/**
 * pdfOcrService — vision-model OCR for scanned PDF pages.
 *
 * pdfjs only extracts the embedded text layer; scanned books have none.
 * When pdfTextExtractor finds image-only pages it renders them to PNGs,
 * and this service transcribes them with the user's configured VISION model
 * (Settings → AI setup → Vision Model) — the same model that OCRs chart
 * screenshots, so one selection powers every vision feature.
 *
 * The transcription prompt is registered as `strategy.ocr_page`, so it is
 * editable in Settings → Prompts like every other prompt the app sends.
 */

import { ProviderConfig } from '../../types/provider';
import { ChatMessage, sendChatRequest } from '../providers/GenericProviderService';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { PdfPageToOcr } from '../infrastructure/pdfTextExtractor';

const DEFAULT_OCR_PAGE_PROMPT = `You are a precise OCR engine. Transcribe ALL text visible in this page image of a trading book, exactly as written — headings, body text, tables, captions, numbers, and footnotes.

Rules:
- Preserve line breaks between paragraphs.
- Do not add commentary, explanations, or markdown formatting.
- Output ONLY the transcribed text.`;

/**
 * Transcribe one rendered page with the vision model. Sequential by design —
 * OCR calls are token-heavy, and parallel pages would multiply cost and
 * provider rate limits.
 */
export const ocrPdfPage = async (
    page: PdfPageToOcr,
    config: ProviderConfig,
    signal?: AbortSignal
): Promise<string> => {
    const messages: ChatMessage[] = [{
        role: 'user',
        content: [
            { type: 'text', text: getPrompt('strategy.ocr_page', DEFAULT_OCR_PAGE_PROMPT) },
            { type: 'image_url', image_url: { url: page.dataUrl } },
        ],
    }];
    const text = await sendChatRequest(config, messages, { maxTokens: TASK_BUDGETS.ocr, signal });
    return (text || '').trim();
};

/** Transcribe all image-only pages, returning text with page markers. */
export const ocrPdfPages = async (
    pages: PdfPageToOcr[],
    config: ProviderConfig,
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void
): Promise<string> => {
    const parts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
        const text = await ocrPdfPage(pages[i], config, signal);
        if (text) parts.push(`\n=== PAGE ${pages[i].pageNumber} (OCR) ===\n${text}`);
        onProgress?.(i + 1, pages.length);
    }
    return parts.join('');
};
