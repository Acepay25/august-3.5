/**
 * Keep chain-of-thought out of the final answer (and vice versa).
 * Providers often dump the plan into the thinking channel, or the pipeline
 * used to persist the whole stream as `reasoning`.
 */

const PLAN_RE = /FINAL TRADE PLAN|\b(?:Direction|Stop Loss|Take Profit(?:\s*[123])?|Invalidation)\s*:/i;

const SCRATCHPAD_START_RE = /(?:^|\n)\s*(?:here(?:['’]s| is)\s+(?:my\s+)?(?:a\s+)?)?thinking\s+process\s*:/i;
const SCRATCHPAD_META_RE = /Analyze User Input\s*:|Deconstruct (?:the )?Context|Current Round\s*:/i;
const ANSWER_MARK_RE = /(?:^|\n)\s*(?:\*\*)?(?:answer|final(?:\s*output)?|response|conclusion)(?:\*\*)?\s*[:.\-]\s*/i;
const META_PARA_RE = /^(?:Analyze User Input|Deconstruct|My State|Role\s*:|Current Round\s*:|YOUR TASK|Moderator's question|Here's a thinking)/i;

export const looksLikeTradeOutput = (text: string): boolean => {
    if (!text || text.length < 40) return false;
    const plan = /FINAL TRADE PLAN/i.test(text);
    const levels = /\b(Stop Loss|SL)\b/i.test(text) && /\b(Take Profit|TP\s*1)\b/i.test(text);
    const entry = /\bEntr(?:y|ies)\b/i.test(text) && /\bDirection\b/i.test(text);
    return plan || (levels && entry) || (PLAN_RE.test(text) && levels);
};

const eq = (a: string, b: string): boolean => a.trim() === b.trim();

const stripTags = (text: string): string => text
    .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, '')
    .replace(/<FINAL_OUTPUT>[\s\S]*?<\/FINAL_OUTPUT>/gi, '')
    .replace(/<\/?(?:THINKING|FINAL_OUTPUT)>/gi, '')
    .replace(/^\s*(?:\*\*)?(?:THINKING|FINAL OUTPUT|FINAL_OUTPUT)(?:\*\*)?\s*:?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const looksLikeScratchpad = (text: string): boolean => {
    const raw = (text || '').trim();
    if (!raw) return false;
    return SCRATCHPAD_START_RE.test(raw) || SCRATCHPAD_META_RE.test(raw);
};

/**
 * Peel "Here's a thinking process / Analyze User Input" dumps out of the
 * visible floor. If there is no real answer yet, visible is empty.
 */
export const stripLeakedScratchpad = (text: string): { visible: string; leaked: string } => {
    const raw = (text || '').trim();
    if (!raw) return { visible: '', leaked: '' };
    if (!looksLikeScratchpad(raw)) return { visible: raw, leaked: '' };

    const start = raw.search(SCRATCHPAD_START_RE);
    const leakStart = start >= 0 ? start : 0;
    const before = raw.slice(0, leakStart).trim();
    const rest = raw.slice(leakStart);

    const answerAt = rest.search(ANSWER_MARK_RE);
    if (answerAt >= 0) {
        const after = rest.slice(answerAt).replace(ANSWER_MARK_RE, '').trim();
        return {
            visible: [before, after].filter(Boolean).join('\n\n'),
            leaked: rest.slice(0, answerAt).trim(),
        };
    }

    const paras = rest.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const tail = [...paras].reverse().find(p =>
        !META_PARA_RE.test(p)
        && !looksLikeScratchpad(p)
        && p.split(/\s+/).length >= 12
    );
    if (tail) {
        return {
            visible: [before, tail].filter(Boolean).join('\n\n'),
            leaked: rest.replace(tail, '').trim(),
        };
    }

    if (before) return { visible: before, leaked: rest };
    return { visible: '', leaked: raw };
};

export const splitThinkingHeaders = (raw: string): { thinking: string; output: string } => {
    const headerRe = /^\s*(?:\*\*)?(THINKING|FINAL OUTPUT|FINAL_OUTPUT)(?:\*\*)?\s*:?[ \t]*\r?\n?/gim;
    const matches = [...raw.matchAll(headerRe)];
    if (matches.length < 2) return { thinking: '', output: '' };
    const sections: Record<string, string> = {};
    matches.forEach((match, i) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
        const key = match[1].toUpperCase().replace(/[ _]/g, '_');
        sections[key] = raw.slice(start, end).trim();
    });
    return { thinking: sections['THINKING'] ?? '', output: sections['FINAL_OUTPUT'] ?? '' };
};

/**
 * Split a model turn into thinking vs visible answer.
 * Native streamed CoT wins for thinking. The content stream wins for output.
 * Never copy one into the other as a fallback.
 */
export const splitThinkingFromOutput = (
    streamedReasoning: string,
    responseText: string,
): { thinking: string; output: string } => {
    const streamed = (streamedReasoning || '').trim();
    const raw = (responseText || '').trim();
    const taggedThinking = raw.match(/<THINKING>\s*([\s\S]*?)\s*<\/THINKING>/i)?.[1]?.trim() ?? '';
    const taggedOutput = raw.match(/<FINAL_OUTPUT>\s*([\s\S]*?)\s*<\/FINAL_OUTPUT>/i)?.[1]?.trim() ?? '';
    const headers = splitThinkingHeaders(raw);

    let thinking = streamed || taggedThinking || headers.thinking;
    let output = taggedOutput || headers.output || (raw ? stripTags(raw) : '');

    if (!raw && streamed) {
        thinking = streamed;
        output = '';
    }

    if (thinking && output && eq(thinking, output)) {
        if (looksLikeTradeOutput(output)) thinking = '';
        else output = '';
    }

    if (thinking && looksLikeTradeOutput(thinking)) {
        if (!output || eq(thinking, output)) output = thinking;
        thinking = streamed && !looksLikeTradeOutput(streamed) ? streamed : '';
    }

    if (output && eq(thinking, output)) thinking = '';

    const peeled = stripLeakedScratchpad(output);
    if (peeled.leaked) {
        thinking = [thinking, peeled.leaked].filter(Boolean).join('\n\n').trim();
        output = peeled.visible;
    }

    return { thinking: thinking.trim(), output: output.trim() };
};

export interface ThinkingDisplayParts {
    thinking: string;
    output: string;
    raw: string;
}

/**
 * Journal / card display: repair records that stored the answer as `reasoning`.
 */
export const displayThinkingParts = (record: {
    role?: string;
    reasoning?: string;
    finalOutput?: string;
    rawReasoning?: string;
}): ThinkingDisplayParts => {
    let thinking = (record.reasoning || '').trim();
    let output = (record.finalOutput || '').trim();
    let raw = (record.rawReasoning || '').trim();

    if (record.role === 'debate_turn') {
        const peeled = stripLeakedScratchpad(output || thinking);
        if (!output) {
            output = peeled.visible;
            thinking = peeled.leaked || '';
        } else if (peeled.leaked) {
            thinking = [thinking, peeled.leaked].filter(Boolean).join('\n\n').trim();
            output = peeled.visible;
        }
        if (eq(thinking, output)) thinking = '';
        if (eq(raw, output) || eq(raw, thinking)) raw = '';
        return { thinking, output, raw };
    }

    const split = splitThinkingFromOutput(raw || thinking, output || thinking);
    thinking = split.thinking;
    output = split.output || output;

    if (raw && looksLikeTradeOutput(raw) && !looksLikeTradeOutput(thinking)) {
        raw = '';
    }
    if (raw && (eq(raw, output) || eq(raw, thinking)) && !looksLikeScratchpad(raw)) raw = '';
    if (eq(thinking, output)) thinking = '';

    return { thinking, output, raw };
};
