/**
 * The small row controls the Chart AI dock and the Chat surface both need. They
 * were module-local to `TradeChatPanel.tsx` only because there was one caller;
 * with two surfaces rendering the same transcript furniture, they live here so
 * the copy affordance and the row's visibility cannot drift.
 *
 * These chips are PERMANENTLY visible — the action row is always on, per the
 * reference. They used to be hover-released, which hid copy from anyone who did
 * not know to hunt for it; `group/msg` is gone from every caller, so a row does
 * not need a group class to make them appear.
 */
import React, { useEffect, useState } from 'react';
import { Check, Copy, Pin, RotateCcw, Square, Volume2 } from './Icons';
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
        className={`flex items-center hit-target rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${className}`.trim()}>
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
    </button>
);

export const CopyChip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button"
            onClick={() => { void copyText(text).then(ok => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1400); } }); }}
            aria-label="Copy message" title={copied ? 'Copied' : 'Copy this message'}
            className={`flex items-center gap-1 hit-target rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${className}`.trim()}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
    );
};

/** Read this answer aloud.
 *
 *  A NEW capability, not chrome: `window.speechSynthesis` returns zero matches
 *  repo-wide before this, so nothing here existed to reuse. Toggle to stop —
 *  pressing the same control again cancels the utterance — and the utterance is
 *  cancelled on unmount so navigating away mid-sentence cannot leave a voice
 *  reading a row the user is no longer looking at.
 *
 *  Where the API is absent (and in tests) the control is NOT drawn. A button
 *  that silently does nothing is exactly the dead control this project rejects;
 *  the caller renders nothing instead, which is honest. */
export const SpeakChip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const [speaking, setSpeaking] = useState(false);
    const available = typeof window !== 'undefined'
        && 'speechSynthesis' in window
        && typeof SpeechSynthesisUtterance !== 'undefined';
    useEffect(() => {
        if (!available) return undefined;
        const stop = (): void => setSpeaking(false);
        window.speechSynthesis.addEventListener('end', stop);
        window.speechSynthesis.addEventListener('error', stop);
        return () => {
            window.speechSynthesis.removeEventListener('end', stop);
            window.speechSynthesis.removeEventListener('error', stop);
            // Release the utterance on unmount rather than leaving it queued.
            window.speechSynthesis.cancel();
        };
    }, [available]);

    if (!available) return null;

    const toggle = (): void => {
        if (speaking) {
            window.speechSynthesis.cancel();
            setSpeaking(false);
            return;
        }
        // `speechSynthesis` existing does NOT imply the utterance constructor
        // exists — jsdom has the object and not the class, and some embedded
        // WebViews are the same shape. Without this guard the click throws and
        // takes the row's action handler with it.
        if (typeof SpeechSynthesisUtterance === 'undefined') return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setSpeaking(true);
    };

    return (
        <button type="button"
            onClick={toggle}
            aria-label={speaking ? 'Stop reading aloud' : 'Read this answer aloud'}
            title={speaking ? 'Stop reading aloud' : 'Read this answer aloud'}
            className={`flex items-center hit-target rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${speaking ? 'text-emerald-300' : ''} ${className}`.trim()}>
            {speaking ? <Square className="h-3 w-3" aria-hidden="true" /> : <Volume2 className="h-3 w-3" aria-hidden="true" />}
        </button>
    );
};

/** Pin this verdict to the Pinned list. Unlike the other chips it is the one
 *  whose state must stay legible: a pinned signal that hides its own pinned
 *  indicator would leave the Pinned list unexplainable. */
export const PinChip: React.FC<{ pinned: boolean; onToggle: () => void }> = ({ pinned, onToggle }) => (
    <button type="button"
        onClick={onToggle}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin this signal' : 'Pin this signal'}
        title={pinned
            ? 'Pinned — tracked in the Pinned list (header tray). Click to remove.'
            : 'Pin this signal to the Pinned list. It tracks the setup; it does not arm a price trigger.'}
        className={`flex items-center gap-1 hit-target rounded-control px-1.5 py-0.5 text-ui-xs transition-colors hover:bg-white/[0.06] ${
            pinned ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
        }`}>
        <Pin className="h-3 w-3" aria-hidden="true" />
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
