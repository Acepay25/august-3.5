import { LoggedTrade, RootCauseClass, TradeOutcome } from '../types';

const EXECUTION_RE = /\b(chased|fomo|revenge trad|moved (the )?(sl|stop)|did(?:n't| not) follow|entered late|late entry|oversized|size too big|skipped (the )?plan|slippage)\b/i;
const MACRO_RE = /\b(cpi|fomc|nfp|fed (rate|decision)|news (candle|spike)|black swan|unexpected news|geopolitical)\b/i;
const LABEL_RE = /\b(SETUP_EDGE_FAILURE|EXECUTION_ERROR|MACRO_SHOCK)\b/;

interface BlameShares {
    setup: number;
    execution: number;
    market: number;
}

const share = (text: string, label: string): number | undefined => {
    const match = text.match(new RegExp(`${label}\\s*[:=]?\\s*(\\d{1,3})\\s*%`, 'i'));
    if (!match) return undefined;
    const n = Number(match[1]);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
};

export const parseBlameShares = (text: string): BlameShares | undefined => {
    const setup = share(text, 'setup');
    const execution = share(text, 'execution');
    const market = share(text, 'market');
    if (setup === undefined && execution === undefined && market === undefined) return undefined;
    return {
        setup: setup ?? 0,
        execution: execution ?? 0,
        market: market ?? 0,
    };
};

const classFromShares = (shares: BlameShares): RootCauseClass => {
    const max = Math.max(shares.setup, shares.execution, shares.market);
    if (max < 40) return 'UNCLEAR';
    const winners: RootCauseClass[] = [];
    if (shares.setup === max) winners.push('SETUP_EDGE_FAILURE');
    if (shares.execution === max) winners.push('EXECUTION_ERROR');
    if (shares.market === max) winners.push('MACRO_SHOCK');
    return winners.length === 1 ? winners[0] : 'UNCLEAR';
};

export const classifyRootCause = (text?: string, outcome?: TradeOutcome): RootCauseClass => {
    const raw = (text || '').trim();
    if (!raw) return 'UNCLEAR';
    const labeled = raw.match(LABEL_RE)?.[1];
    if (labeled === 'SETUP_EDGE_FAILURE' || labeled === 'EXECUTION_ERROR' || labeled === 'MACRO_SHOCK') {
        return labeled;
    }
    const shares = parseBlameShares(raw);
    if (shares) return classFromShares(shares);
    if (EXECUTION_RE.test(raw) && !MACRO_RE.test(raw)) return 'EXECUTION_ERROR';
    if (MACRO_RE.test(raw) && !EXECUTION_RE.test(raw)) return 'MACRO_SHOCK';
    if (outcome === TradeOutcome.WIN) return 'SETUP_EDGE_FAILURE';
    return 'UNCLEAR';
};

export const rootCauseForTrade = (
    trade: Pick<LoggedTrade, 'postMortem' | 'outcome' | 'rootCauseClass'>,
): RootCauseClass => {
    if (trade.rootCauseClass) return trade.rootCauseClass;
    return classifyRootCause(trade.postMortem, trade.outcome);
};

/**
 * Unlabeled post-mortems still admit (legacy text). Parsed execution / macro
 * blame does not become a technical playbook rule.
 */
export const shouldAdmitTechnicalStrategyRule = (cause: RootCauseClass): boolean => (
    cause === 'SETUP_EDGE_FAILURE' || cause === 'UNCLEAR'
);

export const tradeAdmitsTechnicalStrategyRule = (
    trade: Pick<LoggedTrade, 'postMortem' | 'outcome' | 'rootCauseClass'>,
): boolean => shouldAdmitTechnicalStrategyRule(rootCauseForTrade(trade));
