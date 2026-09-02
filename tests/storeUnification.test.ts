/**
 * Store unification (plan §8.1) — the attributed-insight store now lives in
 * the trader notebook (distilled/ memory files) instead of a standalone
 * Preferences key.
 *
 * The load-bearing gate snapshot: generateMandatoryPatternCheck must emit
 * IDENTICAL verdicts over a fixture trade log pre/post migration. The gate
 * code itself is untouched by the migration — these expected strings are the
 * pre-migration output, pinned here so a backend regression cannot silently
 * change what the moderator is told.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateMandatoryPatternCheck,
    addAttributedInsight,
    loadAttributedInsights,
    markInsightSurfaced,
    recordInsightFeedback,
    initPatternMemoryService,
    setAttributedInsightsUser,
} from '../services/learning/PatternMemorySynthesisService';
import {
    loadDistilledFacts,
    writeDistilledFact,
    flushDistilledWrites,
    normalizeInsightFingerprint,
    DISTILLED_FACT_CAP,
} from '../services/learning/distilledMemory';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { PREF_KEYS } from '../services/infrastructure/PreferencesService';
import { LoggedTrade, TradeOutcome } from '../types';

let userCounter = 0;
const freshUser = async (): Promise<string> => {
    const username = `store-unify-${++userCounter}`;
    setAttributedInsightsUser(username);
    await initMemoryFiles(username);
    return username;
};

const makeLossTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    outcome: TradeOutcome.LOSS,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        tradeType: 'swing',
        confidence: 'Medium',
        probability: 60,
        grade: 'C',
        strategy: 'Trend continuation',
        activeStrategies: [],
        entryPoints: [{ description: 'retest', price: '69,500' }],
        stopLoss: '69,000',
        takeProfit: [{ price: '71,000', percentage: '100%' }],
        marketConditions: { pattern: 'Breakout', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
        historicalCorrelation: '',
        validityDurationMinutes: 330,
        detectedPatternFamily: 'Family C',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    ...overrides,
});

const setup = { coin: 'BTC', direction: 'Long' as const, family: 'Family C', pattern: 'Breakout' };

beforeEach(() => { /* each test seeds its own user */ });

describe('generateMandatoryPatternCheck — verdict snapshot over notebook-backed facts', () => {
    it('emits the pre-migration HALT verdict for 3 similar losses', async () => {
        await freshUser();
        const trades = [
            makeLossTrade({ id: 'snap-1' }),
            makeLossTrade({ id: 'snap-2' }),
            makeLossTrade({ id: 'snap-3' }),
        ];
        const gate = generateMandatoryPatternCheck(setup, trades);
        expect(gate.gateResult).toBe('HALT');
        expect(gate.allowed).toBe(false);
        // Snapshot: exact pre-migration strings (gate code unchanged by §8.1).
        expect(gate.reason).toBe('📛 HALT: 3 of the most similar historical trades were LOSSES. Pattern has consistent failure mode.');
        expect(gate.mandatoryQuestions).toEqual([
            'What fundamental change would make this trade succeed where others failed?',
        ]);
    });

    it('emits the pre-migration severity HALT verdict + quotes the notebook severity fact', async () => {
        await freshUser();
        // Two losses bleeding -3R each: sumLossR = -6 ≤ -4, lossesWithR = 2.
        const trades = [
            makeLossTrade({ id: 'snap-s1', correctedStopLoss: '68,000' }),
            makeLossTrade({ id: 'snap-s2', correctedStopLoss: '68,000' }),
        ];
        // The severity lesson lives as a distilled/ notebook fact.
        addAttributedInsight({
            id: 'severity-cluster-BTCUSDT-Family C-Long',
            insight: 'Cumulative R-loss -6R across 2 similar losses (Family C BTCUSDT Long) — severity is the failure mode.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'coin',
            scope: 'BTCUSDT',
            tradeId: 'snap-s1',
        });
        const gate = generateMandatoryPatternCheck(setup, trades);
        expect(gate.gateResult).toBe('HALT');
        expect(gate.reason).toBe('📛 HALT: Cumulative R-loss is -6R across 2 similar losses (avg -3R). Few-but-deep failure pattern — magnitude and frequency both confirm.');
        expect(gate.mandatoryQuestions).toEqual([
            'The pattern has not just repeated, it has bled severely. What evidence shows the next attempt will not repeat the same depth of loss?',
            'Your pattern memory records: "Cumulative R-loss -6R across 2 similar losses (Family C BTCUSDT Long) — severity is the failure mode." — what is structurally different about THIS trade that breaks the pattern?',
        ]);
        expect(gate.severityInsights).toHaveLength(1);
        expect(gate.severityInsights[0].id).toBe('severity-cluster-BTCUSDT-Family C-Long');
    });

    it('emits PASS with insufficient data when the log is empty', async () => {
        await freshUser();
        const gate = generateMandatoryPatternCheck(setup, []);
        expect(gate.gateResult).toBe('PASS');
        expect(gate.reason).toBe('✅ PASS: Insufficient historical data to assess (proceed with standard caution).');
    });
});

describe('notebook-backed store semantics', () => {
    it('facts are visible to the next sync read and land as notebook files', async () => {
        const username = await freshUser();
        addAttributedInsight({
            id: 'fact-visible',
            insight: 'Breakout entries without retest confirmation bleed.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'pattern',
            scope: 'Breakout',
            tradeId: 't-v1',
        });
        // Sync read-after-write (the idempotent upserts depend on this).
        expect(loadAttributedInsights().some(i => i.id === 'fact-visible')).toBe(true);
        await flushDistilledWrites();
        const folder = getMemoryFiles().folders.find(f => f.name === 'distilled')!;
        const file = getMemoryFiles().files.find(
            f => f.folderId === folder.id && f.content.includes('id: fact-visible')
        );
        expect(file).toBeDefined();
        expect(file!.content).toContain(`source: distilled:${normalizeInsightFingerprint('Breakout entries without retest confirmation bleed.')}`);
        expect(file!.autoManaged).toBe(true);
        // And the round-trip through the file parses back to the same fact.
        expect(loadDistilledFacts().find(i => i.id === 'fact-visible')!.insight)
            .toBe('Breakout entries without retest confirmation bleed.');
        expect(username).toBeTruthy();
    });

    it('fingerprint merge: a different id saying the same thing updates the existing fact', async () => {
        await freshUser();
        addAttributedInsight({
            id: 'fp-first',
            insight: 'Tighten the stop when volatility expands.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'global',
            tradeId: 't-fp1',
        });
        addAttributedInsight({
            id: 'fp-second',
            insight: 'Tighten the stop when volatility expands. (6R)',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'global',
            tradeId: 't-fp2',
        });
        await flushDistilledWrites();
        const facts = loadDistilledFacts().filter(i =>
            normalizeInsightFingerprint(i.insight) === normalizeInsightFingerprint('Tighten the stop when volatility expands.')
        );
        expect(facts).toHaveLength(1);
        expect(facts[0].id).toBe('fp-first');
        expect(facts[0].insight).toContain('6R');    });

    it('surfaced marks are deduped within the window (timesUsed +1, not +2)', async () => {
        await freshUser();
        addAttributedInsight({
            id: 'surf-dedupe',
            insight: 'Do not chase premium-side longs in chop.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'global',
            tradeId: 't-sd',
        });
        markInsightSurfaced('surf-dedupe');
        markInsightSurfaced('surf-dedupe');
        await flushDistilledWrites();
        expect(loadDistilledFacts().find(i => i.id === 'surf-dedupe')!.timesUsed).toBe(1);
    });

    it('feedback updates quality and is awaited before reload', async () => {
        await freshUser();
        addAttributedInsight({
            id: 'fb-fact',
            insight: 'Skip the second entry after a stop-out.',
            sourceProvider: 'some-provider',
            category: 'global',
            tradeId: 't-fb',
        });
        await recordInsightFeedback('fb-fact', false);
        await recordInsightFeedback('fb-fact', true);
        const stored = loadDistilledFacts().find(i => i.id === 'fb-fact')!;
        expect(stored.timesHelpful).toBe(1);
        expect(stored.timesNotHelpful).toBe(1);
        expect(stored.qualityScore).toBe(50);
        expect(stored.wasValidated).toBe(true);
    });

    it('caps the library at 200 facts, pruning the least useful first', async () => {
        await freshUser();
        // Distinct-after-normalization texts (the fingerprint strips digits
        // and caps at 80 chars, so a compact two-letter token keeps every
        // fact its own fingerprint).
        const token = (n: number): string =>
            String.fromCharCode(97 + Math.floor(n / 26)) + String.fromCharCode(97 + (n % 26));
        for (let n = 0; n < DISTILLED_FACT_CAP + 5; n++) {
            await writeDistilledFact({
                id: `cap-${n}`,
                insight: `Distinct lesson ${token(n)} about holding runners into the weekly close.`,
                sourceProvider: 'pattern-memory-severity-detector',
                category: 'global',
                qualityScore: n < 5 ? 1 : 50,
                wasValidated: false,
                timesUsed: 0,
                timesHelpful: 0,
                createdAt: new Date(Date.now() - n * 1000).toISOString(),
                tradeId: `t-cap-${n}`,
            });
        }
        await flushDistilledWrites();
        const facts = loadDistilledFacts();
        expect(facts.length).toBe(DISTILLED_FACT_CAP);
        // The five lowest-quality facts were pruned.
        for (let n = 0; n < 5; n++) {
            expect(facts.some(i => i.id === `cap-${n}`)).toBe(false);
        }
        expect(facts.some(i => i.id === `cap-${DISTILLED_FACT_CAP}`)).toBe(true);
    });
});

describe('legacy pref-store migration', () => {
    it('moves attributed_insights_kb rows into distilled/ notebook files once', async () => {
        const username = await freshUser();
        const legacy = [
            {
                id: 'severity-t-legacy-deep_single_loss',
                insight: 'Single -2R loss (BTCUSDT Long) — review stop placement.',
                sourceProvider: 'pattern-memory-severity-detector',
                category: 'coin',
                scope: 'BTCUSDT',
                qualityScore: 75,
                wasValidated: true,
                timesUsed: 4,
                timesHelpful: 3,
                timesNotHelpful: 0,
                createdAt: '2026-08-01T00:00:00.000Z',
                tradeId: 't-legacy',
            },
            {
                id: 'provider-t-legacy-Gemini-0',
                insight: 'Legacy provider lesson about entries.',
                sourceProvider: 'Gemini',
                category: 'global',
                qualityScore: 50,
                wasValidated: false,
                timesUsed: 1,
                timesHelpful: 0,
                createdAt: '2026-08-02T00:00:00.000Z',
                tradeId: 't-legacy',
            },
        ];
        localStorage.setItem(`${PREF_KEYS.ATTRIBUTED_INSIGHTS}_${username}`, JSON.stringify(legacy));

        await initPatternMemoryService();

        // Rows now live as notebook facts with their counters intact…
        const facts = loadAttributedInsights();
        const sev = facts.find(i => i.id === 'severity-t-legacy-deep_single_loss');
        expect(sev).toBeDefined();
        expect(sev!.qualityScore).toBe(75);
        expect(sev!.timesUsed).toBe(4);
        expect(facts.find(i => i.id === 'provider-t-legacy-Gemini-0')).toBeDefined();
        // …and the legacy key is retired.
        expect(localStorage.getItem(`${PREF_KEYS.ATTRIBUTED_INSIGHTS}_${username}`)).toBeNull();

        // The gate sees the migrated severity fact.
        const trades = [
            makeLossTrade({ id: 'mig-1', correctedStopLoss: '68,000' }),
            makeLossTrade({ id: 'mig-2', correctedStopLoss: '68,000' }),
        ];
        const gate = generateMandatoryPatternCheck(setup, trades);
        expect(gate.gateResult).toBe('HALT');
        expect(gate.mandatoryQuestions.some(q => q.includes('review stop placement'))).toBe(true);
    });
});
