/**
 * Shared bubble-text derivation for chat rows.
 *
 * MessageItem (chat rows) and TranscriptRow (settled analysis rows) both
 * need the same scaffolding-stripped display text, leaked CoT, embedded
 * live-market JSON, and accuracy-mode note. Keeping the strip chain here
 * means the two row components can never drift apart.
 */

import { Message } from '../types';
import { extractAndStripThinkBlocks } from './thinkingSplit';

export interface MessageDisplayText {
    /** Bubble-ready text: think tags, JSON_PLAN, legacy scaffolding stripped. */
    displayContent: string;
    /** CoT leaked outside think tags (joins the Thinking row). */
    leakedThinking: string;
    /** Embedded LIVE MARKET DATA JSON block, when the message carries one. */
    liveMarketJson: string | null;
    /** Accuracy-mode verification note beside the settled verdict. */
    ensembleNote: string;
}

export const deriveMessageDisplayText = (message: Message): MessageDisplayText => {
    // Peel any think-tag scaffolding out of the stored text at render time so
    // it never shows in the bubble; the peeled CoT joins the Thinking row.
    const peeled = extractAndStripThinkBlocks(message.text);

    // Extract embedded Live Market JSON if present
    const liveMarketMatch = message.text.match(/\*\*LIVE MARKET DATA\*\*\s*```json\s*([\s\S]*?)\s*```/);
    const liveMarketJson = liveMarketMatch ? liveMarketMatch[1] : null;

    let displayContent = peeled.visible;

    // Hide Live Market Data JSON block if the component is rendering it
    if (liveMarketJson) {
        displayContent = displayContent.replace(/\*\*LIVE MARKET DATA\*\*\s*```json[\s\S]*?```/, '').trim();
    }

    // Hide JSON_PLAN block if there is an analysis object to render it
    if (message.analysis) {
        displayContent = displayContent.replace(/<JSON_PLAN>[\s\S]*?<\/JSON_PLAN>/g, '').trim();
    }

    // Legacy prompt formats wrapped output in <THINKING>/<FINAL_OUTPUT> tags
    // or header-style labels. Strip residual scaffolding from cached and
    // historical messages so it never renders in the bubble.
    displayContent = displayContent
        .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, '')
        .replace(/<FINAL_OUTPUT>[\s\S]*?<\/FINAL_OUTPUT>/gi, '')
        .replace(/<\/?(?:THINKING|FINAL_OUTPUT)>/gi, '')
        .replace(/^\s*(?:\*\*)?(?:THINKING|FINAL OUTPUT|FINAL_OUTPUT)(?:\*\*)?\s*:?\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Accuracy-mode verification note — the stub sentence plus an optional
    // note ("Plan verified by the accuracy pass."); show only the note.
    const ensembleNote = displayContent.includes('The ensemble has concluded its debate.')
        ? displayContent.replace('The ensemble has concluded its debate.', '').trim()
        : '';

    return {
        displayContent,
        leakedThinking: peeled.leaked,
        liveMarketJson,
        ensembleNote,
    };
};
