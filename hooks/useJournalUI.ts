/**
 * useJournalUI — manages journal panel state and message expansion toggles.
 * Extracted from App.tsx to reduce component complexity.
 */

import { useState } from 'react';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';

export function useJournalUI() {
    const [journalState, setJournalState] = useState<{ isOpen: boolean, tab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' }>({ isOpen: false, tab: 'log' });

    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null);
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [highlightedAnalysisId, setHighlightedAnalysisId] = useState<string | null>(null);
    const [expandedIndividualThoughts, setExpandedIndividualThoughts] = useState<Record<string, boolean>>({});
    const [expandedDebateTranscripts, setExpandedDebateTranscripts] = useState<Record<string, boolean>>({});
    const [expandedPostMortemImages, setExpandedPostMortemImages] = useState<Record<string, boolean>>({});
    const [expandedPostMortems, setExpandedPostMortems] = useState<Record<string, boolean>>({});
    const [collapsedUserMessages, setCollapsedUserMessages] = useState<Record<string, boolean>>({});
    const [postMortemCandidate, setPostMortemCandidate] = useState<PostMortemCandidate | null>(null);

    return {
        journalState, setJournalState,
        selectedProbabilityMessageId, setSelectedProbabilityMessageId,
        strategyToView, setStrategyToView,
        copiedMessageId, setCopiedMessageId,
        highlightedAnalysisId, setHighlightedAnalysisId,
        expandedIndividualThoughts, setExpandedIndividualThoughts,
        expandedDebateTranscripts, setExpandedDebateTranscripts,
        expandedPostMortemImages, setExpandedPostMortemImages,
        expandedPostMortems, setExpandedPostMortems,
        collapsedUserMessages, setCollapsedUserMessages,
        postMortemCandidate, setPostMortemCandidate,
    };
}
