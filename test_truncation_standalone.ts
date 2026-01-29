
// Self-contained test script to avoid module resolution issues
interface Message {
    role: string;
    content: string;
    [key: string]: any;
}

// --- COPIED logic from utils/tokenUtils.ts ---

/**
 * Estimates token count for a text string.
 * Approximated as 4 characters per token.
 * 
 * @param text The text to estimate.
 * @returns The estimated token count.
 */
function estimateTokenCount(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Truncates a message history to fit within a specified token limit.
 * Strategies:
 * 1. Always keep the SYSTEM prompt (first message if role=system).
 * 2. Always keep the LATEST user message (last message).
 * 3. Remove from the MIDDLE/OLDEST (but after system) until fit.
 * 
 * @param messages The full history of messages.
 * @param maxTokens The maximum allowed tokens (approx).
 * @returns A filtered array of messages.
 */
function truncateToTokenLimit(messages: Message[], maxTokens: number): Message[] {
    if (messages.length === 0) return [];

    // 1. Calculate total tokens
    const msgWithTokens = messages.map(msg => ({
        msg,
        tokens: estimateTokenCount(msg.content || '')
    }));

    const totalTokens = msgWithTokens.reduce((sum, item) => sum + item.tokens, 0);

    // If already within limits, return original
    if (totalTokens <= maxTokens) {
        return messages;
    }

    console.log(`[TokenTruncation] Input exceeds limit: ${totalTokens} > ${maxTokens}. Truncating...`);

    // 2. Identify critical messages that MUST be kept
    // - System prompt (usually index 0, role='system')
    // - Latest message (last index)

    // We'll construct a new list. Start with valid indices.
    const keepIndices = new Set<number>();

    // Always keep last message (latest user prompt)
    const lastIndex = messages.length - 1;
    keepIndices.add(lastIndex);
    let currentUsage = msgWithTokens[lastIndex].tokens;

    // Always keep system prompt if present (assuming it's at index 0)
    if (messages.length > 1 && messages[0].role === 'system') {
        keepIndices.add(0);
        currentUsage += msgWithTokens[0].tokens;
    }

    // If critical messages already exceed limit, we can't do much but just return them
    // (Or truncate the latest message itself, but for now we basically return minimal set)
    if (currentUsage > maxTokens) {
        console.warn(`[TokenTruncation] Critical messages alone exceed limit (${currentUsage} > ${maxTokens}). Returning minimal set.`);
        return messages.filter((_, i) => keepIndices.has(i));
    }

    // 3. Fill with remaining messages from Newest to Oldest (excluding the one we already kept)
    // We iterate backwards from (lastIndex - 1) down to 1.
    // (Index 0 is system, already handled. Index last is latest, already handled.)

    const candidates = [];
    for (let i = messages.length - 2; i > 0; i--) {
        // Skip if it's the system prompt index (already handled check, but for clarity)
        if (i === 0) continue;
        candidates.push(i);
    }
    // candidates are now [second_to_last, ..., 1]

    for (const idx of candidates) {
        const msgTokens = msgWithTokens[idx].tokens;
        if (currentUsage + msgTokens <= maxTokens) {
            keepIndices.add(idx);
            currentUsage += msgTokens;
        } else {
            console.log(`[TokenTruncation] Dropping message at index ${idx} (${msgTokens} tokens) to fit limit.`);
            // Continue loop? If we want to try to fit smaller earlier messages, we continue.
            // If we want a contiguous block, we might stop. 
            // Usually, dropping intermediate context is fine, we want to maximize recent context.
            // So we continue to try and fit others if they are small enough? 
            // Or typically we just take the newest chunk.
            // Let's stick to "Priority to Newer". If we can't fit a newer one, we definitely won't fit older ones 
            // IF we assume we want contiguous history.
            // But if we just want to pack as much as possible, we keep trying.
            // Decision: Strict "Newer is better". If we skip one because it's too big, do we try the next?
            // "Truncate middle/oldest history".
            // Let's just try to fit them. If a huge message blocks us, maybe a small previous one fits.
        }
    }

    // 4. Reconstruct array in original order
    const result = messages.filter((_, i) => keepIndices.has(i));

    console.log(`[TokenTruncation] Truncated from ${messages.length} to ${result.length} msgs. New count: ${currentUsage}`);
    return result;
}

// --- TEST cases ---

const mockMessages = [
    { role: 'system', content: 'System Prompt (Keep me)' }, // ~21 chars = 6 tokens
    { role: 'user', content: 'Old message 1' }, // ~13 chars = 4 tokens
    { role: 'assistant', content: 'Old message 2' }, // ~13 chars = 4 tokens
    { role: 'user', content: 'Middle message 3' }, // ~16 chars = 4 tokens
    { role: 'user', content: 'Latest User Message (Keep me)' } // ~29 chars = 8 tokens
];

// Total approx: 6 + 4 + 4 + 4 + 8 = 26 tokens.

console.log('--- TEST 1: Strict Truncation (Limit 15) ---');
// Should keep System (6) + Latest (8) = 14.
// Middle ones (4 each) won't fit (14+4 = 18 > 15).
const truncated1 = truncateToTokenLimit(mockMessages, 15);
console.log('Result Length:', truncated1.length);
console.log('Result IDs (content):', truncated1.map(m => m.content));
if (truncated1.length === 2 && truncated1[0].role === 'system' && truncated1[1].role === 'user') {
    console.log('PASS');
} else {
    console.log('FAIL');
}


console.log('\n--- TEST 2: Moderate Truncation (Limit 20) ---');
// Available: 20.
// Fixed: System (6) + Latest (8) = 14.
// Remaining: 6.
// Candidates (reverse): Mid3 (4), Old2 (4), Old1 (4).
// Mid3 (4): Fits. Usage = 18. Rem = 2.
// Old2 (4): No fit.
// Old1 (4): No fit.
// Expected: System, Mid3, Latest.
const truncated2 = truncateToTokenLimit(mockMessages, 20);
console.log('Result Length:', truncated2.length);
console.log('Result IDs (content):', truncated2.map(m => m.content));
if (truncated2.length === 3 && truncated2[1].content.includes('Middle')) {
    console.log('PASS');
} else {
    console.log('FAIL');
}


console.log('\n--- TEST 3: No Truncation (Limit 100) ---');
// Expected: All
const truncated3 = truncateToTokenLimit(mockMessages, 100);
console.log('Result Length:', truncated3.length);
if (truncated3.length === 5) {
    console.log('PASS');
} else {
    console.log('FAIL');
}
