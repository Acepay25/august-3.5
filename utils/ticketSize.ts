import { TradeAnalysis } from '../types';

export interface TicketSize {
    label: 'full' | 'half' | 'none';
    fraction: number;
    reason: string;
}

export interface ContractSize extends TicketSize {
    equityUsd: number;
    leverage: number;
    riskUsd: number;
    notionalUsd: number;
    qty: number | null;
    unit: string;
    line: string;
}

export const computeTicketSize = (analysis: TradeAnalysis): TicketSize => {
    if (analysis.confidence === 'Avoid' || analysis.direction === 'Neutral' || analysis.riskVeto) {
        return { label: 'none', fraction: 0, reason: analysis.riskVeto || 'No trade' };
    }
    const skill = (analysis.validationWarnings ?? []).find(w => /SKILL VETO|NOTEBOOK SKILL VETO/i.test(w));
    if (skill) return { label: 'none', fraction: 0, reason: 'Skill veto' };
    const cap = analysis.gateResult?.confidenceCap;
    if (typeof cap === 'number' && cap < 0.7) {
        return { label: 'half', fraction: 0.5, reason: `Gate cap ${Math.round(cap * 100)}%` };
    }
    if (analysis.originalConfidence === 'High' && analysis.confidence !== 'High') {
        return { label: 'half', fraction: 0.5, reason: `Downgraded from ${analysis.originalConfidence}` };
    }
    return { label: 'full', fraction: 1, reason: 'Uncapped' };
};

const parseNum = (value?: string): number | undefined => {
    if (!value) return undefined;
    const n = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** 1% equity risk scaled by ticket fraction, sized off Entry→SL. */
export const computeContractSize = (
    analysis: TradeAnalysis,
    equityUsd: number,
    leverage: number,
): ContractSize => {
    const base = computeTicketSize(analysis);
    const eq = equityUsd > 0 ? equityUsd : 10_000;
    const lev = leverage > 0 ? leverage : 1;
    if (base.fraction <= 0) {
        return { ...base, equityUsd: eq, leverage: lev, riskUsd: 0, notionalUsd: 0, qty: null, unit: '', line: 'No size' };
    }
    const entry = parseNum(analysis.entryPoints?.[0]?.price);
    const sl = parseNum(analysis.stopLoss);
    const riskUsd = eq * 0.01 * base.fraction;
    const stopDist = entry && sl ? Math.abs(entry - sl) / entry : 0;
    const qty = entry && stopDist > 0 ? riskUsd / (entry * stopDist) : null;
    const notionalUsd = qty && entry ? qty * entry : riskUsd * lev;
    const coin = (analysis.coinName || '').replace(/USDT$/i, '') || 'qty';
    const qtyText = qty !== null
        ? `${qty >= 1 ? qty.toFixed(3) : qty.toPrecision(3)} ${coin}`
        : `${lev}x notional`;
    return {
        ...base,
        equityUsd: eq,
        leverage: lev,
        riskUsd,
        notionalUsd,
        qty,
        unit: coin,
        line: `${qtyText} · $${Math.round(riskUsd)} risk`,
    };
};
