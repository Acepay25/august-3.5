import React, { useState } from 'react';
import { PlusIcon, BookmarkIcon, ActivityIcon, ChevronRightIcon, ChevronLeftIcon } from './Icons';

interface QuickActionChipsProps {
    onNewAnalysis: () => void;
    onOpenJournal: () => void;
    onOpenLiveMarket: () => void;
    onOpenAnalytics: () => void;
    isDisabled?: boolean;
}

export const QuickActionChips: React.FC<QuickActionChipsProps> = ({
    onNewAnalysis,
    onOpenJournal,
    onOpenLiveMarket,
    onOpenAnalytics,
    isDisabled = false
}) => {
    const [isHidden, setIsHidden] = useState(false);

    return (
        <div className="flex lg:flex-col items-center lg:items-start gap-2 pb-2 lg:pb-0 lg:w-full lg:max-w-3xl lg:mx-auto transition-all duration-300">
            {/* Toggle Button - Always visible */}
            <button
                onClick={() => setIsHidden(!isHidden)}
                className="flex items-center justify-center w-8 h-8 bg-zinc-800/80 hover:bg-zinc-700/80 border border-white/10 hover:border-zinc-500/50 rounded-full text-zinc-400 hover:text-white transition-all duration-300 shrink-0 z-10 lg:mb-2"
                title={isHidden ? "Show quick actions" : "Hide quick actions"}
            >
                {isHidden ? (
                    <ChevronRightIcon className="w-4 h-4 lg:rotate-90 lg:transform transition-transform" />
                ) : (
                    <ChevronLeftIcon className="w-4 h-4 lg:-rotate-90 lg:transform transition-transform" />
                )}
            </button>

            {/* Chips Container - Mobile: Slide Horizontal, Desktop: Grid/Vertical */}
            <div
                className={`flex gap-2 overflow-hidden transition-all duration-300 ease-in-out
                    ${isHidden
                        ? 'max-w-0 opacity-0 lg:max-w-none lg:max-h-0 lg:opacity-0'
                        : 'max-w-[1000px] opacity-100 lg:max-w-none lg:max-h-[200px] lg:opacity-100'
                    } lg:w-full`}
            >
                <div className="flex lg:grid lg:grid-cols-4 gap-2 overflow-x-auto lg:overflow-visible scrollbar-hide -mx-1 px-1 lg:mx-0 lg:px-0 lg:w-full">
                    <button
                        onClick={onNewAnalysis}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-4 py-2.5 lg:py-3 bg-zinc-800/60 hover:bg-zinc-700/60 border border-white/10 hover:border-cyan-500/30 rounded-full lg:rounded-xl whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-cyan-400"><PlusIcon className="w-4 h-4" /></span>
                        <span>New Analysis</span>
                    </button>
                    <button
                        onClick={onOpenJournal}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-4 py-2.5 lg:py-3 bg-zinc-800/60 hover:bg-zinc-700/60 border border-white/10 hover:border-violet-500/30 rounded-full lg:rounded-xl whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-violet-400"><BookmarkIcon className="w-4 h-4" /></span>
                        <span>Trade Journal</span>
                    </button>
                    <button
                        onClick={onOpenAnalytics}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-4 py-2.5 lg:py-3 bg-zinc-800/60 hover:bg-zinc-700/60 border border-white/10 hover:border-purple-500/30 rounded-full lg:rounded-xl whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span>🔬</span>
                        <span>Analytics</span>
                    </button>
                    <button
                        onClick={onOpenLiveMarket}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-4 py-2.5 lg:py-3 bg-zinc-800/60 hover:bg-zinc-700/60 border border-white/10 hover:border-emerald-500/30 rounded-full lg:rounded-xl whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-emerald-400"><ActivityIcon className="w-4 h-4" /></span>
                        <span>Live Market</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuickActionChips;
