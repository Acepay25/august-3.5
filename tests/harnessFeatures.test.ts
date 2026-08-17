import { describe, expect, it } from 'vitest';
import { AnalystRole, MessageRole, TradeOutcome } from '../types';
import { buildOcrEnvelope, envelopeKindForRole } from '../utils/debateEnvelopes';
import { buildRecommendationContract } from '../utils/recommendationContract';
import { debateTurnsToRoundTexts, lastCompletedRound, laneDraftsFromTurns, reconstructOpenings } from '../utils/debateResume';
import { citeLevel } from '../utils/levelEvidence';
import { buildRebuttalDiffPacket } from '../utils/debateDiff';
import { summarizePromptVersions } from '../utils/promptVersionStats';
import { parseKeptAnalyst } from '../utils/keptAnalyst';
import { computeTicketSize, computeContractSize, computeLiquidationBuffer } from '../utils/ticketSize';
import { enforceUngroundedLevels } from '../utils/ungroundedGate';
import { describeOpenBookRisk, paperPnlR } from '../utils/paperPnl';
import { enforceCitedVerdict } from '../services/providers/ensembleService';
import { computeEvidenceQualityStats } from '../utils/analysisQuality';
import { buildAnalysisReportMarkdown } from '../utils/analysisReport';
import { describeWatchTick } from '../utils/watchTicks';
import { buildAnalystGantt, formatStageSnippet, lastThoughtSnippet, laneFillForStatus, stageTickerText } from '../utils/runGantt';
import { parseComposerIntent, formatComposerSteer } from '../utils/composerMentions';
import { collectApprovalItems, autoJournalPolicyFor, setAutoJournalRule } from '../utils/approvalInbox';
import { parseIfThenClauses } from '../utils/ifThenSkill';
import { applyHybridChartDrift } from '../utils/hybridChartDrift';
import { parseCraftedSkill } from '../schemas/learning';
import { formatCraftedSkillBody } from '../services/learning/SkillCraftService';
import { parseStructuredAutoplayTranscript } from '../utils/debateTranscript';
import { listSkillDrafts, queueSkillDraft } from '../utils/skillDrafts';
import { buildAnalysisTrace } from '../utils/analysisTrace';

describe('harness envelopes', () => {
    it('parses complete structured autoplay turns without guessing speaker names', () => {
        const turns = parseStructuredAutoplayTranscript(
            '<TURN speaker="Model A" round="1">Long thesis.</TURN><TURN speaker="Moderator" round="2">Challenge.</TURN><TURN speaker="Model B">Response.</TURN>'
        );
        expect(turns).toEqual([
            { speaker: 'Model A', round: 1, text: 'Long thesis.' },
            { speaker: 'Moderator', round: 2, text: 'Challenge.' },
            { speaker: 'Model B', round: undefined, text: 'Response.' },
        ]);
        expect(parseStructuredAutoplayTranscript('<TURN speaker="Model A">unfinished')).toEqual([]);
    });

    it('maps lens roles to isolated kinds', () => {
        expect(envelopeKindForRole(AnalystRole.MACRO_VOLATILITY)).toBe('macro');
        expect(envelopeKindForRole(AnalystRole.TECHNICAL_ANALYST)).toBe('technical');
        expect(envelopeKindForRole(AnalystRole.RISK_EXECUTION)).toBe('risk');
    });

    it('withholds OCR from moderator and risk envelopes', () => {
        expect(buildOcrEnvelope(['chart A'], 'moderator')).toMatch(/withheld/);
        expect(buildOcrEnvelope(['chart A', 'chart B'], 'macro')).toContain('chart A');
        expect(buildOcrEnvelope(['chart A', 'chart B'], 'technical')).toContain('Chart 2');
    });
});

describe('recommendation contract', () => {
    it('marks Avoid as avoid with no position', () => {
        const c = buildRecommendationContract({
            direction: 'Short',
            confidence: 'Avoid',
            probability: 40,
            strategy: '',
            activeStrategies: [],
            entryPoints: [],
            stopLoss: '100',
            takeProfit: [],
            marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
            historicalCorrelation: '',
            invalidationCriteria: [{ level: '101', condition: 'close above' }],
            validityDurationMinutes: 60,
        });
        expect(c.action).toBe('avoid');
        expect(c.riskBoundary).toMatch(/No position/);
        expect(c.invalidation).toHaveLength(1);
        expect(c.validityMinutes).toBe(60);
    });
});

describe('debate resume', () => {
    it('rebuilds round texts and last completed round', () => {
        const turns = [
            { speaker: 'Macro', round: 1, text: 'open A', createdAt: 't' },
            { speaker: 'Tech', round: 1, text: 'open B', createdAt: 't' },
            { speaker: 'Macro', round: 2, text: 'rebut', createdAt: 't' },
        ];
        const texts = debateTurnsToRoundTexts(turns);
        expect(texts.Macro[1]).toBe('open A');
        expect(texts.Macro[2]).toBe('rebut');
        expect(lastCompletedRound(turns)).toBe(1);
        expect(lastCompletedRound(turns, ['Macro', 'Tech'])).toBe(1);
        expect(reconstructOpenings(turns).map(s => s.name)).toEqual(['Macro', 'Tech']);
        expect(laneDraftsFromTurns(turns, 1)).toEqual({ Macro: { round: 2, text: 'rebut' } });
    });
});

describe('level evidence', () => {
    it('cites a matching claim and marks missing prices ungrounded', () => {
        const evidence = [{ claim: 'Entry 64000 from hybrid HTF', sources: ['hybrid:1h'], state: 'observed' as const }];
        expect(citeLevel('Entry', '64000', evidence).source).toBe('hybrid:1h');
        expect(citeLevel('Stop Loss', '62000', evidence).source).toBe('ungrounded');
        expect(citeLevel('Entry', '64000', [], [{ label: 'Entry', price: '64000', sourceId: 'hybrid:4h' }]).source).toBe('hybrid:4h');
    });
});

describe('rebuttal diff', () => {
    it('sends disagreements not full openings', () => {
        const packet = buildRebuttalDiffPacket(
            'Macro',
            '- **Direction:** Long\n- **Entry:** 100\n- **Stop Loss:** 90\n- **Take Profit 1:** 120',
            [{ name: 'Tech', text: '- **Direction:** Short\n- **Entry:** 99\n- **Stop Loss:** 110\n- **Take Profit 1:** 80' }],
        );
        expect(packet).toContain('disagrees');
        expect(packet).not.toContain('restated');
        expect(packet.length).toBeLessThan(800);
    });
});

describe('moderator citation gate', () => {
    it('forces Neutral when nobody aligned', () => {
        const next = enforceCitedVerdict(
            { direction: 'Long', confidence: 'High' },
            { citations: [{ name: 'Macro', aligned: false }] } as any,
        );
        expect(next.direction).toBe('Neutral');
        expect(next.confidence).toBe('Avoid');
    });

    it('keeps a directional call when KEPT names an aligned analyst', () => {
        const next = enforceCitedVerdict(
            { direction: 'Long', confidence: 'High' },
            { citations: [{ displayName: 'Macro', aligned: true }] } as any,
            'Macro',
        );
        expect(next.direction).toBe('Long');
    });
});

describe('kept analyst', () => {
    it('parses KEPT lines', () => {
        expect(parseKeptAnalyst('KEPT: Macro\n</DEBATE_END>')).toBe('Macro');
        expect(parseKeptAnalyst('KEPT: none')).toBeNull();
    });
});

describe('ungrounded gate', () => {
    it('forces Neutral when Entry has no cite', () => {
        const next = enforceUngroundedLevels({
            direction: 'Long',
            confidence: 'High',
            entryPoints: [{ price: '100' }],
            stopLoss: '90',
            evidence: [],
        } as any);
        expect(next.confidence).toBe('Avoid');
        expect(next.direction).toBe('Neutral');
    });
});

describe('ticket size', () => {
    it('zeros Avoid and halves a tight gate cap', () => {
        expect(computeTicketSize({ confidence: 'Avoid', direction: 'Long' } as any).label).toBe('none');
        expect(computeTicketSize({
            confidence: 'Medium', direction: 'Long',
            gateResult: { confidenceCap: 0.55 },
        } as any).label).toBe('half');
    });

    it('sizes qty from entry to SL at the chosen risk percent', () => {
        const sized = computeContractSize({
            confidence: 'High',
            direction: 'Long',
            coinName: 'BTCUSDT',
            entryPoints: [{ price: '100' }],
            stopLoss: '90',
        } as any, 10_000, 10, 1);
        expect(sized.riskUsd).toBe(100);
        expect(sized.qty).toBeCloseTo(10, 5);
        expect(sized.notionalUsd).toBeCloseTo(1000, 5);
        expect(sized.line).toMatch(/\$100 risk/);
    });

    it('flags a stop past isolated liquidation', () => {
        const ok = computeLiquidationBuffer('100', '99', 10);
        expect(ok?.bufferPct).toBeCloseTo(9, 5);
        expect(ok?.line).toMatch(/Liq buffer/);
        const past = computeLiquidationBuffer('100', '80', 10);
        expect(past?.line).toMatch(/past isolated liquidation/);
    });
});

describe('paper book', () => {
    it('reports +1R when price travels the stop distance in favor', () => {
        const p = paperPnlR({
            direction: 'Long', confidence: 'High',
            entryPoints: [{ price: '100' }], stopLoss: '90',
        } as any, 110);
        expect(p?.r).toBe(1);
    });
    it('flags two open Long alts', () => {
        const row = (coin: string) => ({
            analysis: { coinName: coin, direction: 'Long', confidence: 'High' },
            outcome: TradeOutcome.PENDING,
        });
        expect(describeOpenBookRisk([row('ETHUSDT'), row('SOLUSDT')] as any)).toMatch(/Long alts/);
    });
});

describe('prompt version stats', () => {
    it('rolls win rate per stamped version', () => {
        const stats = summarizePromptVersions([
            { id: '1', timestamp: 't', outcome: TradeOutcome.WIN, promptVersion: 'pv-a', analysis: {} as any },
            { id: '2', timestamp: 't', outcome: TradeOutcome.LOSS, promptVersion: 'pv-a', analysis: {} as any },
            { id: '3', timestamp: 't', outcome: TradeOutcome.WIN, analysis: {} as any },
        ]);
        expect(stats).toEqual([{
            version: 'pv-a', trades: 2, wins: 1, losses: 1, winRate: 50,
            avgDeclared: null, avgRealized: 50,
        }]);
    });
});

describe('evidence quality', () => {
    it('buckets coverage vs win rate', () => {
        const stats = computeEvidenceQualityStats([
            {
                id: '1', timestamp: 't', outcome: TradeOutcome.WIN,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'observed' }], probability: 70 } as any,
            },
            {
                id: '2', timestamp: 't', outcome: TradeOutcome.LOSS,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'unobserved' }], probability: 80 } as any,
            },
        ]);
        const high = stats.find(s => s.coverage === 'high');
        const low = stats.find(s => s.coverage === 'low');
        expect(high?.winRate).toBe(100);
        expect(low?.winRate).toBe(0);
    });
});

describe('analysis report', () => {
    it('includes verdict and contract', () => {
        const md = buildAnalysisReportMarkdown({
            analysis: {
                coinName: 'BTC',
                direction: 'Long',
                confidence: 'Medium',
                probability: 62,
                recommendationContract: { action: 'long', riskBoundary: 'SL 1', invalidation: [], thesis: 'Long BTC' },
            } as any,
            debateTurns: [],
        });
        expect(md).toMatch(/BTC/);
        expect(md).toMatch(/Contract/);
    });
});

describe('watch ticks', () => {
    it('emits invalidation when long price breaks below the level', () => {
        const tick = describeWatchTick({
            direction: 'Long',
            invalidationCriteria: [{ level: '100', condition: 'close below' }],
        } as any, 99, 101);
        expect(tick?.kind).toBe('invalidation');
    });

    it('ignores tiny price noise', () => {
        expect(describeWatchTick({ direction: 'Long' } as any, 100.1, 100)).toBeNull();
    });
});

describe('run gantt', () => {
    it('fills complete lanes and clips a thinking snippet', () => {
        expect(laneFillForStatus('complete')).toBe(100);
        expect(laneFillForStatus('waiting')).toBeLessThan(20);
        expect(lastThoughtSnippet('line one\nclose above 64510')).toBe('close above 64510');
        const lanes = buildAnalystGantt({
            analysts: [{
                key: 'a1', displayName: 'Macro', providerId: 'p', providerName: 'P',
                modelId: 'm', modelName: 'M', status: 'analyzing',
            }],
            moderator: { status: 'waiting' },
        });
        expect(lanes.map(l => l.label)).toEqual(['Macro', 'Moderator']);
        expect(lanes[0].live).toBe(true);
    });

    it('formats compact stage text without Markdown markers', () => {
        expect(formatStageSnippet('**Direction:** Long with `BTCUSDT`')).toBe('Direction: Long with BTCUSDT');
        expect(formatStageSnippet('- first point\n- second point')).toBe('first point second point');
        expect(formatStageSnippet('a '.repeat(40), 20)).toHaveLength(20);
    });

    it('advances the bounded ticker at sentence punctuation', () => {
        expect(stageTickerText('First sentence. Second sentence')).toBe('Second sentence');
        expect(stageTickerText('Price 63.748 is holding.')).toBe('Price 63.748 is holding.');
        expect(stageTickerText('Still weighing the entry')).toBe('Still weighing the entry');
        expect(stageTickerText('A very long unfinished thought that keeps streaming new words', 20)).toMatch(/^…/);
    });
});

describe('analysis trace', () => {
    it('exposes the observable gate, transcript, adjustment, and verdict stages', () => {
        const events = buildAnalysisTrace({
            id: 'trace', role: MessageRole.AI, text: '', createdAt: '2026-01-01T00:00:00.000Z',
            runStats: { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', durationMs: 1000 },
            debateTurns: [{ speaker: 'Moderator', round: 1, text: 'Review.' }],
            analysis: {
                direction: 'Neutral', confidence: 'Avoid', probability: 30,
                originalConfidence: 'Low', validationWarnings: ['CALIBRATION ADJUSTMENT: Low → Avoid'],
                gateResult: { passed: true, confidenceCap: 0.6, warnings: [], insights: [] },
            } as any,
        });
        expect(events.map(event => event.label)).toEqual(expect.arrayContaining([
            'Run started', 'Gate passed', 'Transcript parsed', 'Confidence adjusted', 'Decision rule', 'Verdict rendered',
        ]));
    });

    it('renders per-analyst rows with error/complete/thinking tones', () => {
        const events = buildAnalysisTrace({
            id: 'trace', role: MessageRole.AI, text: '', createdAt: '',
            ensembleProgress: {
                analysts: [
                    { key: 'a', displayName: 'Model A', status: 'error', error: 'provider refused' },
                    { key: 'b', displayName: 'Model B', status: 'complete', finalOutput: 'call' },
                    { key: 'c', displayName: 'Model C', status: 'analyzing', reasoning: 'weighing' },
                ],
                moderator: { status: 'waiting' },
            },
        } as any);
        const rows = events.filter(event => event.id.includes('analyst-'));
        expect(rows).toHaveLength(3);
        expect(rows[0]?.label).toBe('Model A');
        expect(rows[0]?.detail).toBe('provider refused');
        expect(rows[0]?.tone).toBe('blocked');
        expect(rows[1]?.detail).toBe('Public output received');
        expect(rows[1]?.tone).toBe('good');
        expect(rows[2]?.detail).toBe('Reasoning received');
        expect(rows[2]?.tone).toBe('neutral');
    });

    it('renders debate run-log steps and flags gate blocks and confidence caps', () => {
        const events = buildAnalysisTrace({
            id: 'trace', role: MessageRole.AI, text: '', createdAt: '',
            debateRunLog: [
                { at: 't1', kind: 'pre_step', detail: 'rebuttals' },
                { at: 't2', kind: 'round', speaker: 'Model A', detail: 'opening' },
                { at: 't3', kind: 'gate', detail: 'confidence cap applied' },
                { at: 't4', kind: 'gate', detail: 'veto: pattern memory' },
            ],
        } as any);
        const log = events.filter(event => event.id.includes('log-'));
        expect(log).toHaveLength(4);
        expect(log[0]?.label).toBe('Pipeline step');
        expect(log[1]?.label).toBe('round');
        expect(log[1]?.detail).toContain('Model A');
        expect(log[2]?.tone).toBe('blocked');
        expect(log[3]?.tone).toBe('blocked');
    });

    it('falls back to a neutral no-trace row for legacy messages', () => {
        const events = buildAnalysisTrace({ id: 'old', role: MessageRole.AI, text: '', createdAt: '' });
        expect(events).toHaveLength(1);
        expect(events[0]?.label).toBe('No trace data');
        expect(events[0]?.tone).toBe('neutral');
    });
});

describe('composer mentions', () => {
    it('parses @lanes and /skills then formats a steer line', () => {
        const intent = parseComposerIntent('@Macro /fade-wick BTC 4h');
        expect(intent.lanes).toEqual(['Macro']);
        expect(intent.skills).toEqual(['fade-wick']);
        expect(intent.rest).toBe('BTC 4h');
        expect(formatComposerSteer(intent)).toMatch(/Address Macro only/);
        expect(formatComposerSteer(intent)).toMatch(/fade-wick/);
    });
});

describe('approval inbox', () => {
    it('collects autopilot and ungrounded items', () => {
        const items = collectApprovalItems(
            [{
                id: 'm1',
                text: '',
                role: MessageRole.AI,
                createdAt: '',
                outcome: TradeOutcome.PENDING,
                analysis: { coinName: 'BTC', validationWarnings: ['Ungrounded Entry'] } as any,
            }],
            { m1: { detail: 'TP1 hit', outcome: TradeOutcome.WIN, expiredOpen: false, detectedAt: '' } },
        );
        expect(items.some(i => i.kind === 'autopilot')).toBe(true);
        expect(items.some(i => i.kind === 'ungrounded')).toBe(true);
    });

    it('stores always/deny coin rules', () => {
        setAutoJournalRule('eth', 'always');
        expect(autoJournalPolicyFor('ETH')).toBe('always');
        setAutoJournalRule('eth', 'ask');
        expect(autoJournalPolicyFor('ETH')).toBe('ask');
    });

    it('keeps approval policies and skill drafts isolated by workspace', () => {
        setAutoJournalRule('sol', 'always', 'alice');
        expect(autoJournalPolicyFor('SOL', 'alice')).toBe('always');
        expect(autoJournalPolicyFor('SOL', 'bob')).toBe('ask');
        setAutoJournalRule('sol', 'ask', 'alice');

        const crafted = {
            name: 'isolated skill',
            kind: 'avoid' as const,
            when: 'the setup matches',
            inputs: ['SOL'],
            steps: ['wait'],
            validate: 'confirmation',
            output: 'avoid',
            approval: 'human',
            ifCondition: 'the setup matches',
            thenAction: 'wait',
        };
        queueSkillDraft({ tradeId: 'trade-alice', crafted }, 'alice');
        expect(listSkillDrafts('alice').some(d => d.tradeId === 'trade-alice')).toBe(true);
        expect(listSkillDrafts('bob').some(d => d.tradeId === 'trade-alice')).toBe(false);
    });
});

describe('if/then skills', () => {
    it('parses IF THEN into a procedure', () => {
        const clauses = parseIfThenClauses('IF 4h close loses 64000 THEN stand aside until a 15m reclaim.');
        expect(clauses[0]?.ifCondition).toMatch(/64000/);
        expect(clauses[0]?.thenAction).toMatch(/stand aside/);
    });
});

describe('hybrid chart drift', () => {
    it('caps High when spot is far from entry', () => {
        const next = applyHybridChartDrift(
            { direction: 'Long', confidence: 'High', entryPoints: [{ price: '100' }] } as any,
            { marketData: { currentPrice: 108 } } as any,
        );
        expect(next.confidence).toBe('Low');
        expect(next.validationWarnings?.[0]).toMatch(/drift/);
    });
});

describe('skill craft', () => {
    it('accepts a Grok-style skill JSON object', () => {
        const skill = parseCraftedSkill({
            name: 'VWAP reclaim short',
            kind: 'avoid',
            when: '15m close reclaims VWAP after a failed breakdown',
            inputs: ['BTC', 'Short', '15m'],
            steps: ['Wait for close', 'Require retest', 'Only then short'],
            validate: 'VWAP still above the reclaim candle',
            output: 'Avoid market shorts until retest',
            approval: 'Human confirms size if leverage > 20x',
            ifCondition: '15m close reclaims VWAP with rising volume',
            thenAction: 'wait for a retest before shorting',
        });
        expect(skill?.steps).toHaveLength(3);
        expect(formatCraftedSkillBody(skill!)).toMatch(/\*\*When:\*\*/);
        expect(formatCraftedSkillBody(skill!)).toMatch(/\*\*Steps:\*\*/);
    });
});
