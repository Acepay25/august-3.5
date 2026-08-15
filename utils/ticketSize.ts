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
    riskPercent: number;
}

export interface LiquidationBuffer {
    stopMovePct: number;
    liquidationMovePct: number;
    bufferPct: number;
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

/** Equity risk scaled by ticket fraction, sized off Entry→SL. */
export const computeContractSize = (
    analysis: TradeAnalysis,
    equityUsd: number,
    leverage: number,
    riskPercent = 1,
): ContractSize => {
    const base = computeTicketSize(analysis);
    const eq = equityUsd > 0 ? equityUsd : 10_000;
    const lev = leverage > 0 ? leverage : 1;
    const riskPct = Number.isFinite(riskPercent) && riskPercent > 0
        ? Math.min(10, Math.max(0.1, riskPercent))
        : 1;
    if (base.fraction <= 0) {
        return {
            ...base,
            equityUsd: eq,
            leverage: lev,
            riskUsd: 0,
            notionalUsd: 0,
            qty: null,
            unit: '',
            line: 'No size',
            riskPercent: riskPct,
        };
    }
    const entry = parseNum(analysis.entryPoints?.[0]?.price);
    const sl = parseNum(analysis.stopLoss);
    const riskUsd = eq * (riskPct / 100) * base.fraction;
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
        riskPercent: riskPct,
    };
};

/** Isolated-margin wipe vs the ticket stop. Positive buffer = SL is inside liquidation. */
export const computeLiquidationBuffer = (
    entry?: string,
    stopLoss?: string,
    leverage = 1,
): LiquidationBuffer | null => {
    const lev = leverage > 0 ? leverage : 1;
    if (lev < 2) return null;
    const entryN = parseNum(entry);
    const slN = parseNum(stopLoss);
    if (!entryN || !slN) return null;
    const stopMovePct = (Math.abs(entryN - slN) / entryN) * 100;
    const liquidationMovePct = 100 / lev;
    const bufferPct = liquidationMovePct - stopMovePct;
    if (bufferPct <= 0) {
        return {
            stopMovePct,
            liquidationMovePct,
            bufferPct,
            line: `SL is past isolated liquidation at ${lev}x`,
        };
    }
    return {
        stopMovePct,
        liquidationMovePct,
        bufferPct,
        line: `Liq buffer ${bufferPct.toFixed(1)}% · SL uses ${stopMovePct.toFixed(1)}% of ${liquidationMovePct.toFixed(1)}% to liq`,
    };
};
