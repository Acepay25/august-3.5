import { HARNESS_CONTRACT_PROMPT } from '../constants/prompts/harnessContract';

/**
 * Prompt composition graph: contract → persona/job extras, each layer once.
 * Nested templates that still embed the harness contract are stripped so
 * models do not spend Thinking reconciling two ladders.
 */

export interface PromptLayer {
    id: string;
    text: string;
}

const CONTRACT_HEADER = '**HARNESS CONTRACT (highest priority — overrides any conflicting instruction):**';

/** Remove a nested copy of the harness contract from a job/persona block. */
export const stripHarnessContract = (text: string): string => {
    const raw = text || '';
    const canonical = HARNESS_CONTRACT_PROMPT.trim();
    let out = canonical && raw.includes(canonical) ? raw.split(canonical).join('\n') : raw;
    const headerAt = out.indexOf(CONTRACT_HEADER);
    if (headerAt >= 0) {
        const memoryLine = out.indexOf('4. **Memory:**', headerAt);
        if (memoryLine >= 0) {
            const lineEnd = out.indexOf('\n', memoryLine);
            out = `${out.slice(0, headerAt)}${lineEnd >= 0 ? out.slice(lineEnd + 1) : ''}`;
        }
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * Compose layers in order. `id: 'contract'` always uses the canonical
 * harness contract and is placed first. Duplicate ids are dropped.
 */
export const composePrompt = (layers: PromptLayer[]): string => {
    const seen = new Set<string>();
    const parts: string[] = [];
    let contract = '';
    for (const layer of layers) {
        const raw = (layer.text || '').trim();
        if (!raw) continue;
        if (seen.has(layer.id)) continue;
        seen.add(layer.id);
        if (layer.id === 'contract') {
            contract = HARNESS_CONTRACT_PROMPT.trim();
            continue;
        }
        const stripped = stripHarnessContract(raw);
        if (stripped) parts.push(stripped);
    }
    return [contract, ...parts].filter(Boolean).join('\n\n');
};
