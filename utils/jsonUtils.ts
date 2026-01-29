
import { sanitizeJSONString } from './sanitizers';

export const robustJsonParse = (jsonString: string): any => {
    if (!jsonString || typeof jsonString !== 'string') {
        throw new Error('Invalid input to robustJsonParse. Expected a non-empty string.');
    }

    // 1. Remove comments
    let cleanedString = jsonString.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    // 2. Escape invalid backslashes (Fix for "Bad escaped character" errors)
    // Case A: Backslash not followed by valid escape char (excluding u for now)
    // Valid JSON escapes: " \ / b f n r t u
    cleanedString = cleanedString.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');

    // Case B: Backslash followed by u, but NOT followed by 4 hex digits (invalid unicode)
    // This fixes issues like \user or \unknown where \u is not a valid unicode start
    cleanedString = cleanedString.replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u');

    // 3. Remove leading plus signs from numbers (e.g. : +2.38 -> : 2.38) which is invalid JSON
    cleanedString = cleanedString.replace(/:\s*\+(\d)/g, ': $1');

    let repaired = '';
    let inString = false;
    for (let i = 0; i < cleanedString.length; i++) {
        const char = cleanedString[i];
        const prevChar = i > 0 ? cleanedString[i - 1] : null;

        if (char === '"' && prevChar !== '\\') {
            if (inString) {
                // Look ahead to see if this looks like a real closing quote
                // A real closing quote is usually followed by , } ] or : (if it was a key)
                // But we must skip whitespace
                let nextMeaningfulChar = null;
                for (let j = i + 1; j < cleanedString.length; j++) {
                    if (!/\s/.test(cleanedString[j])) {
                        nextMeaningfulChar = cleanedString[j];
                        break;
                    }
                }

                if (nextMeaningfulChar === null || [',', '}', ']', ':'].includes(nextMeaningfulChar)) {
                    repaired += char;
                    inString = false;
                } else {
                    // It's a quote inside a string that wasn't escaped
                    repaired += '\\"';
                }
            } else {
                repaired += char;
                inString = true;
            }
        } else {
            repaired += char;
        }
    }
    cleanedString = repaired;

    // 4. Remove trailing commas in objects/arrays (common AI error)
    cleanedString = cleanedString.replace(/,(?=\s*[}\]])/g, '');

    try {
        return JSON.parse(cleanedString);
    } catch (finalError: any) {
        console.error("All JSON parsing and repair attempts failed.", { finalError, originalString: jsonString, repairedString: cleanedString });
        throw new Error(`Failed to parse JSON even after cleaning and repairs. Original error: ${finalError.message}`);
    }
};

export const extractAndParseJson = (text: string): any => {
    if (!text || typeof text !== 'string') {
        throw new Error("Cannot extract JSON from invalid input.");
    }

    // Markdown check: explicitly bounded code blocks are safest
    const markdownMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[1]) {
        try {
            return robustJsonParse(markdownMatch[1]);
        } catch (e: any) {
            console.warn("Found markdown JSON block, but it failed to parse. Falling back to deep scan.", { error: e, block: markdownMatch[1] });
        }
    }

    // Deep scan for the first valid JSON block
    // We iterate through the string to find opening brackets/braces and try to match them.
    // This allows us to skip over initial garbage text like "[System Error]" if it fails parsing.

    let startIndex = -1;
    let nesting = 0;
    let startChar = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (startIndex === -1) {
            // Found a potential start
            if (char === '{' || char === '[') {
                startIndex = i;
                startChar = char;
                nesting = 1;
            }
        } else {
            // Check for nesting or closing
            if (char === startChar) {
                nesting++;
            } else if ((startChar === '{' && char === '}') || (startChar === '[' && char === ']')) {
                nesting--;
                if (nesting === 0) {
                    // Found a complete balanced block
                    const candidate = text.substring(startIndex, i + 1);
                    try {
                        return robustJsonParse(candidate);
                    } catch (e) {
                        // Failed to parse this candidate (e.g. it was just a random bracket pair or error log)
                        // Reset and continue searching from the next character after the opening bracket
                        // We reset 'i' to startIndex to resume scan for nested or subsequent structures properly
                        i = startIndex;
                        startIndex = -1;
                    }
                }
            }
        }
    }

    console.error("Could not find any valid JSON structure in the response text.", text);
    throw new Error("No valid JSON found in the response.");
};

export const extractLastJson = (text: string): any => {
    if (!text || typeof text !== 'string') {
        throw new Error("Invalid input to extractLastJson.");
    }

    // 1. Prefer explicitly tagged blocks (closest to end)
    const tagRegex = /<JSON_PLAN>([\s\S]*?)<\/JSON_PLAN>/g;
    const tagMatches: RegExpExecArray[] = [];
    let tm;
    while ((tm = tagRegex.exec(text)) !== null) {
        tagMatches.push(tm);
    }

    if (tagMatches.length > 0) {
        try {
            return robustJsonParse(tagMatches[tagMatches.length - 1][1]);
        } catch (e) { console.warn("Failed to parse tagged block:", e); }
    }

    // 2. Prefer Markdown JSON blocks (closest to end)
    const mdRegex = /```json\s*([\s\S]*?)\s*```/g;
    const markdownMatches: RegExpExecArray[] = [];
    let mm;
    while ((mm = mdRegex.exec(text)) !== null) {
        markdownMatches.push(mm);
    }

    if (markdownMatches.length > 0) {
        try {
            return robustJsonParse(markdownMatches[markdownMatches.length - 1][1]);
        } catch (e) { console.warn("Failed to parse markdown block:", e); }
    }

    // 3. Scan backwards for the last balanced JSON object
    // Note: This logic targets objects primarily. 
    // If the output is purely an array and not markdown wrapped, step 4 will handle it.
    let idx = text.lastIndexOf('}');
    while (idx !== -1) {
        let balance = 0;
        for (let i = idx; i >= 0; i--) {
            if (text[i] === '}') balance++;
            else if (text[i] === '{') balance--;

            if (balance === 0) {
                try {
                    const candidate = text.substring(i, idx + 1);
                    return robustJsonParse(candidate);
                } catch (e) {
                    // Parsing failed, ignore this block candidate
                }
                break; // Continue outer loop to find next closing brace
            }
        }
        idx = text.lastIndexOf('}', idx - 1);
    }

    // 4. Fallback to forward scan if backwards scan failed (or if it was an array)
    return extractAndParseJson(text);
};
