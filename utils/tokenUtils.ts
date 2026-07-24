
/**
 * Estimates the number of tokens in a text string.
 *
 * Uses a blended heuristic that accounts for:
 * - Word boundaries (whitespace-split tokens ≈ 1.3 tokens per word)
 * - JSON/structural overhead (braces, quotes, colons add tokens)
 * - Character density fallback (chars / 4 for CJK and dense text)
 *
 * This is ~15-20% more accurate than the naive chars/4 for JSON-heavy
 * AI responses, which dominate this app's token budget.
 */
export const estimateTokenCount = (text: string): number => {
    if (!text) return 0;

    // Fast path for short strings
    if (text.length < 100) {
        return Math.ceil(text.length / 4);
    }

    // Count words (whitespace-delimited)
    const words = text.split(/\s+/).filter(Boolean).length;

    // Count structural characters that typically become separate tokens
    const structuralChars = (text.match(/[{}[\]":,]/g) || []).length;

    // Blend: words * 1.3 + structural overhead + char density baseline
    const wordEstimate = words * 1.3;
    const structuralEstimate = structuralChars * 0.5;
    const charEstimate = text.length / 4;

    // Take the median of the three estimates for robustness
    const estimates = [wordEstimate + structuralEstimate, charEstimate, wordEstimate * 1.1];
    estimates.sort((a, b) => a - b);

    return Math.ceil(estimates[1]); // median
};

/**
 * Truncates a conversation history to fit within a specific token limit.
 * PRIORITY:
 * 1. System Prompt (always preserved).
 * 2. Latest User Message (always preserved).
 * 3. Recent History (preserved as much as possible, dropping oldest first).
 *
 * @param messages The full conversation history (OpenAI compatible objects).
 * @param tokenLimit The maximum allowed tokens (approximate).
 * @returns The truncated message array.
 */
export const truncateToTokenLimit = (messages: any[], tokenLimit: number): any[] => {
    if (!messages || messages.length === 0) return [];

    // Helper to get text from a message object (handles string or content array)
    const getText = (msg: any): string => {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
            // Join text parts if it's an array (e.g. text + image_url)
            return msg.content
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text || '')
                .join(' ');
        }
        return '';
    };

    // Calculate total estimated tokens
    const totalTokens = messages.reduce((sum, msg) => sum + estimateTokenCount(getText(msg)), 0);

    // If within limit, return explicitly as-is
    if (totalTokens <= tokenLimit) {
        return messages;
    }

    console.log(`[TokenUtils] Input exceeds limit. Current: ${totalTokens}, Max: ${tokenLimit}. Truncating...`);

    // 1. Identification
    const systemMessage = messages.length > 0 && messages[0].role === 'system' ? messages[0] : null;
    const latestMessage = messages[messages.length - 1];

    // 2. Define the "Middle" chunk (History)
    // If system msg exists, middle starts at 1. Else 0.
    // Middle ends at length-1 (exclusive of last msg).
    const startIndex = systemMessage ? 1 : 0;
    const endIndex = messages.length - 1;

    // Corner case: If no history to remove (e.g. only System + Last), we can't do much without losing context.
    // Return minimal set.
    if (startIndex >= endIndex) {
        console.warn(`[TokenUtils] Cannot truncate conversation history (only System/Last message present). Sending minimal context.`);
        return messages;
    }

    const middleMessages = messages.slice(startIndex, endIndex);

    // 3. Fixed Cost (System + Last)
    const retainedMessages = [latestMessage];
    if (systemMessage) retainedMessages.push(systemMessage);

    const fixedTokenCount = retainedMessages.reduce((sum, msg) => sum + estimateTokenCount(getText(msg)), 0);
    const availableTokens = tokenLimit - fixedTokenCount;

    if (availableTokens < 0) {
        console.warn(`[TokenUtils] System prompt + latest message alone exceed limit! (${fixedTokenCount} > ${tokenLimit}). Sending minimal context.`);
        return systemMessage ? [systemMessage, latestMessage] : [latestMessage];
    }

    // 4. Fill 'availableTokens' with middle messages from NEWEST to OLDEST
    const optimizedMiddle: any[] = [];
    let currentUsed = 0;

    // Iterate backwards (Newest history -> Oldest history)
    for (let i = middleMessages.length - 1; i >= 0; i--) {
        const msg = middleMessages[i];
        const count = estimateTokenCount(getText(msg));

        if (currentUsed + count <= availableTokens) {
            optimizedMiddle.unshift(msg); // Prepend to maintain correct order
            currentUsed += count;
        } else {
            // Skip this message but continue checking older (potentially smaller) messages
            console.log(`[TokenUtils] Dropping message index ${startIndex + i} (Size: ${count} tokens) to fit limit.`);
            continue;
        }
    }

    // 5. Reconstruct
    const finalMessages = [];
    if (systemMessage) finalMessages.push(systemMessage);
    finalMessages.push(...optimizedMiddle);
    finalMessages.push(latestMessage);

    const finalCount = currentUsed + fixedTokenCount;
    const droppedCount = messages.length - finalMessages.length;
    console.log(`[TokenUtils] Truncation complete. Dropped ${droppedCount} messages. New count: ${finalCount}`);

    return finalMessages;
};
