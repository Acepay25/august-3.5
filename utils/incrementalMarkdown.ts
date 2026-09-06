/**
 * Perceived-speed helper: incremental markdown. Re-parsing an entire
 * streaming reply on every chunk is O(n²);
 * instead we split the text into blocks and FREEZE every block except the
 * trailing few. Streaming is append-only, so frozen blocks never change and
 * their memoized renders are skipped — only the small tail is re-parsed per
 * delta. Blocks are separated by blank lines, but never inside a code fence.
 */

/** Number of trailing blocks kept "hot" (re-parsed on each chunk). */
export const UNSTABLE_TAIL_BLOCKS = 2;

const FENCE_RE = /^\s{0,3}(```|~~~)/;

export interface StreamingBlocks {
    /** Complete blocks that will not change again (append-only stream). */
    frozen: string[];
    /** The trailing block(s) still being written. */
    tail: string;
}

/**
 * Close markdown constructs the stream has opened but not yet closed.
 *
 * Halfway through a reply an unclosed fence or bold marker is the NORMAL
 * state, and a plain markdown parser draws that as literal backticks and
 * asterisks until the closing token arrives. This appends the missing
 * closers for the duration of the stream, so incomplete constructs render
 * as the finished thing while they stream. Only constructs whose closer is
 * unambiguous get repaired: fences, inline code, bold (`**`) and
 * strikethrough (`~~`). Single-character emphasis (`*`, `_`) is left alone
 * — a lone `*` is as often a bullet or a multiplication as an emphasis
 * opener, and repairing it wrongly rewrites the user's text.
 */
export const repairStreamTail = (tail: string): string => {
    if (!tail) return tail;

    // One pass: fence state BEFORE each line (a delimiter line itself is
    // never content), the final in-fence flag, and the open fence's marker.
    const lines = tail.split('\n');
    const openBefore: boolean[] = [];
    let inFence = false;
    let fenceMarker = '```';
    for (let i = 0; i < lines.length; i++) {
        openBefore[i] = inFence;
        if (!FENCE_RE.test(lines[i])) continue;
        const marker = lines[i].trim().startsWith('~~~') ? '~~~' : '```';
        if (!inFence) {
            inFence = true;
            fenceMarker = marker;
        } else if (marker === fenceMarker) {
            inFence = false;
        }
    }
    if (inFence) {
        // Inside a code block the unpaired markers ARE the content — the
        // only repair is closing the fence itself.
        return `${tail.replace(/\s+$/, '')}\n${fenceMarker}`;
    }
    // Non-delimiter lines outside any fence are the text inline markers can
    // live in; delimiters and fenced lines are excluded so fence backticks
    // never skew the inline counts.
    const outsideFence = lines
        .filter((line, i) => !FENCE_RE.test(line) && !openBefore[i])
        .join('\n');
    const closers: string[] = [];
    const countOccurrences = (needle: string): number =>
        outsideFence.split(needle).length - 1;
    if (countOccurrences('~~') % 2 === 1) closers.push('~~');
    if (countOccurrences('**') % 2 === 1) closers.push('**');
    // Inline code: an odd number of remaining backticks means one span is
    // still open. Multi-backtick spans (``) pair with themselves, so the
    // odd one out is a single-backtick span.
    if (countOccurrences('`') % 2 === 1) closers.push('`');
    if (closers.length === 0) return tail;
    // Bold/closing markers must touch the last glyph to pair with its
    // opener; a space in between would render the markers literally.
    return `${tail.replace(/\s+$/, '')}${closers.join('')}`;
};

/**
 * Split `text` into paragraph blocks (blank-line separated, fence-aware)
 * and partition them into frozen head + live tail.
 */
export const splitStreamingBlocks = (text: string): StreamingBlocks => {
    const trimmed = text || '';
    if (!trimmed.trim()) return { frozen: [], tail: trimmed };

    const lines = trimmed.split('\n');
    const blocks: string[] = [];
    let current: string[] = [];
    let inFence = false;

    for (const line of lines) {
        if (FENCE_RE.test(line)) inFence = !inFence;
        if (!inFence && line.trim() === '' && current.some(l => l.trim() !== '')) {
            blocks.push(current.join('\n').replace(/\s+$/, ''));
            current = [];
        } else {
            current.push(line);
        }
    }
    const last = current.join('\n').replace(/\s+$/, '');
    if (last.trim() || blocks.length === 0) blocks.push(last);

    const frozenCount = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS);
    return {
        frozen: blocks.slice(0, frozenCount),
        tail: blocks.slice(frozenCount).join('\n\n'),
    };
};
