/**
 * Report export utilities — turn the trade log into a CSV download or a
 * print-ready HTML report (open → Ctrl/Cmd+P → save as PDF).
 */

import { LoggedTrade } from '../types';
import { TradeOutcome } from '../types';
import { phtDayKey } from './timezone';

const dateStamp = (): string => phtDayKey();

function downloadBlob(content: string, filename: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Escape a value for CSV (quoted, embedded quotes doubled). */
const csvCell = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Export the trade log as a CSV file (Excel/Sheets friendly).
 */
export const exportTradesCSV = (trades: LoggedTrade[]): void => {
    const header = [
        'Date', 'Coin', 'Direction', 'Outcome', 'Entry', 'Stop Loss', 'Take Profits',
        'Leverage', 'PnL (USD)', 'PnL (%)', 'Family', 'Strategy', 'Confidence', 'Post-Mortem',
    ];
    const rows = trades.map(t => [
        t.timestamp,
        t.analysis.coinName || '',
        t.analysis.direction || '',
        t.outcome,
        t.analysis.entryPoints?.[0]?.price || '',
        t.analysis.stopLoss || '',
        (t.analysis.takeProfit || []).map(tp => tp.price).join(' / '),
        t.leverage ?? '',
        t.pnlAmount ?? '',
        t.pnlPercent ?? '',
        t.analysis.detectedPatternFamily || '',
        t.analysis.strategy || '',
        t.analysis.confidence || '',
        (t.postMortem || '').slice(0, 300),
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob(csv, `august-trades-${dateStamp()}.csv`, 'text/csv;charset=utf-8;');
};

/**
 * Escape a value for safe interpolation into the report HTML — coin names,
 * strategies and directions come from AI output and can contain markup.
 */
const escapeHtml = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Export the trade log as a printable HTML report (monochrome, print
 * stylesheet included — open it and use the browser's print-to-PDF).
 */
export const exportTradesHTML = (trades: LoggedTrade[]): void => {
    const completed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const wins = completed.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = completed.length - wins;
    const winRate = completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
    const grossWin = trades.filter(t => t.outcome === TradeOutcome.WIN).reduce((s, t) => s + (t.pnlAmount || 0), 0);
    const grossLoss = Math.abs(trades.filter(t => t.outcome === TradeOutcome.LOSS).reduce((s, t) => s + (t.pnlAmount || 0), 0));
    const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');

    const rows = trades.map(t => `
        <tr>
            <td>${new Date(t.timestamp).toLocaleDateString()}</td>
            <td>${escapeHtml(t.analysis.coinName) || '—'}</td>
            <td>${escapeHtml(t.analysis.direction) || '—'}</td>
            <td>${escapeHtml(t.outcome)}</td>
            <td>${escapeHtml(t.analysis.entryPoints?.[0]?.price) || '—'}</td>
            <td>${escapeHtml(t.analysis.stopLoss) || '—'}</td>
            <td>${escapeHtml((t.analysis.takeProfit || []).map(tp => tp.price).join(' / ')) || '—'}</td>
            <td>${escapeHtml(t.leverage) || '—'}x</td>
            <td>${t.pnlAmount !== undefined ? t.pnlAmount.toFixed(2) : (t.pnlPercent !== undefined ? `${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%` : '—')}</td>
            <td>${escapeHtml(t.analysis.detectedPatternFamily) || '—'}</td>
            <td>${escapeHtml(t.analysis.strategy) || '—'}</td>
        </tr>`).join('');

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>August Trading — Trade Report</title>
<style>
  :root { color-scheme: light; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #141416; margin: 2rem auto; max-width: 1100px; padding: 0 1.5rem; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #717171; font-size: .85rem; margin-bottom: 1.5rem; }
  .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .stat { border: 1px solid #d9d9d9; border-radius: 8px; padding: .6rem 1rem; min-width: 110px; }
  .stat b { display: block; font-size: 1.2rem; }
  .stat span { font-size: .7rem; color: #717171; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  th, td { border-bottom: 1px solid #ececec; padding: .45rem .5rem; text-align: left; }
  th { background: #eaeaec; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #717171; }
  tr:nth-child(even) td { background: #f7f7f7; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>Trading Journal — Report</h1>
  <div class="sub">Generated ${new Date().toLocaleString()} · ${trades.length} trades (${wins} W / ${losses} L)</div>
  <div class="stats">
    <div class="stat"><b>${winRate}%</b><span>Win rate</span></div>
    <div class="stat"><b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</b><span>Net PnL (USD)</span></div>
    <div class="stat"><b>${profitFactor}</b><span>Profit factor</span></div>
    <div class="stat"><b>${trades.length}</b><span>Trades</span></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Coin</th><th>Dir</th><th>Outcome</th><th>Entry</th><th>SL</th><th>TPs</th><th>Lev</th><th>PnL</th><th>Family</th><th>Strategy</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * One model-ready training record for a logged trade.
 *
 * Flat and STABLE in shape: every key is present on every line, with null where
 * the app never learned the fact. A ragged JSONL (keys appearing only when set)
 * makes the reader guess whether absence means "not recorded" or "not in this
 * schema version" — the exact ambiguity the rest of this app refuses.
 */
export const trainingRecordFor = (t: LoggedTrade): Record<string, unknown> => ({
    id: t.id,
    planId: t.planId ?? null,
    loggedAt: t.timestamp,
    outcomeResolvedAt: t.outcomeResolvedAt ?? null,
    symbol: t.analysis?.coinName ?? null,
    direction: t.analysis?.direction ?? null,
    strategy: t.analysis?.strategy ?? null,
    strategyFamily: t.analysis?.strategyFamily ?? null,
    verdictProbability: typeof t.analysis?.probability === 'number' ? t.analysis.probability : null,
    entry: t.analysis?.entryPoints?.[0]?.price ?? null,
    stopLoss: t.analysis?.stopLoss ?? null,
    takeProfits: (t.analysis?.takeProfit ?? []).map(tp => tp.price),
    leverage: t.leverage ?? null,
    tradeType: t.tradeType ?? null,
    marketRegime: t.marketRegime ?? null,
    outcome: t.outcome,
    pnlAmount: typeof t.pnlAmount === 'number' ? t.pnlAmount : null,
    pnlPercent: typeof t.pnlPercent === 'number' ? t.pnlPercent : null,
    rMultiple: typeof t.rMultiple === 'number' ? t.rMultiple : null,
    realizedR: typeof t.realizedR === 'number' ? t.realizedR : null,
    maxAdverseExcursion: typeof t.maxAdverseExcursion === 'number' ? t.maxAdverseExcursion : null,
    maxFavorableExcursion: typeof t.maxFavorableExcursion === 'number' ? t.maxFavorableExcursion : null,
    extendedSLZoneBreach: t.extendedSLZoneBreach ?? false,
    mistakeTags: t.mistakeTags ?? [],
    emotionalState: t.emotionalState ?? null,
    followedPlan: typeof t.followedPlan === 'boolean' ? t.followedPlan : null,
    planDeviationNote: t.planDeviationNote ?? null,
    checklist: t.checklistCompleted ?? null,
    rootCauseClass: t.rootCauseClass ?? null,
    postMortem: t.postMortem ?? null,
    modelsUsed: t.modelsUsed ?? null,
    moderator: t.moderatorModel ? { provider: t.moderatorProvider ?? null, model: t.moderatorModel } : null,
    sourceRunId: t.sourceRunId ?? null,
    promptVersion: t.promptVersion ?? null,
    promptLane: t.promptLane ?? null,
    // Size discipline: the transcript is megabytes per row and belongs in the
    // reasoning export, not in a line-oriented training file. Count it, keep
    // the verdict text, and let the reader ask for the rest by run id.
    debateTurnCount: t.debateTurns?.length ?? 0,
    moderatorSynthesis: t.moderatorSynthesis ?? null,
});

/**
 * Export the journal as JSONL — one training record per line — for offline
 * fine-tuning. Deliberately includes UNRESOLVED rows with `outcome` telling you
 * so: dropping them would silently bias the corpus toward trades that settled,
 * which is a different question than the one a finetune answers.
 */
export const exportTrainingDataJSONL = (trades: LoggedTrade[]): void => {
    const body = trades.map(t => JSON.stringify(trainingRecordFor(t))).join('\n');
    downloadBlob(`${body}${body ? '\n' : ''}`, `august-training-data-${dateStamp()}.jsonl`, 'application/x-ndjson');
};
