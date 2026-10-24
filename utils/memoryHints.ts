/**
 * memoryHints — the deterministic safety net for weak and local models.
 *
 * A small model will not reliably DECIDE to read memory or open a skill, so
 * the harness does the deciding for it: a plain string match of the trader's
 * message against the memory index lines and the skill slugs, and on a hit a
 * one-line marked hint telling the seat what to read. No model call, no
 * vector anything, no body ever auto-loaded — the hint names the record, the
 * seat still has to fetch it, which is what keeps the pair honest on strong
 * models too (where this never fires).
 *
 * Sensitive records: this repo's memory kinds carry no sensitivity flag (the
 * ported spec's `sensitive` field has no analogue here), so there is nothing
 * to exclude yet — when a flag appears, the matcher must skip those rows
 * here, in the one place that builds hints.
 */

/** Word tokens worth matching: ≥4 chars, lowercase, no digits-only. Hyphens
 *  are separators, not word characters — a slug like `user-btc-scalps` is
 *  three words, or it can never match a message that says "btc scalp". */
const tokensOf = (text: string): Set<string> =>
    new Set((text.toLowerCase().replace(/-/g, ' ').match(/[a-z][a-z0-9]{3,}/g) ?? [])
        .filter(t => !/^\d+$/.test(t))
        .map(t => t.replace(/s$/, '')));

/** A row or slug matches when EVERY significant word of its slug appears in
 *  the message, or any ≥5-char word of its description does. Slug-first keeps
 *  "my-btc-routine" from firing on every message that says "the". Trailing-s
 *  folding is crude on purpose — this is a hint, not a search engine. */
const STOP_WORDS = new Set(['user', 'feedback', 'project', 'reference', 'memory', 'note', 'the', 'and']);

const matches = (messageTokens: Set<string>, slug: string, description?: string): boolean => {
    const slugWords = [...tokensOf(slug)].filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    if (slugWords.length > 0 && slugWords.every(w => messageTokens.has(w))) return true;
    const descWords = [...tokensOf(description ?? '')].filter(w => w.length >= 5);
    return descWords.some(w => messageTokens.has(w));
};

export interface MemoryHintRow {
    slug: string;
    description?: string;
}

/**
 * The hint lines, in the harness's own marked voice — empty array when
 * nothing matched, which is the common case and must add zero bytes.
 * At most two memory reads and two skill views per turn.
 */
export const buildMemoryHints = (
    message: string,
    memories: readonly MemoryHintRow[],
    skillSlugs: readonly string[],
): string[] => {
    const msg = tokensOf(message);
    if (msg.size === 0) return [];
    const lines: string[] = [];
    for (const m of memories.slice(0, 60)) {
        if (lines.length >= 2) break;
        if (matches(msg, m.slug, m.description)) {
            lines.push(`read_memory "${m.slug}" before answering — the index says it may change this answer.`);
        }
    }
    for (const slug of skillSlugs.slice(0, 60)) {
        if (lines.length >= 4) break;
        if (matches(msg, slug)) {
            lines.push(`skill_view "${slug}" before acting — its description matches this task.`);
        }
    }
    return lines;
};

/**
 * Weak/local model heuristic, ONE place: a provider pointed at a local server
 * (Ollama / LM Studio / vLLM on localhost) or a model from the small local
 * families. Conservative on purpose — a false "strong" costs a hint that the
 * model can ignore; a false "weak" spends a few prompt bytes.
 */
export const isLikelySmallModel = (config: { baseUrl?: string; modelId?: string }): boolean => {
    const url = (config.baseUrl ?? '').toLowerCase();
    if (/(localhost|127\.0\.0\.1|0\.0\.0\.0|:11434|:1234)/.test(url)) return true;
    return /(llama|qwen|gemma|phi-|ministral|smollm)/i.test(config.modelId ?? '');
};
