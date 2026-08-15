import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { TradeAnalysis } from '../types';
import type { ProviderConfig } from '../types/provider';
import { parseMarkdownTradePlan } from '../utils/analysisUtils';

// Mock the transport layer so the debate generators run with scripted chunks
// and NO network/SDK calls (this also makes the abort/error paths observable).
const { streamMock, sendMock } = vi.hoisted(() => ({
  streamMock: vi.fn() as Mock<(...args: any[]) => any>,
  sendMock: vi.fn() as Mock<(...args: any[]) => Promise<any>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
  sendChatRequest: ((...args: any[]) => sendMock(...args)) as any,
  sendChatTurn: (async () => ({
    text: '',
    reasoning: '',
    toolCalls: [],
    assistantMessage: { role: 'assistant', content: '' },
  })) as any,
}));

import {
  conductDebate,
  conductTwoWayDebate,
  conductThreeWayDebate,
  conductRealDebate,
  awaitReplacementWithTimeout,
  buildLivePriceRefreshBlock,
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

/**
 * The moderator's FINAL TRADE PLAN contract is MARKDOWN — labeled bullet
 * lines, no JSON anywhere. The pipeline parses it with parseMarkdownTradePlan.
 */
const MARKDOWN_PLAN = (direction: string, confidence = 'Medium', probability = 60): string =>
  `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** ${direction}
- **Entry:** 95000 — Support retest
- **Stop Loss:** 94500
- **Take Profit 1:** 96000 (2%)
- **Take Profit 2:** 97000 (4%)
- **Confidence:** ${confidence}
- **Probability:** ${probability}%
- **Strategy:** Trend continuation`;

const FULL_DEBATE = [
  '**Analyst One:** thesis presented\n\n',
  '**Analyst Two:** counter-thesis presented\n\n',
  '<DEBATE_START>\n**Moderator:** synthesis verdict\n\n' + MARKDOWN_PLAN('Long'),
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
    expect(output).toContain('FINAL TRADE PLAN');
    // Moderator messages: fixed system role + user prompt that names the analysts.
    const [cfg, messages] = streamMock.mock.calls[0];
    expect(messages[0].role).toBe('system');
    const userPrompt = messages[1].content as string;
    expect(userPrompt).toContain('<DEBATE_START>');
    expect(userPrompt).toContain('FINAL TRADE PLAN');
    expect(userPrompt.toUpperCase()).toContain('ANALYST ONE');
    expect(userPrompt.toUpperCase()).toContain('ANALYST TWO');
    // The embedded markdown plan is extractable end-to-end.
    const plan = parseMarkdownTradePlan(output);
    expect(plan?.direction).toBe('Long');
    expect(plan?.entry).toBe('95000');
    void cfg;
  });

  it('conductThreeWayDebate yields and preserves all three analyst names in the prompt', async () => {
    streamMock.mockImplementation(async function* () {
      yield 'three-way synthesis';
      yield MARKDOWN_PLAN('Long');
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
      yield MARKDOWN_PLAN('Short', 'Medium', 55);
    });

    const output = await collect(conductDebate(
      [analyst, analyst], ['Analyst One', 'Analyst Two'],
      'Analyze', null, 'original', undefined,
      config, 'model-a', false, true, null, [], '',
    ));
    expect(output).toContain('accuracy moderator chunk');
    expect(parseMarkdownTradePlan(output)?.direction).toBe('Short');
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

const isFloorSeat = (system: string, name: string): boolean =>
  system.includes(`**FLOOR SEAT:** ${name}`);

const floorSeatName = (system: string, names: string[]): string =>
  names.find(n => isFloorSeat(system, n)) ?? 'unknown';

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

  /** Mock stream: rebuttals echo the analyst name; clarification defaults to done; verdict emits JSON. */
  const mockStreams = () => {
    const calls: { system: string; user: string }[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      calls.push({ system, user });
      if (system.includes('CLARIFICATION ANSWER')) {
        yield `**${floorSeatName(system, ['Analyst One', 'Analyst Two'])}:** exact clarification answer`;
      } else if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
      } else if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
      } else if (system.includes('debate moderator')) {
        yield 'Verdict: Long on breakout with tight stop.\n';
        yield '</DEBATE_END>\n';
        yield MARKDOWN_PLAN('Long', 'Medium', 60);
      } else {
        yield `rebuttal-${isFloorSeat(system, 'Analyst One') ? 'one' : 'two'}`;
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

    // 2 rebuttal rounds × 2 analysts + clarification questions + verdict.
    expect(calls.length).toBe(2 * REAL_DEBATE_RESPONSE_ROUNDS + 2);
    expect(calls.length).toBe(6);

    // Rebuttal calls carry the DEBATE_RESPONSE_PROMPT with the speaker and round.
    const firstRebuttal = calls.find(c => !c.system.includes('debate moderator'))!;
    expect(firstRebuttal.system).toContain('ENSEMBLE DEBATE PARTICIPANT');
    expect(firstRebuttal.system).toContain('ROUND 2');
    expect(firstRebuttal.system).toContain('not answering a new user question');
    expect(firstRebuttal.system).toContain('**FLOOR SEAT:**');
    expect(firstRebuttal.system).toContain('**OTHER SEATS:**');
    expect(firstRebuttal.user).toContain('FLOOR ORIENTATION');
    expect(firstRebuttal.user).toContain('TRADER REQUEST (Round 1 context only');
    expect(firstRebuttal.user).toContain('YOUR LEVELS');
    expect(firstRebuttal.user).toContain('Respond now with your rebuttal for Round 2');
    expect(firstRebuttal.user).toContain('LEVELS SNAPSHOT');
    expect(firstRebuttal.user).not.toContain('**Analyst Two (Round 1):**');

    // The moderator verdict round streams the </DEBATE_END> + FINAL TRADE PLAN
    // markdown block contract.
    const moderatorEvents = events.filter(e => e.speaker === 'Moderator');
    expect(moderatorEvents.length).toBeGreaterThan(0);
    const modText = moderatorEvents.map(e => e.text).join('');
    expect(modText).toContain('</DEBATE_END>');
    expect(parseMarkdownTradePlan(modText)?.direction).toBe('Long');

    // Round structure: the questions round is reserved (even when the moderator
    // short-circuits with <CLARIFICATION_DONE>) so the verdict gets its own
    // round and can never merge with the questions turn.
    const rounds = [...new Set(events.map(e => e.round))];
    expect(rounds).toEqual([1, 2, 3, 4, 5]);
  });

  it('continues the debate when one analyst fails a rebuttal round', async () => {
    let analystTwoCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
        return;
      }
      if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
        return;
      }
      if (system.includes('debate moderator')) {
        yield '</DEBATE_END>\n' + MARKDOWN_PLAN('Short', 'Low', 45);
        return;
      }
      if (isFloorSeat(system, 'Analyst Two')) {
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
      if (messages[1].content.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
      } else if (messages[0].content.includes('debate moderator')) {
        yield 'Moderator verdict text.\n</DEBATE_END>\n' + MARKDOWN_PLAN('Long', 'Medium', 60);
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

    // 2 rebuttal rounds × 2 analysts + clarification questions + verdict.
    const moderatorCalls = calls.filter(c => c.includes('debate moderator'));
    expect(calls.length).toBe(2 * REAL_DEBATE_RESPONSE_ROUNDS + 2);
    expect(moderatorCalls.length).toBe(2);

    // The moderator's output is its own scripted verdict — never the analyst's
    // rebuttal text, even though the same model id backs both roles.
    const moderatorText = events.filter(e => e.speaker === 'Moderator').map(e => e.text).join('');
    expect(moderatorText).toContain('Moderator verdict text');
    expect(moderatorText).not.toContain('rebuttal-from-analyst');
    expect(moderatorText).toContain('FINAL TRADE PLAN');
  });

  it('retries the moderator once with a compact prompt when the first attempt errors', async () => {
    let moderatorCalls = 0;
    const moderatorPrompts: string[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
        return;
      }
      if (system.includes('debate moderator')) {
        moderatorCalls++;
        moderatorPrompts.push(user);
        if (moderatorCalls === 1) {
          yield '<MODERATOR_ERROR>provider exploded</MODERATOR_ERROR>';
          return;
        }
        yield '</DEBATE_END>\n' + MARKDOWN_PLAN('Short', 'Low', 45);
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
    expect(moderatorText).toContain('FINAL TRADE PLAN');
    expect(moderatorText).toContain('- **Direction:** Short');
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

  const verdictJson = MARKDOWN_PLAN('Long', 'Medium', 60);
  const clarificationAnalysts = () => [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];

  const scriptedClarificationStreams = (judgments: string[], options: { done?: boolean; failQuestion?: boolean; failAnswer?: string; failJudgment?: boolean } = {}) => {
    const calls: { system: string; user: string }[] = [];
    let judgmentIndex = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      calls.push({ system, user });

      if (user.includes('CLARIFICATION ROUND')) {
        if (options.failQuestion) throw new Error('clarification questions unavailable');
        if (options.done) {
          yield '<CLARIFICATION_DONE>';
        } else {
          yield '**Analyst One:** Which exact level confirms the breakout?\n**Analyst Two:** Which exact level invalidates the breakout?';
        }
        return;
      }
      if (user.includes('CLARIFICATION JUDGMENT')) {
        if (options.failJudgment) throw new Error('judgment unavailable');
        yield judgments[judgmentIndex++] || '<CLARIFICATION_SATISFIED>';
        return;
      }
      if (system.includes('CLARIFICATION ANSWER')) {
        if (options.failAnswer && isFloorSeat(system, options.failAnswer)) throw new Error('answer provider unavailable');
        yield isFloorSeat(system, 'Analyst One') ? '**Analyst One:** 123.40 confirms.' : '**Analyst Two:** 121.90 invalidates.';
        return;
      }
      if (system.includes('debate moderator')) {
        yield 'Moderator verdict.\n</DEBATE_END>\n';
        yield verdictJson;
        return;
      }
      yield 'rebuttal';
    });
    return calls;
  };

  it('runs one clarification cycle, then reaches the verdict after satisfaction', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_SATISFIED>']);
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(9);
    expect([...new Set(events.map(event => event.round))]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.some(event => event.round === 4 && event.speaker === 'Moderator')).toBe(true);
    expect(events.some(event => event.round === 5 && event.speaker === 'Analyst One')).toBe(true);
    expect(events.some(event => event.round === 6 && event.speaker === 'Moderator')).toBe(true);
  });

  it('tells each analyst they are answering the Moderator, not a new trader request', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_SATISFIED>']);
    await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    const one = calls.find(c => c.system.includes('CLARIFICATION ANSWER') && isFloorSeat(c.system, 'Analyst One'))!;
    const two = calls.find(c => c.system.includes('CLARIFICATION ANSWER') && isFloorSeat(c.system, 'Analyst Two'))!;
    expect(one.system).toContain('Moderator');
    expect(one.system).toContain('not the trader');
    expect(one.system).toContain('Which exact level confirms the breakout?');
    expect(one.system).not.toContain('Which exact level invalidates the breakout?');
    expect(one.system).toContain('Analyst Two');
    expect(one.user).toContain('FLOOR ORIENTATION');
    expect(one.user).toContain('MODERATOR → Analyst One');
    expect(one.user).toContain('Which exact level confirms the breakout?');
    expect(two.user).toContain('MODERATOR → Analyst Two');
    expect(two.user).toContain('Which exact level invalidates the breakout?');
    expect(two.system).toContain('Analyst One');
    expect(two.system).toContain('Which exact level invalidates the breakout?');
    expect(two.system).not.toContain('Which exact level confirms the breakout?');
  });

  it('injects the live price refresh into rebuttal, clarification answer and verdict prompts', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_UNSATISFIED>', '<CLARIFICATION_SATISFIED>']);
    await collectEvents(conductRealDebate(
      clarificationAnalysts(),
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, () => 62500, // replacementTimeoutMs, getLivePrice
    ));

    // Rebuttal rounds: every analyst re-anchors on TODAY's price.
    const rebuttals = calls.filter(c => c.system.includes('ENSEMBLE DEBATE PARTICIPANT'));
    expect(rebuttals.length).toBeGreaterThan(0);
    for (const c of rebuttals) {
      expect(c.user).toContain('LIVE PRICE REFRESH');
      expect(c.user).toContain('$62,500');
    }
    // Clarification answers carry the refresh too.
    const answers = calls.filter(c => c.system.includes('CLARIFICATION ANSWER'));
    expect(answers.length).toBeGreaterThan(0);
    for (const c of answers) {
      expect(c.user).toContain('LIVE PRICE REFRESH');
      expect(c.user).toContain('$62,500');
    }
    // The final verdict is anchored on the freshest price.
    const verdict = calls.find(c => c.system.includes('debate moderator'))!;
    expect(verdict.user).toContain('LIVE PRICE REFRESH');
    expect(verdict.user).toContain('$62,500');
  });

  it('omits the live price refresh when no live price is available', async () => {
    const calls = mockStreams();
    await collectEvents(conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, () => null, // replacementTimeoutMs, getLivePrice: unknown → no refresh anywhere
    ));

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.user).not.toContain('LIVE PRICE REFRESH');
    }
  });

  it('buildLivePriceRefreshBlock formats a price and no-ops on unknown/invalid values', () => {
    expect(buildLivePriceRefreshBlock(62500, 'before Round 2')).toContain('$62,500');
    expect(buildLivePriceRefreshBlock(62500, 'before Round 2')).toContain('before Round 2');
    expect(buildLivePriceRefreshBlock(null, 'x')).toBe('');
    expect(buildLivePriceRefreshBlock(undefined, 'x')).toBe('');
    expect(buildLivePriceRefreshBlock(0, 'x')).toBe('');
    expect(buildLivePriceRefreshBlock(NaN, 'x')).toBe('');
    expect(buildLivePriceRefreshBlock(-5, 'x')).toBe('');
  });

  it('runs a second clarification cycle after one unsatisfied judgment', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_UNSATISFIED>', '<CLARIFICATION_SATISFIED>']);
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(13);
    expect([...new Set(events.map(event => event.round))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('caps unsatisfied clarification cycles without a third judgment call', async () => {
    const calls = scriptedClarificationStreams([
      '<CLARIFICATION_UNSATISFIED>',
      '<CLARIFICATION_UNSATISFIED>',
    ]);
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(16);
    expect([...new Set(events.map(event => event.round))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(calls.filter(call => call.user.includes('CLARIFICATION JUDGMENT')).length).toBe(2);
  });

  it('short-circuits clarification when the moderator has no questions', async () => {
    const calls = scriptedClarificationStreams([], { done: true });
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(6);
    expect(events.some(event => event.text.includes('<CLARIFICATION_DONE>'))).toBe(true);
    expect(events.some(event => event.round === 4 && event.speaker === 'Moderator')).toBe(true);
  });

  it('drops an analyst after a failed clarification answer and continues', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_UNSATISFIED>', '<CLARIFICATION_SATISFIED>'], { failAnswer: 'Analyst Two' });
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(events.some(event => event.speaker === 'Analyst One' && event.round === 5)).toBe(true);
    expect(events.some(event => event.speaker === 'Analyst Two' && event.round === 5)).toBe(false);
    expect(calls.filter(call => call.system.includes('CLARIFICATION ANSWER') && isFloorSeat(call.system, 'Analyst Two')).length).toBe(1);
    expect(events.some(event => event.speaker === 'Moderator' && event.text.includes('Moderator verdict'))).toBe(true);
  });

  it('skips clarification after a questions-call failure', async () => {
    const calls = scriptedClarificationStreams([], { failQuestion: true });
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(6);
    expect(events.some(event => event.speaker === 'Moderator' && event.text.includes('Moderator verdict'))).toBe(true);
  });

  it('treats a judgment failure as satisfied', async () => {
    const calls = scriptedClarificationStreams([], { failJudgment: true });
    const events = await collectEvents(conductRealDebate(clarificationAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    expect(calls.length).toBe(9);
    expect(events.some(event => event.round === 6 && event.speaker === 'Moderator')).toBe(true);
  });

  it('reports active speaker status around clarification and verdict streams', async () => {
    const calls = scriptedClarificationStreams(['<CLARIFICATION_SATISFIED>']);
    const statuses: Array<{ speaker: string; round: number; active: boolean }> = [];
    await collectEvents(conductRealDebate(
      clarificationAnalysts(),
      'Analyze BTCUSDT',
      null,
      config,
      'model-a',
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      (speaker: string, round: number, active: boolean) => statuses.push({ speaker, round, active }),
    ));

    expect(statuses).toContainEqual({ speaker: 'Moderator', round: 4, active: true });
    expect(statuses).toContainEqual({ speaker: 'Moderator', round: 4, active: false });
    expect(statuses).toContainEqual({ speaker: 'Analyst One', round: 5, active: true });
    expect(statuses).toContainEqual({ speaker: 'Analyst Two', round: 5, active: false });
    expect(statuses).toContainEqual({ speaker: 'Moderator', round: 6, active: true });
    expect(statuses).toContainEqual({ speaker: 'Moderator', round: 6, active: false });
  });

  const threeAnalysts = () => [
    realAnalyst('prov-a', 'Analyst One', 'model-a'),
    realAnalyst('prov-b', 'Analyst Two', 'model-b'),
    realAnalyst('prov-c', 'Analyst Three', 'model-c'),
  ];

  it('runs the full debate with three analysts (openings, rebuttals, verdict)', async () => {
    const calls: { system: string; user: string }[] = [];
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      calls.push({ system, user });
      if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
      } else if (system.includes('debate moderator')) {
        yield 'Verdict for three.\n</DEBATE_END>\n';
        yield verdictJson;
      } else {
        const name = floorSeatName(system, ['Analyst One', 'Analyst Two', 'Analyst Three']);
        yield `rebuttal-${name}`;
      }
    });

    const events = await collectEvents(conductRealDebate(threeAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    // Round 1 = three opening statements, before any provider call happened.
    expect(events.filter(e => e.round === 1).map(e => e.speaker)).toEqual(['Analyst One', 'Analyst Two', 'Analyst Three']);

    // Rebuttal rounds: every analyst speaks in BOTH rounds.
    for (const round of [2, 3]) {
      expect(events.filter(e => e.round === round).map(e => e.speaker).sort()).toEqual(['Analyst One', 'Analyst Three', 'Analyst Two']);
    }

    // 2 rebuttal rounds × 3 analysts + clarification questions + verdict.
    expect(calls.length).toBe(2 * 3 + 2);

    const moderatorEvents = events.filter(e => e.speaker === 'Moderator');
    expect(moderatorEvents.length).toBeGreaterThan(0);
    const modText = moderatorEvents.map(e => e.text).join('');
    expect(modText).toContain('</DEBATE_END>');
    expect(parseMarkdownTradePlan(modText)?.direction).toBe('Long');
    // The questions round is reserved even on <CLARIFICATION_DONE> — the
    // verdict gets its own round (5) instead of sharing round 4.
    expect([...new Set(events.map(e => e.round))]).toEqual([1, 2, 3, 4, 5]);
  });

  it('runs a clarification cycle with all three analysts answering in parallel', async () => {
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (system.includes('CLARIFICATION ANSWER')) {
        const name = floorSeatName(system, ['Analyst One', 'Analyst Two', 'Analyst Three']);
        yield `**${name}:** exact clarification answer`;
      } else if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
      } else if (user.includes('CLARIFICATION ROUND')) {
        yield '**Analyst One:** justify your entry? **Analyst Two:** justify your stop? **Analyst Three:** justify your target?';
      } else if (system.includes('debate moderator')) {
        yield 'Verdict for three.\n</DEBATE_END>\n';
        yield verdictJson;
      } else {
        yield 'rebuttal';
      }
    });

    const events = await collectEvents(conductRealDebate(threeAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    // Clarification: moderator questions (round 4), three parallel answers
    // (round 5), satisfied judgment, verdict (round 6).
    expect(events.filter(e => e.round === 4).some(e => e.speaker === 'Moderator')).toBe(true);
    expect(events.filter(e => e.round === 5).map(e => e.speaker).sort()).toEqual(['Analyst One', 'Analyst Three', 'Analyst Two']);
    expect(events.filter(e => e.round === 5).every(e => e.text.includes('exact clarification answer'))).toBe(true);
    expect([...new Set(events.map(e => e.round))]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('continues with the remaining analysts when one of three fails a rebuttal', async () => {
    let analystThreeCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
        return;
      }
      if (system.includes('debate moderator')) {
        yield 'Verdict for three.\n</DEBATE_END>\n';
        yield verdictJson;
        return;
      }
      if (isFloorSeat(system, 'Analyst Three')) {
        analystThreeCalls++;
        if (analystThreeCalls === 1) throw new Error('Analyst Three provider exploded');
      }
      yield 'rebuttal';
    });

    const events = await collectEvents(conductRealDebate(threeAnalysts(), 'Analyze BTCUSDT', null, config, 'model-a'));

    // Analyst Three still got its opening statement, then dropped out: it
    // never produces a rebuttal and is not called again.
    expect(events.filter(e => e.round === 1).map(e => e.speaker)).toContain('Analyst Three');
    expect(events.filter(e => e.round === 3).map(e => e.speaker).sort()).toEqual(['Analyst One', 'Analyst Two']);
    expect(analystThreeCalls).toBe(1);
    // The moderator verdict still arrives.
    expect(events.some(e => e.speaker === 'Moderator')).toBe(true);
  });

  // =========================================================================
  // Mid-debate analyst replacement (generator suspension)
  // =========================================================================

  /** Round-2 drop of Analyst Two; rounds 1/3+ stream normally. */
  const replacementDropStreams = (dropAnalyst: string) => {
    const calls: { system: string; user: string }[] = [];
    let droppedCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      calls.push({ system, user });
      if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
        return;
      }
      if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
        return;
      }
      if (system.includes('debate moderator')) {
        yield 'Moderator verdict.\n</DEBATE_END>\n';
        yield verdictJson;
        return;
      }
      if (isFloorSeat(system, dropAnalyst)) {
        droppedCalls++;
        if (droppedCalls === 1) throw new Error(`${dropAnalyst} provider exploded`);
      }
      yield 'rebuttal';
    });
    return { calls, droppedCalls: () => droppedCalls };
  };

  it('injects a replacement analyst mid-debate when one drops a rebuttal', async () => {
    const replacement = realAnalyst('prov-c', 'Analyst Three', 'model-c');
    const onReplacementRequested = vi.fn().mockResolvedValue(replacement);
    replacementDropStreams('Analyst Two');

    const events = await collectEvents(conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
      undefined, undefined, undefined, undefined, undefined,
      onReplacementRequested, 2000,
    ));

    // The callback fired once, with the dropped analyst and the drop round.
    expect(onReplacementRequested).toHaveBeenCalledTimes(1);
    expect(onReplacementRequested).toHaveBeenCalledWith('Analyst Two', 2);

    // Drop + join notices are visible System turns.
    const systemTexts = events.filter(e => e.speaker === 'System').map(e => e.text).join(' ');
    expect(systemTexts).toContain('Analyst Two dropped out');
    expect(systemTexts).toContain('Analyst Two was replaced by Analyst Three');

    // The replacement's fresh position is a visible turn seeded at the drop round.
    const seededOpening = events.find(e => e.speaker === 'Analyst Three' && e.round === 2);
    expect(seededOpening?.text).toContain('opening statement');

    // Round 3 rebuttals include the replacement alongside the survivor.
    expect(events.filter(e => e.round === 3).map(e => e.speaker).sort()).toEqual(['Analyst One', 'Analyst Three']);
    // The moderator verdict still arrives.
    const moderatorText = events.filter(e => e.speaker === 'Moderator').map(e => e.text).join('');
    expect(parseMarkdownTradePlan(moderatorText)?.direction).toBe('Long');
  });

  it('continues without a replacement when the user skips', async () => {
    const onReplacementRequested = vi.fn().mockResolvedValue(null);
    replacementDropStreams('Analyst Two');

    const events = await collectEvents(conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
      undefined, undefined, undefined, undefined, undefined,
      onReplacementRequested, 2000,
    ));

    expect(onReplacementRequested).toHaveBeenCalledTimes(1);
    // No replacement ever speaks; only the survivor rebuts in round 3.
    expect(events.some(e => e.speaker === 'Analyst Three')).toBe(false);
    expect(events.filter(e => e.round === 3).map(e => e.speaker)).toEqual(['Analyst One']);
    expect(events.some(e => e.speaker === 'Moderator')).toBe(true);
  });

  it('suspends the debate while waiting for the replacement choice', async () => {
    // Object holder so TS doesn't narrow the resolver to never across closures.
    const pendingReplacement: { resolve: ((a: unknown) => void) | null } = { resolve: null };
    const onReplacementRequested = vi.fn().mockImplementation(
      () => new Promise(resolve => { pendingReplacement.resolve = resolve; }),
    );
    const { calls } = replacementDropStreams('Analyst Two');
    const gen = conductRealDebate(
      [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')],
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
      undefined, undefined, undefined, undefined, undefined,
      onReplacementRequested, 2000,
    );

    // Drain until the System drop notice appears (round-2 pump is complete).
    const events: RealDebateTurnEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const result = await gen.next();
      if (result.done) break;
      events.push(result.value);
      if (result.value.speaker === 'System' && result.value.text.includes('dropped out')) break;
    }
    expect(events.some(e => e.speaker === 'System' && e.text.includes('Analyst Two dropped out'))).toBe(true);

    // Resuming the generator invokes the replacement callback and suspends on
    // it — the moderator must NOT be called while the user is choosing.
    const pending = gen.next();
    expect(onReplacementRequested).toHaveBeenCalledTimes(1);
    expect(calls.filter(c => c.system.includes('debate moderator')).length).toBe(0);

    // The user picks a replacement: the wait resolves and the debate continues.
    pendingReplacement.resolve?.(realAnalyst('prov-c', 'Analyst Three', 'model-c'));
    const resumed = await pending;
    if (resumed.done) throw new Error('Debate ended while waiting for the replacement notice');
    const rest = await collectEvents(gen);
    const all = [...events, resumed.value, ...rest];
    expect(all.some(e => e.speaker === 'Analyst Three')).toBe(true);
    expect(all.some(e => e.speaker === 'Moderator')).toBe(true);
    // The moderator call happened only after the wait resolved.
    expect(calls.filter(c => c.system.includes('debate moderator')).length).toBeGreaterThan(0);
  });

  it('offers a replacement when an analyst drops while answering a clarification question', async () => {
    const onReplacementRequested = vi.fn().mockResolvedValue(realAnalyst('prov-c', 'Analyst Three', 'model-c'));
    scriptedClarificationStreams(['<CLARIFICATION_SATISFIED>'], { failAnswer: 'Analyst Two' });

    const events = await collectEvents(conductRealDebate(
      clarificationAnalysts(),
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
      undefined, undefined, undefined, undefined, undefined,
      onReplacementRequested, 2000,
    ));

    // Analyst Two dropped during the answers (round 5); the replacement was
    // offered at that round and joined.
    expect(onReplacementRequested).toHaveBeenCalledTimes(1);
    expect(onReplacementRequested).toHaveBeenCalledWith('Analyst Two', 5);
    expect(events.some(e => e.speaker === 'Analyst Three' && e.round === 5)).toBe(true);
    expect(events.some(e => e.speaker === 'Moderator')).toBe(true);
  });
});

// =============================================================================
// awaitReplacementWithTimeout — the bounded suspension primitive
// =============================================================================

describe('awaitReplacementWithTimeout', () => {
  it('resolves with the promise value', async () => {
    await expect(awaitReplacementWithTimeout(Promise.resolve('ok'), undefined, 1000)).resolves.toEqual({ status: 'resolved', value: 'ok' });
  });

  it('resolves { status: "timedOut" } when the wait budget elapses', async () => {
    await expect(awaitReplacementWithTimeout(new Promise<void>(() => {}), undefined, 30)).resolves.toEqual({ status: 'timedOut' });
  });

  it('rejects with AbortError when the signal aborts during the wait', async () => {
    const controller = new AbortController();
    const wait = awaitReplacementWithTimeout(new Promise<void>(() => {}), controller.signal, 5000);
    setTimeout(() => controller.abort(), 10);
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(awaitReplacementWithTimeout(Promise.resolve('x'), controller.signal, 1000)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates promise rejections', async () => {
    await expect(awaitReplacementWithTimeout(Promise.reject(new Error('boom')), undefined, 1000)).rejects.toThrow('boom');
  });
});
describe('conductRealDebate — transient-failure retry (streamWithTransientRetry)', () => {
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

  it('retries a rate-limited rebuttal once — the analyst is NOT dropped', async () => {
    // First rebuttal call per analyst throws 429 (no output yet); the second
    // succeeds. The analyst must survive and speak in the next round.
    let rebuttalCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (system.includes('CLARIFICATION ANSWER')) {
        yield `**${floorSeatName(system, ['Analyst One', 'Analyst Two'])}:** exact clarification answer`;
      } else if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
      } else if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
      } else if (system.includes('debate moderator')) {
        yield 'Verdict: Long on breakout with tight stop.\n';
        yield '</DEBATE_END>\n';
        yield MARKDOWN_PLAN('Long', 'Medium', 60);
      } else {
        rebuttalCalls++;
        if (rebuttalCalls <= 2) {
          // First round of rebuttals: BOTH analysts hit a transient 429.
          const err: any = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        }
        yield `rebuttal-${isFloorSeat(system, 'Analyst One') ? 'one' : 'two'}-round-${user.includes('ROUND 3') ? '3' : '2'}`;
      }
    });

    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
    ));

    // Round 2: 2 calls, both 429, both retried (4 calls). Round 3: 2 successful calls.
    // Total 6 — the retry doubled round 2 but neither analyst dropped.
    expect(rebuttalCalls).toBe(6);
    // Both analysts still spoke in round 2 (after the retry) — neither dropped.
    const round2 = events.filter(e => e.round === 2);
    expect(round2.map(e => e.speaker).sort()).toEqual(['Analyst One', 'Analyst Two']);
    // No replacement offer was emitted for a transient blip.
    expect(events.some(e => e.speaker === 'System' && e.text.includes('replacement'))).toBe(false);
  });

  it('does NOT retry a failure that happens after partial output — the analyst drops', async () => {
    // First rebuttal yields one chunk then throws a network error: the drop
    // path purges the partial text and the analyst leaves the debate.
    let rebuttalCalls = 0;
    streamMock.mockImplementation(async function* (...args: any[]) {
      const messages = args[1] as { role: string; content: string }[];
      const system = messages[0].content;
      const user = messages[1].content;
      if (system.includes('CLARIFICATION ANSWER')) {
        yield `**${floorSeatName(system, ['Analyst One', 'Analyst Two'])}:** exact clarification answer`;
      } else if (user.includes('CLARIFICATION JUDGMENT')) {
        yield '<CLARIFICATION_SATISFIED>';
      } else if (user.includes('CLARIFICATION ROUND')) {
        yield '<CLARIFICATION_DONE>';
      } else if (system.includes('debate moderator')) {
        yield 'Verdict: Long on breakout with tight stop.\n';
        yield '</DEBATE_END>\n';
        yield MARKDOWN_PLAN('Long', 'Medium', 60);
      } else {
        rebuttalCalls++;
        if (rebuttalCalls === 1) {
          // Analyst One's first rebuttal: partial output THEN a network failure.
          yield 'partial rebuttal text';
          throw new Error('NetworkError: failed to fetch');
        }
        yield `rebuttal-${isFloorSeat(system, 'Analyst One') ? 'one' : 'two'}`;
      }
    });

    const analysts = [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];
    const events = await collectEvents(conductRealDebate(
      analysts,
      'Analyze BTCUSDT',
      null, config, 'model-a',
      undefined, [], undefined, undefined, undefined, undefined, null, undefined,
      new AbortController().signal,
    ));

    // No retry for the mid-stream failure: Analyst One's rebuttal was called
    // exactly once, Analyst Two's once (round 2), then round 3 only has Two.
    expect(rebuttalCalls).toBe(3);
    const round3 = events.filter(e => e.round === 3);
    expect(round3.map(e => e.speaker)).toEqual(['Analyst Two']);
  });
});
