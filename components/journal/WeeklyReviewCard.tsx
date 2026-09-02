import React, { useEffect, useState } from 'react';
import { loadWeeklyReview, WeeklyReviewDigest } from '../../services/learning/weeklyReview';

const pctOrDash = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

/**
 * Weekly review card (Batch 5, plan §4.5) — the deterministic week stats
 * plus the ONE improvement impulse, rendered at the top of the Journal
 * analytics tab. Reads the stored digest only; generation happens at boot.
 */
export const WeeklyReviewCard: React.FC<{ username: string }> = ({ username }) => {
    const [digest, setDigest] = useState<WeeklyReviewDigest | null>(null);
    useEffect(() => {
        let alive = true;
        void loadWeeklyReview(username).then(d => { if (alive) setDigest(d); });
        return () => { alive = false; };
    }, [username]);
    if (!digest) return null;
    const s = digest.stats;
    return (
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
            <div className="flex items-baseline justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Weekly review · {digest.generatedAt.slice(0, 10)}
                </p>
                <span className="text-[9px] text-zinc-600">via {digest.providerName}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">{digest.impulse}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 tabular-nums">
                <span>{s.closed} closed ({s.wins}W/{s.losses}L)</span>
                <span>Net ${Math.round(s.netPnlUsd)}</span>
                {s.avgR !== null && <span>avg R {s.avgR.toFixed(2)}</span>}
                {s.adherenceFollowedPct !== null && <span>adherence {s.adherenceFollowedPct}%</span>}
                {s.topMistake && <span>costliest: {s.topMistake}</span>}
                {s.givebackDays > 0 && <span>givebacks: {s.givebackDays}</span>}
            </div>
            {/* §8.5b meta-calibration (the loop learns about the loop) — the
                ratios ride the digest; render them beside the week stats so
                the weekly surface shows gate/refinement/eval health, not
                just trade health. '—' when a ratio has no sample. */}
            {digest.metaCalibration && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/5 pt-2 text-[10px] uppercase tracking-widest text-zinc-600 tabular-nums">
                    <span>gate precision {pctOrDash(digest.metaCalibration.worthGatePrecision)}</span>
                    <span>refinement recovery {pctOrDash(digest.metaCalibration.refinementRecovery)}</span>
                    <span>eval agreement {pctOrDash(digest.metaCalibration.evalAgreement)}</span>
                </div>
            )}
        </div>
    );
};
