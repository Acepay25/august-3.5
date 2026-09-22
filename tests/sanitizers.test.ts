import { describe, it, expect } from 'vitest';
import { sanitizeAIResponse, sanitizeAIResponseLight, sanitizeJSONString, cleanPriceField } from '../utils/sanitizers';

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

    // The bug behind "sometimes the response doesn't render": `<[^>]*>` matches
    // newlines, so the `<` in a LaTeX inequality opened a tag that stayed open
    // until the next `>` in the message and deleted everything between — a whole
    // table, a whole paragraph. It only bit when BOTH appeared, which is why it
    // looked intermittent and why LaTeX-heavy answers hit it so often.
    const MATHY = [
      '## Sizing',
      '',
      'Risk is bounded by $\\frac{entry - SL}{entry} < r$.',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| R:R | 2.0 |',
      '',
      'Target 72000 > entry 70000, so size to 1%.',
    ].join('\n');

    it.each([
      MATHY,
      'Momentum fading: $\\alpha < 0.5$. Entry still valid above 69800.',
      'Compact math $a<b$ and later a greater-than: TP 71000 > 70000.',
      'Compare $a < b$ against $c < d$ — no greater-than sign anywhere.',
      'Levels stepped 69000 -> 70000 -> 71000 while $\\beta < 0$.',
      'Invalidation is entry - 1.5 * ATR < 69000, so R:R stays > 2.',
    ])('never deletes prose that merely contains < and > (%#)', (input) => {
      const light = sanitizeAIResponseLight(input);
      // Nothing between the delimiters may vanish: every input line survives.
      expect(light.split('\n')).toHaveLength(input.split('\n').length);
      expect(light.length).toBeGreaterThanOrEqual(input.length);
    });

    it('keeps the table whole when a math inequality precedes a greater-than', () => {
      // The measured regression: 153 chars in, 84 out — the table and the
      // paragraph around it were the deleted span.
      expect(sanitizeAIResponseLight(MATHY)).toBe(MATHY);
      expect(sanitizeAIResponseLight(MATHY)).toContain('| R:R | 2.0 |');
      expect(sanitizeAIResponse(MATHY)).toContain('| R:R | 2.0 |');
    });

    it('still removes every real tag, including multi-line markup', () => {
      expect(sanitizeAIResponseLight('<b>Bold</b> x')).toBe('Bold x');
      expect(sanitizeAIResponseLight('a<br/>b')).toBe('ab');
      expect(sanitizeAIResponseLight('<div class="x">y</div>')).toBe('y');
      expect(sanitizeAIResponseLight('<div class="x">\n  keep me\n</div>')).toBe('\n  keep me\n');
      expect(sanitizeAIResponseLight('<JSON_PLAN>ok</JSON_PLAN>')).toBe('ok');
      expect(sanitizeAIResponse('<b>alert<b>')).not.toContain('<');
      expect(sanitizeAIResponse('Hello <script>alert(1)</script>')).not.toContain('<script>');
    });

    it('leaves a tag whose ATTRIBUTES wrap the line — and every byte around it', () => {
      // Deliberate tradeoff: allowing the attribute list to cross a newline
      // would reopen the exact hole this fixes, because `<y then … >` then
      // looks like a tag spanning paragraphs. So a wrapped-attribute tag stays
      // as literal text (react-markdown escapes it, so it is cosmetic), and —
      // the part that matters — nothing around it is deleted.
      const wrapped = '<img src="a"\n  alt="b">visible tail';
      const out = sanitizeAIResponseLight(wrapped);
      expect(out).toContain('visible tail');
      expect(out.endsWith('visible tail')).toBe(true);
    });

    it('preserves normal text', () => {
      const input = 'BTC is showing a bullish divergence on the 4H chart.';
      const result = sanitizeAIResponse(input);
      expect(result).toContain('bullish divergence');
    });

    it('handles empty input', () => {
      expect(sanitizeAIResponse('')).toBe('');
    });

    it('preserves multiplication asterisks between digits (5*6*7 → 5*6*7, not 567)', () => {
      // The italic pass used to eat digit-adjacent asterisks before the
      // digit-guard could protect them, corrupting math in AI prose.
      expect(sanitizeAIResponse('Risk/Reward math: 5*6*7 = 210')).toContain('5*6*7');
    });

    it('still strips real italic markup', () => {
      const result = sanitizeAIResponse('The *signal* is *strong*');
      expect(result).not.toContain('*');
      expect(result).toContain('signal');
      expect(result).toContain('strong');
    });

    it('preserves spaced-out asterisk math (5 * 6 is multiplication, not decoration)', () => {
      // "5 * 6 * 7" with spaces is math, not italic decoration — the old
      // cleanup pass stripped the asterisks (→ "5  7"), destroying displayed
      // R:R/size math like "TP1 94500 * 2 R:R".
      const result = sanitizeAIResponse('5 * 6 * 7');
      expect(result).toContain('5 * 6 * 7');
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
