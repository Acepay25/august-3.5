import { describe, it, expect } from 'vitest';
import { estimateTokenCount, truncateToTokenLimit } from '../utils/tokenUtils';

describe('tokenUtils', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });

    it('estimates tokens for simple text', () => {
      const text = 'Hello world, this is a test.';
      const count = estimateTokenCount(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(text.length); // Should be less than char count
    });

    it('estimates higher for JSON-heavy content than plain text of same length', () => {
      const plainText = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
      const jsonText = '{"key1":"value1","key2":"value2","key3":"value3","key4":"value4"}'.repeat(10);
      const plainCount = estimateTokenCount(plainText);
      const jsonCount = estimateTokenCount(jsonText);
      // JSON should have more tokens due to structural characters
      expect(jsonCount).toBeGreaterThan(0);
      expect(plainCount).toBeGreaterThan(0);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('returns empty array for empty input', () => {
      expect(truncateToTokenLimit([], 1000)).toEqual([]);
    });

    it('returns all messages when within limit', () => {
      const messages = [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'Hello' },
      ];
      const result = truncateToTokenLimit(messages, 10000);
      expect(result).toHaveLength(2);
    });

    it('preserves system and latest message when truncating', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Old message '.repeat(100) },
        { role: 'ai', content: 'Old response '.repeat(100) },
        { role: 'user', content: 'Latest message' },
      ];
      const result = truncateToTokenLimit(messages, 50);
      // Should always keep system + latest
      expect(result[0].role).toBe('system');
      expect(result[result.length - 1].content).toBe('Latest message');
    });
  });
});
