/**
 * useJournalUI — manages journal panel state and message expansion toggles.
 * Extracted from App.tsx to reduce component complexity.
 *
 * The post-mortem expansion maps and the candidate that gated the upload modal
 * are gone: the post-mortem feature that filled them has been deleted.
 */

import { useState } from 'react';

/** Journal panel route state — consumed only for its `tab` vocabulary since
 *  the surface router owns opening (journalState was deleted after the dead
 *  overlay went; audit 2026-09-15). The tab set is the Journal's own:
 *  ledger, stats, saved. The old models/reasoning/learning/memory tabs are
 *  gone — model stats and the reasoning browser were deleted with them
 *  (2026-10-07) and the pattern memory lives on the Learn surface. */
export interface JournalUIState {
    tab: 'log' | 'analytics' | 'saved';
}

export function useJournalUI() {
    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null);
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

    return {
        selectedProbabilityMessageId, setSelectedProbabilityMessageId,
        strategyToView, setStrategyToView,
        copiedMessageId, setCopiedMessageId,
    };
}
