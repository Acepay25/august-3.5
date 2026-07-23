import { useState } from 'react';

/**
 * Custom hook that encapsulates all UI visibility and progress state.
 * Extracted from App.tsx to reduce component complexity.
 * These are simple boolean flags with no side effects or complex dependencies.
 */
export function useUIState() {
    // ─── Modal / Panel Visibility ─────────────────────────────────────────
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const [isStrategySearchVisible, setIsStrategySearchVisible] = useState(false);
    const [isSavedAnalysesVisible, setIsSavedAnalysesVisible] = useState(false);
    const [isSettingsMenuVisible, setIsSettingsMenuVisible] = useState(false);
    const [isLiveMarketVisible, setIsLiveMarketVisible] = useState(false);
    const [isAdvancedAnalyticsOpen, setIsAdvancedAnalyticsOpen] = useState(false);
    const [isVersionHistoryVisible, setIsVersionHistoryVisible] = useState(false);
    const [isLiveAnalysisVisible, setIsLiveAnalysisVisible] = useState(false);
    const [isLivePostMortemVisible, setIsLivePostMortemVisible] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [showMismatchModal, setShowMismatchModal] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isLeverageDropdownOpen, setIsLeverageDropdownOpen] = useState(false);
    const [isVisionDataVisible, setIsVisionDataVisible] = useState(false);
    const [showUpdateNotification, setShowUpdateNotification] = useState(false);
    const [showAccuracyModal, setShowAccuracyModal] = useState(false);
    const [showScrollDown, setShowScrollDown] = useState(false);
    const [showScrollUp, setShowScrollUp] = useState(false);

    // ─── Loading / Progress State ─────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(false);
    const [isHybridLoading, setIsHybridLoading] = useState(false);
    const [isCalculatingAIProbabilities, setIsCalculatingAIProbabilities] = useState(false);
    const [isAnalysisTypingComplete, setIsAnalysisTypingComplete] = useState(false);
    const [isPostMortemTypingComplete, setIsPostMortemTypingComplete] = useState(false);
    const [isAnalysisInProgress, setIsAnalysisInProgress] = useState(false);
    const [isPostMortemInProgress, setIsPostMortemInProgress] = useState(false);
    const [isSummaryInProgress, setIsSummaryInProgress] = useState(false);
    const [isInsightGenerating, setIsInsightGenerating] = useState(false);
    const [isAutoCapturing, setIsAutoCapturing] = useState(false);
    const [isUpdateAutoCapturing, setIsUpdateAutoCapturing] = useState(false);
    const [isEntryNotHitCapturing, setIsEntryNotHitCapturing] = useState(false);
    const [isRateLimited, setIsRateLimited] = useState(false);

    return {
        // Modal / Panel Visibility
        isUserModalOpen,
        setIsUserModalOpen,
        isHistoryVisible,
        setIsHistoryVisible,
        isStrategySearchVisible,
        setIsStrategySearchVisible,
        isSavedAnalysesVisible,
        setIsSavedAnalysesVisible,
        isSettingsMenuVisible,
        setIsSettingsMenuVisible,
        isLiveMarketVisible,
        setIsLiveMarketVisible,
        isAdvancedAnalyticsOpen,
        setIsAdvancedAnalyticsOpen,
        isVersionHistoryVisible,
        setIsVersionHistoryVisible,
        isLiveAnalysisVisible,
        setIsLiveAnalysisVisible,
        isLivePostMortemVisible,
        setIsLivePostMortemVisible,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        showMismatchModal,
        setShowMismatchModal,
        isFullscreen,
        setIsFullscreen,
        isLeverageDropdownOpen,
        setIsLeverageDropdownOpen,
        isVisionDataVisible,
        setIsVisionDataVisible,
        showUpdateNotification,
        setShowUpdateNotification,
        showAccuracyModal,
        setShowAccuracyModal,
        showScrollDown,
        setShowScrollDown,
        showScrollUp,
        setShowScrollUp,

        // Loading / Progress State
        isLoading,
        setIsLoading,
        isHybridLoading,
        setIsHybridLoading,
        isCalculatingAIProbabilities,
        setIsCalculatingAIProbabilities,
        isAnalysisTypingComplete,
        setIsAnalysisTypingComplete,
        isPostMortemTypingComplete,
        setIsPostMortemTypingComplete,
        isAnalysisInProgress,
        setIsAnalysisInProgress,
        isPostMortemInProgress,
        setIsPostMortemInProgress,
        isSummaryInProgress,
        setIsSummaryInProgress,
        isInsightGenerating,
        setIsInsightGenerating,
        isAutoCapturing,
        setIsAutoCapturing,
        isUpdateAutoCapturing,
        setIsUpdateAutoCapturing,
        isEntryNotHitCapturing,
        setIsEntryNotHitCapturing,
        isRateLimited,
        setIsRateLimited,
    };
}

export type UIState = ReturnType<typeof useUIState>;
