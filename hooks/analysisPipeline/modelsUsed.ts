/**
 * Pipeline stage modules — modelsUsed attribution.
 *
 * Extracted from useAnalysisPipeline so the per-analyst model-attribution
 * contract is unit-testable without mounting the 3k-line send hook.
 */

/**
 * modelsUsed is a Record<providerId, modelId>, but when two lens roles share
 * ONE provider with different models the second entry would overwrite the
 * first (one analyst silently disappears from the model attribution). The
 * UI's per-bubble lookup already accepts `providerId:model` keys
 * (the debate floor), so colliding keys fall back to thoughtsKey form.
 */
export const buildModelsUsedRecord = (analysts: { config: { id: string }; model: string; thoughtsKey: string }[]): Record<string, string> => {
    const record: Record<string, string> = {};
    const seen = new Set<string>();
    for (const analyst of analysts) {
        if (seen.has(analyst.config.id)) {
            record[analyst.thoughtsKey] = analyst.model;
        } else {
            seen.add(analyst.config.id);
            record[analyst.config.id] = analyst.model;
        }
    }
    return record;
};
