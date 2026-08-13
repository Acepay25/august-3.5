/**
 * Classify a thinking record into the journal Think-tab buckets:
 * Macro / Technical / Risk (accuracy + lens ensemble) or Normal
 * (plain 3-model ensemble with no role assignment).
 */

import { AnalystRole } from '../types/enums';
import { AnalystLens, ThinkingRecord } from '../types/thinking';

export const ANALYST_LENS_ORDER: AnalystLens[] = ['macro', 'technical', 'risk', 'normal'];

export const ANALYST_LENS_LABEL: Record<AnalystLens, string> = {
    macro: 'Macro',
    technical: 'Technical',
    risk: 'Risk',
    normal: 'Normal',
};

export function lensFromAnalystRole(role: AnalystRole, lensEnabled: boolean): AnalystLens {
    if (!lensEnabled) return 'normal';
    switch (role) {
        case AnalystRole.MACRO_VOLATILITY:
            return 'macro';
        case AnalystRole.TECHNICAL_ANALYST:
            return 'technical';
        case AnalystRole.RISK_EXECUTION:
            return 'risk';
        default:
            return 'normal';
    }
}

/**
 * Map a debate speaker / analyst display name onto a lens bucket.
 * "Macro & Volatility Analyst" → macro, generic provider names → null
 * (caller then falls back to 'normal').
 */
export function lensFromSpeakerName(name: string | undefined | null): AnalystLens | null {
    if (!name) return null;
    const hay = name.toLowerCase();
    if (/\bmacro\b/.test(hay)) return 'macro';
    if (/\btechnical\b/.test(hay)) return 'technical';
    if (/\brisk\b/.test(hay)) return 'risk';
    return null;
}

/**
 * Stored `analystLens` wins. Otherwise infer from speaker / provider text so
 * records saved before this field still land in the right Think-tab section.
 * Moderator records are not a lens bucket — callers should skip them.
 */
export function resolveAnalystLens(record: Pick<ThinkingRecord, 'analystLens' | 'role' | 'provider' | 'debateTurnSpeaker' | 'modelName'>): AnalystLens {
    if (record.analystLens === 'macro' || record.analystLens === 'technical' || record.analystLens === 'risk' || record.analystLens === 'normal') {
        return record.analystLens;
    }
    return lensFromSpeakerName(record.debateTurnSpeaker)
        || lensFromSpeakerName(record.provider)
        || lensFromSpeakerName(record.modelName)
        || 'normal';
}

export function isModeratorThinking(record: Pick<ThinkingRecord, 'role' | 'provider' | 'debateTurnSpeaker'>): boolean {
    if (record.role === 'moderator') return true;
    const hay = `${record.debateTurnSpeaker ?? ''} ${record.provider}`.toLowerCase();
    return hay.includes('moderator');
}
