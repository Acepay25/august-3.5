import { describe, it, expect } from 'vitest';
import { sanitizeAIResponse, sanitizeJSONString } from '../utils/sanitizers';

describe('sanitizers', () => {
  describe('sanitizeAIResponse', () => {
    it('strips script tags', () => {
      const input = 'Hello <script>alert("xss")</script> world';
      const result = sanitizeAIResponse(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
      // Note: text content between tags may remain; the tag itself is stripped
    });

    it('strips nested script tags (bypass attempt)', () => {
      const input = 'Hello <scr<script>ipt>alert("xss")</scr</script>ipt> world';
      const result = sanitizeAIResponse(input);
      expect(result).not.toContain('<script>');
    });

    it('preserves normal text', () => {
      const input = 'BTC is showing a bullish divergence on the 4H chart.';
      const result = sanitizeAIResponse(input);
      expect(result).toContain('bullish divergence');
    });

    it('handles empty input', () => {
      expect(sanitizeAIResponse('')).toBe('');
    });
  });

  describe('sanitizeJSONString', () => {
    it('removes control characters from JSON', () => {
      const input = '{"key": "value\u0000with\u001Fcontrol"}';
      const result = sanitizeJSONString(input);
      expect(result).not.toContain('\u0000');
      expect(result).not.toContain('\u001F');
    });
  });
});
