import { LoggedTrade, TradeOutcome } from '../types';

export interface JournalGroupStats {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnlPercentSum: number;
}

export interface JournalStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Average PnL per decided trade (percent — R-like for futures). */
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  /** Current streak: positive = wins, negative = losses, 0 = none. */
  currentStreak: number;
  bestWinStreak: number;
  bestLossStreak: number;
  perStrategy: JournalGroupStats[];
  perSymbol: JournalGroupStats[];
}

// Percent-only: manual captures store dollars (pnlAmount) while autopilot
// stores percents (pnlPercent). Averaging the two would mix units — a $150
// manual win would count as 150R. Dollar-only trades are excluded from the
// R-based stats (they still count toward win rate/streaks).
const pnlOf = (t: LoggedTrade): number => (typeof t.pnlPercent === 'number' ? t.pnlPercent : NaN);

const groupBy = (trades: LoggedTrade[], keyOf: (t: LoggedTrade) => string): JournalGroupStats[] => {
  const map = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of trades) {
    const key = keyOf(t) || 'Unknown';
    const entry = map.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    entry.trades++;
    if (t.outcome === TradeOutcome.WIN) entry.wins++;
    const pnl = pnlOf(t);
    if (!Number.isNaN(pnl)) entry.pnl += pnl;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([key, e]) => ({
      key,
      trades: e.trades,
      wins: e.wins,
      losses: e.trades - e.wins,
      winRate: e.trades ? Math.round((e.wins / e.trades) * 1000) / 10 : 0,
      pnlPercentSum: Math.round(e.pnl * 10) / 10,
    }))
    .sort((a, b) => b.trades - a.trades);
};

/**
 * Pure journal analytics — win rate, expectancy, streaks and per-strategy /
 * per-symbol breakdowns. Kept dependency-free for unit testing.
 */
export const computeJournalStats = (trades: LoggedTrade[]): JournalStats => {
  const decided = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
  const wins = decided.filter(t => t.outcome === TradeOutcome.WIN);
  const losses = decided.filter(t => t.outcome === TradeOutcome.LOSS);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  const winPnls = wins.map(pnlOf).filter(v => !Number.isNaN(v));
  const lossPnls = losses.map(pnlOf).filter(v => !Number.isNaN(v));
  const allPnls = decided.map(pnlOf).filter(v => !Number.isNaN(v));

  // Streaks over the log order (trades are appended chronologically).
  let run = 0;
  let bestWinStreak = 0;
  let bestLossStreak = 0;
  for (const t of decided) {
    const isWin = t.outcome === TradeOutcome.WIN;
    if (run === 0 || (run > 0) === isWin) run = isWin ? run + 1 : run - 1;
    else run = isWin ? 1 : -1;
    bestWinStreak = Math.max(bestWinStreak, run);
    bestLossStreak = Math.min(bestLossStreak, run);
  }

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided.length ? Math.round((wins.length / decided.length) * 1000) / 10 : 0,
    expectancyR: Math.round(avg(allPnls) * 10) / 10,
    avgWinR: Math.round(avg(winPnls) * 10) / 10,
    avgLossR: Math.round(avg(lossPnls) * 10) / 10,
    currentStreak: decided.length ? run : 0,
    bestWinStreak,
    bestLossStreak,
    perStrategy: groupBy(decided, t => t.analysis?.strategy || 'Unknown'),
    perSymbol: groupBy(decided, t => t.analysis?.coinName || 'Unknown'),
  };
};
