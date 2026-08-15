import { useCallback, useMemo, useState } from 'react';
import { Message } from '../types';

export interface CompareState {
    primaryId: string;
    secondaryId: string | null;
}

export const useCompareRuns = (messages: Message[]): {
    compareState: CompareState | null;
    comparePrimary: Message | null;
    compareSecondary: Message | null;
    handleCompareAnalysis: (messageId: string) => void;
    handlePickSecondary: (messageId: string) => void;
    closeCompare: () => void;
} => {
    const [compareState, setCompareState] = useState<CompareState | null>(null);

    const handleCompareAnalysis = useCallback((messageId: string) => {
        const analyses = messages.filter(m => m.analysis);
        const idx = analyses.findIndex(m => m.id === messageId);
        const previous = idx > 0 ? analyses[idx - 1] : analyses.find(m => m.id !== messageId);
        setCompareState({ primaryId: messageId, secondaryId: previous?.id ?? null });
    }, [messages]);

    const handlePickSecondary = useCallback((messageId: string) => {
        setCompareState(prev => (prev ? { ...prev, secondaryId: messageId } : prev));
    }, []);

    const closeCompare = useCallback(() => setCompareState(null), []);

    const comparePrimary = useMemo(
        () => (compareState ? messages.find(m => m.id === compareState.primaryId) ?? null : null),
        [compareState, messages],
    );
    const compareSecondary = useMemo(
        () => (compareState?.secondaryId ? messages.find(m => m.id === compareState.secondaryId) ?? null : null),
        [compareState, messages],
    );

    return {
        compareState,
        comparePrimary,
        compareSecondary,
        handleCompareAnalysis,
        handlePickSecondary,
        closeCompare,
    };
};
