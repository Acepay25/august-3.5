import { describe, it, expect } from 'vitest';
import { extractAndParseJson, extractLastJson, repairTruncatedJson } from '../utils/jsonUtils';

describe('jsonUtils', () => {
  describe('extractAndParseJson', () => {
    it('parses a clean JSON string', () => {
      const input = '{"coinName": "BTC", "direction": "Long"}';
      const result = extractAndParseJson(input);
      expect(result).toEqual({ coinName: 'BTC', direction: 'Long' });
    });

    it('extracts JSON from markdown code fences', () => {
      const input = 'Here is the analysis:\n```json\n{"coinName": "ETH", "direction": "Short"}\n```\nDone.';
      const result = extractAndParseJson(input);
      expect(result).toEqual({ coinName: 'ETH', direction: 'Short' });
    });

    it('handles JSON with trailing commas', () => {
      const input = '{"coinName": "BTC", "direction": "Long",}';
      const result = extractAndParseJson(input);
      expect(result).toEqual({ coinName: 'BTC', direction: 'Long' });
    });

    it('throws for non-JSON input', () => {
      const input = 'This is just plain text with no JSON.';
      expect(() => extractAndParseJson(input)).toThrow();
    });

    it('throws for empty input', () => {
      expect(() => extractAndParseJson('')).toThrow();
    });
  });

  describe('extractLastJson', () => {
    it('extracts the last JSON object from a string with multiple', () => {
      const input = 'First: {"a": 1} Then: {"b": 2}';
      const result = extractLastJson(input);
      expect(result).toEqual({ b: 2 });
    });
  });

  describe('truncated-JSON rescue (moderator plan cut at the token limit)', () => {
    it('recovers a plan truncated mid-object via brace repair', () => {
      // The classic failure: the moderator's plan gets cut before the closing
      // braces — previously surfaced as an "Unknown Asset · Neutral" card.
      const truncated = 'Here is my verdict:\n{"coinName": "BTCUSDT", "direction": "Short", "confidence": "High", "entryPoints": [{"price": "64000"';
      const result = extractLastJson(truncated);
      expect(result).not.toBeNull();
      expect(result.direction).toBe('Short');
      expect(result.coinName).toBe('BTCUSDT');
    });

    it('repairTruncatedJson returns null for prose without JSON', () => {
      expect(repairTruncatedJson('The market looks bearish today, no plan.')).toBeNull();
    });

    it('repairTruncatedJson returns null for empty input', () => {
      expect(repairTruncatedJson('')).toBeNull();
      expect(repairTruncatedJson(null as unknown as string)).toBeNull();
    });

    it('does not disturb already-valid JSON (depth 0 succeeds)', () => {
      expect(repairTruncatedJson('{"a": 1}')).toBe('{"a": 1}');
    });

    it('gives up on unrecoverable truncation (string cut mid-value)', () => {
      const cutString = '{"coinName": "BTCUSDT", "direction": "Shor';
      expect(repairTruncatedJson(cutString)).toBeNull();
    });
  });

  describe('extractLastJson string-literal safety', () => {
    it('handles braces inside string values (backward scan)', () => {
      // A valid JSON whose last string ends in } used to fail both scans.
      const input = 'Moderator: {"thoughtProcess": "expect } here", "direction": "Long"}';
      const result = extractLastJson(input);
      expect(result.direction).toBe('Long');
    });

    it('handles braces inside string values (forward scan)', () => {
      const input = '{"note": "a { b } c", "strategy": "hold"} trailing';
      const result = extractAndParseJson(input);
      expect(result.strategy).toBe('hold');
    });

    it('handles escaped quotes inside string values', () => {
      const input = '{"msg": "say "hi" then }", "ok": true}';
      const result = extractLastJson(input);
      expect(result.ok).toBe(true);
    });

    it('preserves URLs with // inside string values', () => {
      // The old comment-strip regex `\/\/.*` corrupted "https://x" → "https:".
      const input = '{"coinName": "BTC", "source": "https://binance.com/api", "ok": true}';
      const result = extractAndParseJson(input);
      expect(result.source).toBe('https://binance.com/api');
    });

    it('still strips real line comments outside strings', () => {
      const input = '{\n  // this is a comment\n  "coinName": "BTC"\n}';
      const result = extractAndParseJson(input);
      expect(result.coinName).toBe('BTC');
    });
  });
});
