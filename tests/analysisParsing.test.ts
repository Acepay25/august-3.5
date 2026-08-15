import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { formatAnalysisForDisplay } from '../utils/analysisUtils';

// Mock the transport so analyzeTradingView runs with scripted streams and NO
// network calls. The analyst path streams via streamChatRequest.
const { streamMock, sendMock } = vi.hoisted(() => ({
  streamMock: vi.fn() as Mock<(...args: any[]) => any>,
  sendMock: vi.fn() as Mock<(...args: any[]) => Promise<any>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
  sendChatRequest: ((...args: any[]) => sendMock(...args)) as any,
}));

import { analyzeTradingView } from '../services/providers/GenericAnalysisService';
import type { AnalyzeTradingViewParams } from '../services/providers/GenericAnalysisService';

const config: ProviderConfig = {
  id: 'prov-a',
  name: 'Provider A',
  apiKey: 'key-a',
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'chat_completions',
  isEnabled: true,
  isBuiltIn: true,
  models: ['model-a'],
  selectedModel: 'model-a',
};

const baseParams: AnalyzeTradingViewParams = {
  prompt: 'Analyze BTCUSDT',
  images: [],
  imageSummaries: [],
  chatHistory: [],
  finalTradeSummary: null,
  recentInsights: null,
  activeFrameworks: [],
  deepenAnalysis: false,
};

/** Script the stream with the given chunks; also feed reasoning deltas via onReasoning. */
const scriptStream = (chunks: string[], reasoning?: string[]) => {
  streamMock.mockImplementation(async function* (...args: any[]) {
    const options = args[2] as { onReasoning?: (r: string) => void };
    for (const r of reasoning ?? []) {
      options?.onReasoning?.(r);
    }
    for (const c of chunks) yield c;
  });
};

const TRADE_JSON = {
  coinName: 'BTCUSDT',
  direction: 'Long',
  entryPoints: [{ description: 'Key support retest', price: '95000' }],
  stopLoss: '94500',
  takeProfit: [{ price: '96000', percentage: '2%' }],
  probability: 65,
  confidence: 'Medium',
  strategy: 'Trend continuation',
  keyLevels: { support: ['94500 (4h)'], resistance: ['96000 (1h)'] },
};

describe('analyzeTradingView response parsing', () => {
  beforeEach(() => {
    streamMock.mockReset();
    sendMock.mockReset();
  });

  it('extracts the THINKING and FINAL_OUTPUT sections from a tagged response', async () => {
    scriptStream([
      '<THINKING>Multi-timeframe structure is bullish on 1h/4h.</THINKING>',
      '<FINAL_OUTPUT>Long BTCUSDT from 95000, stop 94500, target 96000.</FINAL_OUTPUT>',
    ]);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('bullish on 1h/4h');
    expect(result.finalOutput).toContain('Long BTCUSDT from 95000');
  });

  it('recovers a legacy {thoughtProcess, analysis} JSON response into readable text', async () => {
    scriptStream([JSON.stringify({ thoughtProcess: 'Detailed reasoning for the setup.', analysis: TRADE_JSON })]);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('Detailed reasoning');
    // The card must never show raw JSON — the analysis becomes a readable summary.
    expect(result.finalOutput).toContain('**Direction:** Long');
    expect(result.finalOutput).toContain('**Entry:** 95000');
    expect(result.finalOutput).not.toContain('{');
  });

  it('recovers a bare JSON trade-plan object into a readable summary', async () => {
    scriptStream([JSON.stringify(TRADE_JSON)]);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.finalOutput).toContain('**Coin:** BTCUSDT');
    expect(result.finalOutput).toContain('**Stop Loss:** 94500');
    expect(result.finalOutput).toContain('**Probability:** 65%');
    expect(result.finalOutput).not.toContain('"coinName"');
  });

  it('falls back to the raw text when the response is neither tagged nor JSON', async () => {
    scriptStream(['Plain readable analysis text with no structure.']);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.finalOutput).toContain('Plain readable analysis text');
    // No native reasoning streamed and nothing tagged ⇒ harness-style: no thinking.
    expect(result.thoughtProcess).toBe('');
  });

  it('uses the accumulated streamed reasoning as thinking when nothing else parses', async () => {
    scriptStream(
      ['Final answer text.'],
      ['First I check the 1h structure... ', 'then I weigh volume against momentum.']
    );

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('First I check the 1h structure');
    expect(result.thoughtProcess).toContain('then I weigh volume');
  });

  it('salvages a reasoning-only stream instead of rejecting with "empty response"', async () => {
    // Reasoning-mode models sometimes emit chain-of-thought but never content
    // deltas. Keep the seat (no throw) but do not copy CoT into the answer.
    scriptStream([], ['Weighing 1h momentum against 4h structure... ', 'Entry zone 95000-95150 confirmed by wick rejection.']);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('Weighing 1h momentum');
    expect(result.thoughtProcess).toContain('Entry zone 95000-95150');
    expect(result.finalOutput).toBe('');
  });

  it('rejects with an empty-response error when the stream yields nothing at all', async () => {
    scriptStream([]);
    await expect(analyzeTradingView(config, baseParams)).rejects.toThrow('Received an empty response from the AI.');
  });

  it('fulfills (no throw) when the response is only empty tags, yielding no thinking', async () => {
    scriptStream(['<THINKING></THINKING><FINAL_OUTPUT></FINAL_OUTPUT>']);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toBe('');
    expect(result.finalOutput).toBe('');
  });

  it('prefers native streamed reasoning over a tagged THINKING section', async () => {
    scriptStream(
      ['<THINKING>Tagged fallback reasoning.</THINKING><FINAL_OUTPUT>Proposal text.</FINAL_OUTPUT>'],
      ['Native chain-of-thought from the provider.']
    );

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('Native chain-of-thought');
    expect(result.thoughtProcess).not.toContain('Tagged fallback');
    expect(result.finalOutput).toContain('Proposal text.');
  });

  it('splits header-style labels (**THINKING** / **FINAL OUTPUT**) when tags are absent', async () => {
    scriptStream([
      '**THINKING:**\nWeighing 4h structure against 1h momentum.\n**FINAL OUTPUT:**\nLong BTCUSDT from 95000, stop 94500.',
    ]);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.thoughtProcess).toContain('Weighing 4h structure');
    expect(result.thoughtProcess).not.toContain('FINAL OUTPUT');
    expect(result.finalOutput).toContain('Long BTCUSDT from 95000');
    expect(result.finalOutput).not.toContain('THINKING');
  });

  it('strips tag artifacts from a natural untagged response', async () => {
    scriptStream(['<THINKING>Should not leak into output.</THINKING>\nLong BTCUSDT with a stop at 94500.']);

    const result = await analyzeTradingView(config, baseParams);
    expect(result.finalOutput).toContain('Long BTCUSDT');
    expect(result.finalOutput).not.toContain('<THINKING>');
    expect(result.finalOutput).not.toContain('Should not leak');
  });
});

describe('formatAnalysisForDisplay', () => {
  it('renders a readable multi-line summary from a trade-plan JSON object', () => {
    const text = formatAnalysisForDisplay(TRADE_JSON);
    expect(text).toContain('**Coin:** BTCUSDT');
    expect(text).toContain('**Direction:** Long');
    expect(text).toContain('**Entry:** 95000');
    expect(text).toContain('**Stop Loss:** 94500');
    expect(text).toContain('**Take Profit:** 96000');
    expect(text).toContain('**Probability:** 65%');
    expect(text).toContain('**Confidence:** Medium');
    expect(text).toContain('**Key Levels:** Support 94500 (4h) | Resistance 96000 (1h)');
  });

  it('returns an empty string for non-objects', () => {
    expect(formatAnalysisForDisplay(null)).toBe('');
    expect(formatAnalysisForDisplay(undefined)).toBe('');
    expect(formatAnalysisForDisplay('nope')).toBe('');
  });
});
