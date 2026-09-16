/**
 * draftGates — the shared quality bar every skill-draft source passes. The
 * deterministic tier must refuse tombstoned/duplicate/covered/generic drafts
 * and always attach a falsifiable prediction; the evidence tier must honor
 * the worth gate's create/merge/skip verdicts (merge folds the outcome into
 * the existing skill instead of queueing a twin) and fall back to the
 * deterministic bar when the gate itself fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));

import { getQuickResponse } from '../services/providers/GenericProviderService';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import {
    deterministicDraftGate, gateEvidenceBackedDraft, buildSyntheticTrade, validateIfThen,
    coveredByLiveSkill,
} from '../services/learning/draftGates';
import { queueSkillDraft, listSkillDrafts, tombstoneSkillDraftKey, draftTriggerKey } from '../utils/skillDrafts';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import { TradeOutcome, type LoggedTrade } from '../types';
import type { ProviderConfig } from '../types/provider';
import type { CraftedSkill } from '../schemas/learning';

const USER = 'gate-user';
const cfg = {
    id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm',
} as ProviderConfig;

const crafted = (over: Partial<CraftedSkill> = {}): CraftedSkill => ({
    name: 'Repeat BTC sweep reclaim',
    kind: 'repeat',
    when: 'BTC sweeps the lows and reclaims within a bar or two',
    inputs: ['price'],
    steps: ['Watch the sweep', 'Enter the reclaim'],
    validate: 'Sweep plus reclaim confirmed on the close',
    output: 'Long entry',
    approval: 'draft until the human allows it',
    ifCondition: 'BTC long reclaim after a liquidity sweep of the prior low',
    thenAction: 'Enter long once the reclaim candle closes above the swept level',
    ...over,
});

const makeTrade = (id: string, outcome: TradeOutcome): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        detectedPatternFamily: 'sweep',
        entryPoints: [{ price: '100' }],
        stopLoss: '90',
        takeProfit: [{ price: '110' }],
    } as LoggedTrade['analysis'],
    outcome,
    timestamp: new Date().toISOString(),
    postMortem: 'Waited for the reclaim close; it never came back to the level.',
});

beforeEach(() => {
    localStorage.clear();
    vi.mocked(getQuickResponse).mockReset();
    return initMemoryFiles(USER);
});

describe('deterministicDraftGate', () => {
    it('attaches a falsifiable default prediction when the source has none', () => {
        const out = deterministicDraftGate({ crafted: crafted(), tradeId: 't1', username: USER });
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.crafted.prediction).toBeTruthy();
            expect(out.crafted.prediction!.expectedLiftPts).toBeGreaterThan(0);
            expect(out.crafted.prediction!.horizonTrades).toBeGreaterThan(0);
        }
    });

    it('keeps an existing prediction and leaves the craft untouched', () => {
        const withP = crafted({ prediction: { expectedLiftPts: 20, horizonTrades: 15, scope: { coin: 'BTC' } } });
        const out = deterministicDraftGate({ crafted: withP, tradeId: 't1', username: USER });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.crafted.prediction!.expectedLiftPts).toBe(20);
    });

    it('refuses a tombstoned trigger', () => {
        tombstoneSkillDraftKey(draftTriggerKey('BTCUSDT', crafted()), USER);
        const out = deterministicDraftGate({ crafted: crafted(), tradeId: 't1', username: USER, coin: 'BTCUSDT' });
        expect(out).toMatchObject({ ok: false });
    });

    it('refuses a second pending draft with the same trigger', () => {
        queueSkillDraft({ tradeId: 'pending-1', coin: 'BTCUSDT', crafted: crafted() }, USER);
        const out = deterministicDraftGate({ crafted: crafted(), tradeId: 'pending-2', username: USER, coin: 'BTCUSDT' });
        expect(out).toMatchObject({ ok: false, reason: expect.stringContaining('identical draft') });
    });

    it('refuses a setup a live skill already covers', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'covered-skill.md', `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Long
wins: 1
losses: 0
ifCondition: BTC long reclaim after a liquidity sweep of the prior low
thenAction: Enter long once the reclaim candle closes above the swept level
---

# Covered
`, USER, true);
        const out = deterministicDraftGate({ crafted: crafted(), tradeId: 't1', username: USER, coin: 'BTCUSDT' });
        expect(out).toMatchObject({ ok: false, reason: expect.stringContaining('existing skill') });
    });

    it('refuses generic or stub IF/THEN clauses', () => {
        expect(validateIfThen(crafted({ ifCondition: 'follow trend' }))).toMatch(/generic/);
        expect(validateIfThen(crafted({ ifCondition: 'short' }))).toMatch(/too short/);
        expect(deterministicDraftGate({ crafted: crafted({ ifCondition: 'follow trend' }), tradeId: 't1', username: USER }).ok).toBe(false);
    });
});

describe('coverage dedupe is STRICT (coin/family/overlap, not vibes)', () => {
    const seedSkill = async (content: string, name: string) => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, name, content, USER, true);
    };

    it('a DIRECTION-ONLY skill does NOT cover same-direction drafts on other coins', async () => {
        // The loose matcher scored direction-equality alone as coverage, so
        // one direction-only skill answered "an existing skill already
        // covers this" for EVERY same-direction draft on EVERY coin and
        // silently silenced all future drafts for them.
        await seedSkill(`---
status: confirmed
kind: avoid
direction: Short
wins: 3
losses: 0
ifCondition: shorts into rising funding get squeezed
thenAction: skip the short
tradeIds: a,b,c
---

# Direction-only avoid
`, 'direction-only.md');
        expect(coveredByLiveSkill(
            crafted({ ifCondition: 'ETH short fade into the daily supply zone', kind: 'avoid' }),
            'ETHUSDT', 'Short', undefined,
        )).toBe(false);
        // …while a skill that genuinely shares the coin still covers.
        await seedSkill(`---
status: confirmed
kind: avoid
coin: ETHUSDT
direction: Short
wins: 3
losses: 0
ifCondition: ETH short fade into the daily supply zone
thenAction: skip the short
tradeIds: d,e,f
---

# ETH-scoped avoid
`, 'eth-scoped.md');
        expect(coveredByLiveSkill(
            crafted({ ifCondition: 'ETH short fade into the daily supply zone', kind: 'avoid' }),
            'ETHUSDT', 'Short', undefined,
        )).toBe(true);
    });

    it('a same-FAMILY skill on a DIFFERENT coin does NOT suppress the draft', async () => {
        // skillStrictlyMatchesSetup returns true on sameFamily WITHOUT
        // looking at the coin, and it ran ABOVE the different-coin guard —
        // so that guard was dead and a BTC sweep skill suppressed every
        // ETH sweep draft. Coin agreement is now a prerequisite for
        // coverage: the guard runs first.
        await seedSkill(`---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Long
family: sweep
wins: 5
losses: 1
ifCondition: BTC long reclaim after a liquidity sweep of the prior low
thenAction: take the reclaim
tradeIds: a,b,c,d,e
---

# BTC sweep reclaim
`, 'btc-sweep.md');
        expect(coveredByLiveSkill(
            crafted({ ifCondition: 'ETH long reclaim after a liquidity sweep of the prior low' }),
            'ETHUSDT', 'Long', 'sweep',
        )).toBe(false);
        // …while the same-coin path still covers.
        expect(coveredByLiveSkill(
            crafted({ ifCondition: 'BTC long reclaim after a liquidity sweep of the prior low' }),
            'BTCUSDT', 'Long', 'sweep',
        )).toBe(true);
    });
});

describe('buildSyntheticTrade', () => {
    it('maps a scored thesis onto the LoggedTrade evidence shape', () => {
        const t = buildSyntheticTrade({ id: 'fp-1', coin: 'BTCUSDT', direction: 'Short', outcome: 'loss', thesis: 'fade the wick', atMs: 1_700_000_000_000 });
        expect(t.id).toBe('fp-1');
        expect(t.outcome).toBe(TradeOutcome.LOSS);
        expect(t.analysis.direction).toBe('Short');
        expect(t.analysis.coinName).toBe('BTCUSDT');
        expect(t.postMortem).toBe('fade the wick');
        const w = buildSyntheticTrade({ id: 'fp-2', direction: 'Long', outcome: 'win', thesis: 'x', atMs: 1 });
        expect(w.outcome).toBe(TradeOutcome.WIN);
        expect(w.analysis.direction).toBe('Long');
    });
});

describe('gateEvidenceBackedDraft (worth gate wired)', () => {
    const worthJson = (verdict: string, extra: Record<string, unknown> = {}): string =>
        JSON.stringify({
            verdict,
            reason: 'a specific mechanical setup with a testable claim',
            confidence: 0.8,
            kind: 'repeat',
            ifCondition: 'BTC reclaims the swept low on a 15m close',
            thenAction: 'Enter the long on the reclaim close',
            ...extra,
        });

    it('a create verdict queues the draft carrying the gate prediction', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(worthJson('create', {
            prediction: { expectedLiftPts: 12, horizonTrades: 10, scope: { coin: 'BTC', family: 'sweep' } },
        }));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg, coin: 'BTCUSDT', direction: 'Long', family: 'sweep',
        });
        expect(res.action).toBe('queued');
        const drafts = listSkillDrafts(USER);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].crafted.prediction!.expectedLiftPts).toBe(12);
        expect(drafts[0].crafted.ifCondition).toBe('BTC reclaims the swept low on a 15m close');
    });

    it('a create verdict WITHOUT a prediction is rejected fail-closed — a JUDGED skip', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(worthJson('create'));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg,
        });
        expect(res.action).toBe('skipped');
        // The LLM judged it and validateCraftedSkill rejected the artifact:
        // thesis scanners must fingerprint it, not re-run the gate forever.
        expect(res.action === 'skipped' && res.judged).toBe(true);
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('a merge verdict folds the outcome into the covering skill — no draft', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'sweep-reclaim.md', `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Long
wins: 2
losses: 0
ifCondition: BTC long sweep reclaim
thenAction: take the reclaim
tradeIds: a,b
---

# Sweep reclaim
`, USER, true);
        vi.mocked(getQuickResponse).mockResolvedValue(worthJson('merge', { mergeTarget: 'sweep-reclaim' }));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg,
        });
        expect(res.action).toBe('merged');
        expect(res.action === 'merged' && res.target).toBe('sweep-reclaim');
        expect(listSkillDrafts(USER)).toHaveLength(0);
        const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.name === 'sweep-reclaim.md')!.content);
        expect(meta!.wins).toBe(3);
        expect(meta!.tradeIds).toContain('fp-1');
    });

    it('a skip verdict queues nothing — it is a JUDGED reject, not a transient skip', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(worthJson('skip'));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg,
        });
        expect(res.action).toBe('skipped');
        // The worth gate spent an LLM call and said no: pre-judgment callers
        // must NOT retry this every 10 minutes.
        expect(res.action === 'skipped' && res.judged).toBe(true);
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('a merge verdict without a target is a JUDGED reject (malformed artifact, retrying re-pays the LLM)', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(worthJson('merge'));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg,
        });
        expect(res.action).toBe('skipped');
        expect(res.action === 'skipped' && res.judged).toBe(true);
    });

    it('a tombstone cooldown is a NEVER-JUDGED skip (the idea must stay retryable)', async () => {
        tombstoneSkillDraftKey(draftTriggerKey('BTCUSDT', crafted()), USER);
        vi.mocked(getQuickResponse).mockClear();
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg,
        });
        expect(res.action).toBe('skipped');
        // Short-circuited BEFORE the worth gate — nothing was judged, so a
        // later pass is allowed to retry once the cooldown expires.
        expect(res.action === 'skipped' && res.judged === undefined).toBe(true);
        expect(getQuickResponse).not.toHaveBeenCalled();
    });

    it('a gate failure falls back to the deterministic bar (draft still queues)', async () => {
        vi.mocked(getQuickResponse).mockRejectedValue(new Error('no provider'));
        const res = await gateEvidenceBackedDraft({
            crafted: crafted(), tradeId: 'fp-1', cluster: [makeTrade('fp-1', TradeOutcome.WIN)],
            username: USER, config: cfg, coin: 'BTCUSDT', direction: 'Long',
        });
        expect(res.action).toBe('queued');
        const drafts = listSkillDrafts(USER);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].crafted.prediction).toBeTruthy();
    });
});
