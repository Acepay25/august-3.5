/**
 * CompanyRoom — top-down pixel-art office rendered as a fixed
 * background behind the chat pane. Inspired by the "Autonomous AI
 * Company" reference: workstation row at the bottom on a darker
 * platform, a "human approval queue" panel in the center, gauges
 * + task-flow strip at the top.
 *
 * The avatar art reuses `PixelSeat` so the office and the desk
 * view share the same character designs. Seats breathe + fidget
 * via the same CSS animations (the body's `desk-idle-motion-off`
 * class still disables them globally).
 *
 * Layout (top → bottom, mirroring the reference):
 *   ┌─ TASK FLOW strip (gauges) ─────────────────┐
 *   ├─ HUMAN APPROVAL QUEUE (centered panel) ──┤
 *   ├─ WORKSTATION ROW (agents at desks) ──────┤
 *   └─ floor platform ─────────────────────────┘
 *
 * Each cell in the workstation row is `justify-self-center w-fit`
 * so the avatar keeps its intrinsic 48×60 size and the row
 * doesn't get stretched across the whole viewport. The lit-dot
 * is positioned relative to JUST the avatar wrapper, not the
 * whole cell, so it lands on the monitor instead of the cell
 * corner.
 */

import React from 'react';
import { PixelSeat } from '../desk/PixelSeat';

export interface CompanyRoomProps {
    /** Number of ready providers; controls how many desks are lit. */
    activeProviderCount?: number;
    /** Total desks to render. Defaults to 6 (matches the work-farm rows). */
    deskCount?: number;
    /** Optional: pass a seat name list to render specific agents. */
    seatNames?: string[];
    /** Optional: hide the office header (e.g. in a small dock). */
    showHeader?: boolean;
}

const DEFAULT_NAMES = ['Chief', 'Sales', 'Research', 'Build', 'Test', 'Verify', 'Support', 'Risk'];

export const CompanyRoom: React.FC<CompanyRoomProps> = ({
    activeProviderCount = 3,
    deskCount = 6,
    seatNames,
    showHeader = true,
}) => {
    const names = (seatNames && seatNames.length > 0 ? seatNames : DEFAULT_NAMES).slice(0, deskCount);

    // Synthetic metrics for the top task-flow strip. They're static
    // for now — a future PR can wire them to the analysis pipeline.
    const gauges: Array<{ label: string; value: number }> = [
        { label: 'Tasks',     value: 0.42 },
        { label: 'Running',   value: 0.18 },
        { label: 'Shipped',   value: 0.78 },
        { label: 'Approvals',  value: 0.10 },
    ];

    return (
        <div
            data-testid="company-room"
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-zinc-950"
        >
            {/* Background vignette — slightly warmer than pure black so
                the room feels inhabited, not empty. */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 80%, rgba(63,63,70,0.22) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, rgba(15,23,42,0.4) 0%, rgba(0,0,0,0.5) 100%)',
                }}
            />

            {/* SVG floor — top-down tile grid + the office's "architecture"
                lines: two horizontal corridors and a faint horizon
                behind the moderator's seat. */}
            <svg
                className="absolute inset-0 h-full w-full opacity-30"
                viewBox="0 0 1200 720"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
            >
                <defs>
                    <pattern id="company-room-floor" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect x="0" y="0" width="1200" height="720" fill="url(#company-room-floor)" />
                {/* Faint horizon line behind the moderator's seat. */}
                <line x1="0" y1="540" x2="1200" y2="540" stroke="#27272a" strokeWidth="1" strokeDasharray="2 6" />
            </svg>

            {/* Header strip — task-flow + live count. Anchored to the
                top so the trader can always see "N / M agents live". */}
            {showHeader && (
                <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-3 border-b border-white/5 bg-zinc-950/70 px-4 py-2 backdrop-blur">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                        Autonomous AI Company
                    </span>
                    <div className="flex items-center gap-2">
                        {gauges.map(g => (
                            <div key={g.label} className="flex items-center gap-1.5">
                                <span className="text-[9px] uppercase tracking-widest text-zinc-500">
                                    {g.label}
                                </span>
                                <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-800">
                                    <span
                                        className="block h-full rounded-full bg-zinc-500"
                                        style={{ width: `${g.value * 100}%` }}
                                    />
                                </span>
                            </div>
                        ))}
                        <span className="ml-2 text-[10px] font-semibold text-zinc-400">
                            {activeProviderCount} / {names.length} live
                        </span>
                    </div>
                </div>
            )}

            {/* Human approval queue — centered panel that floats above
                the workstation row. Pure decoration for now; the
                actual approval inbox lives in its own component
                (ApprovalInbox). Mirrors the reference image's
                "HUMAN APPROVAL QUEUE" panel. */}
            <div className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
                <div className="rounded-md border border-white/10 bg-zinc-900/60 px-4 py-2 text-center shadow-2xl backdrop-blur">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Human approval queue
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                        Awaiting review on {Math.max(0, names.length - activeProviderCount)} task
                        {names.length - activeProviderCount === 1 ? '' : 's'}
                    </p>
                </div>
            </div>

            {/* Floor platform — a dark band along the bottom where the
                desks sit. Slightly brighter than the room so the
                workstations have a "ground" to stand on. */}
            <div
                className="absolute left-0 right-0 bottom-0 h-[40%]"
                style={{
                    background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(24,24,27,0.55) 50%, rgba(39,39,42,0.85) 100%)',
                    borderTop: '1px solid rgba(63,63,70,0.3)',
                }}
            />

            {/* Workstation row — anchored to the bottom (justify-end)
                so the desks sit on the platform. The grid column
                width is determined by content (`w-fit` + `justify-self-center`)
                so the avatar keeps its 48×60 size instead of being
                stretched to fill the column. */}
            <div className="absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-6 sm:pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-x-2 gap-y-2 place-items-end">
                    {names.map((name, idx) => {
                        const lit = idx < activeProviderCount;
                        return (
                            <div
                                key={name}
                                className="flex flex-col items-center gap-1.5 justify-self-center w-fit"
                                data-testid={`company-desk-${idx}`}
                                data-lit={lit ? '1' : '0'}
                            >
                                {/* Avatar + lit dot, wrapped so the dot is
                                    anchored to the avatar, not the cell. */}
                                <div className="relative">
                                    <PixelSeat
                                        name={name}
                                        live
                                        thinking={idx === activeProviderCount - 1}
                                        pixelSize={3}
                                    />
                                    {lit && (
                                        <span
                                            className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                                            aria-hidden="true"
                                        />
                                    )}
                                </div>
                                {/* Desk label. */}
                                <span className="rounded border border-white/10 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-300">
                                    {name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CompanyRoom;
