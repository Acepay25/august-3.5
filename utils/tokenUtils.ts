
/**
 * Estimates the number of tokens in a text string.
 * Uses a simple approximation: 1 token ≈ 4 characters.
 */
export const estimateTokenCount = (text: string): number => {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
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
            // Stop adding once we hit the limit
            // This effectively drops the oldest messages
            console.log(`[TokenUtils] Dropping message index ${startIndex + i} (Size: ${count} tokens) to fit limit.`);
            break;
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
