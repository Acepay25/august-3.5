
import React, { useState, useMemo, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Message, AccuracySubMode, AnalystLensConfig, AnalysisStep } from '../../../types';
import MessageItem, { ChatContextProps } from './MessageItem';
import { ChatInput } from './ChatInput';
import { QuickActionChips } from './QuickActionChips';
import { ArrowUpIcon, ArrowDownIcon, CloseIcon, LoadingIcon, EyeIcon, EditIcon, CheckIcon, TrashIcon } from '../shared/Icons';
import { ImageMetadata } from '../../../types';
import HybridDataPanel from '../analysis/HybridDataPanel';
import ImageViewerModal from '../modals/ImageViewerModal';
import AnalysisProgress from '../analysis/AnalysisProgress';

// Hoisted list components to prevent re-creation on each render
const ListHeader = () => <div className="h-16"></div>;
const ListFooter = () => <div className="h-32"></div>;

interface ChatAreaProps {
    messages: Message[];
    chatContext: ChatContextProps;
    virtuosoRef: React.RefObject<VirtuosoHandle>;
    isRateLimited: boolean;
    setIsRateLimited: (val: boolean) => void;
    showScrollDown: boolean;
    setShowScrollDown: (val: boolean) => void;
    showScrollUp: boolean;
    setShowScrollUp: (val: boolean) => void;
    handleCycleAnalysisUp: () => void;
    handleScrollToBottom: () => void;
    highlightedAnalysisId: string | null;
    setHighlightedAnalysisId: (id: string | null) => void;
    analysisMessages: Message[];
    loadingMessage: string | null;
    isAnalysisInProgress: boolean;
    isPostMortemInProgress: boolean;
    setIsLiveAnalysisVisible: (val: boolean) => void;
    setIsLivePostMortemVisible: (val: boolean) => void;
    handleCancelAnalysis: () => void;
    onDeleteMessages: (ids: string[]) => void;

    // ChatInput Props
    images: ImageMetadata[];
    removeImage: (index: number) => void;
    leverageRef: React.RefObject<HTMLDivElement | null>;
    setIsLeverageDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
    leverageInput: string;
    handleLeverageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    isLeverageDropdownOpen: boolean;
    handlePresetLeverage: (value: number) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    isImageUploadDisabled: boolean;
    handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    input: string;
    setInput: (value: string) => void;
    handleSendMessage: () => void;
    isSummarizing: boolean;
    isAnyProviderEnabled: boolean;
    isAccuracyModeEnabled: boolean;
    accuracySubMode?: AccuracySubMode;
    // Ensemble Intelligence Props
    isGeminiEnabled: boolean;
    setIsGeminiEnabled: (enabled: boolean) => void;
    isDeepSeekEnabled: boolean;
    setIsDeepSeekEnabled: (enabled: boolean) => void;
    isZhipuEnabled: boolean;
    setIsZhipuEnabled: (enabled: boolean) => void;
    isGroqEnabled: boolean;
    setIsGroqEnabled: (enabled: boolean) => void;
    isGroqNewEnabled: boolean;
    setIsGroqNewEnabled: (enabled: boolean) => void;
    isGroqAlt2Enabled: boolean;
    setIsGroqAlt2Enabled: (enabled: boolean) => void;
    isOpenrouterEnabled: boolean;
    setIsOpenrouterEnabled: (enabled: boolean) => void;
    isOpenaiEnabled: boolean;
    setIsOpenaiEnabled: (enabled: boolean) => void;
    isGrokNativeEnabled: boolean;
    setIsGrokNativeEnabled: (enabled: boolean) => void;
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    // Hybrid Intelligence Props
    hybridData?: any;
    isHybridLoading?: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    slOptimization?: any; // SL Optimization data for display
    suggestedEntryPrice?: number | null; // Entry Timing suggested entry price
    entryTimingScore?: {
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null;
    // Quick Action callbacks
    onNewConversation: () => void;
    onOpenJournal: () => void;
    onOpenLiveMarket: () => void;
    onOpenAnalytics: () => void;
    onInteract?: () => void;
    onSelectMessageForProbability?: (id: string) => void;
    // Analysis Progress (Task UI)
    analysisSteps?: AnalysisStep[];
    isAnalysisActive?: boolean;
}

const ChatAreaInner: React.FC<ChatAreaProps> = ({
    messages,
    chatContext,
    virtuosoRef,
    isRateLimited,
    setIsRateLimited,
    showScrollDown,
    setShowScrollDown,
    showScrollUp,
    setShowScrollUp,
    handleCycleAnalysisUp,
    handleScrollToBottom,
    highlightedAnalysisId,
    setHighlightedAnalysisId,
    analysisMessages,
    loadingMessage,
    isAnalysisInProgress,
    isPostMortemInProgress,
    setIsLiveAnalysisVisible,
    setIsLivePostMortemVisible,
    handleCancelAnalysis,
    onDeleteMessages,
    // ChatInput Props
    images,
    removeImage,
    leverageRef,
    setIsLeverageDropdownOpen,
    leverageInput,
    handleLeverageChange,
    handleLeverageBlur,
    isLeverageDropdownOpen,
    handlePresetLeverage,
    fileInputRef,
    isImageUploadDisabled,
    handleImageUpload,
    input,
    setInput,
    handleSendMessage,
    isSummarizing,
    isAnyProviderEnabled,
    isAccuracyModeEnabled,
    accuracySubMode,
    isGeminiEnabled,
    setIsGeminiEnabled,
    isDeepSeekEnabled,
    setIsDeepSeekEnabled,
    isZhipuEnabled,
    setIsZhipuEnabled,
    isGroqEnabled,
    setIsGroqEnabled,
    isGroqNewEnabled,
    setIsGroqNewEnabled,
    isGroqAlt2Enabled,
    setIsGroqAlt2Enabled,
    isOpenrouterEnabled,
    setIsOpenrouterEnabled,
    isOpenaiEnabled,
    setIsOpenaiEnabled,
    isGrokNativeEnabled,
    setIsGrokNativeEnabled,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig,
    hybridData,
    isHybridLoading,
    hybridConnectionStatus,
    slOptimization,
    suggestedEntryPrice,
    entryTimingScore,
    onNewConversation,
    onOpenJournal,
    onOpenLiveMarket,
    onOpenAnalytics,
    onInteract,
    onSelectMessageForProbability,
    analysisSteps,
    isAnalysisActive
}) => {
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);

    const handleToggleSelection = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedIds.size === messages.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(messages.map(m => m.id)));
        }
    }, [messages, selectedIds]);

    const handleDeleteSelected = useCallback(() => {
        onDeleteMessages(Array.from(selectedIds));
        setSelectedIds(new Set());
        setIsSelectionMode(false);
    }, [selectedIds, onDeleteMessages]);

    const handleCancelSelection = useCallback(() => {
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    }, []);

    const enhancedContext = useMemo(() => ({
        ...chatContext,
        isSelectionMode,
        selectedMessageIds: selectedIds,
        onToggleMessageSelection: handleToggleSelection,
        onViewImage: (url: string) => setViewerImageUrl(url),
        onSelectMessageForProbability
    }), [chatContext, isSelectionMode, selectedIds, handleToggleSelection, onSelectMessageForProbability]);

    // Dynamic Introduction Text based on mode
    const INTRO_TEXT_STANDARD = "Welcome! I am August. I can work as a single analyst or as a collaborative ensemble. For a full analysis, please upload your 4H, 1H, and 15M OKX charts and state your request.";
    const INTRO_TEXT_ACCURACY_ORIGINAL = "Accuracy Mode activated. August will now apply strict rule-based logic, multi-timeframe validation, and structured confirmations. Please upload your charts or provide your market data for a precise and disciplined analysis.";
    const INTRO_TEXT_PURE_AI = "Pure AI Mode enabled. August will analyze your request using fully autonomous reasoning, adaptive learning, and pattern synthesis. Upload your charts or input your data for an unrestricted and intuitive AI-driven analysis.";

    const getIntroText = useCallback(() => {
        if (!isAccuracyModeEnabled) return INTRO_TEXT_STANDARD;
        return accuracySubMode === 'pure_ai' ? INTRO_TEXT_PURE_AI : INTRO_TEXT_ACCURACY_ORIGINAL;
    }, [isAccuracyModeEnabled, accuracySubMode]);

    // Process messages to dynamically replace intro text
    const processedMessages = useMemo(() => {
        return messages.map(msg => {
            if (msg.id === 'init') {
                return { ...msg, text: getIntroText() };
            }
            return msg;
        });
    }, [messages, getIntroText]);

    return (
        <div
            className={`flex-1 relative min-h-0 flex flex-col bg-transparent transition-colors duration-500`}
            onClick={onInteract}
            onTouchStart={onInteract}
        >
            {/* Selection Toolbar */}
            {isSelectionMode ? (
                <div className="absolute top-4 left-4 right-4 z-40 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-xl p-3 flex items-center justify-between shadow-2xl animate-fade-in">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSelectAll}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${selectedIds.size > 0 && selectedIds.size === messages.length ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-white'}`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedIds.size > 0 && selectedIds.size === messages.length ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-500'}`}>
                                {selectedIds.size > 0 && selectedIds.size === messages.length && <CheckIcon className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider">Select All</span>
                        </button>
                        <span className="text-sm font-medium text-zinc-300 ml-2">{selectedIds.size} Selected</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedIds.size === 0}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <TrashIcon className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Delete</span>
                        </button>
                        <button
                            onClick={handleCancelSelection}
                            className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            ) : (
                messages.length > 0 && (
                    <button
                        onClick={() => setIsSelectionMode(true)}
                        className="absolute top-4 right-6 z-30 p-2 bg-zinc-800/80 backdrop-blur-md text-zinc-400 border border-white/10 rounded-xl shadow-lg hover:bg-white/10 hover:text-cyan-400 hover:scale-105 transition-all"
                        title="Manage Messages"
                    >
                        <EditIcon className="w-4 h-4" />
                    </button>
                )
            )}

            <Virtuoso
                ref={virtuosoRef}
                data={processedMessages}
                context={enhancedContext}
                itemContent={(index, message, context) => <MessageItem message={message} context={context} />}
                followOutput="smooth"
                atBottomStateChange={(atBottom) => setShowScrollDown(!atBottom)}
                atTopStateChange={(atTop) => setShowScrollUp(!atTop && analysisMessages.length > 0)}
                style={{ height: '100%', width: '100%' }}
                increaseViewportBy={200}
                components={{
                    Header: ListHeader,
                    Footer: ListFooter
                }}
            />

            {/* Accuracy Mode Banner Overlay - Positioned Fixed/Absolute at top of chat area */}
            {isAccuracyModeEnabled && !isSelectionMode && (
                <div className="absolute top-0 left-0 right-0 pointer-events-none flex justify-center pt-2 z-10">
                    <div className="border px-4 py-1 rounded-full backdrop-blur-md shadow-lg bg-cyan-900/40 border-cyan-500/30">
                        <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-cyan-300">
                            {accuracySubMode === 'pure_ai' ? 'Accuracy Mode: Pure AI Reasoning' : 'Accuracy Mode: Strict Protocol'}
                        </span>
                    </div>
                </div>
            )}

            {isRateLimited && <div className="absolute top-16 left-4 right-4 z-10 bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl flex items-center justify-between mb-6 animate-fade-in" role="alert"><span><strong>Rate Limit Exceeded:</strong> Please wait a moment.</span><button onClick={() => setIsRateLimited(false)} className="text-red-200 hover:text-white ml-4"><CloseIcon /></button></div>}

            <div className="fixed bottom-40 right-6 z-30 flex flex-col gap-2">
                {showScrollUp && !isSelectionMode && (
                    <button
                        onClick={handleCycleAnalysisUp}
                        className="w-9 h-9 bg-zinc-800/80 hover:bg-zinc-700 backdrop-blur-md text-zinc-400 hover:text-white border border-zinc-700/50 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
                        aria-label="Cycle to previous analysis"
                        title={highlightedAnalysisId ? "Jump to previous analysis" : "Jump to latest analysis"}
                    >
                        <ArrowUpIcon className="h-4 w-4" />
                    </button>
                )}
                {showScrollDown && !isSelectionMode && (
                    <button
                        onClick={handleScrollToBottom}
                        className="w-9 h-9 bg-zinc-800/80 hover:bg-zinc-700 backdrop-blur-md text-zinc-400 hover:text-white border border-zinc-700/50 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
                        aria-label="Scroll to bottom"
                        title="Scroll to bottom"
                    >
                        <ArrowDownIcon className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Hybrid Intelligence Connection Status - Always visible */}
            <HybridDataPanel
                data={hybridData}
                isLoading={isHybridLoading}
                connectionStatus={hybridConnectionStatus}
                slOptimization={slOptimization}
                suggestedEntryPrice={suggestedEntryPrice}
                entryTimingScore={entryTimingScore}
            />

            {loadingMessage ? (
                <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-4 pointer-events-none z-10">
                    <div className="max-w-4xl mx-auto pointer-events-auto">
                        {analysisSteps && analysisSteps.length > 0 ? (
                            <AnalysisProgress
                                steps={analysisSteps}
                                isActive={!!loadingMessage}
                                onCancel={handleCancelAnalysis}
                                isPostMortem={isPostMortemInProgress}
                                isAnalysisInProgress={isAnalysisInProgress}
                                isPostMortemInProgress={isPostMortemInProgress}
                                onOpenLiveView={() => setIsLiveAnalysisVisible(true)}
                                onOpenPostMortem={() => setIsLivePostMortemVisible(true)}
                            />
                        ) : (
                            /* Fallback: original spinner overlay when no step data */
                            <div className="flex flex-col items-center justify-center p-6 glass rounded-2xl shadow-[0_0_50px_-12px_rgba(34,211,238,0.2)] animate-fade-in border-t border-cyan-500/20">
                                <div className="relative">
                                    <div className="absolute inset-0 blur-xl opacity-20 animate-pulse bg-cyan-500"></div>
                                    <LoadingIcon className="h-8 w-8 relative z-10 text-cyan-400" />
                                </div>
                                <p className="mt-3 font-mono text-sm animate-pulse text-cyan-300">{loadingMessage}</p>
                                <div className="flex items-center gap-4 mt-4">
                                    {isAnalysisInProgress && <button onClick={() => setIsLiveAnalysisVisible(true)} className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-medium py-1.5 px-4 rounded-full text-xs transition-all uppercase tracking-wide"><EyeIcon />Live View</button>}
                                    {isPostMortemInProgress && <button onClick={() => setIsLivePostMortemVisible(true)} className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-medium py-1.5 px-4 rounded-full text-xs transition-all uppercase tracking-wide"><EyeIcon />View Post-Mortem</button>}
                                    <button onClick={handleCancelAnalysis} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 font-medium py-1.5 px-4 rounded-full text-xs transition-all uppercase tracking-wide">Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* Quick Action Chips - positioned above ChatInput */}
                    <div className="absolute bottom-[140px] lg:bottom-[180px] left-0 right-0 px-3 sm:px-4 lg:px-0 pointer-events-none z-10 lg:w-full lg:max-w-3xl lg:mx-auto">
                        <div className="w-full pointer-events-auto">
                            <QuickActionChips
                                onNewAnalysis={onNewConversation}
                                onOpenJournal={onOpenJournal}
                                onOpenLiveMarket={onOpenLiveMarket}
                                onOpenAnalytics={onOpenAnalytics}
                                isDisabled={!!loadingMessage}
                            />
                        </div>
                    </div>
                    <ChatInput
                        images={images}
                        removeImage={removeImage}
                        leverageRef={leverageRef}
                        setIsLeverageDropdownOpen={setIsLeverageDropdownOpen}
                        leverageInput={leverageInput}
                        handleLeverageChange={handleLeverageChange}
                        handleLeverageBlur={handleLeverageBlur}
                        isLeverageDropdownOpen={isLeverageDropdownOpen}
                        handlePresetLeverage={handlePresetLeverage}
                        fileInputRef={fileInputRef}
                        isImageUploadDisabled={isImageUploadDisabled}
                        handleImageUpload={handleImageUpload}
                        input={input}
                        setInput={setInput}
                        handleSendMessage={handleSendMessage}
                        loadingMessage={loadingMessage}
                        isSummarizing={isSummarizing}
                        isRateLimited={isRateLimited}
                        isAnyProviderEnabled={isAnyProviderEnabled}
                        isGeminiEnabled={isGeminiEnabled}
                        setIsGeminiEnabled={setIsGeminiEnabled}
                        isDeepSeekEnabled={isDeepSeekEnabled}
                        setIsDeepSeekEnabled={setIsDeepSeekEnabled}
                        isZhipuEnabled={isZhipuEnabled}
                        setIsZhipuEnabled={setIsZhipuEnabled}
                        isGroqEnabled={isGroqEnabled}
                        setIsGroqEnabled={setIsGroqEnabled}
                        isGroqNewEnabled={isGroqNewEnabled}
                        setIsGroqNewEnabled={setIsGroqNewEnabled}
                        isGroqAlt2Enabled={isGroqAlt2Enabled}
                        setIsGroqAlt2Enabled={setIsGroqAlt2Enabled}
                        isOpenrouterEnabled={isOpenrouterEnabled}
                        setIsOpenrouterEnabled={setIsOpenrouterEnabled}
                        isOpenaiEnabled={isOpenaiEnabled}
                        setIsOpenaiEnabled={setIsOpenaiEnabled}
                        isGrokNativeEnabled={isGrokNativeEnabled}
                        setIsGrokNativeEnabled={setIsGrokNativeEnabled}
                        selectedVisionModel={selectedVisionModel}
                        setSelectedVisionModel={setSelectedVisionModel}
                        lensConfig={lensConfig}
                        setLensConfig={setLensConfig}
                    />
                </>
            )}

            {/* Image Viewer Modal */}
            <ImageViewerModal
                imageUrl={viewerImageUrl}
                onClose={() => setViewerImageUrl(null)}
            />
        </div>
    );
};

export const ChatArea = React.memo(ChatAreaInner);
