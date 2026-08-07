import { describe, it, expect } from 'vitest';
import { sanitizeAIResponse, sanitizeJSONString, cleanPriceField } from '../utils/sanitizers';

describe('sanitizers', () => {
  describe('cleanPriceField', () => {
    it('preserves a leading minus sign (negative percentages/prices)', () => {
      expect(cleanPriceField('-0.5%')).toBe('-0.5%');
      expect(cleanPriceField('-94500')).toBe('-94500');
    });

    it('strips bracketed asides (the old regex only handled parentheses)', () => {
      expect(cleanPriceField('[94500]')).toBe('94500');
      expect(cleanPriceField('94500 [call]')).toBe('94500');
    });

    it('still strips parenthesized asides and jargon', () => {
      expect(cleanPriceField('94500 (call)')).toBe('94500');
      expect(cleanPriceField('94500 (options strategy)')).toBe('94500');
    });
  });

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

    it('preserves underscores inside tickers/timeframes', () => {
      // A bare _ pair used to be stripped as italic markup: BTCUSDT_4h → BTCUSDT4h
      const result = sanitizeAIResponse('Watch BTCUSDT_4h and 15m_1h_4h structure');
      expect(result).toContain('BTCUSDT_4h');
      expect(result).toContain('15m_1h_4h');
    });

    it('still strips word-boundary underscore italics', () => {
      const result = sanitizeAIResponse('This is _italic_ text');
      expect(result).not.toContain('_');
      expect(result).toContain('italic');
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
