/**
 * learningLoopE2E — the "is the loop actually closed?" proof.
 *
 * Walks the WHOLE cycle with every LLM boundary mocked at the transport and
 * ZERO human interaction:
 *   closed trade + post-mortem → syncClosedTradeToNotebook (diary/evidence)
 *   → craftSkillFromPostMortem → gateEvidenceBackedDraft (LLM worth gate)
 *   → runSupervisorPass (the model approves, not a person) → candidate skill
 *   → getMemoryFilesContext injects it → attribution recorded
 *   → applySkillEvidence counts the outcome → the eval verdict demotes it.
 * The ε-holdout is on the same path, so a control run is asserted to see
 * nothing — otherwise the "proof" would pass on a run the experiment
 * deliberately withheld skills from.
 *
 * Plus the WS-3 half: a bot turn reads the shared notebook, writes its lesson
 * back to its own memory.md, and that lesson reaches the NEXT chart analysis
 * for the same coin.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

// No memory model configured: refinement/derivative LLM phases skip and the
// suite exercises the real bookkeeping paths instead.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));

import { getQuickResponse, streamChatRequest } from '../services/providers/GenericProviderService';
import * as supStore from '../services/learning/supervisorStore';
import { runSupervisorPass, setSessionModel } from '../services/learning/skillSupervisor';
import {
    syncClosedTradeToNotebook,
    parseSkillMarkdown,
    applySkillEvidence,
    listSkills,
    setSkillStatus,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { craftSkillFromPostMortem } from '../services/learning/SkillCraftService';
import { gateEvidenceBackedDraft } from '../services/learning/draftGates';
import { recordEvalVerdict, evaluateSkill, type SkillAnalysisRunner } from '../services/learning/SkillEvalService';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import { getRecentMemoryInjections } from '../services/learning/MemoryInjectionService';
import { shouldSkillHoldout } from '../utils/skillHoldout';
import { buildBotSharedMemoryContext, recordBotTurnOutcome, mineBotTurnQuery, botOriginForMessage } from '../services/agents/botLearning';
import { assemblePipelineMemoryContext } from '../hooks/analysisPipeline/memoryContext';
import { listSkillDrafts } from '../utils/skillDrafts';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import type { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';
import type { ProviderConfig } from '../types/provider';

const USER = 'e2e-user';
/** The holdout is a pure hash of the run id, so these are stable. Asserted in
 *  every test that depends on them — if the constants ever flip, this suite
 *  fails loudly instead of silently proving nothing. */
const RUN = 'run-e2e-proof';
const HOLDOUT_RUN = 'run-e2e-1';

const cfg: ProviderConfig = {
    id: 'prov-e2e', name: 'Judge', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['judge-1'], selectedModel: 'judge-1',
};

const makeTrade = (id: string, outcome: TradeOutcome, overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome,
    // Deliberately NO literal IF/THEN clause: that would let the deterministic
    // ingest in syncClosedTradeToNotebook mint the skill itself, and this test
    // is about the LLM craft → worth gate → supervisor chain.
    postMortem: 'Lesson: the sweep reclaim held because the close stayed above the swept level, and the short had no edge once it failed.',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    ...overrides,
});

/** The supervisor streams its verdict; craft + worth gate use the quick
 *  transport. Route the quick mock by the prompt each caller builds. */
const verdictJson = (obj: unknown): void => {
    vi.mocked(streamChatRequest).mockReset();
    vi.mocked(streamChatRequest).mockImplementation(async function* (): AsyncGenerator<string> {
        yield JSON.stringify(obj);
    } as never);
};

const quickJson = (craft: unknown, worth: unknown): void => {
    vi.mocked(getQuickResponse).mockReset();
    vi.mocked(getQuickResponse).mockImplementation((async (_c: ProviderConfig, prompt: string) =>
        String(prompt).includes('EVIDENCE CLUSTER') ? JSON.stringify(worth) : JSON.stringify(craft)) as never);
};

const metaOf = (fileId: string): SkillMeta =>
    parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;

const CRAFTED = {
    name: 'Avoid shorting the failed sweep',
    kind: 'avoid',
    when: 'BTC sweeps the low but closes back above it',
    inputs: ['price', 'candle close'],
    steps: ['Mark the swept prior low', 'Wait for the reclaim close above it', 'Stand down on the short'],
    validate: 'The reclaim candle closed above the swept level',
    output: 'Skip the short',
    approval: 'Only when size or a new coin is involved',
    ifCondition: 'BTC sweeps the prior low but the candle closes back above it',
    thenAction: 'Do not short — the sweep failed and downside conviction is gone',
};

const WORTH_CREATE = {
    verdict: 'create',
    reason: 'The cluster is a losing short on a specific, mechanical reclaim trigger that no catalog skill covers.',
    confidence: 0.8,
    kind: 'avoid',
    ifCondition: CRAFTED.ifCondition,
    thenAction: CRAFTED.thenAction,
    prediction: { expectedLiftPts: 10, horizonTrades: 10, scope: { coin: 'BTC', family: 'Family A' } },
};

beforeEach(async () => {
    store = {};
    supStore.__resetForTests();
    localStorage.clear();
    // Retrieval records injections under getActiveUsername() — the same user
    // the evidence join reads back, or the attribution never lines up.
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    setSessionModel(cfg);
    await initMemoryFiles(USER);
});

describe('the loop, end to end', () => {
    it('trade → craft → worth gate → LLM approve → inject → evidence → demote, zero human clicks', async () => {
        expect(shouldSkillHoldout(RUN)).toBe(false);

        // 1. A closed trade with a post-mortem syncs into the notebook.
        const trade = makeTrade('t-1', 'LOSS' as TradeOutcome);
        await syncClosedTradeToNotebook(trade, [trade], USER);
        const diary = getMemoryFiles().files.filter(f => {
            const folder = getMemoryFiles().folders.find(fd => fd.id === f.folderId);
            return folder?.name === 'trader-diary';
        });
        expect(diary.length).toBeGreaterThan(0);

        // 2. The model crafts a skill from the post-mortem, and the LLM worth
        //    gate — not a human — decides it is worth creating and queues it.
        quickJson(CRAFTED, WORTH_CREATE);
        const crafted = await craftSkillFromPostMortem(trade, cfg);
        expect(crafted).not.toBeNull();
        const gate = await gateEvidenceBackedDraft({
            crafted: crafted!, tradeId: trade.id, cluster: [trade], username: USER, config: cfg, allTrades: [trade],
        });
        expect(gate.action).toBe('queued');
        expect(listSkillDrafts(USER)).toHaveLength(1);

        // 3. The LLM supervisor approves it — the human Save button never fires.
        verdictJson({ action: 'approve', reason: 'mechanical trigger, falsifiable, not covered' });
        expect(await runSupervisorPass(USER, { manual: true })).toBe(1);
        expect(listSkillDrafts(USER)).toHaveLength(0);

        const skills = listSkills();
        expect(skills).toHaveLength(1);
        const skill = skills[0];
        expect(skill.meta.status).toBe('candidate');
        // Cold-start break: an approved draft must be INJECTABLE to earn its
        // first counted sample, or the loop never turns (see SkillMeta.prior).
        expect(skill.meta.prior).toBe('gated');

        // 4. Retrieval serves it to a matching setup, labeled as untested, and
        //    records the attribution the evidence join depends on.
        const setup = { coin: 'BTCUSDT', direction: 'Short', family: 'Family A' };
        const slug = skill.file.name.replace(/\.md$/i, '');
        const opening = getMemoryFilesContext(setup, undefined, 'analyst', 'opening', { runId: RUN });
        expect(opening).toContain(slug);
        expect(opening).toContain('untested');
        const ctx = getMemoryFilesContext(setup, undefined, 'analyst', 'verdict', { runId: RUN });
        expect(ctx).toContain(slug);
        expect(ctx).toContain('no counted evidence yet');
        await new Promise(r => setTimeout(r, 30));
        const recs = await getRecentMemoryInjections(USER);
        expect(recs.some(r => r.runId === RUN && r.sources.some(s => s.path === `skills/${skill.file.name}`))).toBe(true);

        // 4b. An ε-holdout run must NOT see it — the control group is the only
        //     thing that makes the skill's eventual lift claim honest.
        const held = getMemoryFilesContext(setup, undefined, 'analyst', 'verdict', { runId: HOLDOUT_RUN });
        expect(shouldSkillHoldout(HOLDOUT_RUN)).toBe(true);
        expect(held).not.toContain(slug);

        // 5. A trade from the run that saw it moves the tally.
        const before = metaOf(skill.file.id);
        const t2 = makeTrade('t-2', 'WIN' as TradeOutcome, { sourceRunId: RUN });
        await applySkillEvidence(t2, USER, [trade, t2]);
        const after = metaOf(skill.file.id);
        expect(after.wins + after.losses).toBeGreaterThan(before.wins + before.losses);

        // 6. Once confirmed, the CAUSAL eval demotes it without a human: run
        //    the real evaluateSkill over the trade pair, and land its verdict
        //    through the same recorder the scheduler uses. Only the runner is
        //    mocked — with the AVOID rule in the prompt it talks itself into
        //    HIGHER confidence, which is precisely the misalignment the eval
        //    exists to catch. (This used to hand-feed recordEvalVerdict a
        //    verdict string, so the producer was never exercised here.)
        await setSkillStatus(skill.file.id, 'confirmed', USER);
        const hurtsRunner: SkillAnalysisRunner = async (_t, { skillEnabled }) => ({
            confidence: skillEnabled ? 'High' : 'Low',
            direction: 'Short',
        });
        const first = await evaluateSkill(skill.file.id, USER, [trade, t2], cfg, hurtsRunner);
        expect(first.verdict).toBe('hurts');
        await recordEvalVerdict(skill.file.id, first, USER);
        const second = await evaluateSkill(skill.file.id, USER, [trade, t2], cfg, hurtsRunner);
        await recordEvalVerdict(skill.file.id, second, USER);
        const demoted = metaOf(skill.file.id);
        expect(demoted.status).toBe('candidate');
        expect(demoted.history?.[demoted.history.length - 1].reason).toMatch(/^eval hurts/);
    });
});

describe('WS-3: bots read and write the shared loop', () => {
    it('a bot turn reads the shared notebook (retrieval slice keyed on the prompt)', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 2
losses: 6
ifCondition: BTC short into a reclaimed sweep
thenAction: skip the short
tradeIds: a,b,c
---

# Avoid BTC short

**When:** BTC short into a reclaimed sweep
**What I do:** skip.
`, USER, true);
        const ctx = buildBotSharedMemoryContext('BTC looks heavy short here', { botId: 'bot-1', memoryScope: 'global' });
        expect(ctx).toContain('btc-short-avoid');
        expect(buildBotSharedMemoryContext('BTC short', { botId: 'bot-1', memoryScope: 'isolated' })).toBe('');
    });

    it('a bot turn writes its lesson into the bot memory.md', async () => {
        await recordBotTurnOutcome(
            { id: 'bot-1', name: 'Macro', providerId: 'prov-e2e' },
            'BTC short?',
            'Verdict: avoid.\nLesson: BTC shorting a failed sweep is the wrong side — wait for the reclaim close.',
            { username: USER, trades: [] },
        );
        const folder = getMemoryFiles().folders.find(f => f.name === 'bots-bot-1');
        expect(folder).toBeTruthy();
        const mem = getMemoryFiles().files.find(f => f.folderId === folder!.id && f.name === 'memory.md');
        expect(mem?.content).toContain('reclaim close');
    });

    it('a bot lesson reaches the NEXT chart analysis for the same coin', async () => {
        localStorage.setItem(`bots_v1_${USER}`, JSON.stringify({ bots: [{ id: 'bot-1', name: 'Macro' }] }));
        await recordBotTurnOutcome(
            { id: 'bot-1', name: 'Macro', providerId: 'prov-e2e' },
            'BTC short?',
            'Verdict: avoid.\nLesson: BTC shorting a failed sweep is the wrong side — wait for the reclaim close.',
            { username: USER, trades: [] },
        );
        const ctx = assemblePipelineMemoryContext('BTC short family a', [], null, RUN);
        expect(ctx.memoryFilesContext).toContain('failed sweep');
    });

    it('mineBotTurnQuery extracts the setup the same way the pipeline does', () => {
        expect(mineBotTurnQuery('BTC long here?')).toMatchObject({ coin: 'BTC', direction: 'Long' });
        expect(mineBotTurnQuery('thoughts on the market')).toMatchObject({ direction: 'Neutral' });
        // The fork used to stop at coin+direction, so a bot asking about a
        // fakeout retrieved on a weaker query than the analyst seat beside it.
        expect(mineBotTurnQuery('BTC fakeout short here'))
            .toMatchObject({ coin: 'BTC', direction: 'Short', family: 'Family A', pattern: 'Family A' });
    });

    it('the bot turn records what the budget REALLY injected, under its own run id', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-sweep-reclaim.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 3
losses: 1
ifCondition: BTC short into a reclaimed sweep on the 15m
thenAction: skip the short
tradeIds: a,b,c,d,e
originBotId: bot-1
originBotName: Macro
---

# Avoid BTC short after a reclaimed sweep

**When:** BTC short into a reclaimed sweep
**What I do:** skip.
`, USER, true);

        const ctx = buildBotSharedMemoryContext('BTC fakeout short here', {
            botId: 'bot-1', memoryScope: 'global', runId: RUN,
        });
        expect(ctx).toContain('btc-sweep-reclaim');
        // WS-3.3: the block says WHO taught it, so a bot's rule does not
        // arrive at the next reader looking like an anonymous house rule.
        expect(ctx).toContain('from @Macro');

        // The recorder is fire-and-forget behind two dynamic imports, so give
        // it a tick — the same way the turn itself never waits on telemetry.
        await vi.waitFor(async () => {
            const recs = await getRecentMemoryInjections(USER);
            expect(recs.find(r => r.runId === RUN)?.sources.some(s => s.path.includes('btc-sweep-reclaim'))).toBe(true);
        });
    });

    it('a one-pair reply resolves to that bot as the trade author; a verdict does not', () => {
        localStorage.setItem(`agents_bots_v1_${USER}`, JSON.stringify([
            { id: 'bot-1', name: 'Macro', providerId: 'prov-e2e', modelId: 'm-1' },
        ]));
        expect(botOriginForMessage({ 'prov-e2e': 'm-1' })).toEqual({ botId: 'bot-1', botName: 'Macro' });
        // An ensemble verdict answers with several providers at once — there is
        // no single authoring bot, so it must stay on the chart-AI path.
        expect(botOriginForMessage({ 'prov-e2e': 'm-1', other: 'm-2' })).toBeNull();
        expect(botOriginForMessage(undefined)).toBeNull();
        expect(botOriginForMessage({ nobody: 'not-a-model' })).toBeNull();
    });
});
