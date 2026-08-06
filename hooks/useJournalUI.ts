/**
 * useJournalUI — manages journal panel state and message expansion toggles.
 * Extracted from App.tsx to reduce component complexity.
 */

import { useState } from 'react';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';

/** Journal panel state. focusTradeId deep-links the Think tab to one analysis. */
export interface JournalUIState {
    isOpen: boolean;
    tab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models' | 'reasoning';
    focusTradeId?: string;
}

export function useJournalUI() {
    const [journalState, setJournalState] = useState<JournalUIState>({ isOpen: false, tab: 'log' });

    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null);
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [highlightedAnalysisId, setHighlightedAnalysisId] = useState<string | null>(null);
    const [expandedPostMortemImages, setExpandedPostMortemImages] = useState<Record<string, boolean>>({});
    const [expandedPostMortems, setExpandedPostMortems] = useState<Record<string, boolean>>({});
    const [postMortemCandidate, setPostMortemCandidate] = useState<PostMortemCandidate | null>(null);

    return {
        journalState, setJournalState,
        selectedProbabilityMessageId, setSelectedProbabilityMessageId,
        strategyToView, setStrategyToView,
        copiedMessageId, setCopiedMessageId,
        highlightedAnalysisId, setHighlightedAnalysisId,
        expandedPostMortemImages, setExpandedPostMortemImages,
        expandedPostMortems, setExpandedPostMortems,
        postMortemCandidate, setPostMortemCandidate,
    };
}
