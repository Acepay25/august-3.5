/**
 * useJournalUI — manages journal panel state and message expansion toggles.
 * Extracted from App.tsx to reduce component complexity.
 */

import { useState } from 'react';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';

/** Journal panel route state — consumed only for its `tab` vocabulary since
 *  the surface router owns opening (journalState was deleted after the dead
 *  overlay branch went; audit 2026-09-15). focusTradeId deep-links the
 *  Think tab to one analysis. */
export interface JournalUIState {
    tab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models' | 'reasoning';
    focusTradeId?: string;
}

export function useJournalUI() {
    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null);
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [highlightedAnalysisId, setHighlightedAnalysisId] = useState<string | null>(null);
    const [expandedPostMortemImages, setExpandedPostMortemImages] = useState<Record<string, boolean>>({});
    const [expandedPostMortems, setExpandedPostMortems] = useState<Record<string, boolean>>({});
    const [postMortemCandidate, setPostMortemCandidate] = useState<PostMortemCandidate | null>(null);

    return {
        selectedProbabilityMessageId, setSelectedProbabilityMessageId,
        strategyToView, setStrategyToView,
        copiedMessageId, setCopiedMessageId,
        highlightedAnalysisId, setHighlightedAnalysisId,
        expandedPostMortemImages, setExpandedPostMortemImages,
        expandedPostMortems, setExpandedPostMortems,
        postMortemCandidate, setPostMortemCandidate,
    };
}
