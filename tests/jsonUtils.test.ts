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
});
