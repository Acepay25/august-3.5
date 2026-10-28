/**
 * contextCompact — automatic compaction of the outbound message array.
 *
 * The bug this fixes: a desk turn grows its own request. Every round appends an
 * assistant tool-call message plus one `tool` reply per call, and a tool reply
 * is a market payload — an order book, a liquidation ladder, a notebook read —
 * each up to the per-result cap in `budgetToolContent`. Eight rounds of three
 * tools is twenty-four payloads inside ONE request, and nothing anywhere looked
 * at the running total. The Agents surface had the same shape from the other side:
 * `chatSurfaceTurnMessages` maps the WHOLE stored conversation onto the wire,
 * so turn thirty sends twenty-nine prior turns verbatim. When the request gets
 * too big the provider either refuses it outright or — the worse shape, because
 * it looks like a normal turn — answers with `finish_reason: length` and the
 * trader sees the "THE PROVIDER STOPPED EARLY" line and no reply.
 *
 * Compaction is therefore a budget, not a feature: `messages` comes in, a
 * token ceiling goes out, and the array is shrunk to fit BEFORE the request is
 * made.
 *
 * ## What gets shrunk, in what order
 *
 * Ordered by how little the seat loses:
 *
 *  1. **Old tool payloads** — the seat already read them, and the payload it is
 *     reasoning over now is the newest one. Kept as a head slice plus a
 *     `clipNote`, which is this app's own dialect for "the rest is MISSING, not
 *     absent" (`utils/harnessMarks.ts`); where the result was spilled to an
 *     artifact the note says so, because then the seat can page the rest back
 *     with `read_tool_output` rather than re-fetching it.
 *  2. **Old assistant prose** — same shape, same note. Reasoning summaries are
 *     the least load-bearing bytes in a tool loop.
 *  3. **Whole oldest turns, dropped** — only when 1 and 2 cannot reach the
 *     ceiling, and only as ATOMIC groups. An assistant message carrying
 *     `tool_calls` and its `tool` replies live or die together: OpenAI-compatible
 *     gateways 400 on a `tool_calls` block with no matching reply, and the
 *     failure lands as "the model did not answer" — the exact symptom this
 *     module exists to remove. `turnGroups` is the only place that decides what
 *     "together" means.
 *
 * ## What never gets touched
 *
 * The system block (it is the mandate, not the history); the trailing
 * `keepAtLeast` messages (the current question, the answer forming under it and
 * the tool results being read — collapse those and the seat answers a different
 * question); and the last user turn, always. When even that cannot fit, the
 * result says so in `stillOver` and the caller fails LOUDLY instead of silently
 * dropping the trader's own words.
 *
 * ## The estimate is an estimate
 *
 * `utils/tokenEstimate.estimateTokens` is biased high on purpose, so a compacted
 * request is a little smaller than the ceiling rather than a little bigger. Tool
 * schemas are NOT in the message array and cannot be counted here; that is what
 * `WIRE_FRAMING_SAFETY_TOKENS` in the ceiling is for.
 */

import type { ChatMessage, ContentPart } from './GenericProviderService';
import type { ProviderConfig } from '../../types/provider';
import { estimateTokens } from '../../utils/tokenEstimate';
import { clipNote, findArtifactIdIn } from '../../utils/harnessMarks';
import {
    DEFAULT_OUTPUT_RESERVE_TOKENS,
    MIN_KEEP_MESSAGES,
    promptTokenCeiling,
    resolveContextWindow,
    type ContextWindowSource,
} from '../../utils/contextWindow';

/** Head kept when a tool payload is compacted. Small enough to matter on a
 *  crowded wire, big enough that the payload's own header line survives — desk
 *  results start with what they are, and that is the part the seat needs to
 *  know it already looked this up. */
const TOOL_HEAD_KEEP_CHARS = 400;

/** Head kept when old assistant prose is compacted. */
const ASSISTANT_HEAD_KEEP_CHARS = 600;

/** A flat estimate for one image part. The app cannot compute the provider's
 *  real patch count, and a char-derived number for base64 is meaningless (it
 *  scales with ENCODING overhead, not with content). Over-estimating costs an
 *  earlier compaction; under-estimating costs a rejected request. Images ride
 *  in the trailing turn, which the keep-rule protects, so in practice this
 *  count only decides whether the COMPACTOR runs, not what it drops. */
const IMAGE_TOKEN_ESTIMATE = 1_500;

/** The text of a message, flattening vision parts. */
const textOf = (content: ChatMessage['content']): string => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((part: ContentPart) => (part?.type === 'text' ? part.text ?? '' : '')).join('\n');
};

/**
 * Estimated tokens one wire message costs — content, tool-call arguments and
 * images. The framing constant inside `estimateTokens` is per call, so a message
 * with three tool calls pays it three times: over-estimating again.
 */
export const estimateMessageTokens = (message: ChatMessage): number => {
    let tokens = estimateTokens(textOf(message.content));
    if (Array.isArray(message.content)) {
        tokens += message.content.filter(part => part?.type === 'image_url').length * IMAGE_TOKEN_ESTIMATE;
    }
    for (const call of message.tool_calls ?? []) {
        tokens += estimateTokens(`${call.function?.name ?? ''} ${call.function?.arguments ?? ''}`);
    }
    return tokens;
};

/** Estimated tokens of a whole outbound array. */
export const estimateMessagesTokens = (messages: readonly ChatMessage[]): number =>
    messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

/**
 * Atomic drop units, oldest first.
 *
 * One group is a message that can be deleted on its own, or an assistant turn
 * with `tool_calls` PLUS every `tool` reply that follows it. `user` turns never
 * join a group: a harness continuation (`Continue. Write your reply now…`) is
 * droppable even when the tool round before it is not — the seat is told what to
 * do in its system mandate, so the pointer is the cheapest byte in the array.
 */
export const turnGroups = (messages: readonly ChatMessage[]): number[][] => {
    const groups: number[][] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'tool') {
            // A tool reply with no assistant `tool_calls` above it (a text
            // protocol, or an array that started mid-turn) still belongs to the
            // group ending here — never left dangling alone.
            const last = groups[groups.length - 1];
            if (last && messages[last[last.length - 1]].role !== 'tool') {
                last.push(i);
                continue;
            }
        }
        groups.push([i]);
        if (m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0) {
            for (let j = i + 1; j < messages.length && messages[j].role === 'tool'; j++) {
                groups[groups.length - 1].push(j);
                i = j;
            }
        }
    }
    return groups;
};

export type CompactKind = 'tool-payload' | 'assistant-text' | 'turn-drop';

export interface CompactAction {
    kind: CompactKind;
    /** Index in the array AS IT STANDS when the action is taken. Pass 3 splices
     *  as it goes, so these are not indices into the caller's input. */
    index: number;
    /** Tool name for a payload action. */
    name?: string;
    /** Bytes kept vs bytes that existed — the numbers the note tells the seat. */
    kept: number;
    total: number;
}

export interface CompactInput {
    messages: readonly ChatMessage[];
    /** The prompt may not exceed this. From `promptTokenCeiling`. */
    ceilingTokens: number;
    /** Tail protected from any change. Defaults to `MIN_KEEP_MESSAGES`. */
    keepAtLeast?: number;
}

export interface CompactResult {
    messages: ChatMessage[];
    beforeTokens: number;
    afterTokens: number;
    /** True when anything was rewritten or dropped. */
    changed: boolean;
    actions: CompactAction[];
    /**
     * Still over the ceiling AFTER doing everything possible. Non-zero means
     * the request cannot be made to fit — the caller must say so rather than
     * send it and let the provider answer with an error the trader cannot act
     * on.
     */
    stillOver: number;
    /** One line for the transcript: what the trader lost from this request. */
    notice: string;
}

const headSlice = (text: string, keep: number): string => {
    if (text.length <= keep) return text;
    // Cut on a newline where one exists near the boundary: a payload's tail is
    // usually the next row of a table, and half a row reads like data.
    const hard = text.slice(0, keep);
    const nl = hard.lastIndexOf('\n');
    return nl > keep * 0.5 ? hard.slice(0, nl) : hard;
};

const stubFor = (label: string, text: string, keep: number): string => {
    const head = headSlice(text, keep);
    const artifactId = findArtifactIdIn(text);
    return `${head}\n${clipNote({
        source: label,
        kept: head.length,
        total: text.length,
        guidance: artifactId
            ? `this result was compacted to save context, but the full copy is still paged — call read_tool_output with id "${artifactId}"`
            : 'it was compacted to save context, not because it was empty — call the tool again if you need it',
    })}`;
};

/** Is this index inside the protected tail? */
const inTail = (index: number, length: number, keepAtLeast: number): boolean =>
    index >= length - keepAtLeast;

/**
 * Fit a message array to a token ceiling, oldest-first, losing the least
 * load-bearing bytes first. See the header for the order and the guarantees.
 */
export const compactMessages = (input: CompactInput): CompactResult => {
    const keepAtLeast = Math.max(MIN_KEEP_MESSAGES, input.keepAtLeast ?? 0);
    const out: ChatMessage[] = input.messages.map(m => ({ ...m }));
    const beforeTokens = estimateMessagesTokens(out);
    const actions: CompactAction[] = [];

    const total = (): number => estimateMessagesTokens(out);

    // Pass 1 + 2: shrink the bodies, oldest first. `role === 'tool'` first
    // because a payload is bulkier and less load-bearing than prose.
    for (const pass of ['tool', 'assistant'] as const) {
        for (let i = 0; i < out.length; i++) {
            if (total() <= input.ceilingTokens) break;
            if (inTail(i, out.length, keepAtLeast)) break;
            const m = out[i];
            if (pass === 'tool' && m.role !== 'tool') continue;
            if (pass === 'assistant' && (m.role !== 'assistant' || m.tool_calls?.length)) continue;
            const text = textOf(m.content);
            if (text.length < 1_200) continue;
            const keep = pass === 'tool' ? TOOL_HEAD_KEEP_CHARS : ASSISTANT_HEAD_KEEP_CHARS;
            // A head slice that is NOT smaller than what is already there buys
            // nothing and costs a dangling note; skip rather than grow.
            if (text.length - keep < 400) continue;
            const label = pass === 'tool' ? (m.name || 'tool result') : 'earlier reply';
            out[i] = { ...m, content: stubFor(label, text, keep) };
            actions.push({
                kind: pass === 'tool' ? 'tool-payload' : 'assistant-text',
                index: i,
                ...(pass === 'tool' && m.name ? { name: m.name } : {}),
                kept: keep,
                total: text.length,
            });
        }
    }

    // Pass 3: drop whole groups, oldest first, never into the protected tail
    // and never the last USER turn. The tail is a count of recent messages; in
    // a tool loop the question lives at the START of the array while every
    // round appends after it, so the question leaves the tail after three
    // rounds. Dropping it here would send tool results with no question — the
    // seat would answer something the trader never asked. Recompute the index
    // each pass because each splice shifts it.
    while (total() > input.ceilingTokens) {
        const groups = turnGroups(out);
        let lastUserIndex = -1;
        for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].role === 'user') { lastUserIndex = i; break; }
        }
        const droppable = groups.find(g => {
            const first = out[g[0]];
            return first?.role !== 'system'
                && !g.includes(lastUserIndex)
                && !inTail(g[0], out.length, keepAtLeast);
        });
        if (!droppable) break;
        // ONE action per group: a group is the unit the trader lost, and
        // counting its messages would make the notice say "3 turns dropped"
        // about one tool round.
        const droppedTokens = droppable.reduce((sum, index) => sum + estimateMessageTokens(out[index]), 0);
        const droppedNames = droppable
            .map(index => out[index])
            .filter(m => m.role === 'tool' && m.name)
            .map(m => m.name as string);
        actions.push({
            kind: 'turn-drop',
            index: droppable[0],
            ...(droppedNames.length === 1 ? { name: droppedNames[0] } : {}),
            kept: 0,
            total: droppedTokens,
        });
        out.splice(droppable[0], droppable.length);
    }

    const afterTokens = total();
    const changed = afterTokens !== beforeTokens;
    const stillOver = Math.max(0, afterTokens - input.ceilingTokens);
    return {
        messages: out,
        beforeTokens,
        afterTokens,
        changed,
        actions,
        stillOver,
        notice: (stillOver > 0
            // The compactor did everything it is allowed to do and the request
            // STILL does not fit. Said here rather than left for the provider's
            // 400, because "the window is smaller than this conversation" is
            // something the trader can act on and a raw HTTP error is not.
            ? `CONTEXT FULL: even after compaction this request is ${stillOver.toLocaleString()} estimated tokens over a ${input.ceilingTokens.toLocaleString()}-token ceiling, so the oldest of it cannot be sent at all. `
            : '') + compactNotice(actions, beforeTokens, afterTokens),
    };
}

/** Human line for the transcript. Written from the ACTIONS the compactor
 *  actually took, so it cannot claim a drop that never happened — the same rule
 *  that keeps every other harness notice a measurement. */
const compactNotice = (actions: CompactAction[], before: number, after: number): string => {
    if (actions.length === 0) return '';
    const payloads = actions.filter(a => a.kind === 'tool-payload').length;
    const prose = actions.filter(a => a.kind === 'assistant-text').length;
    const drops = actions.filter(a => a.kind === 'turn-drop').length;
    const parts: string[] = [];
    if (payloads) parts.push(`${payloads} old tool result${payloads === 1 ? '' : 's'} shortened`);
    if (prose) parts.push(`${prose} earlier repl${prose === 1 ? 'y' : 'ies'} shortened`);
    if (drops) parts.push(`${drops} earlier turn${drops === 1 ? '' : 's'} dropped`);
    return `COMPACTED FOR THE CONTEXT WINDOW: ${parts.join(', ')} — ${before.toLocaleString()} → ${after.toLocaleString()} estimated tokens. `
        + 'What was cut is missing from THIS request, not from your journal; re-run the lookup if the seat needs it.';
};

// ─── The wire-facing entry point ────────────────────────────────────────────

export interface WireCompactResult extends CompactResult {
    /** The window the ceiling was taken from, and which evidence supplied it. */
    windowTokens: number;
    windowSource: ContextWindowSource;
    ceilingTokens: number;
}

/**
 * Compact an outbound message array to what THIS provider+model can hold.
 *
 * `windowTokensOverride` is the measured-limit path: a provider that just
 * rejected the request stated its real window in the error, and that number
 * beats everything `resolveContextWindow` can say about it — including the
 * user's own override, because the request has already been refused once.
 */
export const compactForWire = (
    config: ProviderConfig,
    messages: readonly ChatMessage[],
    opts?: { outputReserveTokens?: number; windowTokens?: number; keepAtLeast?: number },
): WireCompactResult => {
    const resolved = resolveContextWindow(config);
    const windowTokens = opts?.windowTokens ?? resolved.tokens;
    const ceilingTokens = promptTokenCeiling(windowTokens, opts?.outputReserveTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS);
    const result = compactMessages({ messages, ceilingTokens, keepAtLeast: opts?.keepAtLeast });
    return {
        ...result,
        windowTokens,
        windowSource: opts?.windowTokens !== undefined ? 'measured' : resolved.source,
        ceilingTokens,
    };
};

