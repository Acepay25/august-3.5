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
