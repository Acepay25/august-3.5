import { describe, it, expect } from 'vitest';
import { toAnthropicContent, toResponsesInput } from '../services/providers/GenericProviderService';
import type { ChatMessage, ContentPart } from '../services/providers/GenericProviderService';

// B4/B5 regression tests: the provider payload builders were the highest-risk
// untested code in the app — a hardcoded 'image/png' media type broke JPEG
// screenshots, and role:'system' entries in the Responses API input got 400s.

describe('toAnthropicContent — vision payloads', () => {
  it('passes plain strings through as text blocks', () => {
    expect(toAnthropicContent('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('carries the real media type from the data URL prefix', () => {
    const parts: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/webp;base64,BBBB' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,CCCC' } },
    ];
    const blocks = toAnthropicContent(parts);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].source.media_type).toBe('image/jpeg');
    expect(blocks[1].source.media_type).toBe('image/webp');
    expect(blocks[2].source.media_type).toBe('image/png');
    expect(blocks[0].source.data).toBe('AAAA');
  });

  it('defaults to png when the data URL has no media type', () => {
    const parts: ContentPart[] = [{ type: 'image_url', image_url: { url: 'data:;base64,XXXX' } }];
    const blocks = toAnthropicContent(parts);
    expect(blocks[0].source.media_type).toBe('image/png');
  });

  it('passes non-data URLs through as url sources instead of empty base64', () => {
    const parts: ContentPart[] = [{ type: 'image_url', image_url: { url: 'https://host/chart.jpg' } }];
    const blocks = toAnthropicContent(parts);
    expect(blocks[0].source.type).toBe('url');
    expect(blocks[0].source.url).toBe('https://host/chart.jpg');
    // The old code emitted { data: '' } — never an empty payload.
    expect(blocks[0].source.data).toBeUndefined();
  });

  it('keeps text blocks alongside images', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Analyze this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ];
    const blocks = toAnthropicContent(parts);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Analyze this' });
    expect(blocks[1].type).toBe('image');
  });
});

describe('toResponsesInput — OpenAI Responses API roles', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a trading analyst.' },
    { role: 'user', content: 'Analyze BTC' },
    { role: 'assistant', content: 'Here is the analysis.' },
  ];

  it('excludes the system message from input (the API only accepts user/assistant)', () => {
    const input = toResponsesInput(messages);
    expect(input).toHaveLength(2);
    expect(input.every(m => m.role !== 'system')).toBe(true);
    expect(input[0].role).toBe('user');
    expect(input[1].role).toBe('assistant');
  });

  it('maps image parts to input_image blocks', () => {
    const withImage: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'chart' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ];
    const input = toResponsesInput(withImage);
    expect(input[0].content[0]).toEqual({ type: 'input_text', text: 'chart' });
    expect(input[0].content[1].type).toBe('input_image');
    expect(input[0].content[1].image_url).toBe('data:image/png;base64,AAAA');
  });
});
