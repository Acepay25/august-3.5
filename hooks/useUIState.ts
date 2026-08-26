import { useReducer, useCallback, useMemo } from 'react';

// =============================================================================
// STATE SHAPE
// =============================================================================

interface UIStateShape {
    // Modal / Panel Visibility
    isUserModalOpen: boolean;
    isStrategySearchVisible: boolean;
    isSavedAnalysesVisible: boolean;
    isSettingsMenuVisible: boolean;
    isLiveMarketVisible: boolean;
    isAdvancedAnalyticsOpen: boolean;
    isVersionHistoryVisible: boolean;
    isLivePostMortemVisible: boolean;
    isMobileMenuOpen: boolean;
    showMismatchModal: boolean;
    isVisionDataVisible: boolean;
    showAccuracyModal: boolean;
    showScrollDown: boolean;
    showScrollUp: boolean;

    // Loading / Progress State
    isLoading: boolean;
    isHybridLoading: boolean;
    isCalculatingAIProbabilities: boolean;
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
    isStrategySearchVisible: false,
    isSavedAnalysesVisible: false,
    isSettingsMenuVisible: false,
    isLiveMarketVisible: false,
    isAdvancedAnalyticsOpen: false,
    isVersionHistoryVisible: false,
    isLivePostMortemVisible: false,
    isMobileMenuOpen: false,
    showMismatchModal: false,
    isVisionDataVisible: false,
    showAccuracyModal: false,
    showScrollDown: false,
    showScrollUp: false,
    isLoading: false,
    isHybridLoading: false,
    isCalculatingAIProbabilities: false,
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
    | { type: 'SET_FUNCTIONAL'; key: keyof UIStateShape; fn: (prev: boolean) => boolean }
    | { type: 'TOGGLE'; key: keyof UIStateShape }
    | { type: 'CLOSE_ALL_OVERLAYS' }
    | { type: 'RESET_PROGRESS' };

/** Keys that are overlays (modals, drawers, panels) — closed by CLOSE_ALL_OVERLAYS */
const OVERLAY_KEYS: (keyof UIStateShape)[] = [
    'isStrategySearchVisible',
    'isSavedAnalysesVisible',
    'isSettingsMenuVisible',
    'isLiveMarketVisible',
    'isAdvancedAnalyticsOpen',
    'isVersionHistoryVisible',
    'isLivePostMortemVisible',
    'isMobileMenuOpen',
    'showMismatchModal',
    'isVisionDataVisible',
    'showAccuracyModal',
];

/** Keys that are progress/loading flags — reset by RESET_PROGRESS */
const PROGRESS_KEYS: (keyof UIStateShape)[] = [
    'isLoading',
    'isHybridLoading',
    'isCalculatingAIProbabilities',
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

        case 'SET_FUNCTIONAL':
            return { ...state, [action.key]: action.fn(state[action.key]) };

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

    // Generate setter functions that match the old useState API.
    // Built once via useMemo (the setters depend only on the stable
    // dispatch) — a useCallback-per-key loop would call a hook inside a
    // loop, which only works while initialState stays a compile-time
    // constant and trips react-hooks linting.
    // Functional updates dispatch SET_FUNCTIONAL so the reducer computes
    // the new value from its OWN latest state — avoiding the stale closure
    // bug where render-time `state[key]` was used instead.
    const setters = useMemo(() => {
        const map = {} as { [K in keyof UIStateShape as `set${Capitalize<string & K>}`]: (value: boolean | ((prev: boolean) => boolean)) => void };
        for (const key of Object.keys(initialState) as (keyof UIStateShape)[]) {
            const setterName = `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof map;
            // The cast is required: the mapped type keys can't be narrowed to
            // a concrete call signature per setter.
            map[setterName] = ((value: boolean | ((prev: boolean) => boolean)) => {
                if (typeof value === 'function') {
                    dispatch({ type: 'SET_FUNCTIONAL', key, fn: value });
                } else {
                    dispatch({ type: 'SET', key, value });
                }
            }) as any;
        }
        return map;
    }, [dispatch]);

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
