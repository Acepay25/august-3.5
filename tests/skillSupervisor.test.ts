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
} from '../services/learning/skillSupervisor';
import { queueSkillDraft, listSkillDrafts, isDraftTombstoned, draftTriggerKey } from '../utils/skillDrafts';
import { proposeForgedTool, loadForgedTools } from '../services/tools/toolForge';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, isSkillFile } from '../services/learning/SkillMemoryService';
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
    vi.mocked(streamChatRequest).mockReset();
    vi.mocked(streamChatRequest).mockImplementation(async function* (): AsyncGenerator<string> {
        yield JSON.stringify(obj);
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
