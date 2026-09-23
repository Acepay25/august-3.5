
import React from 'react';
import { Scale } from 'lucide-react';
import type { SkillEffectiveness } from '../../../services/learning/SkillMemoryService';

interface ReviewActionsSectionProps {
    skillReview: SkillEffectiveness[];
    /** File currently mid-action — disables its button and renders '…'. */
    applyingFileId: string | null;
    onApply: (fileId: string, fileName: string, recommendation: 'promote' | 'demote' | 'retire') => void;
    onRefine: (fileId: string, fileName: string) => void;
}

/**
 * Review actions: apply what the causal review recommends. 'refine' rows are
 * actionable too — a Refine button runs the LLM tighten pass instead of
 * rendering a dead-end recommendation.
 */
export const ReviewActionsSection: React.FC<ReviewActionsSectionProps> = ({
    skillReview, applyingFileId, onApply, onRefine,
}) => {
    const actionableReviews = skillReview.filter(r =>
        r.recommendation === 'promote' || r.recommendation === 'demote' || r.recommendation === 'retire' || r.recommendation === 'refine');

    return (
        <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
            <h4 className="text-ui-xs sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-cyan-400" /> Skill Review — Apply
            </h4>
            <p className="text-ui-xs text-zinc-600 mb-2">
                Causal verdicts (A/B eval + lift) outrank outcome correlation. Evidence still has the final say on the next closed trade.
            </p>
            {actionableReviews.length === 0
                ? <p className="text-xs text-zinc-600 italic">No actions recommended — every skill is where its evidence says it belongs.</p>
                : <div className="space-y-1.5">
                    {actionableReviews.slice(0, 8).map(r => (
                        <div key={r.fileId} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <span className={`text-ui-xs font-bold uppercase tracking-wider ${r.recommendation === 'retire' || r.recommendation === 'demote' ? 'text-red-400' : r.recommendation === 'refine' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                    {r.recommendation}
                                </span>
                                <span className="text-ui-dense text-zinc-300 ml-1.5 truncate inline-block max-w-[45%] align-bottom">{r.title}</span>
                                <p className="text-ui-xs text-zinc-600 truncate" title={r.rationale}>{r.rationale}</p>
                            </div>
                            {r.recommendation === 'refine' ? (
                                <button
                                    onClick={() => onRefine(r.fileId, r.title)}
                                    disabled={applyingFileId === r.fileId}
                                    className="shrink-0 px-2 py-1 rounded text-ui-xs font-bold uppercase tracking-wider border border-white/10 bg-zinc-900 text-zinc-300 hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
                                >
                                    {applyingFileId === r.fileId ? '…' : 'Refine'}
                                </button>
                            ) : (
                                <button
                                    onClick={() => onApply(r.fileId, r.title, r.recommendation as 'promote' | 'demote' | 'retire')}
                                    disabled={applyingFileId === r.fileId}
                                    className="shrink-0 px-2 py-1 rounded text-ui-xs font-bold uppercase tracking-wider border border-white/10 bg-zinc-900 text-zinc-300 hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
                                >
                                    {applyingFileId === r.fileId ? '…' : 'Apply'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>}
        </div>
    );
};

export default ReviewActionsSection;
