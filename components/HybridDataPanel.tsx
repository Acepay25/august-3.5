import React from 'react';
import { CloseIcon } from './Icons';
import { HybridDataPacket } from '../services/HybridIntelligenceService';
import { SLOptimization } from '../services/StopLossOptimizerService';

interface HybridDataPanelProps {
    data: HybridDataPacket | null;
    isLoading?: boolean;
    onClose?: () => void;
    connectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    slOptimization?: SLOptimization | null; // Display-only, doesn't affect AI
    suggestedEntryPrice?: number | null; // Entry Timing suggested entry price
    entryTimingScore?: {
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null;
}

const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
};

const formatVolume = (volume: number): string => {
    if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
    if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `$${(volume / 1e3).toFixed(2)}K`;
    return `$${volume.toFixed(2)}`;
};

const IndicatorRow: React.FC<{ label: string; value: string | number | undefined; color?: string }> = ({ label, value, color }) => (
    <div className="flex justify-between items-center py-0.5">
        <span className="text-zinc-500 text-[9px]">{label}</span>
        <span className={`text-[9px] font-mono ${color || 'text-zinc-200'}`}>{value ?? 'N/A'}</span>
    </div>
);

const TimeframeBadge: React.FC<{ tf: string; indicators: any; expanded?: boolean }> = ({ tf, indicators, expanded }) => {
    const rsiColor = indicators.rsi.rsi14 > 70 ? 'text-red-400' : indicators.rsi.rsi14 < 30 ? 'text-emerald-400' : 'text-zinc-300';
    const macdColor = indicators.macd.histogram > 0 ? 'text-emerald-400' : 'text-red-400';
    const stochColor = indicators.stochastic.k > 80 ? 'text-red-400' : indicators.stochastic.k < 20 ? 'text-emerald-400' : 'text-zinc-300';

    if (!expanded) {
        return (
            <div className="bg-zinc-900/50 rounded-lg p-2 border border-white/5">
                <div className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider mb-1">{tf}</div>
                <div className="space-y-0">
                    <IndicatorRow label="RSI14" value={indicators.rsi.rsi14} color={rsiColor} />
                    <IndicatorRow label="MACD" value={indicators.macd.histogram} color={macdColor} />
                    <IndicatorRow label="Stoch K" value={indicators.stochastic.k} color={stochColor} />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-zinc-900/50 rounded-lg p-3 border border-white/5 space-y-2">
            <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider border-b border-white/5 pb-1">{tf} Timeframe</div>

            {/* RSI Section */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">RSI</div>
                <div className="grid grid-cols-4 gap-1 text-[9px]">
                    <div><span className="text-zinc-500">6:</span> <span className={rsiColor}>{indicators.rsi.rsi6}</span></div>
                    <div><span className="text-zinc-500">12:</span> <span className={rsiColor}>{indicators.rsi.rsi12}</span></div>
                    <div><span className="text-zinc-500">14:</span> <span className="font-bold" style={{ color: rsiColor }}>{indicators.rsi.rsi14}</span></div>
                    <div><span className="text-zinc-500">24:</span> <span className={rsiColor}>{indicators.rsi.rsi24}</span></div>
                </div>
            </div>

            {/* MACD Section */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">MACD</div>
                <div className="grid grid-cols-3 gap-1 text-[9px]">
                    <div><span className="text-zinc-500">DIF:</span> <span className={macdColor}>{indicators.macd.dif}</span></div>
                    <div><span className="text-zinc-500">DEA:</span> <span>{indicators.macd.dea}</span></div>
                    <div><span className="text-zinc-500">Hist:</span> <span className={`font-bold ${macdColor}`}>{indicators.macd.histogram}</span></div>
                </div>
            </div>

            {/* Stochastic Section */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Stochastic</div>
                <div className="grid grid-cols-3 gap-1 text-[9px]">
                    <div><span className="text-zinc-500">K:</span> <span className={stochColor}>{indicators.stochastic.k}</span></div>
                    <div><span className="text-zinc-500">D:</span> <span>{indicators.stochastic.d}</span></div>
                    <div><span className="text-zinc-500">J:</span> <span>{indicators.stochastic.j}</span></div>
                </div>
            </div>

            {/* MA Section */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Moving Averages</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0 text-[8px]">
                    <div><span className="text-zinc-500">MA5:</span> ${formatPrice(indicators.sma.ma5)}</div>
                    <div><span className="text-zinc-500">MA10:</span> ${formatPrice(indicators.sma.ma10)}</div>
                    <div><span className="text-zinc-500">MA20:</span> ${formatPrice(indicators.sma.ma20)}</div>
                    <div><span className="text-zinc-500">MA60:</span> ${formatPrice(indicators.sma.ma60)}</div>
                </div>
            </div>

            {/* EMA Section */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">EMAs</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0 text-[8px]">
                    <div><span className="text-zinc-500">EMA9:</span> ${formatPrice(indicators.ema.ema9)}</div>
                    <div><span className="text-zinc-500">EMA21:</span> ${formatPrice(indicators.ema.ema21)}</div>
                    <div><span className="text-zinc-500">EMA50:</span> ${formatPrice(indicators.ema.ema50)}</div>
                    <div><span className="text-zinc-500">EMA200:</span> ${formatPrice(indicators.ema.ema200)}</div>
                </div>
            </div>

            {/* Bollinger Bands */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase mb-0.5">Bollinger Bands</div>
                <div className="grid grid-cols-3 gap-1 text-[8px]">
                    <div><span className="text-red-400">U:</span> ${formatPrice(indicators.bollingerBands.upper)}</div>
                    <div><span className="text-zinc-400">M:</span> ${formatPrice(indicators.bollingerBands.middle)}</div>
                    <div><span className="text-emerald-400">L:</span> ${formatPrice(indicators.bollingerBands.lower)}</div>
                </div>
            </div>

            {/* ATR & Volume */}
            <div className="grid grid-cols-2 gap-2 text-[8px]">
                <div><span className="text-zinc-500">ATR:</span> ${indicators.atr} ({indicators.atrPercent}%)</div>
                <div><span className="text-zinc-500">Vol:</span> <span className={indicators.volume.trend === 'high' ? 'text-emerald-400' : indicators.volume.trend === 'low' ? 'text-red-400' : ''}>{indicators.volume.trend.toUpperCase()}</span></div>
            </div>
        </div>
    );
};

const HybridDataPanel: React.FC<HybridDataPanelProps> = ({ data, isLoading, onClose, connectionStatus, slOptimization, suggestedEntryPrice, entryTimingScore }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [showDetailedView, setShowDetailedView] = React.useState(false);
    const [loadingStep, setLoadingStep] = React.useState(0);

    // Drag state for movable panel
    const [position, setPosition] = React.useState({ x: 16, y: 64 }); // Default: left-4, top-16
    const [isDragging, setIsDragging] = React.useState(false);
    const [hasDragged, setHasDragged] = React.useState(false); // Track if we actually moved
    const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
    const panelRef = React.useRef<HTMLDivElement>(null);

    // Drag handlers
    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setIsDragging(true);
        setHasDragged(false);
        setDragOffset({ x: clientX - position.x, y: clientY - position.y });
    };

    React.useEffect(() => {
        if (!isDragging) return;

        const handleMove = (e: MouseEvent | TouchEvent) => {
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const panelWidth = panelRef.current?.offsetWidth || 48;
            const panelHeight = panelRef.current?.offsetHeight || 48;

            // Allow positioning anywhere, just keep at least 8px visible on each edge
            const minVisible = 8;
            const minX = -panelWidth + minVisible;
            const maxX = window.innerWidth - minVisible;
            const minY = -panelHeight + minVisible;
            const maxY = window.innerHeight - minVisible;

            const newX = Math.max(minX, Math.min(maxX, clientX - dragOffset.x));
            const newY = Math.max(minY, Math.min(maxY, clientY - dragOffset.y));

            // Mark as dragged if we moved more than 5px
            if (Math.abs(newX - position.x) > 5 || Math.abs(newY - position.y) > 5) {
                setHasDragged(true);
            }

            setPosition({ x: newX, y: newY });
        };

        const handleEnd = () => {
            setIsDragging(false);
            // Reset hasDragged after a short delay to allow click event to check it
            setTimeout(() => setHasDragged(false), 100);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        window.addEventListener('touchmove', handleMove);
        window.addEventListener('touchend', handleEnd);

        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleEnd);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleEnd);
        };
    }, [isDragging, dragOffset, position.x, position.y]);

    // Animate through loading steps
    React.useEffect(() => {
        if (isLoading) {
            const steps = ['Connecting to Binance API...', 'Fetching OHLCV data...', 'Calculating indicators...', 'Processing market data...'];
            let step = 0;
            const interval = setInterval(() => {
                step = (step + 1) % steps.length;
                setLoadingStep(step);
            }, 800);
            return () => clearInterval(interval);
        }
    }, [isLoading]);

    // Show disconnected or error status when not connected
    if (!data && !isLoading && (connectionStatus === 'disconnected' || connectionStatus === 'error' || !connectionStatus)) {
        return (
            <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
                <div className="group relative">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${connectionStatus === 'error'
                        ? 'bg-gradient-to-br from-red-900/90 to-rose-900/90 border-2 border-red-500/50 shadow-red-500/20'
                        : 'bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 border-2 border-zinc-600/50 shadow-zinc-500/10'
                        }`}>
                        <span className="text-lg opacity-60">🤖</span>
                        {/* Status dot */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-900 ${connectionStatus === 'error' ? 'bg-red-500' : 'bg-zinc-500'
                            }`}></div>
                    </div>
                    {/* Tooltip */}
                    <div className="absolute left-14 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/95 border border-white/10 rounded-lg px-3 py-2 whitespace-nowrap pointer-events-none min-w-[180px]">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-zinc-400 font-bold text-[10px] uppercase">Hybrid Intelligence</span>
                        </div>
                        <div className={`text-xs flex items-center gap-1.5 ${connectionStatus === 'error' ? 'text-red-400' : 'text-zinc-400'
                            }`}>
                            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'error' ? 'bg-red-400' : 'bg-zinc-400'
                                }`}></div>
                            {connectionStatus === 'error' ? 'Connection Error' : 'Disconnected'}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">
                            Enable Hybrid Mode in Settings
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Show persistent connection status when hybrid mode is on but no data yet
    if (!data && !isLoading && (connectionStatus === 'connected' || connectionStatus === 'connecting')) {
        return (
            <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
                <div className="group relative">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${connectionStatus === 'connecting'
                        ? 'bg-gradient-to-br from-yellow-900/90 to-amber-900/90 border-2 border-yellow-500/50 shadow-yellow-500/20'
                        : 'bg-gradient-to-br from-emerald-900/90 to-cyan-900/90 border-2 border-emerald-500/50 shadow-emerald-500/20'
                        }`}>
                        {connectionStatus === 'connecting' && (
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-yellow-400 animate-spin"></div>
                        )}
                        <span className="text-lg">🤖</span>
                        {/* Status dot */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-900 ${connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500'
                            }`}></div>
                    </div>
                    {/* Tooltip */}
                    <div className="absolute left-14 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/95 border border-white/10 rounded-lg px-3 py-2 whitespace-nowrap pointer-events-none min-w-[180px]">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-emerald-400 font-bold text-[10px] uppercase">Hybrid Intelligence</span>
                        </div>
                        <div className={`text-xs flex items-center gap-1.5 ${connectionStatus === 'connecting' ? 'text-yellow-400' : 'text-emerald-400'
                            }`}>
                            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'
                                }`}></div>
                            {connectionStatus === 'connecting' ? 'Connecting to Binance...' : 'Connected to Binance API'}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">
                            Send an analysis request to fetch data
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        const steps = ['Connecting to Binance API...', 'Fetching OHLCV data...', 'Calculating indicators...', 'Processing market data...'];
        return (
            <>
                {/* Floating button with loading animation */}
                <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
                    <div className="relative w-14 h-14 bg-gradient-to-br from-emerald-900/90 to-cyan-900/90 border-2 border-emerald-500/70 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                        {/* Rotating ring */}
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-400 animate-spin"></div>
                        <span className="text-2xl animate-pulse">🤖</span>
                    </div>
                </div>

                {/* Top banner notification */}
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
                    <div className="bg-gradient-to-r from-emerald-950/95 to-cyan-950/95 border border-emerald-500/50 rounded-xl px-6 py-3 shadow-2xl shadow-emerald-500/20 backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            {/* Animated icon */}
                            <div className="relative">
                                <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                                    <span className="text-xl">🤖</span>
                                </div>
                                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-400 animate-spin"></div>
                            </div>

                            {/* Text content */}
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-emerald-400 font-bold text-sm">HYBRID INTELLIGENCE</span>
                                    <span className="text-[9px] bg-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full uppercase animate-pulse">Active</span>
                                </div>
                                <div className="text-zinc-400 text-xs mt-0.5 flex items-center gap-2">
                                    <span className="text-white">{steps[loadingStep]}</span>
                                    <span className="flex gap-0.5">
                                        <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                        <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                        <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                    </span>
                                </div>
                            </div>

                            {/* Progress dots */}
                            <div className="flex gap-1 ml-4">
                                {[0, 1, 2, 3].map((i) => (
                                    <div
                                        key={i}
                                        className={`w-2 h-2 rounded-full transition-all duration-300 ${i <= loadingStep ? 'bg-emerald-400 scale-110' : 'bg-zinc-600'
                                            }`}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    if (!data) return null;

    const priceChangeColor = data.marketData.priceChangePercent24h >= 0 ? 'text-emerald-400' : 'text-red-400';
    const fundingColor = data.fundingRateSentiment === 'bullish' ? 'text-emerald-400'
        : data.fundingRateSentiment === 'bearish' ? 'text-red-400'
            : 'text-zinc-400';

    if (!isExpanded) {
        return (
            <div
                ref={panelRef}
                className={`fixed z-50 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{ left: position.x, top: position.y }}
            >
                <div
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    onClick={(e) => {
                        // Only open if we didn't drag (drag moves, click opens)
                        if (!hasDragged) setIsExpanded(true);
                    }}
                    className="group relative w-12 h-12 bg-zinc-800 border border-white/20 rounded-full flex items-center justify-center shadow-lg hover:bg-zinc-700 hover:border-white/30 transition-all duration-200 select-none"
                    title={`Drag to move • Click to view ${data.symbol}`}
                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                >
                    <span className="text-xl pointer-events-none">🤖</span>
                    <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${data.marketData.priceChangePercent24h >= 0 ? 'bg-emerald-500' : 'bg-red-500'} border border-black animate-pulse pointer-events-none`}></div>
                    <div className="absolute left-14 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/95 border border-white/10 rounded-lg px-3 py-2 whitespace-nowrap pointer-events-none">
                        <div className="text-[10px] text-zinc-300 font-bold">{data.symbol}</div>
                        <div className="text-white font-bold text-sm">${formatPrice(data.marketData.currentPrice)}</div>
                        <div className={`text-[10px] ${priceChangeColor}`}>
                            {data.marketData.priceChangePercent24h >= 0 ? '+' : ''}{data.marketData.priceChangePercent24h.toFixed(2)}%
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={panelRef}
            className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] animate-slide-in-left"
            style={{ left: position.x, top: position.y, maxHeight: 'calc(100vh - 120px)' }}
        >
            <div className="h-full max-h-[calc(100vh-120px)] bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden shadow-xl flex flex-col">
                {/* Header - Drag Handle */}
                <div
                    className={`flex items-center justify-between p-3 border-b border-white/5 bg-zinc-800/50 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                >
                    <div className="flex items-center gap-2">
                        {/* Drag indicator */}
                        <div className="flex flex-col gap-0.5 mr-1 opacity-40">
                            <div className="flex gap-0.5"><div className="w-1 h-1 bg-zinc-400 rounded-full"></div><div className="w-1 h-1 bg-zinc-400 rounded-full"></div></div>
                            <div className="flex gap-0.5"><div className="w-1 h-1 bg-zinc-400 rounded-full"></div><div className="w-1 h-1 bg-zinc-400 rounded-full"></div></div>
                        </div>
                        <span className="text-lg">🤖</span>
                        <div>
                            <div className="text-zinc-200 font-bold text-xs">HYBRID DATA</div>
                            <div className="text-zinc-500 text-[9px]">{data.symbol} • {new Date(data.dataTimestamp).toLocaleTimeString()}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowDetailedView(!showDetailedView)}
                            className={`px-2 py-1 text-[9px] rounded-lg transition-colors ${showDetailedView ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-700 text-zinc-400 hover:text-white'}`}
                        >
                            {showDetailedView ? 'Simple' : 'Detailed'}
                        </button>
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                        >
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">

                    {/* NEW: Session Context */}
                    {data.session && (
                        <div className="bg-indigo-950/30 rounded-xl p-3 border border-indigo-500/20">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Session Context</div>
                                <div className={`text-[9px] px-1.5 py-0.5 rounded-full ${data.session.isKillZone ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-zinc-800 text-zinc-400'}`}>
                                    {data.session.isKillZone ? 'KILL ZONE' : 'Standard'}
                                </div>
                            </div>
                            <div className="text-xs text-white font-medium mb-1">{data.session.sessionName}</div>
                            <div className="flex justify-between text-[9px] text-zinc-400 mb-2">
                                <span>{data.session.sessionStart} - {data.session.sessionEnd} UTC</span>
                                <span>{data.session.minutesToSessionEnd}m remaining</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[9px]">
                                <div className="bg-black/20 rounded p-1.5">
                                    <div className="text-zinc-500">Volatility</div>
                                    <div className={data.session.volatilityExpectation === 'high' ? 'text-red-400 font-bold' : 'text-zinc-300'}>
                                        {data.session.volatilityExpectation.toUpperCase()}
                                    </div>
                                </div>
                                <div className="bg-black/20 rounded p-1.5">
                                    <div className="text-zinc-500">Action</div>
                                    <div className={data.session.suggestedAction === 'optimal' ? 'text-emerald-400 font-bold' : 'text-zinc-300'}>
                                        {data.session.suggestedAction.toUpperCase()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Price Card */}
                    <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/5">
                        <div className="flex items-baseline justify-between">
                            <div className="text-white font-bold text-xl">${formatPrice(data.marketData.currentPrice)}</div>
                            <div className={`text-sm font-bold ${priceChangeColor}`}>
                                {data.marketData.priceChangePercent24h >= 0 ? '+' : ''}{data.marketData.priceChangePercent24h.toFixed(2)}%
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <div className="text-zinc-500 text-[9px] uppercase">Volume</div>
                                <div className="text-zinc-200 text-xs font-mono">{formatVolume(data.marketData.volume24h)}</div>
                            </div>
                            <div>
                                <div className="text-zinc-500 text-[9px] uppercase">Funding</div>
                                <div className={`text-xs font-mono ${fundingColor}`}>{(data.fundingRate * 100).toFixed(4)}%</div>
                            </div>
                        </div>
                    </div>

                    {/* NEW: Market Regime */}
                    {data.regime && (
                        <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/5">
                            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Market Regime</div>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-bold text-white">{data.regime.regime.replace(/_/g, ' ').toUpperCase()}</div>
                                <div className="text-[9px] text-zinc-400">ADX: {data.regime.adx}</div>
                            </div>
                            <div className="text-[9px] text-zinc-400 italic border-l-2 border-zinc-700 pl-2">
                                "{data.regime.recommendation}"
                            </div>
                        </div>
                    )}

                    {/* NEW: Derivatives Sentiment */}
                    {data.derivatives && (
                        <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/5">
                            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Derivatives Sentiment</div>
                            <div className="flex items-center justify-between mb-2">
                                <div className={`text-xs font-bold ${data.derivatives.overallSentiment.includes('bullish') ? 'text-emerald-400' :
                                    data.derivatives.overallSentiment.includes('bearish') ? 'text-red-400' : 'text-zinc-300'
                                    }`}>
                                    {data.derivatives.overallSentiment.replace(/_/g, ' ').toUpperCase()}
                                </div>
                                <div className="text-[9px] text-zinc-400">Score: {data.derivatives.sentimentScore}</div>
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-[8px]">
                                <div className="bg-black/20 rounded p-1 text-center">
                                    <div className="text-zinc-500">L/S Ratio</div>
                                    <div className="text-zinc-300">{data.derivatives.longShortRatio.ratio.toFixed(2)}</div>
                                </div>
                                <div className="bg-black/20 rounded p-1 text-center">
                                    <div className="text-zinc-500">Top Trader</div>
                                    <div className="text-zinc-300">{data.derivatives.topTraderRatio.ratio.toFixed(2)}</div>
                                </div>
                                <div className="bg-black/20 rounded p-1 text-center">
                                    <div className="text-zinc-500">OI</div>
                                    <div className="text-zinc-300">{formatVolume(data.derivatives.openInterestValue)}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* NEW: Order Book Depth */}
                    {data.orderBook && (
                        <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/5">
                            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">📖 Order Book Depth</div>
                            <div className="flex items-center justify-between mb-2">
                                <div className={`text-xs font-bold ${data.orderBook.dominantSide === 'buyers' ? 'text-emerald-400' :
                                    data.orderBook.dominantSide === 'sellers' ? 'text-red-400' : 'text-zinc-300'
                                    }`}>
                                    {data.orderBook.dominantSide.toUpperCase()}
                                </div>
                                <div className="text-[9px] text-zinc-400">
                                    Imbalance: {(data.orderBook.depthImbalance * 100).toFixed(1)}%
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-[8px] mb-2">
                                <div className="bg-emerald-950/30 rounded p-1.5 text-center border border-emerald-500/10">
                                    <div className="text-zinc-500">Bid Depth</div>
                                    <div className="text-emerald-400 font-mono">{formatVolume(data.orderBook.bidDepth)}</div>
                                </div>
                                <div className="bg-red-950/30 rounded p-1.5 text-center border border-red-500/10">
                                    <div className="text-zinc-500">Ask Depth</div>
                                    <div className="text-red-400 font-mono">{formatVolume(data.orderBook.askDepth)}</div>
                                </div>
                            </div>
                            {data.orderBook.buyWalls.length > 0 && (
                                <div className="text-[8px] mb-1">
                                    <span className="text-emerald-500">Buy Walls:</span>{' '}
                                    <span className="text-zinc-300">{data.orderBook.buyWalls.slice(0, 2).map(w => `$${formatPrice(w.price)}`).join(', ')}</span>
                                </div>
                            )}
                            {data.orderBook.sellWalls.length > 0 && (
                                <div className="text-[8px]">
                                    <span className="text-red-500">Sell Walls:</span>{' '}
                                    <span className="text-zinc-300">{data.orderBook.sellWalls.slice(0, 2).map(w => `$${formatPrice(w.price)}`).join(', ')}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* NEW: Recent Liquidations */}
                    {data.liquidations && (
                        <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/5">
                            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">🔥 Recent Liquidations (1H)</div>
                            <div className="flex items-center justify-between mb-2">
                                <div className={`text-xs font-bold ${data.liquidations.liquidationPressure === 'high' ? 'text-orange-400' :
                                    data.liquidations.liquidationPressure === 'medium' ? 'text-yellow-400' : 'text-zinc-300'
                                    }`}>
                                    {data.liquidations.liquidationPressure.toUpperCase()} PRESSURE
                                </div>
                                <div className="text-[9px] text-zinc-400">
                                    Total: {formatVolume(data.liquidations.totalRecentLiquidations)}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-[8px] mb-2">
                                <div className="bg-red-950/30 rounded p-1.5 text-center border border-red-500/10">
                                    <div className="text-zinc-500">Long Liqs</div>
                                    <div className="text-red-400 font-mono">{formatVolume(data.liquidations.recentLongLiquidations)}</div>
                                </div>
                                <div className="bg-emerald-950/30 rounded p-1.5 text-center border border-emerald-500/10">
                                    <div className="text-zinc-500">Short Liqs</div>
                                    <div className="text-emerald-400 font-mono">{formatVolume(data.liquidations.recentShortLiquidations)}</div>
                                </div>
                            </div>
                            <div className="text-[9px] text-zinc-400 italic border-l-2 border-zinc-700 pl-2">
                                {data.liquidations.sentiment}
                            </div>
                        </div>
                    )}

                    {/* Entry Timing Score (Display Only) */}
                    {entryTimingScore && (
                        <div className={`rounded-xl p-3 border ${entryTimingScore.score >= 70 ? 'bg-emerald-950/30 border-emerald-500/20' :
                            entryTimingScore.score >= 50 ? 'bg-yellow-950/30 border-yellow-500/20' :
                                entryTimingScore.score >= 35 ? 'bg-orange-950/30 border-orange-500/20' :
                                    'bg-red-950/30 border-red-500/20'
                            }`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] font-bold uppercase tracking-wider" style={{
                                    color: entryTimingScore.score >= 70 ? '#4ade80' :
                                        entryTimingScore.score >= 50 ? '#facc15' :
                                            entryTimingScore.score >= 35 ? '#fb923c' : '#f87171'
                                }}>🎯 Entry Timing</div>
                                <div className={`text-[9px] px-1.5 py-0.5 rounded-full ${entryTimingScore.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' :
                                    entryTimingScore.score >= 50 ? 'bg-yellow-500/20 text-yellow-300' :
                                        entryTimingScore.score >= 35 ? 'bg-orange-500/20 text-orange-300' :
                                            'bg-red-500/20 text-red-300'
                                    }`}>
                                    {entryTimingScore.timingQuality}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`text-xl font-bold ${entryTimingScore.score >= 70 ? 'text-emerald-200' :
                                    entryTimingScore.score >= 50 ? 'text-yellow-200' :
                                        entryTimingScore.score >= 35 ? 'text-orange-200' : 'text-red-200'
                                    }`}>
                                    {entryTimingScore.score}/100
                                </div>
                                <div className="text-[10px] text-zinc-400">
                                    entry quality score
                                </div>
                            </div>

                            {/* Suggested Better Entry */}
                            {entryTimingScore.suggestedEntry && (
                                <div className="bg-black/30 rounded-lg p-2 border border-cyan-500/20">
                                    <div className="text-[9px] text-cyan-400 mb-1">💡 Better Entry Available:</div>
                                    <div className="text-[11px] text-cyan-100 font-mono">
                                        ${entryTimingScore.suggestedEntry.price.toLocaleString()}
                                    </div>
                                    <div className="text-[8px] text-cyan-300/70 mt-1">
                                        {entryTimingScore.suggestedEntry.reason}
                                    </div>
                                </div>
                            )}

                            <div className="text-[8px] text-zinc-500 mt-2 text-center italic">
                                Display only • Does not affect AI calculation
                            </div>
                        </div>
                    )}

                    {/* SL Optimization (Display Only) */}
                    {slOptimization && slOptimization.hasEnoughData && (
                        <div className="bg-amber-950/30 rounded-xl p-3 border border-amber-500/20">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">📊 SL Optimization</div>
                                <div className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                    {slOptimization.missedWinRate.toFixed(0)}% missed wins
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="text-xl font-bold text-amber-200">
                                    {(slOptimization.recommendedMultiplier * 100).toFixed(0)}%
                                </div>
                                <div className="text-[10px] text-amber-300/80">
                                    recommended SL width
                                </div>
                            </div>

                            {/* Show optimized SL calculation from Entry Timing suggested price */}
                            {suggestedEntryPrice && slOptimization.recommendedMultiplier > 1 && (
                                <div className="bg-black/30 rounded-lg p-2 mb-2 border border-amber-500/10">
                                    <div className="text-[9px] text-cyan-400 mb-1">💡 From Entry Timing suggested price:</div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div>
                                            <div className="text-zinc-500">Suggested Entry</div>
                                            <div className="text-cyan-100 font-mono">${suggestedEntryPrice.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div className="text-zinc-500">Wider SL (Long)</div>
                                            <div className="text-amber-200 font-mono">
                                                ${(suggestedEntryPrice * (1 - (slOptimization.recommendedMultiplier * 0.02))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-[8px] text-amber-400/60 mt-1">
                                        +{((slOptimization.recommendedMultiplier - 1) * 100).toFixed(0)}% wider than standard 2% SL
                                    </div>
                                </div>
                            )}

                            {slOptimization.contextRecommendations.length > 0 && (
                                <div className="space-y-1">
                                    {slOptimization.contextRecommendations.slice(0, 2).map((rec, i) => (
                                        <div key={i} className="text-[9px] text-amber-200/70 bg-black/20 px-2 py-1 rounded">
                                            {rec.context}: {(rec.recommendedMultiplier * 100).toFixed(0)}%
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="text-[8px] text-amber-400/50 mt-2 text-center italic">
                                Display only • Does not affect AI calculation
                            </div>
                        </div>
                    )}

                    {/* 24H Range */}
                    <div className="bg-zinc-900/50 rounded-xl p-2 border border-white/5">
                        <div className="flex justify-between text-[9px] text-zinc-500 uppercase mb-1">
                            <span>${formatPrice(data.marketData.price24hLow)}</span>
                            <span>24H</span>
                            <span>${formatPrice(data.marketData.price24hHigh)}</span>
                        </div>
                        <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="absolute h-full bg-gradient-to-r from-red-500/50 via-yellow-500/50 to-emerald-500/50" style={{ width: '100%' }} />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow border border-emerald-500"
                                style={{
                                    left: `${Math.min(100, Math.max(0, ((data.marketData.currentPrice - data.marketData.price24hLow) / (data.marketData.price24hHigh - data.marketData.price24hLow)) * 100))}%`,
                                    transform: 'translate(-50%, -50%)'
                                }}
                            />
                        </div>
                    </div>

                    {/* Technical Indicators by Timeframe */}
                    <div>
                        <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Indicators</div>
                        {showDetailedView ? (
                            <div className="space-y-2">
                                <TimeframeBadge tf="4H" indicators={data.indicators['4h']} expanded />
                                <TimeframeBadge tf="1H" indicators={data.indicators['1h']} expanded />
                                <TimeframeBadge tf="15M" indicators={data.indicators['15m']} expanded />
                                <TimeframeBadge tf="5M" indicators={data.indicators['5m']} expanded />
                            </div>
                        ) : (
                            <div className="grid grid-cols-4 gap-1">
                                <TimeframeBadge tf="4H" indicators={data.indicators['4h']} />
                                <TimeframeBadge tf="1H" indicators={data.indicators['1h']} />
                                <TimeframeBadge tf="15M" indicators={data.indicators['15m']} />
                                <TimeframeBadge tf="5M" indicators={data.indicators['5m']} />
                            </div>
                        )}
                    </div>

                    {/* Key Levels */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-red-950/30 rounded-lg p-2 border border-red-500/20">
                            <div className="text-[9px] font-bold text-red-400 uppercase mb-1">Resistance</div>
                            {data.keyLevels.resistance.length > 0 ? (
                                data.keyLevels.resistance.slice(0, 3).map((level, i) => (
                                    <div key={i} className="text-[10px] font-mono text-red-300">${formatPrice(level)}</div>
                                ))
                            ) : (
                                <div className="text-[10px] text-zinc-600 italic">None</div>
                            )}
                        </div>
                        <div className="bg-emerald-950/30 rounded-lg p-2 border border-emerald-500/20">
                            <div className="text-[9px] font-bold text-emerald-400 uppercase mb-1">Support</div>
                            {data.keyLevels.support.length > 0 ? (
                                data.keyLevels.support.slice(0, 3).map((level, i) => (
                                    <div key={i} className="text-[10px] font-mono text-emerald-300">${formatPrice(level)}</div>
                                ))
                            ) : (
                                <div className="text-[10px] text-zinc-600 italic">None</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-2 border-t border-white/5 bg-zinc-900/50">
                    <div className="text-center text-[8px] text-zinc-600">
                        Source: Binance API • Calculated by technicalindicators
                    </div>
                </div>
            </div>
        </div >
    );
};

export default React.memo(HybridDataPanel);
