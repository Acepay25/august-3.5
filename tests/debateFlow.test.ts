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
  conductRealDebate,
  REAL_DEBATE_RESPONSE_ROUNDS,
} from '../services/providers/ensembleService';
import type { RealDebateTurnEvent } from '../services/providers/ensembleService';

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

// =============================================================================
// REAL inter-model debate (each analyst is re-invoked between rounds)
// =============================================================================

describe('conductRealDebate (real inter-model debate)', () => {
  beforeEach(() => {
    streamMock.mockReset();
    sendMock.mockReset();
  });

  const realAnalyst = (id: string, name: string, model: string) => ({
    provider: {
      config: { ...config, id, name, models: [model], selectedModel: model },
      name,
      model,
      thoughtsKey: `${id}:${model}`,
    },
    result: {
      thoughtProcess: `${name} internal thinking`,
      finalOutput: `${name} opening statement: long bias on breakout.`,
      analysis,
    },
  });

  async function collectEvents(gen: AsyncGenerator<RealDebateTurnEvent>): Promise<RealDebateTurnEvent[]> {
    const events: RealDebateTurnEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  /** Mock stream: rebuttal calls echo the analyst name; the moderator emits the verdict contract. */
  const mockStreams = () => {
    const calls: { system: string; user: string }[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      calls.push({ system: messages[0].content, user: messages[1].content });
      if (messages[0].content.includes('debate moderator')) {
        yield 'Verdict: Long on breakout with tight stop.\n';
        yield '</DEBATE_END>\n';
        yield '<JSON_PLAN>{"direction":"Long","confidence":"Medium","probability":60,"strategy":"s","activeStrategies":[],"entryPoints":[],"stopLoss":"","takeProfit":[],"marketConditions":{"pattern":"","candleBehavior":"","timeframeAlignment":"","rsi":"","macd":"","sentiment":""},"historicalCorrelation":""}</JSON_PLAN>';
      } else {
        yield `rebuttal-${messages[0].content.includes('One') ? 'one' : 'two'}`;
      }
    });
    return calls;
  };

  it('emits opening statements with zero API calls, then parallel rebuttal rounds and the moderator verdict', async () => {
    const calls = mockStreams();
    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
    ));

    // Round 1 = the two opening statements — and they must have been emitted
    // before any provider call happened (no extra API calls for round 1).
    const round1 = events.filter(e => e.round === 1);
    expect(round1.map(e => e.speaker)).toEqual(['Analyst One', 'Analyst Two']);
    expect(round1[0].text).toContain('opening statement');
    expect(events.findIndex(e => e.speaker === 'Analyst One' && e.round === 1)).toBeLessThan(
      events.findIndex(e => e.round === 2),
    );

    // 2 rebuttal rounds × 2 analysts + 1 moderator call.
    expect(calls.length).toBe(2 * REAL_DEBATE_RESPONSE_ROUNDS + 1);
    expect(calls.length).toBe(5);

    // Rebuttal calls carry the DEBATE_RESPONSE_PROMPT with the speaker and round.
    const firstRebuttal = calls.find(c => !c.system.includes('debate moderator'))!;
    expect(firstRebuttal.system).toContain('ENSEMBLE DEBATE PARTICIPANT');
    expect(firstRebuttal.system).toContain('ROUND 2');
    expect(firstRebuttal.user).toContain('YOUR POSITION (Round 1)');

    // The moderator verdict round streams the </DEBATE_END> + <JSON_PLAN> contract.
    const moderatorEvents = events.filter(e => e.speaker === 'Moderator');
    expect(moderatorEvents.length).toBeGreaterThan(0);
    const modText = moderatorEvents.map(e => e.text).join('');
    expect(modText).toContain('</DEBATE_END>');
    expect(extractLastJson(modText).direction).toBe('Long');

    // Round structure: 1 (openings) + rebuttal rounds + final verdict round.
    const rounds = [...new Set(events.map(e => e.round))];
    expect(rounds).toEqual([1, 2, 3, 4]);
  });

  it('continues the debate when one analyst fails a rebuttal round', async () => {
    let analystTwoCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      if (messages[0].content.includes('debate moderator')) {
        yield '</DEBATE_END>\n<JSON_PLAN>{"direction":"Short","confidence":"Low","probability":45,"strategy":"s","activeStrategies":[],"entryPoints":[],"stopLoss":"","takeProfit":[],"marketConditions":{"pattern":"","candleBehavior":"","timeframeAlignment":"","rsi":"","macd":"","sentiment":""},"historicalCorrelation":""}</JSON_PLAN>';
      }
      if (messages[0].content.includes('Analyst Two')) {
        analystTwoCalls++;
        if (analystTwoCalls === 1) {
          throw new Error('Analyst Two provider exploded');
        }
      }
      yield 'rebuttal';
    });

    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
    ));

    // Analyst Two still got its opening statement; the moderator verdict still arrives.
    expect(events.some(e => e.speaker === 'Analyst Two' && e.round === 1)).toBe(true);
    expect(events.some(e => e.speaker === 'Moderator')).toBe(true);
    // Analyst Two dropped out of the debate after its first-round failure.
    expect(analystTwoCalls).toBe(1);
  });

  it('propagates cancellation as AbortError once the signal aborts', async () => {
    streamMock.mockImplementation(async function* () {
      yield 'any';
    });

    const controller = new AbortController();
    const gen = conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      controller.signal,
    );

    // Consume the free opening statements, then abort before the rebuttals.
    const first = await gen.next();
    expect(first.value).toMatchObject({ round: 1 });
    await gen.next(); // second analyst's opening
    controller.abort();
    await expect(gen.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('requires at least two analysts', async () => {
    await expect(collectEvents(conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
    ))).rejects.toThrow('at least 2 analysts');
  });

  it('calls the moderator SEPARATELY even when the same model is also an analyst', async () => {
    const calls: string[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      calls.push(messages[0].content);
      if (messages[0].content.includes('debate moderator')) {
        yield 'Moderator verdict text.\n</DEBATE_END>\n<JSON_PLAN>{"direction":"Long","confidence":"Medium","probability":60,"strategy":"s","activeStrategies":[],"entryPoints":[],"stopLoss":"","takeProfit":[],"marketConditions":{"pattern":"","candleBehavior":"","timeframeAlignment":"","rsi":"","macd":"","sentiment":""},"historicalCorrelation":""}</JSON_PLAN>';
      } else {
        yield 'rebuttal-from-analyst';
      }
    });

    // Moderator uses model-b — the SAME model as Analyst Two.
    const moderatorConfig = { ...config, selectedModel: 'model-b' };
    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, moderatorConfig, 'model-b',
    ));

    // 2 rebuttal rounds × 2 analysts + exactly ONE separate moderator call.
    const moderatorCalls = calls.filter(c => c.includes('debate moderator'));
    expect(calls.length).toBe(2 * REAL_DEBATE_RESPONSE_ROUNDS + 1);
    expect(moderatorCalls.length).toBe(1);

    // The moderator's output is its own scripted verdict — never the analyst's
    // rebuttal text, even though the same model id backs both roles.
    const moderatorText = events.filter(e => e.speaker === 'Moderator').map(e => e.text).join('');
    expect(moderatorText).toContain('Moderator verdict text');
    expect(moderatorText).not.toContain('rebuttal-from-analyst');
    expect(moderatorText).toContain('<JSON_PLAN>');
  });

  it('retries the moderator once with a compact prompt when the first attempt errors', async () => {
    let moderatorCalls = 0;
    const moderatorPrompts: string[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      if (messages[0].content.includes('debate moderator')) {
        moderatorCalls++;
        moderatorPrompts.push(messages[1].content);
        if (moderatorCalls === 1) {
          yield '<MODERATOR_ERROR>provider exploded</MODERATOR_ERROR>';
          return;
        }
        yield '</DEBATE_END>\n<JSON_PLAN>{"direction":"Short","confidence":"Low","probability":45,"strategy":"s","activeStrategies":[],"entryPoints":[],"stopLoss":"","takeProfit":[],"marketConditions":{"pattern":"","candleBehavior":"","timeframeAlignment":"","rsi":"","macd":"","sentiment":""},"historicalCorrelation":""}</JSON_PLAN>';
      } else {
        yield 'rebuttal';
      }
    });

    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
    ));

    expect(moderatorCalls).toBe(2);
    // Second attempt uses the compact prompt (no full context blocks).
    expect(moderatorPrompts[1]).toContain('COMPACT');
    const moderatorText = events.filter(e => e.speaker === 'Moderator').map(e => e.text).join('');
    expect(moderatorText).toContain('<JSON_PLAN>');
    expect(moderatorText).toContain('"direction":"Short"');
  });

  it('still completes the stream when both moderator attempts fail (hook falls back)', async () => {
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      if (messages[0].content.includes('debate moderator')) {
        yield '<MODERATOR_ERROR>still down</MODERATOR_ERROR>';
      } else {
        yield 'rebuttal';
      }
    });

    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
    ));

    // The generator completes without throwing; the error marker is visible so
    // the pipeline can fall back to a clear message instead of a silent dead end.
    const moderatorText = events.filter(e => e.speaker === 'Moderator').map(e => e.text).join('');
    expect(moderatorText).toContain('<MODERATOR_ERROR>');
    expect(events.some(e => e.speaker === 'Analyst One')).toBe(true);
  });
});