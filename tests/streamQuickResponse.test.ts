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
