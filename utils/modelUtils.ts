/**
 * modelUtils — Shared model-related heuristics.
 *
 * Kept in one place so a new vision-capable model only needs a single edit.
 */

/** Heuristic: does this model accept vision/image inputs? */
export function isVisionModel(modelId: string): boolean {
    const m = modelId.toLowerCase();
    return m.includes('llama-4')
        || m.includes('vision')
        || m.includes('gpt-4o')
        || m.includes('gpt-4.1')
        || m.includes('gpt-5')
        || m.includes('glm-4.5v')
        || m.includes('glm-4.6v')
        || m.includes('gemini');
}
