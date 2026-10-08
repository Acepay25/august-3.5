/**
 * TradeProposalCard — the model's presented trade plan rendered as a card
 * with Log-this-trade / Cancel. This is the dock's half of the outcome
 * autopilot: logging hands App an OPEN (PENDING) trade that the autopilot
 * later scores. Extracted from TradeChatPanel unchanged.
 *
 * The double-log guard and the disposition map stay in the dock (they live at
 * module scope so a 'logged' plan survives an unmount/remount); this card only
 * reflects `canLog` and forwards the two clicks.
 */

import React from 'react';
import { CheckCircle } from '../../shared/Icons';
import type { TradeProposal } from '../../../services/trade/proposedTrade';
import { computeRrRatio } from '../../../services/trade/proposedTrade';
import { fmtRiskReward } from '../../../utils/riskReward';

export interface TradeProposalCardProps {
    proposal: TradeProposal;
    /** A journal is attached (App passed onLogProposedTrade) — without it the
     *  Log button is hidden and only Cancel shows. */
    canLog: boolean;
    onLog: () => void;
    onCancel: () => void;
}

const TradeProposalCard: React.FC<TradeProposalCardProps> = ({ proposal, canLog, onLog, onCancel }) => (
    <div className="mt-1 rounded-control border border-white/[0.04] bg-white/[0.015] p-2.5" data-testid="trade-proposal-card">
        <div className="flex items-center gap-2">
            <span className={`rounded-control px-1.5 py-0.5 text-ui-xs font-bold ${proposal.direction === 'Long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>{proposal.direction}</span>
            <span className="font-mono text-ui-sm font-bold text-zinc-100">{proposal.symbol}</span>
            {/* The number that gates "Log this trade" — from the canonical
                planned-R:R util, the same chip the Chat surface header shows. */}
            {computeRrRatio(proposal) > 0 && (
                <span className="rounded-control border border-white/[0.04] bg-white/[0.04] px-1.5 py-0.5 font-mono text-ui-xs font-medium text-zinc-300">
                    {fmtRiskReward(computeRrRatio(proposal), 1)} R:R
                </span>
            )}
            <span className="ml-auto font-mono text-ui-xs uppercase tracking-wider text-zinc-500">{proposal.confidence} confidence</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-control border border-white/[0.04] bg-white/[0.02] p-2 font-mono text-ui-dense tabular-nums">
            <div>
                <div className="font-mono text-ui-xs uppercase text-zinc-500">Entry</div>
                <div className="font-semibold text-zinc-100">{proposal.entry}</div>
            </div>
            <div>
                <div className="font-mono text-ui-xs uppercase text-zinc-500">SL</div>
                <div className="font-semibold text-rose-400">{proposal.stopLoss}</div>
            </div>
            <div>
                <div className="font-mono text-ui-xs uppercase text-zinc-500">TP</div>
                <div className="font-semibold text-emerald-400">{proposal.takeProfits.join(' / ')}</div>
            </div>
        </div>
        {proposal.rationale && <p className="mt-1.5 text-ui-dense leading-relaxed text-zinc-400">{proposal.rationale}</p>}
        <div className="mt-2.5 flex items-center gap-1.5">
            {canLog && (
                <button type="button"
                    onClick={onLog}
                    className="rounded-control bg-emerald-600/90 px-2.5 py-1 text-ui-dense font-medium text-white transition-colors hover:bg-emerald-500">
                    Log this trade
                </button>
            )}
            <button type="button"
                onClick={onCancel}
                className="rounded-control border border-white/[0.06] px-2.5 py-1 text-ui-dense text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200">
                Cancel
            </button>
        </div>
    </div>
);

/** The settled counterpart: a plan the trader already logged, left in the
 *  transcript so it can never be clicked twice. */
export const TradeProposalLoggedRow: React.FC = () => (
    <p className="mt-1 flex items-center gap-1.5 text-ui-xs font-semibold uppercase tracking-wider text-emerald-400">
        <CheckCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>✓ Logged as an open trade — the harness will score it against the outcome.</span>
    </p>
);

export default TradeProposalCard;
