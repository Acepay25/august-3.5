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
    .replace(/(\*|_)(.*?)\1/g, '$2')   // Italic
    .replace(/^\s*[\*\-]\s/gm, '')     // List items
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
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};