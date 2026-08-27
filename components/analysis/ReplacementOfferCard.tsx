import React from 'react';
import { ReplacementOffer } from '../../types/message';

interface ReplacementOfferCardProps {
    offer: ReplacementOffer;
    /** Parent binds the message id — the card only reports the provider choice. */
    onChoice: (providerId: string | null) => void;
    className?: string;
}

/**
 * Mid-debate analyst replacement: the engine suspends until a candidate is
 * picked or skipped, so the choice renders BOTH in the chat bubble and at the
 * top of the debate side panel — whichever surface the user is watching.
 */
const ReplacementOfferCard: React.FC<ReplacementOfferCardProps> = ({ offer, onChoice, className = '' }) => (
    <div className={`status-surface rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 ${className}`.trim()}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-medium text-amber-300">
                {offer.droppedName} dropped out (round {offer.round})
            </span>
            <span className="text-[11px] text-zinc-400">Pick a replacement analyst to continue:</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {offer.candidates.map(candidate => {
                const chosen = offer.chosenProviderId === candidate.providerId;
                const disabled = Boolean(offer.chosenProviderId);
                return (
                    <button
                        key={candidate.providerId}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChoice(candidate.providerId)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            chosen
                                ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
                                : disabled
                                    ? 'border-white/5 bg-zinc-800/40 text-zinc-600'
                                    : 'border-white/10 bg-zinc-800 text-zinc-200 hover:border-amber-400/40 hover:text-amber-200'
                        }`}
                    >
                        {chosen ? 'Analyzing…' : `${candidate.displayName} · ${candidate.modelId}`}
                    </button>
                );
            })}
            {!offer.chosenProviderId && (
                <button
                    type="button"
                    onClick={() => onChoice(null)}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200"
                >
                    Continue without
                </button>
            )}
        </div>
    </div>
);

export default ReplacementOfferCard;
