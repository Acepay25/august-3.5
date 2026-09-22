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
import { CheckCircle } from 'lucide-react';
import type { TradeProposal } from '../../../services/trade/proposedTrade';

export interface TradeProposalCardProps {
    proposal: TradeProposal;
    /** A journal is attached (App passed onLogProposedTrade) — without it the
     *  Log button is hidden and only Cancel shows. */
    canLog: boolean;
    onLog: () => void;
    onCancel: () => void;
}

const TradeProposalCard: React.FC<TradeProposalCardProps> = ({ proposal, canLog, onLog, onCancel }) => (
    <div className="mt-1 rounded-xl border border-white/10 bg-zinc-800/70 p-2.5" data-testid="trade-proposal-card">
        <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-ui-xs font-bold ${proposal.direction === 'Long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>{proposal.direction}</span>
            <span className="font-mono text-[12px] font-bold text-zinc-100">{proposal.symbol}</span>
            <span className="ml-auto text-ui-xs uppercase tracking-wider text-zinc-500">{proposal.confidence} confidence</span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[11px] tabular-nums">
            <span className="text-zinc-400">Entry <span className="text-zinc-100">{proposal.entry}</span></span>
            <span className="text-zinc-400">SL <span className="text-rose-400">{proposal.stopLoss}</span></span>
            <span className="text-zinc-400">TP <span className="text-emerald-400">{proposal.takeProfits.join(' / ')}</span></span>
        </div>
        {proposal.rationale && <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">{proposal.rationale}</p>}
        <div className="mt-2 flex items-center gap-1.5">
            {canLog && (
                <button type="button"
                    onClick={onLog}
                    className="rounded-control bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500">
                    Log this trade
                </button>
            )}
            <button type="button"
                onClick={onCancel}
                className="rounded-control border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                Cancel
            </button>
        </div>
    </div>
);

/** The settled counterpart: a plan the trader already logged, left in the
 *  transcript so it can never be clicked twice. */
export const TradeProposalLoggedRow: React.FC = () => (
    <p className="mt-1 flex items-center gap-1.5 text-ui-xs font-semibold uppercase tracking-wider text-emerald-400">
        <CheckCircle className="h-3 w-3 shrink-0" />
        <span>✓ Logged as an open trade — the harness will score it against the outcome.</span>
    </p>
);

export default TradeProposalCard;
