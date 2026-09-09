/**
 * Zod boundaries for the Deep Research pipeline (Minara-style multi-stage
 * research). Same doctrine as tradeAnalysis: AI output is coerced leniently
 * at the boundary, and a stage that cannot be parsed degrades to "that stage
 * said nothing" — never to a fabricated finding.
 */

import { z } from 'zod';

export const ResearchFindingSchema = z.object({
    /** Direct answer to the subtask, 1-3 sentences. */
    answer: z.string().default(''),
    /** Source titles/URLs the answer rests on (may be empty when the data
     *  handed in was unavailable — the answer must then say so). */
    sources: z.array(z.string()).default([]),
    // An unknown confidence word is noise, not a reason to discard a good
    // answer — coerce it to the neutral tier instead of failing the object.
    confidence: z.preprocess(
        v => (v === 'low' || v === 'medium' || v === 'high' ? v : undefined),
        z.enum(['low', 'medium', 'high']).default('medium'),
    ),
});

export type ResearchFinding = {
    subtask: string;
    answer: string;
    sources: string[];
    confidence: 'low' | 'medium' | 'high';
    /** The stage's raw evidence block (desk-tool output) for provenance. */
    evidence?: string;
};

export const ResearchSubtaskPlanSchema = z.object({
    subtasks: z.array(z.string()).min(1).max(6),
});

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Lenient parse of one finding response; null when unusable. */
export const parseResearchFinding = (raw: unknown): { answer: string; sources: string[]; confidence: 'low' | 'medium' | 'high' } | null => {
    const result = ResearchFindingSchema.safeParse(raw);
    if (result.success) {
        const answer = text(result.data.answer);
        if (!answer) return null;
        return {
            answer: answer.slice(0, 600),
            sources: result.data.sources.map(text).filter(Boolean).slice(0, 6),
            confidence: result.data.confidence,
        };
    }
    // Salvage a bare string answer (models sometimes skip the JSON shape).
    if (typeof raw === 'string' && raw.trim()) {
        return { answer: raw.trim().slice(0, 600), sources: [], confidence: 'low' };
    }
    return null;
};

/** Coerce a subtask list (accepts {subtasks:[...]} or a bare array). A
 *  longer list is TRUNCATED to the cap, not rejected — over-generous plans
 *  are a cost signal, not a parse failure. */
export const parseResearchSubtasks = (raw: unknown): string[] => {
    const candidate = Array.isArray(raw)
        ? { subtasks: raw.slice(0, 6) }
        : raw && typeof raw === 'object'
            ? { subtasks: Array.isArray((raw as { subtasks?: unknown }).subtasks)
                ? ((raw as { subtasks: unknown[] }).subtasks).slice(0, 6)
                : undefined }
            : raw;
    const result = ResearchSubtaskPlanSchema.safeParse(candidate);
    if (!result.success) return [];
    return result.data.subtasks.map(text).filter(Boolean).slice(0, 6);
};

/** Coerce the cross-validation output: a list of contradiction lines. */
export const parseResearchContradictions = (raw: unknown): string[] => {
    const candidate = Array.isArray(raw) ? { contradictions: raw } : raw;
    if (!candidate || typeof candidate !== 'object') return [];
    const list = (candidate as { contradictions?: unknown }).contradictions;
    if (!Array.isArray(list)) return [];
    return list.map(text).filter(Boolean).slice(0, 6);
};
