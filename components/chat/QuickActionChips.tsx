import React, { useState } from 'react';
import { PlusIcon, BookmarkIcon, ActivityIcon, ChartBarIcon, ChevronRightIcon, ChevronLeftIcon } from '../shared/Icons';

interface QuickActionChipsProps {
    onNewAnalysis: () => void;
    onOpenJournal: () => void;
    onOpenLiveMarket: () => void;
    onOpenAnalytics: () => void;
    onOpenWatchList?: () => void;
    watchOpenCount?: number;
    isDisabled?: boolean;
    // Fresh sessions already ARE a new conversation — no point starting
    // another one from the hero/docked chips.
    disableNewAnalysis?: boolean;
    // 'docked' = vertical grid above the input (active sessions);
    // 'centered' = horizontal outlined row under the hero composer.
    layout?: 'docked' | 'centered';
}

export const QuickActionChips: React.FC<QuickActionChipsProps> = ({
    onNewAnalysis,
    onOpenJournal,
    onOpenLiveMarket,
    onOpenAnalytics,
    onOpenWatchList,
    watchOpenCount = 0,
    isDisabled = false,
    disableNewAnalysis = false,
    layout = 'docked'
}) => {
    const [isHidden, setIsHidden] = useState(false);

    if (layout === 'centered') {
        const chipClass = "flex items-center gap-2 px-3 py-1.5 bg-transparent border border-white/10 hover:border-white/25 hover:bg-zinc-800 rounded-lg text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
        return (
            <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                    onClick={() => setIsHidden(!isHidden)}
                    className="flex items-center justify-center w-7 h-7 bg-transparent border border-white/10 hover:border-white/25 rounded-full text-zinc-500 hover:text-zinc-200 transition-all duration-300 shrink-0"
                    title={isHidden ? "Show quick actions" : "Hide quick actions"}
                >
                    {isHidden ? <ChevronRightIcon className="w-3.5 h-3.5" /> : <ChevronLeftIcon className="w-3.5 h-3.5" />}
                </button>
                {!isHidden && (
                    <>
                        <button onClick={onNewAnalysis} disabled={isDisabled || disableNewAnalysis} className={chipClass}>
                            <span className="text-zinc-400"><PlusIcon className="w-4 h-4" /></span>
                            <span>New Analysis</span>
                        </button>
                        <button onClick={onOpenJournal} disabled={isDisabled} className={chipClass}>
                            <span className="text-zinc-400"><BookmarkIcon className="w-4 h-4" /></span>
                            <span>Trade Journal</span>
                        </button>
                        <button onClick={onOpenAnalytics} disabled={isDisabled} className={chipClass}>
                            <span className="text-zinc-400"><ChartBarIcon className="w-4 h-4" /></span>
                            <span>Analytics</span>
                        </button>
                        <button onClick={onOpenLiveMarket} disabled={isDisabled} className={chipClass}>
                            <span className="text-zinc-400"><ActivityIcon className="w-4 h-4" /></span>
                            <span>Live Market</span>
                        </button>
                        {onOpenWatchList && (
                            <button onClick={onOpenWatchList} disabled={isDisabled} className={chipClass}>
                                <span>Watch list{watchOpenCount > 0 ? ` (${watchOpenCount})` : ''}</span>
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="flex lg:flex-col items-center lg:items-start gap-2 pb-2 lg:pb-0 w-full transition-all duration-300">
            {/* Toggle Button - Always visible */}
            <button
                onClick={() => setIsHidden(!isHidden)}
                className="flex items-center justify-center w-8 h-8 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-zinc-500/50 rounded-full text-zinc-400 hover:text-white transition-all duration-300 shrink-0 z-10 lg:mb-2"
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
                <div className="flex lg:grid lg:grid-cols-5 gap-2 overflow-x-auto lg:overflow-visible scrollbar-hide -mx-1 px-1 lg:mx-0 lg:px-0 lg:w-full">
                    <button
                        onClick={onNewAnalysis}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-3 py-2 lg:py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-white/25 rounded-lg whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-zinc-400"><PlusIcon className="w-4 h-4" /></span>
                        <span>New Analysis</span>
                    </button>
                    <button
                        onClick={onOpenJournal}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-3 py-2 lg:py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-white/25 rounded-lg whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-zinc-400"><BookmarkIcon className="w-4 h-4" /></span>
                        <span>Trade Journal</span>
                    </button>
                    <button
                        onClick={onOpenAnalytics}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-3 py-2 lg:py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-white/25 rounded-lg whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-zinc-400"><ChartBarIcon className="w-4 h-4" /></span>
                        <span>Analytics</span>
                    </button>
                    <button
                        onClick={onOpenLiveMarket}
                        disabled={isDisabled}
                        className="flex items-center justify-center lg:justify-start gap-2 px-3 py-2 lg:py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-white/25 rounded-lg whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                    >
                        <span className="text-zinc-400"><ActivityIcon className="w-4 h-4" /></span>
                        <span>Live Market</span>
                    </button>
                    {onOpenWatchList && (
                        <button
                            onClick={onOpenWatchList}
                            disabled={isDisabled}
                            className="flex items-center justify-center lg:justify-start gap-2 px-3 py-2 lg:py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 hover:border-white/25 rounded-lg whitespace-nowrap text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 lg:w-full"
                        >
                            <span>Watch list{watchOpenCount > 0 ? ` (${watchOpenCount})` : ''}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default QuickActionChips;
