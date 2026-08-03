import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { TradeAnalysis } from '../types';
import type { ProviderConfig } from '../types/provider';
import { extractLastJson } from '../utils/jsonUtils';

// Mock the transport layer so the debate generators run with scripted chunks
// and NO network/SDK calls (this also makes the abort/error paths observable).
const { streamMock, sendMock } = vi.hoisted(() => ({
  streamMock: vi.fn() as Mock<(...args: any[]) => any>,
  sendMock: vi.fn() as Mock<(...args: any[]) => Promise<any>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
  sendChatRequest: ((...args: any[]) => sendMock(...args)) as any,
}));

import {
  conductDebate,
  conductTwoWayDebate,
  conductThreeWayDebate,
} from '../services/providers/ensembleService';

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

const analysis: TradeAnalysis = {
  coinName: 'BTCUSDT',
  direction: 'Long',
  tradeType: 'swing',
  confidence: 'High',
  probability: 75,
  grade: 'B',
  strategy: 'Trend continuation',
  activeStrategies: ['Momentum Trading'],
  entryPoints: [{ description: 'Key support retest', price: '95000' }],
  stopLoss: '94500',
  takeProfit: [{ price: '96000', percentage: '2%' }, { price: '97000', percentage: '4%' }],
  marketConditions: {
    pattern: 'Bull Flag',
    candleBehavior: 'Higher lows forming',
    timeframeAlignment: '3 of 4 bullish',
    rsi: '55',
    macd: 'Bullish crossover',
    sentiment: 'Neutral',
    prices: { '5m': '95100', '15m': '95050', '1h': '95000', '4h': '94800' },
  },
  historicalCorrelation: 'Similar to previous winning setups',
  validityDurationMinutes: 330,
};

const analyst = { analysis, thoughtProcess: 'Detailed reasoning for the setup.' };

const FULL_DEBATE = [
  '**Analyst One:** thesis presented\n\n',
  '**Analyst Two:** counter-thesis presented\n\n',
  '<DEBATE_START>\n**Moderator:** synthesis verdict\n\n<JSON_PLAN>\n' +
    JSON.stringify({ ...analysis, thoughtProcess: 'moderator thinking' }) +
    '\n</JSON_PLAN>',
];

/** Collect all chunks an async generator yields. */
async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of gen) out += chunk;
  return out;
}

describe('ensemble debate generators (mocked transport)', () => {
  beforeEach(() => {
    streamMock.mockReset();
    sendMock.mockReset();
  });

  it('conductTwoWayDebate yields the scripted turns + JSON plan', async () => {
    streamMock.mockImplementation(async function* () {
      yield* FULL_DEBATE;
    });

    const output = await collect(conductTwoWayDebate(
      analyst, analyst, 'Analyst One', 'Analyst Two',
      'Analyze BTCUSDT', null, config, 'model-a', undefined, [],
    ));

    expect(output).toContain('**Analyst One:** thesis presented');
    expect(output).toContain('<JSON_PLAN>');
    // Moderator messages: fixed system role + user prompt that names the analysts.
    const [cfg, messages] = streamMock.mock.calls[0];
    expect(messages[0].role).toBe('system');
    const userPrompt = messages[1].content as string;
    expect(userPrompt).toContain('<DEBATE_START>');
    expect(userPrompt).toContain('<JSON_PLAN>');
    expect(userPrompt.toUpperCase()).toContain('ANALYST ONE');
    expect(userPrompt.toUpperCase()).toContain('ANALYST TWO');
    // The embedded JSON plan is extractable end-to-end.
    const plan = extractLastJson(output);
    expect(plan.direction).toBe('Long');
    expect(plan.entryPoints[0].price).toBe('95000');
    expect(plan.invalidationCriteria).toBeUndefined(); // input had none
    void cfg;
  });

  it('conductThreeWayDebate yields and preserves all three analyst names in the prompt', async () => {
    streamMock.mockImplementation(async function* () {
      yield 'three-way synthesis';
      yield '<JSON_PLAN>{"direction":"Long"}</JSON_PLAN>';
    });

    const output = await collect(conductThreeWayDebate(
      analyst, analyst, analyst,
      'Analyst One', 'Analyst Two', 'Analyst Three',
      'Analyze BTCUSDT', null, config, 'model-a', undefined,
      [], [], [], undefined, [], [], [], undefined, undefined,
    ));
    expect(output).toContain('three-way synthesis');

    const [, messages] = streamMock.mock.calls[0];
    const userPrompt = messages[1].content as string;
    expect(userPrompt.toUpperCase()).toContain('ANALYST ONE');
    expect(userPrompt.toUpperCase()).toContain('ANALYST TWO');
    expect(userPrompt.toUpperCase()).toContain('ANALYST THREE');
  });

  it('conductDebate (accuracy mode) yields moderator output', async () => {
    streamMock.mockImplementation(async function* () {
      yield 'accuracy moderator chunk';
      yield '<JSON_PLAN>{"direction":"Short","confidence":"Medium","probability":55,"strategy":"s","activeStrategies":[],"entryPoints":[],"stopLoss":"","takeProfit":[],"marketConditions":{"pattern":"","candleBehavior":"","timeframeAlignment":"","rsi":"","macd":"","sentiment":""},"historicalCorrelation":""}</JSON_PLAN>';
    });

    const output = await collect(conductDebate(
      [analyst, analyst], ['Analyst One', 'Analyst Two'],
      'Analyze', null, 'original', undefined,
      config, 'model-a', false, true, null, [], '',
    ));
    expect(output).toContain('accuracy moderator chunk');
    expect(extractLastJson(output).direction).toBe('Short');
  });

  it('propagates user cancellation as AbortError (no <MODERATOR_ERROR> marker)', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    streamMock.mockImplementation(async function* () {
      yield 'partial chunk';
      throw abortError;
    });

    const gen = conductTwoWayDebate(
      analyst, analyst, 'Analyst One', 'Analyst Two',
      'Analyze', null, config, 'model-a', undefined, [],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      new AbortController().signal,
    );
    await expect(collect(gen)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rethrows rate-limit (429) errors instead of emitting a marker', async () => {
    // eslint-disable-next-line require-yield -- mocked stream fails before yielding any chunk
    streamMock.mockImplementation(async function* () {
      throw Object.assign(new Error('Rate limit reached. Please wait and try again.'), { status: 429 });
    });

    const gen = conductTwoWayDebate(
      analyst, analyst, 'Analyst One', 'Analyst Two',
      'Analyze', null, config, 'model-a', undefined, [],
    );
    await expect(collect(gen)).rejects.toMatchObject({ status: 429 });
  });

  it('yields an <MODERATOR_ERROR> marker for non-rate-limit provider failures', async () => {
    // eslint-disable-next-line require-yield -- mocked stream fails before yielding any chunk
    streamMock.mockImplementation(async function* () {
      throw new Error('boom: provider exploded');
    });

    const output = await collect(conductTwoWayDebate(
      analyst, analyst, 'Analyst One', 'Analyst Two',
      'Analyze', null, config, 'model-a', undefined, [],
    ));
    expect(output).toContain('<MODERATOR_ERROR>');
  });
});