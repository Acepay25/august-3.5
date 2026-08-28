/**
 * CompanyRoom — top-down pixel-art office rendered as a fixed
 * background behind the chat pane. Inspired by the "Autonomous AI
 * Company" reference: workstation rows, small pixel agents at each
 * desk, low-contrast so messages float on top.
 *
 * The avatar art reuses `PixelSeat` so the office and the desk
 * view share the same character designs. Seats breathe + fidget
 * via the same CSS animations (the body's `desk-idle-motion-off`
 * class still disables them globally).
 *
 * The room is a single absolutely-positioned <div> that sits behind
 * the message list via z-index. It does not own any state; it
 * reads `activeProviderCount` (passed in) to dim the unoccupied
 * desks so the trader can see at a glance which agents are live.
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
    // Each lit desk has a small green dot above the monitor.
    return (
        <div
            data-testid="company-room"
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-zinc-950"
        >
            {/* Soft vignette + warm tint. */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 30%, rgba(63,63,70,0.18) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(0,0,0,0.7) 100%)',
                }}
            />
            {/* Top-down office grid. Drawn at low opacity so the room is
                ambient, not foreground. */}
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
                    <linearGradient id="company-room-glow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(59,130,246,0.06)" />
                        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width="1200" height="720" fill="url(#company-room-floor)" />
                <rect x="0" y="0" width="1200" height="720" fill="url(#company-room-glow)" />
                {/* Two horizontal "office corridors" — workstations on each
                    side, a meeting room in the middle. */}
                <line x1="0" y1="280" x2="1200" y2="280" stroke="#27272a" strokeWidth="1" />
                <line x1="0" y1="500" x2="1200" y2="500" stroke="#27272a" strokeWidth="1" />
            </svg>

            {/* Pixel-art workstations, top-down. Each is a 96×80 desk
                tile with a tiny pixel agent sitting behind a monitor.
                Lit status (the green dot) is gated by activeProviderCount
                so the trader can see who is live. */}
            <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-6 sm:p-10 place-items-center content-center">
                {names.map((name, idx) => {
                    const lit = idx < activeProviderCount;
                    return (
                        <div
                            key={name}
                            className="relative flex flex-col items-center gap-1"
                            data-testid={`company-desk-${idx}`}
                            data-lit={lit ? '1' : '0'}
                        >
                            <div className="relative">
                                {/* The agent at the desk. Live status = breath + halo.
                                    Let `name` drive the role detection; passing a
                                    roleOverride here would force a single preset
                                    for every desk and break the variety. */}
                                <PixelSeat
                                    name={name}
                                    live
                                    thinking={idx === activeProviderCount - 1}
                                    pixelSize={3}
                                />
                                {/* Live status dot. */}
                                {lit && (
                                    <span
                                        className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-emerald-400 shadow shadow-emerald-400/60"
                                        aria-hidden="true"
                                    />
                                )}
                            </div>
                            {/* Desk label. */}
                            <span className="rounded border border-white/10 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-300">
                                {name}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Header strip (hidden when used in a small dock). */}
            {showHeader && (
                <div className="absolute left-0 right-0 top-0 flex items-center justify-between border-b border-white/5 bg-zinc-950/60 px-4 py-2 backdrop-blur">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Autonomous AI Company
                    </span>
                    <span className="text-[10px] text-zinc-500">
                        {activeProviderCount} / {names.length} agents live
                    </span>
                </div>
            )}
        </div>
    );
};

export default CompanyRoom;
