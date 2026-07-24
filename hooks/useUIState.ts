import { useReducer, useCallback } from 'react';

// =============================================================================
// STATE SHAPE
// =============================================================================

interface UIStateShape {
    // Modal / Panel Visibility
    isUserModalOpen: boolean;
    isHistoryVisible: boolean;
    isStrategySearchVisible: boolean;
    isSavedAnalysesVisible: boolean;
    isSettingsMenuVisible: boolean;
    isLiveMarketVisible: boolean;
    isAdvancedAnalyticsOpen: boolean;
    isVersionHistoryVisible: boolean;
    isLiveAnalysisVisible: boolean;
    isLivePostMortemVisible: boolean;
    isMobileMenuOpen: boolean;
    showMismatchModal: boolean;
    isFullscreen: boolean;
    isLeverageDropdownOpen: boolean;
    isVisionDataVisible: boolean;
    showUpdateNotification: boolean;
    showAccuracyModal: boolean;
    showScrollDown: boolean;
    showScrollUp: boolean;

    // Loading / Progress State
    isLoading: boolean;
    isHybridLoading: boolean;
    isCalculatingAIProbabilities: boolean;
    isAnalysisTypingComplete: boolean;
    isPostMortemTypingComplete: boolean;
    isAnalysisInProgress: boolean;
    isPostMortemInProgress: boolean;
    isSummaryInProgress: boolean;
    isInsightGenerating: boolean;
    isAutoCapturing: boolean;
    isUpdateAutoCapturing: boolean;
    isEntryNotHitCapturing: boolean;
    isRateLimited: boolean;
}

const initialState: UIStateShape = {
    isUserModalOpen: false,
    isHistoryVisible: false,
    isStrategySearchVisible: false,
    isSavedAnalysesVisible: false,
    isSettingsMenuVisible: false,
    isLiveMarketVisible: false,
    isAdvancedAnalyticsOpen: false,
    isVersionHistoryVisible: false,
    isLiveAnalysisVisible: false,
    isLivePostMortemVisible: false,
    isMobileMenuOpen: false,
    showMismatchModal: false,
    isFullscreen: false,
    isLeverageDropdownOpen: false,
    isVisionDataVisible: false,
    showUpdateNotification: false,
    showAccuracyModal: false,
    showScrollDown: false,
    showScrollUp: false,
    isLoading: false,
    isHybridLoading: false,
    isCalculatingAIProbabilities: false,
    isAnalysisTypingComplete: false,
    isPostMortemTypingComplete: false,
    isAnalysisInProgress: false,
    isPostMortemInProgress: false,
    isSummaryInProgress: false,
    isInsightGenerating: false,
    isAutoCapturing: false,
    isUpdateAutoCapturing: false,
    isEntryNotHitCapturing: false,
    isRateLimited: false,
};

// =============================================================================
// ACTIONS
// =============================================================================

type UIAction =
    | { type: 'SET'; key: keyof UIStateShape; value: boolean }
    | { type: 'TOGGLE'; key: keyof UIStateShape }
    | { type: 'CLOSE_ALL_OVERLAYS' }
    | { type: 'RESET_PROGRESS' };

/** Keys that are overlays (modals, drawers, panels) — closed by CLOSE_ALL_OVERLAYS */
const OVERLAY_KEYS: (keyof UIStateShape)[] = [
    'isHistoryVisible',
    'isStrategySearchVisible',
    'isSavedAnalysesVisible',
    'isSettingsMenuVisible',
    'isLiveMarketVisible',
    'isAdvancedAnalyticsOpen',
    'isVersionHistoryVisible',
    'isLiveAnalysisVisible',
    'isLivePostMortemVisible',
    'isMobileMenuOpen',
    'showMismatchModal',
    'isVisionDataVisible',
    'showAccuracyModal',
    'isLeverageDropdownOpen',
];

/** Keys that are progress/loading flags — reset by RESET_PROGRESS */
const PROGRESS_KEYS: (keyof UIStateShape)[] = [
    'isLoading',
    'isHybridLoading',
    'isCalculatingAIProbabilities',
    'isAnalysisTypingComplete',
    'isPostMortemTypingComplete',
    'isAnalysisInProgress',
    'isPostMortemInProgress',
    'isSummaryInProgress',
    'isInsightGenerating',
    'isAutoCapturing',
    'isUpdateAutoCapturing',
    'isEntryNotHitCapturing',
];

function uiReducer(state: UIStateShape, action: UIAction): UIStateShape {
    switch (action.type) {
        case 'SET':
            return { ...state, [action.key]: action.value };

        case 'TOGGLE':
            return { ...state, [action.key]: !state[action.key] };

        case 'CLOSE_ALL_OVERLAYS': {
            const next = { ...state };
            for (const key of OVERLAY_KEYS) {
                next[key] = false;
            }
            return next;
        }

        case 'RESET_PROGRESS': {
            const next = { ...state };
            for (const key of PROGRESS_KEYS) {
                next[key] = false;
            }
            return next;
        }

        default:
            return state;
    }
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Custom hook that encapsulates all UI visibility and progress state.
 * Uses a single useReducer for predictable, auditable transitions.
 *
 * Backward-compatible: returns the same { isX, setIsX } shape as before.
 */
export function useUIState() {
    const [state, dispatch] = useReducer(uiReducer, initialState);

    // Generate setter functions that match the old useState API
    const setters = {} as { [K in keyof UIStateShape as `set${Capitalize<string & K>}`]: (value: boolean | ((prev: boolean) => boolean)) => void };

    for (const key of Object.keys(initialState) as (keyof UIStateShape)[]) {
        const setterName = `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof setters;
        setters[setterName] = (value: boolean | ((prev: boolean) => boolean)) => {
            if (typeof value === 'function') {
                // Functional update: read current state and compute
                dispatch({ type: 'SET', key, value: value(state[key]) });
            } else {
                dispatch({ type: 'SET', key, value });
            }
        };
    }

    // Convenience actions
    const closeAllOverlays = useCallback(() => dispatch({ type: 'CLOSE_ALL_OVERLAYS' }), []);
    const resetProgress = useCallback(() => dispatch({ type: 'RESET_PROGRESS' }), []);

    return {
        ...state,
        ...setters,
        closeAllOverlays,
        resetProgress,
    };
}

export type UIState = ReturnType<typeof useUIState>;
