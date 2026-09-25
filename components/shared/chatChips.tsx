/**
 * The four small row controls the Chart AI dock and the Chat surface both
 * need. They were module-local to `TradeChatPanel.tsx` only because there was
 * one caller; with two surfaces rendering the same transcript furniture, they
 * live here so the hover behaviour and the copy affordance cannot drift.
 *
 * Every chip uses `group-hover/msg:opacity-100`, so the row must carry
 * `group/msg` for hover-reveal to work.
 */
import React, { useState } from 'react';
import { Check, Copy, Pin, RotateCcw } from 'lucide-react';
import { copyText } from '../../utils/clipboard';
import MarkdownContent from './MarkdownContent';

/** Hover chip on USER bubbles: re-run the turn from this message — the
 *  stale answer(s) after it are dropped and the model regenerates with
 *  fresh live context. */
export const RetryChip: React.FC<{ onRetry: () => void; className?: string }> = ({ onRetry, className = '' }) => (
    <button type="button"
        onClick={onRetry}
        aria-label="Retry this message"
        title="Retry — regenerate the answer"
        className={`flex items-center rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100 ${className}`.trim()}>
        <RotateCcw className="h-3 w-3" />
    </button>
);

export const CopyChip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button"
            onClick={() => { void copyText(text).then(ok => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1400); } }); }}
            aria-label="Copy message" title={copied ? 'Copied' : 'Copy this message'}
            className={`flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100 ${className}`.trim()}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
    );
};

/** Pin this verdict to the Pinned list. Unlike the copy/retry chips it stays
 *  visible once set: the hover-reveal helps you FIND the control, but hiding a
 *  pinned signal's own state would leave the list unexplainable. */
export const PinChip: React.FC<{ pinned: boolean; onToggle: () => void }> = ({ pinned, onToggle }) => (
    <button type="button"
        onClick={onToggle}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin this signal' : 'Pin this signal'}
        title={pinned
            ? 'Pinned — tracked in the Pinned list (header tray). Click to remove.'
            : 'Pin this signal to the Pinned list. It tracks the setup; it does not arm a price trigger.'}
        className={`flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui-xs transition-opacity hover:bg-white/[0.06] focus:opacity-100 ${
            pinned ? 'text-zinc-100' : 'text-zinc-500 opacity-0 hover:text-zinc-200 group-hover/msg:opacity-100'
        }`}>
        <Pin className="h-3 w-3" />
        <span>{pinned ? 'Pinned' : 'Pin'}</span>
    </button>
);

/** Every character the store holds, every render. The reveal used to be a
 *  requestAnimationFrame-driven prefix of the text, which silently withheld
 *  content: measured on a 4,800-char answer, only 1,728 characters were in the
 *  DOM while the window was hidden (rAF fired 0 times in 400ms). The tail was
 *  unrendered and therefore unscrollable, while the Copy chip — handed the
 *  full string — revealed that the model had answered completely. The chunks
 *  arriving from the provider already give the typewriter feel; the fade here
 *  is CSS-only and can never eat text. */
export const FadingText: React.FC<{ text: string; streaming: boolean; className?: string }> = ({ text, streaming, className }) => (
    <div className={streaming ? 'stream-fade' : undefined}>
        <MarkdownContent content={text} className={className ?? "!text-ui-sm [&_p]:my-1 [&_li]:text-ui-sm"} />
    </div>
);
