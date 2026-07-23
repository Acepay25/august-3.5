// AlgorithmicChatService.ts
// Replaces AI-based Chat History Compression with a Smart Sliding Window
// Saves tokens by pruning middle messages instead of summarizing them

import { Message } from '../../types';

/**
 * Compresses chat history using a Smart Sliding Window approach.
 * Keeps the "Head" (Context) and "Tail" (Recency) while pruning the middle.
 * 
 * @param messages - Full message history
 * @param currentSummary - Optional existing summary (ignored in sliding window mode, but kept for interface compatibility)
 * @param keepHead - Number of initial context messages to preserve (default: 2)
 * @param keepTail - Number of recent messages to preserve (default: 15)
 */
export const compressChatHistoryAlgorithmically = (
    messages: Message[],
    currentSummary: string = "",
    keepHead: number = 2,
    keepTail: number = 15
): string => {

    // If history is short enough, return it all (formatted)
    if (messages.length <= (keepHead + keepTail)) {
        return messages.map(formatMessage).join('\n\n');
    }

    // 1. preserve HEAD (Context/System Setup)
    const headMessages = messages.slice(0, keepHead);

    // 2. preserve TAIL (Recent Context)
    const tailMessages = messages.slice(-keepTail);

    // Calculate how many were skipped
    const omittedCount = messages.length - (headMessages.length + tailMessages.length);

    // Build the compressed string
    let compressed = "";

    // Add Head
    compressed += headMessages.map(formatMessage).join('\n\n');

    // Add Spacer
    if (omittedCount > 0) {
        compressed += `\n\n--- [ ${omittedCount} MESSAGES OMITTED FOR BREVITY ] ---\n\n`;
    }

    // Add Tail
    compressed += tailMessages.map(formatMessage).join('\n\n');

    return compressed;
};

/**
 * Formats a message object into a string for the AI context
 */
const formatMessage = (m: Message): string => {
    let content = `${m.role.toUpperCase()}: ${m.text}`;

    // Append visual context if available
    if (m.imageSummaries && m.imageSummaries.length > 0) {
        content += `\n[IMAGE ANALYSIS: ${m.imageSummaries.join('; ')}]`;
    }

    // Append trade analysis if available (for AI messages)
    if (m.analysis) {
        content += `\n[TRADE ANALYSIS: ${m.analysis.direction} ${m.analysis.coinName} - ${m.outcome || 'PENDING'}]`;
    }

    return content;
};
