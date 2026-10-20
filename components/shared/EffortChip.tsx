/**
 * EffortChip — the thinking-effort dial: a quiet pill naming the current tier,
 * opening a radio menu.
 *
 * Lifted out of `panels/ChatComposer` alongside `ModelChip` for the same reason:
 * the tier decides whether the provider returns real reasoning at all — `low`
 * switches thinking OFF on the GLM and DeepSeek routes
 * (`reasoningControls.ts:281`, `:304`) — so a surface without the dial cannot
 * ask for reasoning it will then be shown as a text scratchpad. Two surfaces
 * driving one preference also means the value lives where both already look:
 * the chat session in `chatStore`, not in whichever component set it last.
 *
 * `auto` is deliberately still a choice: it means "whatever this task defaults
 * to" (`effortForTask('tradingDecision')` for the dock and the Chat surface —
 * the two homes that can present a plan), not a hidden fixed tier.
 */
import React, { useState } from 'react';
import { Check, ChevronDown } from './Icons';
import { EFFORT_CHOICES, effortChoiceOf, type EffortChoice } from './effortScale';

// The ladder has one owner — `effortScale.ts` — because the merged model panel
// prints the tier on its trigger and edits it on a slider, and a chip that kept
// its own copy of the labels would be a third place to disagree. Re-exported so
// every existing importer reads the same symbols as before.
export { EFFORT_CHOICES, effortChoiceOf, type EffortChoice };

export interface EffortChipProps {
    /** The session's stored tier — `'auto'` when the user has never picked. */
    value: EffortChoice;
    onChange: (id: EffortChoice) => void;
}

const EffortChip: React.FC<EffortChipProps> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const label = effortChoiceOf(value).label;
    return (
        <div className="relative">
            <button type="button" onClick={() => setOpen(v => !v)}
                aria-label={`Thinking effort: ${label}`}
                aria-expanded={open} aria-haspopup="menu"
                title={`Thinking effort: ${label}`}
                data-testid="composer-effort-chip"
                className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-zinc-900/60 px-2.5 py-1 text-ui-dense text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-200">
                <span className="whitespace-nowrap">{label}</span>
                <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-[var(--ease-snappy)] ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open && (
                <>
                    {/* The invisible-backdrop close the model chip uses: a menu
                        you can leave only by picking an item is a trap. It also
                        means the two chips cannot both be open — the first one
                        swallows the click on the other. */}
                    <div className="fixed inset-0 z-20" aria-hidden onClick={() => setOpen(false)} />
                    <div className="absolute bottom-8 right-0 z-30 w-40 rounded-bubble border border-white/10 bg-zinc-900 p-1 shadow-xl"
                        data-testid="effort-menu" role="menu" aria-label="Thinking effort"
                        onKeyDown={(e) => {
                            // Contain Escape: unhandled, it bubbles to the
                            // app-level shortcut that CANCELS a running analysis.
                            e.stopPropagation();
                            if (e.key === 'Escape') setOpen(false);
                        }}>
                        {EFFORT_CHOICES.map(c => (
                            <button key={c.id} type="button" role="menuitemradio"
                                aria-checked={value === c.id}
                                autoFocus={value === c.id}
                                onClick={() => { onChange(c.id); setOpen(false); }}
                                className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui-dense transition-colors hover:bg-white/[0.06] ${value === c.id ? 'text-zinc-100' : 'text-zinc-500'}`}>
                                <Check className={`h-3 w-3 shrink-0 ${value === c.id ? 'text-emerald-400' : 'opacity-0'}`} aria-hidden="true" />
                                {c.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default React.memo(EffortChip);
