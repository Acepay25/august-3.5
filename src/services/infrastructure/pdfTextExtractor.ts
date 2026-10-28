/**
 * pdfTextExtractor — extracts raw text from an uploaded PDF using pdfjs-dist.
 *
 * The worker is bundled by Vite as an asset (`?url`), so it works on the
 * web build, the Electron shell (app:// protocol) and Capacitor alike.
 * Output is capped because books can be enormous — the summarizer is fed
 * the first MAX_CHARS of text with page markers preserved.
 *
 * Scanned books have no embedded text layer: pages that yield almost no
 * text are rendered to PNGs (`pagesNeedingOcr`) so the vision model can
 * transcribe them (see services/learning/pdfOcrService.ts).
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Assign once at module load; repeated extractions reuse the same worker URL.
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}

/** A rendered page image ready for vision-OCR transcription. */
export interface PdfPageToOcr {
    pageNumber: number;
    /** Rendered PNG data URL (downscaled to ~1400px wide). */
    dataUrl: string;
}

export interface ExtractedPdfText {
    /** Raw embedded page text with `=== PAGE N ===` markers between pages. */
    text: string;
    pageCount: number;
    /** Length of the embedded text (before any OCR pass). */
    charCount: number;
    /** Pages with no usable text layer — rendered for vision-OCR. */
    pagesNeedingOcr: PdfPageToOcr[];
}

const MAX_CHARS = 400_000;
const MAX_OCR_PAGES = 20;
/** A page with fewer chars than this has no usable text layer (scanned). */
const MIN_PAGE_CHARS = 5;

async function renderPageToDataUrl(page: pdfjsLib.PDFPageProxy): Promise<string> {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable — cannot render PDF pages.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
}

export async function extractPdfText(data: ArrayBuffer): Promise<ExtractedPdfText> {
    const doc = await pdfjsLib.getDocument({ data }).promise;
    try {
        const pageCount = doc.numPages;
        let text = '';
        const pagesNeedingOcr: PdfPageToOcr[] = [];
        for (let p = 1; p <= pageCount; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            const pageText = content.items
                .map(item => ('str' in item && typeof item.str === 'string' ? item.str : ''))
                .join(' ')
                .trim();

            if (pageText.length >= MIN_PAGE_CHARS) {
                text += `\n=== PAGE ${p} ===\n${pageText}`;
            } else if (pagesNeedingOcr.length < MAX_OCR_PAGES) {
                // Scanned page — render it so the vision model can read it.
                const dataUrl = await renderPageToDataUrl(page);
                pagesNeedingOcr.push({ pageNumber: p, dataUrl });
            }

            if (text.length >= MAX_CHARS) {
                text = text.slice(0, MAX_CHARS);
                break;
            }
        }
        return { text, pageCount, charCount: text.length, pagesNeedingOcr };
    } finally {
        await doc.destroy().catch(() => { /* best-effort cleanup */ });
    }
}
