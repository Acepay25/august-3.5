import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { MessageRole } from '../types';

// Mock the transport so streamQuickResponse runs on scripted chunks with no
// network/SDK calls.
const { streamMock } = vi.hoisted(() => ({
  streamMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
  sendChatRequest: vi.fn(async () => '') as any,
}));

import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import { TASK_BUDGETS } from '../services/providers/taskBudgets';

const config: ProviderConfig = {
  id: 'prov-a',
  name: 'Provider A',
  apiKey: 'key-a',
  baseUrl: 'https://api.example.com',
  apiFormat: 'chat_completions',
  models: ['model-a'],
  selectedModel: 'model-a',
  isEnabled: true,
  isBuiltIn: false,
} as ProviderConfig;

const asyncGen = (chunks: string[]) => (async function* () {
  for (const c of chunks) yield c;
})();

// Build think-tag scaffolding via concatenation so this file's own source
// never contains a literal think block.
const THINK_OPEN = '<' + 'think' + '>';
const THINK_CLOSE = '</' + 'think' + '>';

describe('streamQuickResponse (live casual-chat streaming)', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  it('pushes visible deltas to onChunk as they arrive and returns the full text', async () => {
    streamMock.mockReturnValue(asyncGen(['Hello ', 'trader, ', 'watch the sweep.']));
    const chunks: string[] = [];
    const result = await streamQuickResponse(
      config, 'question', [], undefined, undefined, undefined,
      delta => chunks.push(delta),
    );
    expect(chunks).toEqual(['Hello ', 'trader, ', 'watch the sweep.']);
    expect(result).toBe('Hello trader, watch the sweep.');
  });

  it('routes think-tag bodies to onReasoning, never into the visible reply', async () => {
    streamMock.mockReturnValue(asyncGen([
      `${THINK_OPEN}weighing the sweep${THINK_CLOSE}`,
      'The answer is Long.',
    ]));
    let reasoning = '';
    const chunks: string[] = [];
    const result = await streamQuickResponse(
      config, 'question', [], undefined, undefined,
      r => { reasoning += r; },
      delta => chunks.push(delta),
    );
    expect(reasoning).toContain('weighing the sweep');
    expect(result).toBe('The answer is Long.');
    expect(result).not.toContain('weighing the sweep');
  });

  it('returns a fallback when the stream yields nothing', async () => {
    streamMock.mockReturnValue(asyncGen([]));
    const result = await streamQuickResponse(config, 'question', []);
    expect(result).toContain('could not generate');
  });

  it('retries once with a doubled budget when reasoning consumed the whole stream', async () => {
    // Pass 1: the model thinks (think tags → reasoning channel) and never
    // gets to the answer. Pass 2 (doubled maxTokens): the reply lands.
    const THINK_OPEN = '<' + 'think' + '>';
    const THINK_CLOSE = '</' + 'think' + '>';
    let call = 0;
    streamMock.mockImplementation(() => {
      call += 1;
      return asyncGen(call === 1
        ? [`${THINK_OPEN}a very long chain of thought${THINK_CLOSE}`]
        : ['The answer is Long.']);
    });
    let reasoning = '';
    const result = await streamQuickResponse(
      config, 'question', [], undefined, undefined,
      r => { reasoning += r; },
    );
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(reasoning).toContain('a very long chain of thought');
    expect(result).toBe('The answer is Long.');
    // Second attempt asked for double the chat budget (referenced from the
    // source of truth so it tracks future budget changes).
    const secondOptions = (streamMock.mock.calls[1] as any)[2];
    expect(secondOptions.maxTokens).toBe(TASK_BUDGETS.chat * 2);
  });

  it('does not retry when the stream simply yields nothing (no reasoning)', async () => {
    streamMock.mockReturnValue(asyncGen([]));
    await streamQuickResponse(config, 'question', []);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('builds the chat messages with a system prompt and the user prompt once', async () => {
    streamMock.mockReturnValue(asyncGen(['ok']));
    await streamQuickResponse(config, 'my question', [
      { id: '1', role: MessageRole.USER, text: 'earlier', createdAt: '' },
    ]);
    const [, messages] = streamMock.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'my question' });
    // The prompt is not duplicated even though history is passed.
    expect(messages.filter((m: any) => m.content === 'my question')).toHaveLength(1);
  });
});

// The composer's thinking dial. Both chat homes now show one chip over one
// stored tier, so the tier has to reach the request — a chip that displays
// 'High' while the wire is sent the chat default is a control that lies about
// the reasoning it asked for. Pinned at the transport, not at the chip.
describe('the composer effort tier reaches the wire', () => {
  const optionsOf = (call = 0): any => (streamMock.mock.calls[call] as any)[2];

  beforeEach(() => {
    streamMock.mockReset();
    streamMock.mockReturnValue(asyncGen(['ok']));
  });

  it('sends the chat task default when the caller names no tier', async () => {
    await streamQuickResponse(config, 'question', []);
    expect(optionsOf().reasoningEffort).toBe('low');
  });

  it('treats an explicit "auto" as the task default, not as a knob', async () => {
    await streamQuickResponse(config, 'question', [], undefined, undefined, undefined, undefined, 'auto');
    expect(optionsOf().reasoningEffort).toBe('low');
  });

  it('sends the tier the composer chose', async () => {
    await streamQuickResponse(config, 'question', [], undefined, undefined, undefined, undefined, 'high');
    expect(optionsOf().reasoningEffort).toBe('high');
  });

  it('passes "off" through instead of stepping it back to the default', async () => {
    await streamQuickResponse(config, 'question', [], undefined, undefined, undefined, undefined, 'off');
    expect(optionsOf().reasoningEffort).toBe('off');
  });

  it('keeps the chosen tier on the doubled-budget retry', async () => {
    // Pass 1 thinks its way through the whole budget; pass 2 must not silently
    // fall back to the default — the user asked for this tier for THIS answer.
    let call = 0;
    streamMock.mockImplementation(() => {
      call += 1;
      return asyncGen(call === 1
        ? ['<' + 'think' + '>a very long chain of thought</' + 'think' + '>']
        : ['The answer is Long.']);
    });
    await streamQuickResponse(config, 'question', [], undefined, undefined, undefined, undefined, 'max');
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(optionsOf(0).reasoningEffort).toBe('max');
    expect(optionsOf(1).reasoningEffort).toBe('max');
    expect(optionsOf(1).maxTokens).toBe(TASK_BUDGETS.chat * 2);
  });
});
