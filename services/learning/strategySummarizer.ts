/**
 * StrategySummarizer — turns raw PDF book text into a concise strategy list.
 *
 * Long books are chunked (with overlap) and each chunk is summarized
 * independently, then a final merge pass dedupes and consolidates the
 * per-chunk lists. Both passes use the user-configured prompt
 * `strategy.summarize_pdf` (editable in Settings → Prompts).
 *
 * The provider is chosen by the caller (first ready provider) so the user's
 * configured models are used consistently.
 */

import { ProviderConfig } from '../../types/provider';
import { getQuickResponse } from '../providers/GenericProviderService';
import { getPrompt } from '../infrastructure/PromptOverrideService';

const CHUNK_CHARS = 60_000;
const CHUNK_OVERLAP = 3_000;
// 7 chunks cover 60k + 6×57k = 402k chars ≥ the extractor's 400k cap. The
// old 5-chunk budget covered only 288k — text between 288k and 400k was
// extracted (worker cost) but silently never summarized.
const MAX_CHUNKS = 7;

const DEFAULT_SUMMARIZE_PROMPT = `You are a trading-strategy extractor. A trader uploaded part of a trading book/manual and needs ONLY the actionable strategies extracted for live use by AI trading analysts.

Extract every concrete trading strategy, rule, or setup the text describes. For each one capture:
- Name/type (e.g. "breakout retest", "engulfing continuation", "range fade")
- Entry conditions (exact price/indicator/candle conditions)
- Stop-loss placement
- Take-profit / exit rules
- Filters (what invalidates the setup, required market conditions)
- Position sizing / risk guidance if given

Rules:
- Output ONLY strategies; skip theory, anecdotes, fluff, and motivation.
- Keep each strategy under 120 words, as concise bullet-style prose.
- Preserve concrete numbers (levels, ratios, thresholds) exactly.
- If a passage has no actionable strategy, skip it.
- Format: a numbered list of "**Strategy: <name>** — <conditions>…".
- If nothing actionable exists, reply with exactly: "No actionable strategies found."`;

const splitChunks = (text: string): string[] => {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length && chunks.length < MAX_CHUNKS) {
        chunks.push(text.slice(start, start + CHUNK_CHARS));
        start += CHUNK_CHARS - CHUNK_OVERLAP;
    }
    return chunks;
};

/**
 * Summarize PDF text into a consolidated strategy list. Returns the final
 * merged list, or an empty string when every chunk produced nothing.
 * Throws on provider failure so the caller can surface a friendly message.
 */
export const summarizeStrategiesPdf = async (
    text: string,
    sourceName: string,
    config: ProviderConfig,
    signal?: AbortSignal
): Promise<string> => {
    const summarizePrompt = getPrompt('strategy.summarize_pdf', DEFAULT_SUMMARIZE_PROMPT);
    const chunks = splitChunks(text.trim());

    if (chunks.length === 0) return '';

    const sectionResults: string[] = [];
    for (const [i, chunk] of chunks.entries()) {
        const chunkPrompt = `Section ${i + 1}/${chunks.length} of "${sourceName}".

${chunk}`;
        const result = await getQuickResponse(config, chunkPrompt, summarizePrompt, {
            maxTokens: 4096,
            signal,
        });
        const trimmed = result?.trim() || '';
        if (trimmed && !/no actionable strategies found/i.test(trimmed)) {
            sectionResults.push(trimmed);
        }
    }

    if (sectionResults.length === 0) return 'No actionable strategies found.';

    // Merge pass: dedupe overlapping strategies and order by importance.
    if (sectionResults.length > 1) {
        const mergePrompt = `Below are strategy lists extracted from different sections of "${sourceName}". Merge them into ONE final list:
- Deduplicate overlapping strategies (keep the most complete version).
- Drop anything non-actionable.
- Keep concrete numbers exactly.
- Order by importance (most generally applicable first).

${sectionResults.join('\n\n---SECTION---\n\n')}

Final consolidated strategy list:`;
        const merged = await getQuickResponse(config, mergePrompt, summarizePrompt, {
            maxTokens: 4096,
            signal,
        });
        if (merged?.trim()) return merged.trim();
    }

    return sectionResults.join('\n\n---\n\n');
};
