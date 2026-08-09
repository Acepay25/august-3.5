import { describe, it, expect } from 'vitest';
import { DebateTurn, TradeAnalysis } from '../types';
import {
  buildTranscriptMarkdown,
  buildTranscriptJson,
  buildTranscriptFilename,
} from '../utils/transcriptExport';

const turns: DebateTurn[] = [
  { speaker: 'Alpha', text: 'I see a long above 95k.', round: 1 },
  { speaker: 'Beta', text: 'Counter: liquidity below.', round: 2 },
  { speaker: 'Moderator', text: 'Verdict: Long, entry 95000.', round: 3 },
];

const analysis: TradeAnalysis = {
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'High',
  probability: 78,
  strategy: 'Breakout retest',
  activeStrategies: [],
  entryPoints: [{ description: 'Entry', price: '95000' }],
  stopLoss: '93000',
  takeProfit: [{ price: '98000' }],
  marketConditions: {
    pattern: 'range',
    candleBehavior: 'steady',
    timeframeAlignment: 'aligned',
    rsi: 'neutral',
    macd: 'neutral',
    sentiment: 'neutral',
  },
  historicalCorrelation: 'N/A',
  createdAt: new Date().toISOString(),
};

describe('buildTranscriptMarkdown', () => {
  it('renders verdict header + per-speaker sections', () => {
    const md = buildTranscriptMarkdown(turns, analysis);
    expect(md).toContain('# Debate Transcript — BTCUSDT');
    expect(md).toContain('**Verdict:** Long');
    expect(md).toContain('High confidence');
    expect(md).toContain('78%');
    expect(md).toContain('Entry 95000');
    expect(md).toContain('SL 93000');
    expect(md).toContain('TP 98000');
    expect(md).toContain('## Round 1');
    expect(md).toContain('### Alpha (Round 1)');
    expect(md).toContain('I see a long above 95k.');
    expect(md).toContain('### Moderator (Round 3)');
  });

  it('handles no-analysis transcripts and markdown-in-speaker names', () => {
    const md = buildTranscriptMarkdown(turns, null);
    expect(md).toContain('# Debate Transcript — Trade');
    // Speaker headings clean up markdown metacharacters.
    const dirty = buildTranscriptMarkdown([{ speaker: 'A*#B', text: 'x' }], null);
    expect(dirty).toContain('### A*#B');
  });
});

describe('buildTranscriptJson', () => {
  it('serializes turns + analysis summary and round-trips', () => {
    const json = buildTranscriptJson(turns, analysis);
    const parsed = JSON.parse(json);
    expect(parsed.turns).toHaveLength(3);
    expect(parsed.analysis.coinName).toBe('BTCUSDT');
    expect(parsed.analysis.entry).toBe('95000');
    expect(parsed.exportedAt).toBeTruthy();
  });

  it('omits the analysis block when absent', () => {
    const parsed = JSON.parse(buildTranscriptJson(turns, null));
    expect(parsed.analysis).toBeUndefined();
    expect(parsed.turns).toHaveLength(3);
  });
});

describe('buildTranscriptFilename', () => {
  it('sanitizes the coin and embeds a timestamp', () => {
    const name = buildTranscriptFilename(analysis, 'md');
    expect(name).toMatch(/^debate-BTCUSDT-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
    const jname = buildTranscriptFilename(analysis, 'json');
    expect(jname.endsWith('.json')).toBe(true);
  });

  it('falls back to trade for unnamed analyses', () => {
    expect(buildTranscriptFilename(null, 'md')).toMatch(/^debate-trade-/);
  });
});
