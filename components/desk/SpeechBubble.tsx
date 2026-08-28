/**
 * SpeechBubble — a comic-style speech bubble pinned above a speaking seat.
 *
 * The bubble is a presentational layer that renders a single line of
 * speech. The PARENT (the desk floor) decides WHEN the bubble is visible
 * (4-second fade OR a new seat starts speaking) and WHERE (above the
 * seat anchor). The bubble's only job is to draw itself with a tail
 * pointing at the seat.
 *
 * The tail's "direction" is a CSS transform; we use the `side` prop to
 * mirror the tail for seats on the right side of the room.
 */

import React from 'react';

const BUBBLE_MAX_CHARS = 64;
const FADE_MS = 4000;

const truncate = (s: string, n = BUBBLE_MAX_CHARS): string => {
    const cleaned = (s ?? '').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= n) return cleaned;
    return `${cleaned.slice(0, n - 1).trimEnd()}…`;
};

export interface SpeechBubbleProps {
    text: string;
    /** Whose bubble it is (used as the aria-label). */
    speaker: string;
    /** Side the seat is on — flips the tail. */
    side?: 'left' | 'right' | 'center';
    /** Conviction chip (0..100) — surfaces the sealed stake for the room. */
    conviction?: number | null;
    /** Optional tone key for the border accent (matches the avatar's `C`). */
    toneKey?: string;
    /** "Block print" — bold uppercase callout for VERDICT/PRICE lines. */
    emphasis?: 'normal' | 'block-print';
    'data-testid'?: string;
}

const TONE_ACCENT: Record<string, string> = {
    risk: '#7f1d1d',
    macro: '#1e3a8a',
    technical: '#14532d',
    sentiment: '#581c87',
    moderator: '#fbbf24',
    followup: '#155e75',
    postmortem: '#52525b',
    execution: '#78350f',
};

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({
    text,
    speaker,
    side = 'center',
    conviction,
    toneKey,
    emphasis = 'normal',
    'data-testid': testId,
}) => {
    const cleaned = truncate(text);
    if (!cleaned) return null;
    const accent = (toneKey && TONE_ACCENT[toneKey.toLowerCase()]) ?? '#fbbf24';
    const sideClass =
        side === 'left' ? 'left-2' : side === 'right' ? 'right-2' : 'left-1/2 -translate-x-1/2';
    const tailClass =
        side === 'left'
            ? 'left-3'
            : side === 'right'
                ? 'right-3'
                : 'left-1/2 -translate-x-1/2';
    return (
        <div
            role="status"
            aria-label={`${speaker} says: ${cleaned}`}
            data-testid={testId}
            data-side={side}
            data-emphasis={emphasis}
            className={`absolute z-20 ${sideClass} bottom-full mb-2 w-44 max-w-[12rem] animate-[bubble-pop_220ms_ease-out]`}
        >
            <div
                className={`relative rounded-md border bg-zinc-900/95 px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-sm ${
                    emphasis === 'block-print'
                        ? 'border-amber-400/40'
                        : 'border-white/15'
                }`}
                style={{ borderColor: emphasis === 'block-print' ? accent : undefined }}
            >
                <p
                    className={`break-words text-[11px] leading-snug text-zinc-100 ${
                        emphasis === 'block-print' ? 'font-bold uppercase tracking-wide' : ''
                    }`}
                >
                    {cleaned}
                </p>
                {conviction !== null && conviction !== undefined && (
                    <span
                        className="mt-1 inline-flex items-center gap-1 rounded border border-white/10 bg-zinc-950/70 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300"
                        title="Sealed conviction (0-100)"
                    >
                        <span className="text-[8px] uppercase tracking-widest text-zinc-500">Conv</span>
                        <span className="tabular-nums">{conviction}</span>
                        <span className="h-1 w-8 overflow-hidden rounded-full bg-zinc-800">
                            <span className="block h-full rounded-full" style={{ width: `${conviction}%`, background: accent }} />
                        </span>
                    </span>
                )}
                {/* Tail — side-aware triangular pointer toward the seat.
                    Inline SVG so the path can be tuned per side without a
                    second stylesheet. */}
                <svg
                    aria-hidden="true"
                    data-testid="speech-bubble-tail"
                    data-side={side}
                    className={`pointer-events-none absolute -bottom-2 ${tailClass} h-3 w-4`}
                    viewBox="0 0 16 12"
                    preserveAspectRatio="none"
                >
                    <path
                        d={tailPath(side)}
                        fill="rgba(24,24,27,0.95)"
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth="1"
                    />
                </svg>
            </div>
        </div>
    );
};

/**
 * Tail path for each side. The bubble is `bottom-full` of the seat, so
 * the tail is on the bubble's BOTTOM edge and points DOWN at the seat.
 * - left   : tail hugs the bubble's left edge, points down-left.
 * - right  : tail hugs the bubble's right edge, points down-right.
 * - center : tail is centered, points straight down.
 */
const tailPath = (side: 'left' | 'right' | 'center'): string => {
    if (side === 'left') {
        // Triangle with hypotenuse running from the bubble's left side
        // down to the seat. Origin at top-left of the SVG.
        return 'M 2 0 L 14 0 L 2 12 Z';
    }
    if (side === 'right') {
        return 'M 14 0 L 2 0 L 14 12 Z';
    }
    // center: symmetric downward triangle.
    return 'M 0 0 L 16 0 L 8 12 Z';
};

/** Default fade — exported for the floor's bubble lifecycle. */
export const SPEECH_BUBBLE_FADE_MS = FADE_MS;

export default SpeechBubble;
