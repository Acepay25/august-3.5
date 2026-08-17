export interface StructuredAutoplayTurn {
    speaker: string;
    round?: number;
    text: string;
}

/**
 * Parse the optional machine-readable envelope emitted by accuracy autoplay.
 * The parser intentionally returns only complete TURN elements so a streamed
 * partial tag cannot leak into the public transcript. The legacy Speaker:
 * fallback remains in the pipeline for older providers and user overrides.
 */
export const parseStructuredAutoplayTranscript = (text: string): StructuredAutoplayTurn[] => {
    if (!text) return [];
    const turns: StructuredAutoplayTurn[] = [];
    const pattern = /<TURN\s+speaker=["']([^"']+)["'](?:\s+round=["'](\d+)["'])?\s*>([\s\S]*?)<\/TURN>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const body = match[3].trim();
        if (!body) continue;
        const round = match[2] ? Number.parseInt(match[2], 10) : undefined;
        turns.push({
            speaker: match[1].trim(),
            round: Number.isFinite(round) ? round : undefined,
            text: body,
        });
    }
    return turns;
};
