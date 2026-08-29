/**
 * FloorRail — chat mode's right-side panel, Hermes-Bot-Mode style.
 * The pixel office used to render as a horizontal desk strip pinned
 * to the bottom of the chat; the trader wants the cast VERTICAL on
 * the right instead, beside the conversation (like Hermes' rail that
 * docks beside the chat only while the Bots tab is active).
 *
 * Content, top to bottom:
 *  - "On the floor": the office cast as vertical pixel seats with
 *    live/thinking states (same roleOverrides the office honors).
 *  - "Needs you": the human approval queue — our "needs you" badge
 *    (Hermes surfaces the same idea on roster rows).
 *  - Debate status: the live phase while a run is in flight.
 *
 * Presentational only: seat positions stay in the shared roomLayout
 * store used by the floor mode, so nothing here drifts from it.
 * `relative z-10` is REQUIRED — the CompanyRoom office is a fixed
 * z-0 backdrop and non-positioned siblings paint under it.
 */

import React from 'react';
import { PixelSeat } from '../desk/PixelSeat';
import { resolveRole } from '../../services/desk/roleOverrides';
import type { ApprovalItem } from '../../utils/approvalInbox';

export interface FloorRailProps {
    /** Ready providers — lights that many seats' live pips. */
    activeProviderCount: number;
    gaugeStats: { tasks: number; running: number; shipped: number; approvals: number };
    approvalItems: ApprovalItem[];
    /** True while a debate/post-mortem is streaming. */
    isDebating: boolean;
    /** Live phase string (e.g. "Round 2 of 3 · rebuttals"). */
    phase?: string;
}

/** The office cast — mirrors CompanyRoom's DEFAULT_NAMES. */
const CAST = ['Chief', 'Sales', 'Research', 'Build', 'Test', 'Verify'];

export const FloorRail: React.FC<FloorRailProps> = ({
    activeProviderCount,
    gaugeStats,
    approvalItems,
    isDebating,
    phase,
}) => {
    // The full office cast, always — mirrors CompanyRoom's six desks
    // (Chief/Sales/Research/Build/Test/Verify); seats beyond the ready
    // provider count render dark, exactly like the office did.
    const cast = CAST;

    return (
        <aside
            data-testid="floor-rail-chat"
            aria-label="Agents on the floor"
            className="relative z-10 hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-white/[0.06] bg-zinc-900/40 xl:flex"
        >
            {/* On the floor — the cast, vertical */}
            <div className="border-b border-white/[0.06] p-3" data-testid="floor-rail-cast">
                <div className="flex items-baseline justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        On the floor
                    </p>
                    <p className="font-mono text-[10px] tabular-nums text-zinc-500">
                        {activeProviderCount} live
                    </p>
                </div>
                <ul className="mt-2 flex flex-col items-center gap-2">
                    {cast.map((name, idx) => {
                        const lit = idx < activeProviderCount;
                        return (
                            <li key={name} className="flex flex-col items-center gap-0.5">
                                <PixelSeat
                                    name={name}
                                    roleOverride={resolveRole(name)}
                                    live={lit}
                                    thinking={isDebating && idx === activeProviderCount - 1}
                                    pixelSize={2}
                                    compact
                                />
                                <span className="rounded border border-white/10 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
                                    {name}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {/* Needs you — the human approval queue */}
            <div className="border-b border-white/[0.06] p-3" data-testid="floor-rail-needs-you">
                <div className="flex items-baseline justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Needs you
                    </p>
                    <p className="font-mono text-[10px] tabular-nums text-zinc-500">
                        {gaugeStats.approvals}
                    </p>
                </div>
                {approvalItems.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-zinc-600">Queue clear.</p>
                ) : (
                    <ul className="mt-1.5 space-y-1">
                        {approvalItems.slice(0, 3).map(item => (
                            <li key={item.id} className="flex items-start justify-between gap-2 text-[11px]">
                                <span className="min-w-0 truncate text-zinc-400">{item.title}</span>
                                <span className="status-surface shrink-0 rounded border border-amber-500/40 px-1 text-[8px] font-bold uppercase tracking-widest text-amber-300">
                                    Risk
                                </span>
                            </li>
                        ))}
                        {approvalItems.length > 3 && (
                            <li className="text-[10px] text-zinc-600">+{approvalItems.length - 3} more</li>
                        )}
                    </ul>
                )}
            </div>

            {/* Debate status */}
            <div className="p-3" data-testid="floor-rail-status">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    Debate
                </p>
                <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">
                    {isDebating ? (phase ?? 'Debate in progress') : 'Floor idle — send a setup to convene the desk.'}
                </p>
            </div>
        </aside>
    );
};

export default FloorRail;
