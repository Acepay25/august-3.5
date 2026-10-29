/**
 * SignalFeed — the desk's own calls, settled against the tape.
 *
 * Owner scope (phase 1): a Signal Card and a Feed, nothing consumes the
 * resolutions yet. The feed states what it knows and no more: an open call
 * says when it expires, a resolved one shows outcome R after the named costs,
 * and every shadow measurement (the programmatic gate, the evidence check) is
 * labelled SHADOW because it never blocked the emission.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SignalRow, SignalStatus, SignalSummary } from '../../types/signal';
import { readSignals } from '../../services/signals/signalLedger';
import { settleDueSignals } from '../../services/signals/signalService';
import { summariseSignals, SIGNAL_SLIPPAGE_RATE, SIGNAL_TAKER_FEE_RATE } from '../../services/signals/signalResolver';
import { getActiveUsername } from '../../utils/activeUser';
import { phtClock, phtDayKey } from '../../utils/timezone';
import { RefreshIcon } from '../shared/Icons';

interface SignalFeedProps {
    user?: string;
}

const STATUS_WORD: Record<SignalStatus, string> = {
    open: 'open',
    won: 'won',
    lost: 'lost',
    expired: 'expired',
    never_triggered: 'no entry',
};

const statusClass = (status: SignalStatus): string =>
    status === 'won' ? 'text-emerald-400'
        : status === 'lost' ? 'text-rose-400'
            : status === 'expired' ? 'text-amber-300'
                : status === 'never_triggered' ? 'text-zinc-500'
                    : 'text-cyan-300';

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;
const pct = (n: number | null): string => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
    <div className="min-w-0">
        <div className="mb-1 text-ui-2xs uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="truncate text-ui-sm font-semibold text-zinc-100" title={value}>{value}</div>
        {sub && <div className="truncate text-ui-2xs text-zinc-500" title={sub}>{sub}</div>}
    </div>
);

const ShadowLine: React.FC<{ summary: SignalSummary }> = ({ summary }) => {
    const refused = summary.shadowRefusedR;
    const passed = summary.shadowPassedR;
    if (refused === null && passed === null) return null;
    return (
        <Stat
            label="Gate shadow"
            value={`${refused === null ? 'no refusals' : `refused ${signed(refused)}`} · ${passed === null ? 'no passes' : `passed ${signed(passed)}`}`}
            sub="mean outcome R of resolved calls on each side — the gate never blocked"
        />
    );
};

export const SignalCard: React.FC<{ row: SignalRow }> = ({ row }) => {
    const s = row.signal;
    const risk = Math.abs(s.entry - s.stop);
    const rr = risk > 0 ? Math.abs(s.target - s.entry) / risk : 0;
    const resolution = row.resolution;
    const gate = row.gate;
    const grounding = row.grounding;
    return (
        <article
            className="rounded-bubble border border-white/[0.06] bg-zinc-900/40 p-4"
            data-testid="signal-card"
            data-signal-id={s.id}
            data-status={row.status}
        >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-ui-sm font-semibold text-zinc-100">{s.coin}</span>
                <span className={`text-ui-2xs font-bold uppercase tracking-wider ${s.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {s.direction}
                </span>
                <span className={`text-ui-2xs font-bold uppercase tracking-wider ${statusClass(row.status)}`}>
                    {STATUS_WORD[row.status]}
                    {resolution?.ambiguous ? ' · ambiguous' : ''}
                </span>
                <span className="ml-auto font-mono text-ui-2xs text-zinc-600">
                    {phtDayKey(s.emittedAt)} {phtClock(s.emittedAt)}
                </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Entry" value={s.entry.toLocaleString()} />
                <Stat label="Stop" value={s.stop.toLocaleString()} />
                <Stat label="Target" value={s.target.toLocaleString()} />
                <Stat label="Planned" value={`${rr.toFixed(2)}R`} sub={`expires ${phtClock(s.expiresAt)}`} />
            </div>

            <p className="mt-3 text-ui-dense text-zinc-400">{s.thesis}</p>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.04] pt-2 text-ui-2xs text-zinc-500">
                <span title={s.evidenceRefs.join('\n')}>
                    {s.evidenceRefs.length} evidence ref{s.evidenceRefs.length === 1 ? '' : 's'}
                </span>
                <span className="font-mono" title="The requested provider/model recorded with the emission">{[s.provider, s.model].filter(x => x && x !== 'unknown').join(' · ') || 'model unrecorded'}</span>
                <span className="font-mono" title="FNV-1a of the tape the app knew at emission">{s.dataHash}</span>
                {grounding && (
                    <span
                        className={grounding.verdict === 'missing' ? 'text-amber-300/80' : ''}
                        title={grounding.missing.length ? `Not a desk tool: ${grounding.missing.join(', ')}` : 'Evidence references are citations; tool-like refs must name real desk tools'}
                    >
                        evidence shadow: {grounding.verdict}
                    </span>
                )}
                {gate && (
                    <span className={gate.status === 'refused' ? 'text-amber-300/80' : ''}>
                        gate shadow: {gate.status}{typeof gate.confidenceCap === 'number' ? ` · cap ${(gate.confidenceCap * 100).toFixed(0)}%` : ''}
                    </span>
                )}
            </div>

            {resolution && (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.04] pt-2 text-ui-dense">
                    <span className={`font-mono font-semibold ${resolution.outcomeR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {signed(resolution.outcomeR)}
                    </span>
                    <span className="font-mono text-ui-2xs text-zinc-500">
                        gross {signed(resolution.grossR)} · cost {resolution.feeR.toFixed(2)}R
                    </span>
                    {typeof resolution.exitPrice === 'number' && (
                        <span className="font-mono text-ui-2xs text-zinc-500">exit {resolution.exitPrice.toLocaleString()}</span>
                    )}
                    <span className={`text-ui-2xs ${resolution.crossCheck === 'disagree' ? 'text-rose-400' : 'text-zinc-500'}`}>
                        {resolution.crossCheck === 'agree' ? 'cross-checked OKX/Binance'
                            : resolution.crossCheck === 'disagree' ? 'exchange mismatch'
                                : 'no cross-check'}
                    </span>
                    {resolution.primarySource === 'binance' && (
                        <span className="text-ui-2xs text-amber-300/80">Binance fallback (OKX unavailable)</span>
                    )}
                    <span className="text-ui-2xs text-zinc-500">
                        {resolution.path === '1m' ? '1m drill-down' : `${Math.max(0, resolution.usedBarTimes.length)} closed bar${resolution.usedBarTimes.length === 1 ? '' : 's'} read`}
                    </span>
                </div>
            )}
        </article>
    );
};

const SignalFeed: React.FC<SignalFeedProps> = ({ user }) => {
    const activeUser = user ?? getActiveUsername();
    const [rows, setRows] = useState<SignalRow[]>(() => readSignals(activeUser));
    const [settling, setSettling] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(() => setRows(readSignals(activeUser)), [activeUser]);

    useEffect(() => {
        let alive = true;
        setRows(readSignals(activeUser));
        setSettling(true);
        void settleDueSignals(activeUser)
            .then(out => {
                if (!alive) return;
                load();
                if (out.resolved > 0) setNote(`Settled ${out.resolved} signal${out.resolved === 1 ? '' : 's'} against the tape.`);
                else if (out.skipped.some(s => s.reason.startsWith('the tape does not reach back'))) {
                    setNote('Some open signals predate the fetched tape; they stay open rather than being read as no-entry.');
                }
            })
            .catch(() => { /* settlement is best-effort; the stored rows still render */ })
            .finally(() => { if (alive) setSettling(false); });
        return () => { alive = false; };
    }, [activeUser, load]);

    const refresh = useCallback(() => {
        setSettling(true);
        setNote(null);
        void settleDueSignals(activeUser, { force: true })
            .then(out => {
                load();
                setNote(out.resolved > 0 ? `Settled ${out.resolved} signal${out.resolved === 1 ? '' : 's'}.` : 'No signal was ready to settle.');
            })
            .catch(() => setNote('Settlement could not reach the tape; nothing was written.'))
            .finally(() => setSettling(false));
    }, [activeUser, load]);

    const summary = useMemo(() => summariseSignals(rows), [rows]);
    const costPct = ((SIGNAL_TAKER_FEE_RATE + SIGNAL_SLIPPAGE_RATE) * 2 * 100).toFixed(2);

    return (
        <div className="h-full overflow-y-auto" data-testid="signal-feed">
            <div className="space-y-6 p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="mb-1.5 text-ui-2xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Desk signals</p>
                        <h3 className="font-serif text-ui-title font-medium tracking-[-0.02em] text-zinc-100">Signals</h3>
                        <p className="mt-2 max-w-2xl text-ui-caption text-zinc-500">
                            The desk's own calls — a direction, three prices and an expiry — recorded when it emits one and settled later
                            against the tape. These are not your trades and nothing here places an order.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={settling}
                        className="inline-flex items-center gap-1.5 rounded-control border border-white/[0.07] bg-zinc-800/80 px-3 py-1.5 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:bg-zinc-700/70 hover:text-zinc-100 disabled:opacity-40"
                        title="Re-check open signals against the tape"
                    >
                        <RefreshIcon className={`h-3.5 w-3.5 ${settling ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {settling ? 'Settling…' : 'Settle now'}
                    </button>
                </div>

                {summary.emitted > 0 && (
                    <section className="grid grid-cols-2 gap-5 rounded-bubble border border-white/[0.06] bg-zinc-900/30 p-4 sm:grid-cols-4">
                        <Stat
                            label="Hit rate"
                            value={pct(summary.hitRate)}
                            sub={`${summary.won}W / ${summary.lost}L / ${summary.expired} expired of ${summary.won + summary.lost + summary.expired} fills`}
                        />
                        <Stat
                            label="Expectancy"
                            value={summary.expectancyR === null ? '—' : signed(summary.expectancyR)}
                            sub="after fees, per filled call"
                        />
                        <Stat
                            label="Ambiguity"
                            value={pct(summary.ambiguityRate)}
                            sub="same-bar both-hit, settled stop-first"
                        />
                        <Stat
                            label="Emitted"
                            value={`${summary.emitted}`}
                            sub={`${summary.open} open · ${summary.neverTriggered} no entry`}
                        />
                        <ShadowLine summary={summary} />
                    </section>
                )}

                {note && <p className="text-ui-dense text-zinc-500" data-testid="signal-note">{note}</p>}
                {settling && <p className="text-ui-dense text-zinc-500">Reading closed OKX candles (Binance cross-check)…</p>}

                {rows.length === 0 ? (
                    <div className="rounded-bubble border border-white/[0.06] bg-zinc-900/30 p-6" data-testid="signal-feed-empty">
                        <p className="text-ui-sm text-zinc-200">No signals yet.</p>
                        <p className="mt-2 max-w-2xl text-ui-caption text-zinc-500">
                            A signal is emitted by the desk when it calls <code className="font-mono text-ui-dense text-zinc-400">emit_signal</code> —
                            a direction, entry, stop, target and expiry it is willing to be graded on. Every one is settled on closed
                            5-minute candles after expiry, with a stop-first rule when a bar contains both levels.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rows.map(row => <SignalCard key={row.signal.id} row={row} />)}
                    </div>
                )}

                <p className="text-ui-2xs text-zinc-600">
                    Settlement: closed OKX 5m candles, Binance cross-check on the bars that decided the call, 1m drill-down only for a
                    bar that contains both levels. Costs charged in R: {costPct}% round trip (taker fee + assumed slippage). A signal
                    whose tape is unavailable stays open; it is never read as &quot;no entry&quot;.
                </p>
            </div>
        </div>
    );
};

export default React.memo(SignalFeed);
