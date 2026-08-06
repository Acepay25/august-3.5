import { describe, it, expect } from 'vitest';
import { extractAndParseJson, extractLastJson } from '../utils/jsonUtils';

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
  });
});
