import { AnalystRole } from '../types';
import { HybridDataPacket, HybridTimeframe, generateHybridPromptInjection } from '../services/analysis/HybridIntelligenceService';

export type EnvelopeKind = 'macro' | 'technical' | 'risk' | 'general' | 'moderator';

export const envelopeKindForRole = (role: AnalystRole | undefined): EnvelopeKind => {
    if (role === AnalystRole.MACRO_VOLATILITY) return 'macro';
    if (role === AnalystRole.TECHNICAL_ANALYST) return 'technical';
    if (role === AnalystRole.RISK_EXECUTION) return 'risk';
    return 'general';
};

const TIMEFRAMES: Record<EnvelopeKind, HybridTimeframe[] | undefined> = {
    macro: ['1d', '4h'],
    technical: ['15m', '1h', '4h'],
    risk: ['15m', '1h'],
    general: undefined,
    moderator: ['1d', '4h', '1h', '15m'],
};

export const buildHybridEnvelope = (data: HybridDataPacket | null | undefined, kind: EnvelopeKind): string => {
    if (!data) return '';
    const injection = generateHybridPromptInjection(data, {
        timeframes: TIMEFRAMES[kind],
        compact: kind === 'moderator' || kind === 'macro' || kind === 'risk',
    });
    const label = kind === 'general'
        ? 'FULL MARKET PACKET'
        : `ISOLATED ENVELOPE (${kind.toUpperCase()}) — do not invent data from other lenses`;
    return `**${label}:**\n\n${injection}`;
};

export const buildOcrEnvelope = (summaries: string[] | undefined, kind: EnvelopeKind): string => {
    const items = (summaries || []).map(s => s.trim()).filter(Boolean);
    if (items.length === 0) return '';
    if (kind === 'moderator' || kind === 'risk') {
        return '**CHART OCR:** withheld from this envelope (use hybrid levels, not chart prose).';
    }
    if (kind === 'macro') {
        return `**CHART OCR (macro slice):**\n${items[0].slice(0, 800)}`;
    }
    return `**CHART OCR:**\n${items.map((s, i) => `Chart ${i + 1}: ${s}`).join('\n\n')}`;
};
