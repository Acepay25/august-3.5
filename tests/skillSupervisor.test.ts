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
    MAX_ITEMS_PER_PASS, MAX_ITEMS_PER_HOUR, countPendingSupervision,
    getSupervisionSpend, __setSupervisionSpendForTests, overrideVerdict,
} from '../services/learning/skillSupervisor';
import { queueSkillDraft, listSkillDrafts, isDraftTombstoned, draftTriggerKey } from '../utils/skillDrafts';
import { queueLearningProposal, listLearningProposals } from '../utils/learningQueue';
import { proposeForgedTool, loadForgedTools } from '../services/tools/toolForge';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    parseSkillMarkdown, isSkillFile, ingestCraftedSkillFromDraft, listSkills,
    isApprovedSkill,
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

describe("runSupervisorPass — skill drafts (TRIAGE: nothing is created, removed or tombstoned)", () => {
    it("an approve verdict records the judgement and LEAVES the draft in the inbox", async () => {
        queueSkillDraft({ tradeId: 'd1', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical trigger, falsifiable claim, not covered' });
        const handled = await runSupervisorPass(USER, { manual: true });
        expect(handled).toBe(1);
        // CONTRACT CHANGE (2026-10-05): this used to ingest a candidate skill stamped
        // approvedBy: supervisor. The trader asks that nothing model-generated becomes
        // active without their yes, so the draft stays and the verdict is a note.
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(skillFiles()).toHaveLength(0);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('approved');
        expect(decided?.decision?.reason).toMatch(/triaged/i);
        expect(decided?.decision?.createdFileId).toBeUndefined();
    });

    it('an enhance verdict SUGGESTS its wording without applying it', async () => {
        queueSkillDraft({ tradeId: 'd2', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({
            action: 'enhance',
            reason: 'solid core; sharper IF and a real activation key',
            enhanced: {
                ifCondition: 'BTC reclaims the swept prior low on a 15m CLOSE',
                description: 'Enter BTC longs when a liquidity sweep is reclaimed on a 15m close.',
            },
        });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(skillFiles()).toHaveLength(0);
        // The suggestion is in the note the trader reads — that is the whole value.
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.reason).toContain('BTC reclaims the swept prior low on a 15m CLOSE');
        expect(decided?.decision?.reason).toMatch(/triaged/i);
    });

    it('a reject verdict does NOT consume the draft and does NOT tombstone its trigger', async () => {
        const draft = queueSkillDraft({ tradeId: 'd3', coin: 'BTCUSDT', crafted: crafted() }, USER);
        if (!draft) throw new Error('queueSkillDraft stored nothing');
        verdictJson({ action: 'reject', reason: 'duplicate of an existing catalog entry' });
        await runSupervisorPass(USER, { manual: true });
        // A reject used to remove the draft and tombstone the trigger key: the model
        // retiring the trader's own proposal without asking.
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(skillFiles()).toHaveLength(0);
        expect(isDraftTombstoned(draftTriggerKey('BTCUSDT', draft.crafted), USER)).toBe(false);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('rejected');
        expect(decided?.decision?.reason).toMatch(/triaged/i);
    });

    it('a MALFORMED verdict never even records a judgement — the draft stays queued', async () => {
        queueSkillDraft({ tradeId: 'd4', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson('this is not json at all');
        await runSupervisorPass(USER, { manual: true });
        expect(listSkillDrafts(USER)).toHaveLength(1);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('skipped');
        expect(decided?.decision?.createdFileId).toBeUndefined();
    });

    it('the pause toggle blocks automatic passes; a manual run triages without applying', async () => {
        queueSkillDraft({ tradeId: 'd5', coin: 'BTCUSDT', crafted: crafted() }, USER);
        store.setAutoEnabled(false);
        expect(await runSupervisorPass(USER)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
        verdictJson({ action: 'approve', reason: 'mechanical, uncovered, claim holds' });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(listSkillDrafts(USER)).toHaveLength(1);
        store.setAutoEnabled(true);
    });

    it('does not re-read an item it has already triaged', async () => {
        queueSkillDraft({ tradeId: 'd5b', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical, uncovered, claim holds' });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(await runSupervisorPass(USER, { manual: true })).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
    });
});

describe('runSupervisorPass — forged tool candidates (triage only)', () => {
    it('approving a tool does NOT confirm it', async () => {
        proposeForgedTool({
            name: 'fear-greed',
            description: 'Current crypto fear & greed index — use when the user asks about market sentiment.',
            urlTemplate: 'https://api.alternative.me/fng/',
            parameters: {},
        }, 'test');
        verdictJson({ action: 'approve', reason: 'read-only, https, sensible params' });
        await runSupervisorPass(USER, { manual: true });
        // A confirmed tool is callable by every desk seat. That is the trader's call.
        expect(loadForgedTools().find(t => t.proposal.name === 'fear-greed')?.status).toBe('candidate');
        expect(store.getSnapshot().events.find(e => e.itemKind === 'tool' && e.decision)?.decision?.verdict)
            .toBe('approved');
    });

    it('rejecting a tool does NOT retire it', async () => {
        proposeForgedTool({
            name: 'shady-scan',
            description: 'Scans everything.',
            urlTemplate: 'https://api.alternative.me/fng/',
            parameters: {},
        }, 'test');
        verdictJson({ action: 'reject', reason: 'description does not say when a model would use this' });
        await runSupervisorPass(USER, { manual: true });
        expect(loadForgedTools().find(t => t.proposal.name === 'shady-scan')?.status).toBe('candidate');
    });
});

describe('user overrides', () => {
    it('overrideApproveSkill ingests a triaged draft from its stored snapshot — the human path still writes', async () => {
        queueSkillDraft({ tradeId: 'd7', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'reject', reason: 'not convinced' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.decision)!;
        // The model said no; the trader says yes. This is the only path that creates a
        // skill now, and it stamps the human approval itself.
        await overrideApproveSkill(ev.id, USER);
        expect(skillFiles()).toHaveLength(1);
        expect(isApprovedSkill(listSkills()[0].meta)).toBe(true);
        const overridden = store.getSnapshot().events.find(e => e.id === ev.id);
        expect(overridden?.decision?.verdict).toBe('approved');
    });

    it('overrideRejectSkill removes the human-created candidate + tombstones the trigger', async () => {
        queueSkillDraft({ tradeId: 'd6', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'reject', reason: 'not convinced' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.decision)!;
        await overrideApproveSkill(ev.id, USER);
        expect(skillFiles()).toHaveLength(1);
        await overrideRejectSkill(ev.id, USER);
        expect(skillFiles()).toHaveLength(0);
        expect(isDraftTombstoned(draftTriggerKey('BTCUSDT', crafted()), USER)).toBe(true);
        const overridden = store.getSnapshot().events.find(e => e.id === ev.id);
        expect(overridden?.decision?.overriddenByUser).toBe(true);
    });

    it('overrideApproveSkill does NOT report approved when the ingest could not write', async () => {
        queueSkillDraft({ tradeId: 'd7b', coin: 'BTCUSDT', crafted: crafted() }, USER);
        verdictJson({ action: 'reject', reason: 'not convinced' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.decision)!;

        const mf = getMemoryFiles();
        mf.folders = [{ id: 'custom', name: 'my-notes', order: 0 }] as typeof mf.folders;
        mf.files = [];

        const result = await overrideApproveSkill(ev.id, USER);

        expect(result).toEqual({ created: false, reason: 'no-skills-folder' });
        expect(skillFiles()).toHaveLength(0);
        const after = store.getSnapshot().events.find(e => e.id === ev.id);
        expect(after?.decision?.overriddenByUser).not.toBe(true);
    });
});

// ─── WS-2: proposal triage ──────────────────────────────────────────────────
// Every lifecycle proposal is a change to what the trader believes and trades
// on. The supervisor judges them and writes the judgement down; the queue row
// keeps its buttons, which is where the decision now lives.

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

describe('runSupervisorPass — rescope / contradiction proposals (triage only)', () => {
    it('an enhance verdict writes nothing to the skill and leaves the proposal queued', async () => {
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
        // The skill still says what it said. The suggestion is in the note.
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
        expect(listLearningProposals(USER)).toHaveLength(1);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.verdict).toBe('enhanced');
        expect(decided?.decision?.reason).toContain('the 4h trend is up');
        expect(decided?.decision?.reason).toMatch(/triaged/i);
    });

    it('a reject verdict leaves the proposal queued — it does not dismiss it', async () => {
        const slug = await seedSkill();
        queueRescope(slug);
        verdictJson({ action: 'reject', reason: 'the losing trades were a regime shift, not a broken trigger' });
        await runSupervisorPass(USER, { manual: true });
        // Dismissal was the model deleting the trader's own pending change.
        expect(listLearningProposals(USER)).toHaveLength(1);
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.reason).toMatch(/stays queued for you/i);
    });

    it('a proposal whose clauses are stored is quoted back in the note, unchanged', async () => {
        const slug = await seedSkill();
        const stored = {
            ifCondition: 'BTC sweeps the prior low and reclaims while the 4h trend is up',
            thenAction: 'Enter long once the reclaim candle closes above the swept level, trending tapes only',
        };
        queueLearningProposal({
            kind: 'rescope', skillSlug: slug, fingerprint: 'rs-stored',
            text: 'The seat proposed this narrowing.',
            payload: { source: 'model:desk', ...stored },
        }, USER);
        verdictJson({ action: 'approve', reason: 'the stored re-scope is justified by the evidence' });
        await runSupervisorPass(USER, { manual: true });
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
        const decided = store.getSnapshot().events.find(e => e.decision);
        expect(decided?.decision?.reason).toContain(stored.ifCondition);
    });

    it('one pass triages a draft AND a proposal, changing neither', async () => {
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
        expect(await runSupervisorPass(USER, { manual: true })).toBe(2);
        // Both queues are exactly as they were, and the library has not moved.
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(listLearningProposals(USER)).toHaveLength(1);
        expect(listSkills()).toHaveLength(1);
        expect(listSkills()[0].meta.ifCondition).toBe(crafted().ifCondition);
        expect(store.getSnapshot().events.filter(e => e.decision)).toHaveLength(2);
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
        // Under triage a reviewed draft STAYS in the inbox; what drains is the
        // unread backlog (the pending count), not the queue itself.
        expect(listSkillDrafts(USER)).toHaveLength(MAX_ITEMS_PER_PASS + 3);
        expect(countPendingSupervision(USER)).toBe(3);
        expect(store.getSnapshot().pendingCount).toBe(3);
        expect(store.getSnapshot().events.some(e => e.text.includes('3 item(s) still waiting'))).toBe(true);
        // The next sweep finishes the reading — deferral is not abandonment.
        expect(await runSupervisorPass(USER, { manual: true })).toBe(3);
        expect(countPendingSupervision(USER)).toBe(0);
        expect(store.getSnapshot().pendingCount).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(MAX_ITEMS_PER_PASS + 3);
    });
});

// A per-pass cap is not a budget: the debounce and every chat nudge can start
// another 12 calls, so the model could spend indefinitely across passes. The
// session ceiling is what the plan asked for, and a human pressing Run is an
// instruction rather than more autonomous spend — so it overrides.
describe('per-session budget (WS-2.4)', () => {
    it('refuses automatic passes once the session ceiling is spent, but honours a human Run', async () => {
        queueSkillDraft({
            tradeId: 's-1', coin: 'BTCUSDT',
            crafted: {
                ...crafted(), name: 'Rule past the ceiling',
                ifCondition: 'BTC sweeps the prior low on the ceiling probe and the candle closes back above it',
                thenAction: 'Do not short the ceiling probe — the failed sweep removes downside conviction',
            },
        }, USER);
        verdictJson({ action: 'approve', reason: 'mechanical trigger, falsifiable, not covered' });
        __setSupervisionSpendForTests(MAX_ITEMS_PER_HOUR);

        expect(getSupervisionSpend().exhausted).toBe(true);
        expect(await runSupervisorPass(USER)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(store.getSnapshot().events.some(e => e.text.includes('Hourly budget spent'))).toBe(true);

        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        // Triaged, so it stays in the inbox — but it has been READ (spend recorded).
        expect(listSkillDrafts(USER)).toHaveLength(1);
        expect(countPendingSupervision(USER)).toBe(0);
    });
});

// WS-2.3: the human keeps an override on EVERY verdict, not only on skill
// drafts. Each kind goes back through the same status writer a human button
// would have used — and a proposal the model APPLIED is deliberately excluded,
// because that rewrite landed on a file that has its own undo.
describe('overrideVerdict — per-kind override', () => {
    it('a triaged tool candidate can still be walked to retired by the human', async () => {
        proposeForgedTool({
            name: 'fear-greed', description: 'Crypto fear & greed index.',
            urlTemplate: 'https://api.alternative.me/fng/', parameters: {},
        }, 'test');
        verdictJson({ action: 'approve', reason: 'read-only, https, sensible params' });
        await runSupervisorPass(USER, { manual: true });
        const ev = store.getSnapshot().events.find(e => e.itemKind === 'tool' && e.decision)!;
        // The supervisor triaged it; the tool is still a candidate.
        expect(loadForgedTools().find(t => t.id === ev.itemId)?.status).toBe('candidate');
        // The override on an "approved" decision is the walk-BACK: retire it.
        expect(await overrideVerdict(ev.id, USER)).toBe(true);
        expect(loadForgedTools().find(t => t.id === ev.itemId)?.status).toBe('retired');
        expect(store.getSnapshot().events.find(e => e.id === ev.id)!.decision?.overriddenByUser).toBe(true);
        // Reversing an override would flip the tool back without being asked.
        expect(await overrideVerdict(ev.id, USER)).toBe(false);
        expect(loadForgedTools().find(t => t.id === ev.itemId)?.status).toBe('retired');
    });

    it('leaves a rejected proposal in the queue — triage does not drop it', async () => {
        queueLearningProposal({
            kind: 'contradiction', skillSlug: 'btc-range', fingerprint: 'ov-1',
            text: 'Two enabled skills disagree about range-low breaks — settle which trigger holds.',
        }, USER);
        verdictJson({ action: 'reject', reason: 'the two rules cover different regimes' });
        await runSupervisorPass(USER, { manual: true });
        // The model would drop it; under triage the trader's proposal stays queued.
        expect(listLearningProposals(USER).map(p => p.fingerprint)).toContain('ov-1');
    });
});
