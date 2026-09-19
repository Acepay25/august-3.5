
import React, { useState, useEffect } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { APP_VERSION } from '../../constants/version';

// Import services
import { ReinforcementSignalService, ReinforcementSignal } from '../../services/learning/ReinforcementSignalService';
import { getCalibrationSummary } from '../../services/validation/ConfidenceCalibrationService';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
import { storageService } from '../../services/infrastructure/StorageService';
import { getAttributedInsightsSummary } from '../../services/learning/severityInsights';
import { recordInsightFeedback } from '../../services/learning/PatternMemorySynthesisService';
import { jobQueue } from '../../services/infrastructure/JobQueueService';
import { ConfidenceCalibration } from '../../types';
import { listSkills } from '../../services/learning/SkillMemoryService';
import { getMemoryFilesStats } from '../../services/learning/MemoryFilesService';
import {
    GATE_SCAN_JSON_SCHEMA,
    MASTER_TRADE_PLAN_MARKDOWN,
    DUAL_SCENARIO_JSON_SCHEMA
} from '../../constants/schemas';

// Map schemas for display — the trade plan is MARKDOWN now (no JSON anywhere
// in the output contract), shown as text.
const validationSchemas: Record<string, any> = {
    tradeValidation: JSON.parse(GATE_SCAN_JSON_SCHEMA),
    marketAnalysis: MASTER_TRADE_PLAN_MARKDOWN,
    postMortem: JSON.parse(DUAL_SCENARIO_JSON_SCHEMA)
};

// -- ICONS (lucide-react) --
import { X, Brain, Zap, Server, AreaChart as AreaChartIcon, Sparkles, Code } from 'lucide-react';

const Icons = {
    Close: X,
    Brain,
    Zap,
    Server,
    Chart: AreaChartIcon,
    Sparkles,
    Code,
};

export const VersionHistoryDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    // Esc closes the overlay (backdrop-click was the only way out before).
    useEscapeClose(true, onClose);
    const [activeTab, setActiveTab] = useState<'Intelligence' | 'Algorithm' | 'System'>('Intelligence');
    const [signals, setSignals] = useState<ReinforcementSignal[]>([]);
    const [calibration, setCalibration] = useState<ConfidenceCalibration | undefined>(undefined);
    const [rules, setRules] = useState<Array<{ file: { name: string }; meta: { kind: string; status: string; wins: number; losses: number; ifCondition?: string; thenAction?: string } }>>([]);
    const [insights, setInsights] = useState<any[]>([]);
    const [providerStats, setProviderStats] = useState<Record<string, { count: number; avgQuality: number }>>({});

    // Real-time System Stats
    const [queueSize, setQueueSize] = useState<number>(0);
    const [storageCount, setStorageCount] = useState<number>(0);
    const [memoryStats, setMemoryStats] = useState<{ enabledCount: number; charCount: number }>({ enabledCount: 0, charCount: 0 });

    // Selection states for dropdown outputs
    const [selectedRuleIndex, setSelectedRuleIndex] = useState<number>(0);
    const [selectedInsightIndex, setSelectedInsightIndex] = useState<number>(0);
    const [selectedSchema, setSelectedSchema] = useState<string>('tradeValidation');

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000); // Refresh background metrics without a 5s polling loop
        return () => clearInterval(interval);
    }, []);

    const loadData = async () => {
        try {
            // 1. Intelligence Data (signals across all configured providers)
            const recentSignals = await ReinforcementSignalService.getAllSignals(20);
            setSignals(recentSignals || []);

            // The bucketed per-confidence calibration is owned by GlobalLearning
            // Service (per-user). It used to be read off the raw
            // 'confidence_calibration' localStorage key — which Model
            // Performance was writing a DIFFERENT (providers-shaped) blob to,
            // so every bucket parsed as `undefined`. Read the real owner now.
            setCalibration(GlobalLearningService.getCalibration());

            const sk = listSkills().filter(s => s.meta.status !== 'retired');
            setRules(sk);
            // 5s polling reloads the lists — clamp the selection so a shrink
            // between polls can't point past the end of the new array (the
            // <select> would render no matching <option>).
            setSelectedRuleIndex(i => Math.max(0, Math.min(i, sk.length - 1)));

            const iStats = getAttributedInsightsSummary();
            const topInsights = iStats.topInsights || [];
            setInsights(topInsights);
            setSelectedInsightIndex(i => Math.min(i, Math.max(0, topInsights.length - 1)));
            setProviderStats(iStats.byProvider || {});

            // 2. System Data
            setQueueSize(jobQueue.getQueueLength());
            setMemoryStats(getMemoryFilesStats());

            // Count only records this screen can actually explain.
            const logs = await storageService.getTradeLogs();
            setStorageCount(logs.length + sk.length + (iStats.totalInsights || 0));
        } catch (error) {
            console.error('[VersionHistoryDashboard] Failed to load data:', error);
        }
    };

    // Insight quality feedback: records helpful/not-helpful so the store can
    // derive a real quality ratio (timesHelpful / timesUsed) instead of the
    // default 50. Reloads immediately so the counters update in place.
    const handleInsightFeedback = async (insightId: string | undefined, wasHelpful: boolean) => {
        if (!insightId) return;
        // Await the notebook write so the immediate reload observes the
        // new counters (the store persists through the notebook write lock).
        await recordInsightFeedback(insightId, wasHelpful);
        loadData();
    };

    // Human-friendly label for the synthetic severity tag (the store's
    // sourceProvider is a stable id, not a display name).
    const providerLabel = (provider: string): string =>
        provider === 'pattern-memory-severity-detector' ? 'Severity Detector' : provider;

    const highConfidenceWinRate = calibration ? getCalibrationSummary(calibration).high.winRate : null;

    // -- Modern Card Component --
    const ModernCard = ({ title, value, subtitle, icon, accent = "blue", large = false, children }: any) => {
        const accentColors: any = {
            blue: "from-zinc-800/50 to-zinc-900/50 border-zinc-700/50 text-zinc-300",
            purple: "from-zinc-800/50 to-zinc-900/50 border-zinc-700/50 text-zinc-300",
            emerald: "from-emerald-500/20 to-teal-500/5 border-emerald-500/20 text-emerald-400",
            amber: "from-amber-500/20 to-orange-500/5 border-amber-500/20 text-amber-400",
            yellow: "from-yellow-500/20 to-amber-500/5 border-yellow-500/20 text-yellow-400",
            rose: "from-rose-500/20 to-red-500/5 border-rose-500/20 text-rose-400",
            zinc: "from-zinc-800/50 to-zinc-900/50 border-zinc-700/50 text-zinc-400"
        };

        const config = accentColors[accent] || accentColors.blue;

        return (
            <div className={`
        relative overflow-hidden
        bg-gradient-to-br ${config.split(' ')[0]} ${config.split(' ')[1]}
        rounded-3xl border border-white/5
        transition-all duration-300 hover:shadow-2xl hover:border-white/10 hover:-translate-y-1
        ${large ? 'col-span-1 md:col-span-2 row-span-2' : 'col-span-1'}
        flex flex-col group
      `}>
                <div className="p-6 flex-1 flex flex-col relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className={`p-2 rounded-2xl bg-zinc-800 ${config.split(' ').pop()} group-hover:scale-110 transition-transform`}>
                            {icon}
                        </div>
                        {large && <div className="text-xs font-mono text-white/30 uppercase tracking-widest">Live Monitor</div>}
                    </div>

                    <h3 className="text-sm font-medium text-white/60 mb-1">{title}</h3>

                    {children ? (
                        <div className="mt-2 flex-1 flex flex-col min-w-0">{children}</div>
                    ) : (
                        <>
                            <div className="text-3xl font-light text-white tracking-tight">{value}</div>
                            <div className="text-xs text-white/40 mt-2 font-light">{subtitle}</div>
                        </>
                    )}
                </div>

                {/* Decorative Glow */}
                <div className={`absolute -right-10 -bottom-10 w-40 h-40 bg-gradient-to-br rounded-full blur-[60px] opacity-0 group-hover:opacity-20 transition-opacity duration-500 ${config.split(' ')[0]}`} />
            </div>
        );
    };

    // -- Dynamic Content Renderers --

    const renderContent = () => {
        switch (activeTab) {
            case 'Intelligence':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-fade-in">
                        {/* 1.1 RL - Large Card */}
                        <ModernCard title="Reinforcement Loop" accent="emerald" icon={<Icons.Chart className="w-5 h-5" />} large>
                            {signals.length > 0 ? (
                                <div className="h-48 w-full -ml-2 min-w-0">
                                    <ResponsiveContainer width="100%" height="100%" minWidth={100}>
                                        <AreaChart data={signals}>
                                            <defs>
                                                <linearGradient id="colorReward" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#2fc97f" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#2fc97f" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#141412', border: '1px solid #2f2f2f', borderRadius: '12px' }}
                                                itemStyle={{ color: '#b7b7b1' }}
                                            />
                                            <Area type="monotone" dataKey="rewardScore" stroke="#2fc97f" strokeWidth={2} fillOpacity={1} fill="url(#colorReward)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-48 w-full min-w-0 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-500/20 bg-emerald-500/5 text-center">
                                    <Icons.Chart className="h-6 w-6 text-emerald-500/60" />
                                    <p className="text-sm font-medium text-zinc-200">No feedback yet</p>
                                    <p className="max-w-[240px] text-[11px] leading-relaxed text-zinc-500">Resolved trades will create the first reinforcement signal.</p>
                                </div>
                            )}
                            <div className="flex justify-between items-end mt-4">
                                <div className="text-2xl font-light text-emerald-400">
                                    {signals.length > 0 ? (signals.reduce((a, b) => a + b.rewardScore, 0) / signals.length).toFixed(2) : '—'}
                                    <span className="text-sm text-emerald-500/50 ml-2">Avg Reward</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="text-xs text-emerald-500/40 font-mono">Real-time Feedback</div>
                                    <div className="text-[10px] text-zinc-500">{signals.length > 0 ? `Last: ${new Date(signals[signals.length - 1].timestamp).toLocaleTimeString()}` : 'Awaiting first resolved trade'}</div>
                                </div>
                            </div>
                        </ModernCard>

                        {/* 1.2 Skill Library (replaced the retired IF/THEN rule extraction) */}
                        <ModernCard title="Skill Library" accent="purple" icon={<Icons.Brain className="w-5 h-5" />}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-2xl font-light text-white">{rules.length}</div>
                                <div className="text-xs text-white/40">Active Skills</div>
                            </div>

                            {rules.length > 0 ? (
                                <div className="flex flex-col h-full bg-purple-500/5 rounded-xl border border-purple-500/10 overflow-hidden">
                                    <div className="p-2 border-b border-purple-500/10">
                                        <select
                                            value={selectedRuleIndex}
                                            onChange={(e) => setSelectedRuleIndex(Number(e.target.value))}
                                            className="w-full bg-transparent text-xs text-purple-300 focus:outline-none cursor-pointer"
                                        >
                                            {rules.map((s, idx) => (
                                                <option key={idx} value={idx} className="bg-zinc-900 text-zinc-300">
                                                    Skill #{idx + 1}: {s.file.name.replace(/\.md$/i, '').substring(0, 24)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="p-3 overflow-y-auto max-h-[100px] custom-scrollbar scrollbar-thumb-purple-500/20">
                                        <p className="text-[10px] text-purple-200/80 font-mono leading-relaxed">
                                            <span className="text-purple-400 font-bold uppercase">{rules[selectedRuleIndex]?.meta.kind}</span> {' '}
                                            [{rules[selectedRuleIndex]?.meta.status} · {rules[selectedRuleIndex]?.meta.wins}W/{rules[selectedRuleIndex]?.meta.losses}L]
                                            <br />
                                            {rules[selectedRuleIndex]?.meta.ifCondition
                                                ? `IF ${rules[selectedRuleIndex]?.meta.ifCondition} THEN ${rules[selectedRuleIndex]?.meta.thenAction}`
                                                : rules[selectedRuleIndex]?.file.name.replace(/\.md$/i, '')}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-auto text-xs text-white/30 italic">No active skills yet.</div>
                            )}
                        </ModernCard>

                        {/* 1.3 Bayesian */}
                        <ModernCard
                            title="Bayesian Confidence"
                            value={highConfidenceWinRate != null ? `${highConfidenceWinRate}%` : 'No data'}
                            subtitle={highConfidenceWinRate != null ? 'High-confidence outcomes' : 'Log resolved high-confidence trades to calibrate'}
                            accent="zinc"
                            icon={<Icons.Sparkles className="w-5 h-5" />}
                        />

                        {/* 1.4 Memory */}
                        <ModernCard title="Knowledge Base" accent="amber" icon={<Icons.Server className="w-5 h-5" />}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-2xl font-light text-white">{insights.length}</div>
                                <div className="text-xs text-white/40">Stored Insights</div>
                            </div>

                            {insights.length > 0 ? (
                                <div className="flex flex-col h-full bg-amber-500/5 rounded-xl border border-amber-500/10 overflow-hidden">
                                    <div className="p-2 border-b border-amber-500/10">
                                        <select
                                            value={selectedInsightIndex}
                                            onChange={(e) => setSelectedInsightIndex(Number(e.target.value))}
                                            className="w-full bg-transparent text-xs text-amber-300 focus:outline-none cursor-pointer"
                                        >
                                            {insights.map((insight, idx) => (
                                                <option key={idx} value={idx} className="bg-zinc-900 text-zinc-300">
                                                    Insight #{idx + 1} ({insight.category})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="p-3 overflow-y-auto max-h-[100px] custom-scrollbar scrollbar-thumb-amber-500/20">
                                        <p className="text-[10px] text-amber-200/80 font-mono leading-relaxed">
                                            "{insights[selectedInsightIndex]?.insight}"
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between px-3 py-1.5 border-t border-amber-500/10">
                                        <span className="text-[9px] text-amber-200/50 font-mono">
                                            {insights[selectedInsightIndex]?.qualityScore ?? 50}/100 · {insights[selectedInsightIndex]?.timesUsed ?? 0} used · {insights[selectedInsightIndex]?.timesHelpful ?? 0} helpful
                                        </span>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleInsightFeedback(insights[selectedInsightIndex]?.id, true)}
                                                className="p-1 rounded text-[9px] bg-amber-500/10 hover:bg-amber-500/25 text-amber-200/80 hover:text-amber-200 transition-colors"
                                                title="Mark helpful"
                                                aria-label="Mark helpful"
                                            >
                                                <ThumbsUp className="h-3 w-3" />
                                            </button>
                                            <button
                                                onClick={() => handleInsightFeedback(insights[selectedInsightIndex]?.id, false)}
                                                className="p-1 rounded text-[9px] bg-amber-500/10 hover:bg-amber-500/25 text-amber-200/80 hover:text-amber-200 transition-colors"
                                                title="Mark not helpful"
                                                aria-label="Mark not helpful"
                                            >
                                                <ThumbsDown className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-auto text-xs text-white/30 italic">No insights stored yet.</div>
                            )}

                            {/* By-provider breakdown: which AI produced the
                                lessons and how their quality is tracking. */}
                            {Object.keys(providerStats).length > 0 && (
                                <div className="mt-2 pt-2 border-t border-amber-500/10">
                                    <div className="text-[9px] text-amber-200/50 font-mono mb-1">BY PROVIDER</div>
                                    <div className="flex flex-col gap-0.5">
                                        {Object.entries(providerStats)
                                            .sort((a, b) => b[1].count - a[1].count)
                                            .map(([provider, stat]) => (
                                                <div key={provider} className="flex items-center justify-between text-[9px] font-mono">
                                                    <span className="text-amber-200/70 truncate pr-2" title={provider}>{providerLabel(provider)}</span>
                                                    <span className="text-amber-200/40 whitespace-nowrap">{stat.count} · {stat.avgQuality}/100</span>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </ModernCard>

                        {/* 1.5 Global Learning */}
                        <ModernCard
                            title="Cross-Session Memory"
                            value={memoryStats.enabledCount > 0 ? `${memoryStats.enabledCount} active` : 'No files'}
                            subtitle={memoryStats.enabledCount > 0 ? `${memoryStats.charCount.toLocaleString()} chars injected` : 'Enable memory files to inject context'}
                            accent="zinc"
                            icon={<Icons.Server className="w-5 h-5" />}
                        />
                    </div>
                );

            case 'Algorithm':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-fade-in">
                        {/* 2.1 Monte Carlo */}
                        <ModernCard title="Regime Detection" value="Active" subtitle="ADX/ATR Trend Monitoring" accent="yellow" icon={<Icons.Zap className="w-5 h-5" />} />

                        {/* 2.2 Pattern Class - Real Output */}
                        <ModernCard title="Pattern Class." accent="purple" icon={<Icons.Zap className="w-5 h-5" />}>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {['Family A', 'Family B', 'Family C', 'Omega'].map(f => (
                                    <span key={f} className="px-2 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-[10px] text-purple-300">
                                        {f}
                                    </span>
                                ))}
                            </div>
                            <div className="mt-auto text-xs text-purple-400/60 pt-2">Detecting Live Patterns</div>
                        </ModernCard>

                        {/* 2.3 Kelly */}
                        <ModernCard title="Kelly Criterion" value="Enabled" subtitle="Risk/Trade Optimization" accent="emerald" icon={<Icons.Zap className="w-5 h-5" />}>
                            <div className="mt-auto flex justify-between items-end border-t border-emerald-500/20 pt-2">
                                <span className="text-xs text-emerald-500/60">Risk Source</span>
                                <span className="text-xs text-emerald-400 font-mono">Kelly Formula</span>
                            </div>
                        </ModernCard>

                        {/* 2.6 Schemas - With JSON Viewer */}
                        <ModernCard title="JSON Schemas" accent="zinc" icon={<Icons.Code className="w-5 h-5" />} large>
                            <div className="flex flex-col h-full">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs text-zinc-400 uppercase tracking-widest">Type Definitions (v2)</h4>
                                    <select
                                        value={selectedSchema}
                                        onChange={(e) => setSelectedSchema(e.target.value)}
                                        className="bg-zinc-800 text-[10px] text-zinc-300 rounded px-2 py-1 border border-zinc-700"
                                    >
                                        <option value="tradeValidation">Val. Gate</option>
                                        <option value="marketAnalysis">Analysis</option>
                                        <option value="postMortem">Post-Mortem</option>
                                    </select>
                                </div>
                                <div className="flex-1 bg-zinc-800 rounded-xl p-3 font-mono text-[9px] text-zinc-400 overflow-auto border border-white/5 custom-scrollbar">
                                    <div className="whitespace-pre">
                                        {typeof validationSchemas[selectedSchema] === 'string'
                                            ? validationSchemas[selectedSchema]
                                            : JSON.stringify(validationSchemas[selectedSchema] || { type: 'object' }, null, 2)}
                                    </div>
                                </div>
                            </div>
                        </ModernCard>

                        <ModernCard title="Entry Timing" value="Wait/Enter" subtitle="Limit Order Logic" accent="blue" icon={<Icons.Zap className="w-5 h-5" />} />
                    </div>
                );

            case 'System':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-fade-in">
                        {/* 3.4 Storage - Real Output */}
                        <ModernCard title="Unified Storage" accent="blue" icon={<Icons.Server className="w-5 h-5" />}>
                            <div className="mt-1">
                                <span className="text-3xl font-light text-white">{storageCount}</span>
                                <span className="text-xs text-blue-400 ml-2">Items</span>
                            </div>
                            <div className="mt-2 text-xs text-white/40">Across IndexedDB & Local</div>
                        </ModernCard>

                        {/* 3.3 Job Queue - Real Output */}
                        <ModernCard title="Job Queue" accent="emerald" icon={<Icons.Server className="w-5 h-5" />}>
                            <div className="mt-1 flex items-baseline">
                                <span className={`text-3xl font-light ${queueSize > 0 ? 'text-emerald-400 animate-pulse' : 'text-white'}`}>{queueSize}</span>
                                <span className="text-xs text-emerald-400/60 ml-2">Pending Jobs</span>
                            </div>
                            <div className="mt-2 text-xs text-white/40">{queueSize === 0 ? 'Workers Idle' : 'Processing...'}</div>
                        </ModernCard>

                        <ModernCard title="Schema Version" value="v2.0.0" subtitle="Migration Status: Done" accent="zinc" icon={<Icons.Server className="w-5 h-5" />} />
                        <ModernCard title="Rule Engine" value="Unified" subtitle="Centralized Logic" accent="purple" icon={<Icons.Server className="w-5 h-5" />} />
                    </div>
                );
        }
    };

    return (
        <div className=" fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />

            {/* Main Container */}
            <div className="relative w-full max-w-6xl h-[85vh] bg-zinc-950 rounded-[2.5rem] border border-zinc-800 shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/5">

                {/* Header Section */}
                <div className="px-8 py-6 flex items-center justify-between bg-zinc-950 z-20">
                    <div className="flex items-center gap-4">
                        <div className="bg-zinc-800 border border-zinc-700 p-2 rounded-xl">
                            <Icons.Sparkles className="text-zinc-300 w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-xl font-medium text-white tracking-tight">System Intelligence</h1>
                            <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono mt-0.5">
                                Learning & runtime overview
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <span aria-label="System version" className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm font-mono rounded-xl py-2 px-4">
                            v{APP_VERSION}
                        </span>

                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all duration-200"
                        >
                            <Icons.Close className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="px-8 pb-2">
                    <div className="flex p-1 bg-zinc-900 rounded-2xl w-fit border border-white/5">
                        {['Intelligence', 'Algorithm', 'System'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`
                       px-6 py-2 rounded-xl text-sm font-medium transition-all duration-300
                       ${activeTab === tab
                                        ? 'bg-zinc-800 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}
                    `}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 p-8 overflow-y-auto bg-gradient-to-b from-zinc-950 to-zinc-900/50">
                    {renderContent()}
                </div>

            </div>
        </div>
    );
};
