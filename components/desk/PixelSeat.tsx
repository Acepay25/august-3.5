/**
 * PixelSeat — a single seat on the desk floor. Renders the procedural
 * pixel-art avatar (cap + face + vest), a small desk tile with a monitor,
 * and the seat's status pip (live/speaking/thinking). Pure presentational:
 * it accepts a `DebateStageActor` and an anchor `{x,y}` in normalized 0..1
 * coordinates; the parent floor places the seat accordingly.
 *
 * The pixel grid is one `<span>` per pixel cell, absolutely positioned
 * inside a fixed-size box. We use `image-rendering: pixelated` so the
 * shape stays crisp at any zoom level. The seat's CSS variable
 * `--avatar-px` controls the size of one pixel (default 5 → 80×100).
 */

import React from 'react';
import { Mic, MicOff, Loader2, MessageSquare } from 'lucide-react';
import {
    buildGridForRole,
    colorForToken,
    isValidGrid,
    PIXEL_GRID_H,
    PIXEL_GRID_W,
    roleForName,
    type PixelToken,
} from './pixelAvatars';

export interface PixelSeatProps {
    /** Seat name — used for role detection AND for the visible name plate. */
    name: string;
    /** Live speech line; the speech bubble (parent) is the right place for
     *  the full line, but the seat shows a one-liner status text. */
    speech?: string;
    /** Whether the seat is live / speaking / thinking. */
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    /** Optional override for the role — used by tests. */
    roleOverride?: ReturnType<typeof roleForName>;
    /** Pixel scale (cell size in CSS px). Default 5. */
    pixelSize?: number;
    /** Optional click handler — usually opens the seat's transcript. */
    onClick?: () => void;
    /** Status text shown under the avatar (the seat's last speech, one line). */
    statusText?: string;
    /** Compact: skip the name plate + status line. Used when a SpeechBubble
     *  is the primary source of context. */
    compact?: boolean;
    /** Test seam: pass a fixed role instead of deriving from name. */
    'data-testid'?: string;
}

export const PixelSeat: React.FC<PixelSeatProps> = ({
    name,
    speech,
    live = false,
    thinking = false,
    speaking = false,
    roleOverride,
    pixelSize = 5,
    onClick,
    statusText,
    compact = false,
    'data-testid': testId,
}) => {
    const role = roleOverride ?? roleForName(name);
    // While the seat is speaking, swap between the idle and speaking
    // grids at ~2 Hz so the head visibly "talks" (mouth open / body
    // lean). Reduced-motion users see only the idle frame.
    const [tick, setTick] = React.useState(0);
    const reducedMotion = React.useRef(
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ).current;
    React.useEffect(() => {
        if (!speaking || reducedMotion) return undefined;
        const id = window.setInterval(() => setTick(t => (t + 1) % 2), 480);
        return () => window.clearInterval(id);
    }, [speaking, reducedMotion]);
    const frame: 'idle' | 'speaking' = speaking && !reducedMotion && tick === 1 ? 'speaking' : 'idle';
    const grid = buildGridForRole(role, frame);
    if (!isValidGrid(grid)) {
        // Bad grid means a developer broke the hand-authored table. Fail loud.
        return (
            <span className="text-[10px] text-rose-400" data-testid={testId}>
                pixel grid invalid for role {role}
            </span>
        );
    }
    const cellW = pixelSize;
    const cellH = pixelSize;
    const avatarW = PIXEL_GRID_W * cellW;
    const avatarH = PIXEL_GRID_H * cellH;
    const isLive = live || speaking || thinking;
    const pipColor = speaking
        ? 'bg-amber-400'
        : thinking
            ? 'bg-sky-400'
            : live
                ? 'bg-emerald-400'
                : 'bg-zinc-600';
    const PipIcon = speaking ? Mic : thinking ? Loader2 : (speech?.trim() ? MessageSquare : MicOff);

    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            data-role={role}
            aria-label={`Open ${name} seat`}
            className={`group/seat relative flex flex-col items-center gap-1 rounded-md p-1 text-center transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${
                speaking ? 'is-speaking' : thinking ? 'is-thinking' : live ? 'is-live' : ''
            }`}
        >
            {/* Status pip — top-right of the avatar box. */}
            <span
                aria-hidden="true"
                className={`absolute right-0 top-0 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-900 ${pipColor} ${speaking || thinking ? 'animate-pulse' : ''}`}
            >
                <PipIcon className="h-2.5 w-2.5 text-zinc-900" />
            </span>

            {/* Pixel-art avatar (16×20 grid). */}
            <span
                className="pixelArt relative block"
                style={{
                    width: avatarW,
                    height: avatarH,
                    // The thinking-monitor overlay in index.css uses
                    // --avatar-cell-h to position itself over the monitor
                    // row of the grid (row 18 of 20).
                    ['--avatar-cell-h' as string]: `${cellH}px`,
                } as React.CSSProperties}
                aria-hidden="true"
            >
                {grid.map((row, rIdx) => (
                    <React.Fragment key={`r${rIdx}`}>
                        {row.split('').map((c, cIdx) => {
                            if (c === '.') return null;
                            const token = c as PixelToken;
                            return (
                                <span
                                    key={`${rIdx}-${cIdx}`}
                                    style={{
                                        position: 'absolute',
                                        left: cIdx * cellW,
                                        top: rIdx * cellH,
                                        width: cellW,
                                        height: cellH,
                                        background: colorForToken(token, role),
                                    }}
                                />
                            );
                        })}
                    </React.Fragment>
                ))}
                {/* Thinking monitor overlay — a horizontal cyan flicker
                    that rides the monitor row while the seat is thinking. */}
                {thinking ? <span className="seat-monitor-overlay" /> : null}
            </span>

            {/* Name plate — kept visible at all sizes; the role is implied
                by the cap color. */}
            {!compact && (
                <span className="mt-0.5 max-w-[7.5rem] truncate rounded-sm border border-white/10 bg-zinc-900/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-200">
                    {name}
                </span>
            )}
            {!compact && statusText && (
                <span className="line-clamp-1 max-w-[7.5rem] text-[9px] italic text-zinc-500">
                    {statusText}
                </span>
            )}
            {!compact && !statusText && speech && speech.trim() && (
                <span className="line-clamp-1 max-w-[7.5rem] text-[9px] italic text-zinc-500" title={speech}>
                    {speech}
                </span>
            )}
        </button>
    );
};

export default PixelSeat;
