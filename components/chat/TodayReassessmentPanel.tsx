/**
 * TodayReassessmentPanel — "What would I do today?" on a post-mortem bubble.
 *
 * Idle (post-mortem complete, no reassessment yet): a button to launch the
 * fresh forward-looking re-assessment against today's market price.
 * In flight: a spinner state. Done: the verdict badge (would take / avoid /
 * maybe) + the model's reasoning.
 */

import React from 'react';
import { Message, TodayReassessment } from '../../types';
import { RefreshIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface TodayReassessmentPanelProps {
    message: Message;
    /** Message id currently running a reassessment (else null). */
    inFlight: string | null;
    onRequest: (messageId: string) => void;
}

const VERDICT_META: Record<TodayReassessment['verdict'], { label: string; badge: string }> = {
    YES: { label: 'Would take today', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
    NO: { label: 'Would avoid today', badge: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
    MAYBE: { label: 'Maybe — needs confirmation', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
};

const fmtPrice = (p: number): string =>
    p > 0 ? (p >= 1000 ? `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${p.toFixed(2)}`) : 'price unavailable';

const TodayReassessmentPanel: React.FC<TodayReassessmentPanelProps> = ({ message, inFlight, onRequest }) => {
    const reassessment = message.todayReassessment;

    if (!reassessment) {
        // Only offer on a completed post-mortem (never on the failed-candidate stub).
        // The report can land in `text` alone when SmoothText never completes on a
        // hidden/unmounted message — the reassessment hook falls back to text too.
        if (!message.isPostMortem || (!message.postMortem && !message.text) || message.postMortemFailedCandidate) return null;
        const loading = inFlight === message.id;
        return (
            <div className="mt-4 pt-3 border-t border-white/10">
                <button
                    onClick={() => onRequest(message.id)}
                    disabled={loading || inFlight != null}
                    className="px-3 py-2 rounded-lg border border-white/10 bg-zinc-700/80 text-zinc-300 hover:border-amber-400/25 hover:bg-amber-500/10 hover:text-amber-200 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Re-assess this setup against today's market price — would you still take it?"
                >
                    <RefreshIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                        {loading ? 'Assessing today’s market…' : 'What would I do today?'}
                    </span>
                </button>
            </div>
        );
    }

    const meta = VERDICT_META[reassessment.verdict];
    return (
        <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-black tracking-widest text-zinc-400 uppercase">
                    What would I do today?
                </span>
                <span className="text-[9px] font-mono text-zinc-500">
                    @ {fmtPrice(reassessment.price)} · {new Date(reassessment.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
            <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider mb-2 ${meta.badge}`}>
                {meta.label}
            </span>
            <MarkdownContent content={reassessment.text} className="text-zinc-200" />
        </div>
    );
};

export default React.memo(TodayReassessmentPanel);
