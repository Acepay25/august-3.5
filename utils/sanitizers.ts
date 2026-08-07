export const sanitizeAIResponse = (text: string): string => {
  if (!text) return '';

  // Handle case where AI returns an object instead of string (e.g., thoughtProcess as JSON object)
  if (typeof text !== 'string') {
    try {
      text = JSON.stringify(text, null, 2);
    } catch {
      return String(text);
    }
  }

  // First, basic markdown cleanup
  let cleaned = text
    .replace(/^#+\s/gm, '') // Headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
    .replace(/(\*)(.*?)\1/g, '$2')   // Italic (*)
    // Underscore-italic only at word boundaries — a bare `_` pair would
    // otherwise corrupt tickers/timeframes ("BTCUSDT_4h" → "BTCUSDT4h").
    .replace(/(?<!\w)_([^_\n]*)_(?!\w)/g, '$1')
    .replace(/^\s*[*-]\s/gm, '')     // List items
    .replace(/`/g, '');                 // Code ticks

  // Remove remaining asterisks that might have been missed or used for decoration
  // We use a negative lookbehind and lookahead to preserve * if it's between digits (e.g. 5*5)
  // This removes * if it is NOT preceded by a digit OR NOT followed by a digit.
  cleaned = cleaned.replace(/(?<!\d)\*|\*(?!\d)/g, '');

  // Aggressive XSS prevention: Strip HTML tags (loop until stable to defeat nested-tag bypasses)
  // This prevents <script>, <iframe>, <object>, etc. from being rendered if the UI ever uses dangerous HTML setting.
  // Even though React escapes by default, this adds a layer of safety for copy-paste or other sinks.
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]*>/gm, '');
  }

  return cleaned;
};

export const sanitizeJSONString = (str: string): string => {
  if (typeof str !== 'string') return '';
  // Remove control characters (except newline, tab, carriage return) but preserve Unicode
  // eslint-disable-next-line no-control-regex -- intentional control-char stripping
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

/**
 * Light sanitizer for analyst thinking / final output: strips HTML tags and
 * control characters but PRESERVES markdown (bold, code, lists, tables) so
 * the cards can render it with proper formatting. ReactMarkdown escapes any
 * residual raw HTML, so this stays XSS-safe.
 */
export const sanitizeAIResponseLight = (text: string): string => {
  if (!text) return '';
  if (typeof text !== 'string') {
    try {
      text = JSON.stringify(text, null, 2);
    } catch {
      return String(text);
    }
  }
  let cleaned = text;
  // Strip control characters (except newline/tab/CR)
  // eslint-disable-next-line no-control-regex -- intentional control-char stripping
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Strip HTML tags (loop until stable to defeat nested-tag bypasses); the
  // markdown renderer escapes raw HTML as a second layer.
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]*>/gm, '');
  }
  return cleaned;
};

/**
 * Strict price-field cleaning for AI output: strips parenthesized asides and
 * options jargon the models hallucinate into crypto prices ("94500 (call)"),
 * normalizes whitespace/punctuation, then control-char sanitizes the result.
 */
export const cleanPriceField = (val: unknown): string => {
  if (!val) return '';
  let str = String(val);

  // Remove content inside parentheses (e.g. " (options strategy)").
  str = str.replace(/\([^)]*\)/g, '');

  // Strip square brackets but KEEP the price inside ("[94500]" → "94500",
  // "94500 [call]" → "94500 call" — the jargon pass then removes "call").
  str = str.replace(/[\[\]]/g, '');

  // Remove specific jargon words often hallucinated by AI
  const jargon = ['straddle', 'strangle', 'spread', 'condor', 'iron', 'call', 'put', 'option', 'breakeven', 'credit', 'debit', 'halves', 'profit'];
  const regex = new RegExp(`\\b(${jargon.join('|')})\\b`, 'gi');
  str = str.replace(regex, '');

  // Clean up extra whitespace and punctuation left behind
  str = str.replace(/\s+/g, ' ').trim();
  // Trim leading/trailing punctuation — but preserve a leading minus so
  // negative percentages ("-0.5%") and negative prices keep their sign.
  str = str.replace(/^[;,\[\s]+|[;,\[\]\-\s]+$/g, '');

  return sanitizeJSONString(str);
};