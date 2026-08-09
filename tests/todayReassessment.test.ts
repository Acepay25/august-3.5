import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock the transport layer — no network calls; script the raw model output.
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn() as Mock<(...args: any[]) => Promise<string>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  sendChatRequest: ((...args: any[]) => sendMock(...args)) as any,
  streamChatRequest: ((...args: any[]) => Promise.reject(new Error('not used'))) as any,
}));

import {
  buildTodayReassessmentPrompt,
  parseTodayReassessment,
  conductTodayReassessment,
} from '../services/providers/GenericAnalysisService';
import { TradeOutcome } from '../types';
import type { ProviderConfig } from '../types/provider';

const config: ProviderConfig = {
  id: 'prov-a',
  name: 'Provider A',
  apiKey: 'test',
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'chat_completions',
  isEnabled: true,
  isBuiltIn: false,
  models: ['model-1'],
  selectedModel: 'model-1',
};

const analysis = {
  coinName: 'BTCUSDT',
  direction: 'Long',
  entryPoints: [{ price: '60000' }],
  stopLoss: '58000',
  takeProfit: [{ price: '65000' }],
  confidence: 'High',
  probability: 85,
  strategy: 'Breakout retest',
} as any;

describe('parseTodayReassessment', () => {
  it('parses a YES verdict and strips the tag from the body', () => {
    const { verdict, body } = parseTodayReassessment('The setup is still valid.\n<TODAY_VERDICT>YES</TODAY_VERDICT>');
    expect(verdict).toBe('YES');
    expect(body).toBe('The setup is still valid.');
  });

  it('parses NO and MAYBE verdicts case-insensitively', () => {
    expect(parseTodayReassessment('X <today_verdict>no</today_verdict>').verdict).toBe('NO');
    expect(parseTodayReassessment('X <TODAY_VERDICT>maybe</TODAY_VERDICT>').verdict).toBe('MAYBE');
  });

  it('returns UNKNOWN when the tag is missing, keeping the full text as body', () => {
    const { verdict, body } = parseTodayReassessment('No tag here at all.');
    expect(verdict).toBe('UNKNOWN');
    expect(body).toBe('No tag here at all.');
  });
});

describe('buildTodayReassessmentPrompt', () => {
  it('includes the original setup levels, outcome, price and the verdict directive', () => {
    const prompt = buildTodayReassessmentPrompt({
      analysis,
      postMortem: 'The stop was too tight.',
      outcome: TradeOutcome.LOSS,
      currentPrice: 62500,
    });
    expect(prompt).toContain('60000');
    expect(prompt).toContain('58000');
    expect(prompt).toContain('65000');
    expect(prompt).toContain('Long');
    expect(prompt).toContain('$62,500');
    expect(prompt).toContain('LOSS');
    expect(prompt).toContain('Would you still take this setup TODAY');
    expect(prompt).toContain('<TODAY_VERDICT>YES</TODAY_VERDICT>');
  });

  it('truncates very long post-mortems to protect the context window', () => {
    const prompt = buildTodayReassessmentPrompt({
      analysis,
      postMortem: 'x'.repeat(5000),
      outcome: TradeOutcome.WIN,
      currentPrice: 60000,
    });
    expect(prompt).not.toContain('x'.repeat(5000));
    expect(prompt.length).toBeLessThan(4000);
  });

  it('notes when the current price is unavailable instead of inventing one', () => {
    const prompt = buildTodayReassessmentPrompt({
      analysis,
      postMortem: '',
      outcome: TradeOutcome.LOSS,
      currentPrice: 0,
    });
    expect(prompt).toContain('unavailable right now');
  });
});

describe('conductTodayReassessment', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('returns the parsed verdict + reasoning from the model output', async () => {
    sendMock.mockResolvedValue('Levels still hold.\n<TODAY_VERDICT>YES</TODAY_VERDICT>');
    const result = await conductTodayReassessment(config, {
      analysis,
      postMortem: 'pm',
      outcome: TradeOutcome.WIN,
      currentPrice: 61000,
    });
    expect(result).toEqual({ verdict: 'YES', text: 'Levels still hold.' });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to MAYBE when the model omits the verdict tag', async () => {
    sendMock.mockResolvedValue('Unclear without more data.');
    const result = await conductTodayReassessment(config, {
      analysis,
      postMortem: 'pm',
      outcome: TradeOutcome.LOSS,
      currentPrice: 61000,
    });
    expect(result.verdict).toBe('MAYBE');
    expect(result.text).toBe('Unclear without more data.');
  });

  it('propagates provider failures (the hook surfaces them)', async () => {
    sendMock.mockRejectedValue(new Error('quota exceeded'));
    await expect(
      conductTodayReassessment(config, {
        analysis,
        postMortem: 'pm',
        outcome: TradeOutcome.LOSS,
        currentPrice: 61000,
      }),
    ).rejects.toThrow('quota exceeded');
  });
});
