/**
 * skillSupervisor — the LLM that supervises the approval queues. The verdict
 * call is mocked at the transport; the apply paths must land EXACTLY where
 * the human buttons land: approve/enhance → candidate skill (with the
 * enhanced fields), reject → tombstone, malformed verdict → fail-safe (the
 * draft stays with the human), pause honored, tool candidates confirmed/
 * retired, and user overrides reversible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));

import { streamChatRequest } from '../services/providers/GenericProviderService';
import * as store from '../services/learning/supervisorStore';
import {
    runSupervisorPass, setSessionModel, overrideApproveSkill, overrideRejectSkill,
    MAX_ITEMS_PER_PASS, countPendingSupervision,
} from '../services/learning/skillSupervisor';
import { queueSkillDraft, listSkillDrafts, isDraftTombstoned, draftTriggerKey } from '../utils/skillDrafts';
import { queueLearningProposal, listLearningProposals } from '../utils/learningQueue';
import { proposeForgedTool, loadForgedTools } from '../services/tools/toolForge';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    parseSkillMarkdown, isSkillFile, ingestCraftedSkillFromDraft, listSkills, setSkillStatus,
} from '../services/learning/SkillMemoryService';
import type { ProviderConfig } from '../types/provider';

const USER = 'sup-user';
const cfg: ProviderConfig = {
    id: 'prov-s', name: 'Supervisor', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['judge-1'], selectedModel: 'judge-1',
};

const crafted = () => ({
    name: 'Repeat BTC sweep reclaim',
    kind: 'repeat' as const,
    when: 'BTC sweeps the lows and reclaims within a bar or two',
    inputs: ['price'],
    steps: ['Watch the sweep', 'Enter the reclaim'],
    validate: 'Sweep plus reclaim confirmed on the close',
    output: 'Long entry',
    approval: 'draft until allowed',
    ifCondition: 'BTC long reclaim after a liquidity sweep of the prior low',
    thenAction: 'Enter long once the reclaim candle closes above the swept level',
});

const verdictJson = (obj: unknown): void => {
    verdictSeq(obj);
};

/** One pass calls the model once per queue item, in order. Later items reuse
 *  the LAST entry, so a two-item drain test can give each its own verdict. */
const verdictSeq = (...objs: unknown[]): void => {
    vi.mocked(streamChatRequest).mockReset();
    let i = 0;
    vi.mocked(streamChatRequest).mockImplementation(async function* (): AsyncGenerator<string> {
        const obj = objs[Math.min(i, objs.length - 1)];
        i += 1;
        yield typeof obj === 'string' ? obj : JSON.stringify(obj);
    } as never);
};

const skillFiles = (): Array<{ name: string } & Record<string, unknown>> =>
    getMemoryFiles().files.filter(isSkillFile).map(f => ({
        name: f.name,
        ...parseSkillMarkdown(f.content),
    }) as { name: string } & Record<string, unknown>);

beforeEach(async () => {
    store.__resetForTests();
    vi.mocked(streamChatRequest).mockReset();
    localStorage.clear();
    setSessionModel(cfg);
    await initMemoryFiles(USER);
});

describe('runSupervisorPass — skill drafts', () => {
    it('an approve verdict ingests the draft as a candidate skill (the human "Save as skill" path)', async () => {
        queueSkillDraft({ tradeId: 'd1', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical trigger, falsifiable claim, not covered' });
        const handled = await runSupervisorPass(USER, { manual: true });
        expect(handled).toBe(1);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        const skills = skillFiles();
        expect(skills).toHaveLength(1);
        expect(skills[0].status).toBe('candidate');
        expect(skills[0].ifCondition).toBe('BTC long reclaim after a liquidity sweep of the prior low');
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('approved');
        expect(decided?.decision?.createdFileId).toBeTruthy();
    });

    it('the verdict reason is persisted ON the skill — the audit survives the session log', async () => {
        queueSkillDraft({ tradeId: 'd-why', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical reclaim trigger, falsifiable, not covered by the catalog' });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkills()[0].meta.whyAccepted)
            .toBe('mechanical reclaim trigger, falsifiable, not covered by the catalog');
        // Round-trips through the file itself, not an in-memory sidecar.
        expect(getMemoryFiles().files.find(f => f.id === listSkills()[0].file.id)!.content)
            .toContain('whyAccepted:');
    });

    it('an enhance verdict applies the enhanced fields (activation description lands in the meta)', async () => {
        queueSkillDraft({ tradeId: 'd2', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({
            action: 'enhance',
            reason: 'solid core; sharper IF and a real activation key',
            enhanced: {
                ifCondition: 'BTC reclaims the swept prior low on a 15m CLOSE',
                description: 'Enter BTC longs when a liquidity sweep is reclaimed on a 15m close — use after a sweep into a tested support.',
            },
        });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkillDrafts(USER)).toHaveLength(0);
        const skills = skillFiles();
        expect(skills[0].ifCondition).toBe('BTC reclaims the swept prior low on a 15m CLOSE');
        expect(skills[0].description).toContain('liquidity sweep is reclaimed');
    });

    it('a reject verdict tombstones the trigger exactly like the human Discard', async () => {
        const draft = queueSkillDraft({ tradeId: 'd3', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'reject', reason: 'duplicate of an existing catalog entry' });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkillDrafts(USER)).toHaveLength(0);
        expect(skillFiles()).toHaveLength(0);
        expect(isDraftTombstoned(draftTriggerKey('BTCUSDT', draft.crafted), USER)).toBe(true);
    });

    it('a MALFORMED verdict never auto-applies — the draft stays queued for the human', async () => {
        queueSkillDraft({ tradeId: 'd4', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson('this is not json at all');
        await runSupervisorPass(USER, { manual: true });
        expect(listSkillDrafts(USER)).toHaveLength(1);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('skipped');
        expect(decided?.decision?.createdFileId).toBeUndefined();
    });

    it('the pause toggle blocks automatic passes; manual runs still work', async () => {
        queueSkillDraft({ tradeId: 'd5', coin: 'BTCUSDT', crafted: crafted() }, USER);
        store.setAutoEnabled(false);
        expect(await runSupervisorPass(USER)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
        verdictJson({ action: 'approve', reason: 'mechanical, uncovered, claim holds' });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        store.setAutoEnabled(true);
    });
});

describe('runSupervisorPass — forged tool candidates', () => {
    it('approves a sound tool candidate to confirmed', async () => {
        proposeForgedTool({
            name: 'fear-greed',
            description: 'Current crypto fear & greed index — use when the user asks about market sentiment.',
            urlTemplate: 'https://api.alternative.me/fng/',
            parameters: {},
        }, 'test');
        verdictJson({ action: 'approve', reason: 'read-only, https, sensible params' });
        await runSupervisorPass(USER, { manual: true });
        expect(loadForgedTools().find(t => t.proposal.name === 'fear-greed')?.status).toBe('confirmed');
    });

    it('retires a rejected tool candidate', async () => {
        proposeForgedTool({
            name: 'shady-scan',
            description: 'Scans everything.',
            urlTemplate: 'https://api.alternative.me/fng/',
            parameters: {},
        }, 'test');
        verdictJson({ action: 'reject', reason: 'description does not say when a model would use this' });
        await runSupervisorPass(USER, { manual: true });
        expect(loadForgedTools().find(t => t.proposal.name === 'shady-scan')?.status).toBe('retired');
    });
});

describe('user overrides', () => {
    it('overrideRejectSkill removes the created candidate + tombstones the trigger', async () => {
        queueSkillDraft({ tradeId: 'd6', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical, uncovered, claim holds' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.decision)!;
        expect(skillFiles()).toHaveLength(1);
        await overrideRejectSkill(ev.id, USER);
        expect(skillFiles()).toHaveLength(0);
        expect(isDraftTombstoned(draftTriggerKey('BTCUSDT', crafted()), USER)).toBe(true);
        const overridden = store.getSnapshot().events.find(e => e.id === ev.id);
        expect(overridden?.decision?.overriddenByUser).toBe(true);
        expect(overridden?.decision?.verdict).toBe('rejected');
    });

    it('overrideApproveSkill ingests a rejected draft from its stored snapshot', async () => {
        queueSkillDraft({ tradeId: 'd7', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'reject', reason: 'not convinced' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.decision)!;
        await overrideApproveSkill(ev.id, USER);
        expect(skillFiles()).toHaveLength(1);
        const overridden = store.getSnapshot().events.find(e => e.id === ev.id);
        expect(overridden?.decision?.verdict).toBe('approved');
    });
});

// ─── WS-2: proposal actuation ────────────────────────────────────────────────
// rescope/contradiction are the two kinds that need a model-AUTHORED rewrite —
// there is nothing mechanical to apply. The model must either supply a clause
// that clears the same IF/THEN bar a fresh draft clears, or leave the proposal
// queued for the human. A bare "approve" is not allowed to silently drain it.

const seedSkill = async (over: Partial<ReturnType<typeof crafted>> = {}): Promise<string> => {
    await ingestCraftedSkillFromDraft({ ...crafted(), ...over } as never, 'BTCUSDT', USER);
    return listSkills()[0].file.name.replace(/\.md$/i, '');
};

const queueRescope = (skillSlug: string, fingerprint = 'rs-1'): void => {
    queueLearningProposal({
        kind: 'rescope', skillSlug, fingerprint,
        text: `${skillSlug} fires in ranging tapes too and loses there — narrow the trigger to trending.`,
    }, USER);
};

describe('runSupervisorPass — rescope / contradiction proposals', () => {
    it('an enhance verdict writes the rewritten clause and drains the proposal', async () => {
        const slug = await seedSkill();
        queueRescope(slug);
        verdictJson({
            action: 'enhance',
            reason: 'the trigger is right except for regime; narrow it mechanically',
            enhanced: {
                ifCondition: 'BTC long reclaim after a liquidity sweep while the 4h trend is up',
                thenAction: 'Enter long once the reclaim candle closes above the swept level, trending tapes only',
            },
        });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(listLearningProposals(USER)).toHaveLength(0);
        const meta = listSkills()[0].meta;
        expect(meta.ifCondition).toBe('BTC long reclaim after a liquidity sweep while the 4h trend is up');
        expect(meta.thenAction).toContain('trending tapes only');
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('enhanced');
    });

    it('a rewrite of a CONFIRMED skill demotes it — the new claim must re-prove itself', async () => {
        const slug = await seedSkill();
        await setSkillStatus(listSkills()[0].file.id, 'confirmed', USER);
        queueRescope(slug);
        verdictJson({
            action: 'enhance',
            reason: 'narrow to the reclaim close',
            enhanced: {
                ifCondition: 'BTC reclaims the swept prior low on a 15m CLOSE',
                thenAction: 'Enter long only after that reclaim close prints, never on the wick',
            },
        });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkills()[0].meta.status).toBe('candidate');
    });

    it('a bare "approve" carries no clause — the proposal STAYS queued for the human', async () => {
        const slug = await seedSkill();
        queueRescope(slug);
        verdictJson({ action: 'approve', reason: 'the rescope looks justified on the evidence' });
        await runSupervisorPass(USER, { manual: true });
        expect(listLearningProposals(USER)).toHaveLength(1);
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('skipped');
        expect(decided?.decision?.reason).toMatch(/stays for the human/);
    });

    it('a vague rewrite fails the same IF/THEN bar a draft must clear', async () => {
        const slug = await seedSkill();
        queueRescope(slug);
        verdictJson({
            action: 'enhance',
            reason: 'tighten it a bit',
            // Passes the schema's length floor but is exactly the boilerplate
            // the deterministic gate exists to refuse.
            enhanced: {
                ifCondition: 'Be careful with BTC longs after a sweep',
                thenAction: 'Manage risk and size down on the reclaim entry',
            },
        });
        await runSupervisorPass(USER, { manual: true });
        expect(listLearningProposals(USER)).toHaveLength(1);
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
    });

    it('a reject verdict dismisses the proposal without touching the skill', async () => {
        const slug = await seedSkill();
        queueRescope(slug);
        verdictJson({ action: 'reject', reason: 'the losing trades were a regime shift, not a broken trigger' });
        await runSupervisorPass(USER, { manual: true });
        expect(listLearningProposals(USER)).toHaveLength(0);
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
    });

    it('a rewrite aimed at a skill that no longer exists leaves the queue intact', async () => {
        queueRescope('ghost-skill');
        verdictJson({
            action: 'enhance',
            reason: 'narrow the trigger mechanically',
            enhanced: {
                ifCondition: 'BTC reclaims the swept prior low on a 15m CLOSE',
                thenAction: 'Enter long only after that reclaim close prints',
            },
        });
        await runSupervisorPass(USER, { manual: true });
        expect(listLearningProposals(USER)).toHaveLength(1);
    });

    it('one pass drains drafts AND proposals with no human in the loop', async () => {
        const slug = await seedSkill({ name: 'Fade the SOL range low' });
        queueSkillDraft({
            tradeId: 'd8', coin: 'ETHUSDT',
            crafted: {
                ...crafted(), name: 'Repeat ETH reclaim',
                ifCondition: 'ETH reclaims the swept prior low on a 15m close',
                thenAction: 'Enter ETH long once that reclaim candle closes above the swept level',
            },
        }, USER);
        queueLearningProposal({
            kind: 'contradiction', skillSlug: slug, fingerprint: 'ct-1',
            text: 'Two enabled skills disagree about range-low breaks — settle which trigger holds.',
        }, USER);
        verdictSeq(
            { action: 'approve', reason: 'mechanical, falsifiable, not covered' },
            {
                action: 'enhance',
                reason: 'the contradiction is real; scope this one to funding',
                enhanced: {
                    ifCondition: 'SOL breaks the 4h range low while funding is still positive',
                    thenAction: 'Skip the SOL short until funding flips negative on the break',
                },
            },
        );
        const handled = await runSupervisorPass(USER, { manual: true });
        expect(handled).toBe(2);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        expect(listLearningProposals(USER)).toHaveLength(0);
        // The draft landed as a skill AND the proposal's rewrite landed on it
        // the other skill — both queues emptied through the model alone.
        expect(listSkills().map(s => s.meta.ifCondition)).toContain(
            'SOL breaks the 4h range low while funding is still positive',
        );
    });
});


// ─── WS-2.4: budget honesty ──────────────────────────────────────────────────
// One pass spends a bounded number of provider calls. A backlog it does not
// reach must be COUNTED and VISIBLE — silent deferral reads as a healthy,
// idle supervisor while drafts pile up.

describe('per-pass call budget', () => {
    it('stops at the cap and reports exactly how many items are still waiting', async () => {
        for (let i = 0; i < MAX_ITEMS_PER_PASS + 3; i++) {
            queueSkillDraft({
                tradeId: `b${i}`, coin: 'BTCUSDT',
                crafted: {
                    ...crafted(),
                    name: `Rule number ${i}`,
                    ifCondition: `BTC sweeps the prior low on attempt ${i} and the candle closes back above it`,
                    thenAction: `Do not short attempt ${i} — the failed sweep removes downside conviction`,
                },
            }, USER);
        }
        expect(countPendingSupervision(USER)).toBe(MAX_ITEMS_PER_PASS + 3);
        verdictJson({ action: 'approve', reason: 'mechanical trigger, falsifiable, not covered' });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(MAX_ITEMS_PER_PASS);
        expect(listSkillDrafts(USER)).toHaveLength(3);
        expect(store.getSnapshot().pendingCount).toBe(3);
        expect(store.getSnapshot().events.some(e => e.text.includes('3 item(s) still waiting'))).toBe(true);
        // The next sweep finishes the job — deferral is not abandonment.
        expect(await runSupervisorPass(USER, { manual: true })).toBe(3);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        expect(store.getSnapshot().pendingCount).toBe(0);
    });
});
