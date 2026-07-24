
import React, { useState, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';

// Import services
import { ReinforcementSignalService, ReinforcementSignal } from '../../services/learning/ReinforcementSignalService';
import { getCalibrationSummary, initializeCalibration } from '../../services/validation/ConfidenceCalibrationService';
import { storageService } from '../../services/infrastructure/StorageService';
import { getAttributedInsightsSummary } from '../../services/learning/InsightExtractionService';
import { jobQueue } from '../../services/infrastructure/JobQueueService'; // Import JobQueue
import { AIProvider, ConfidenceCalibration, LearningRule } from '../../types';
import {
    GATE_SCAN_JSON_SCHEMA,
    MASTER_TRADE_PLAN_JSON_SCHEMA,
    DUAL_SCENARIO_JSON_SCHEMA
} from '../../constants/schemas';

// Map schemas for display
const validationSchemas: Record<string, any> = {
    tradeValidation: JSON.parse(GATE_SCAN_JSON_SCHEMA),
    marketAnalysis: JSON.parse(MASTER_TRADE_PLAN_JSON_SCHEMA),
    postMortem: JSON.parse(DUAL_SCENARIO_JSON_SCHEMA)
};

// -- ICONS (lucide-react) --
import { X, Brain, Zap, Server, CheckCircle, AreaChart as AreaChartIcon, Sparkles, ChevronDown, Code } from 'lucide-react';

const Icons = {
    Close: X,
    Brain,
    Zap,
    Server,
    Check: CheckCircle,
    Chart: AreaChartIcon,
    Sparkles,
    ChevronDown,
    Code,
};

export const VersionHistoryDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [selectedVersionId, setSelectedVersionId] = useState<string>('v6');
    const [activeTab, setActiveTab] = useState<'Intelligence' | 'Algorithm' | 'System'>('Intelligence');
    const [signals, setSignals] = useState<ReinforcementSignal[]>([]);
    const [calibration, setCalibration] = useState<ConfidenceCalibration | undefined>(undefined);
    const [rules, setRules] = useState<LearningRule[]>([]);
    const [insights, setInsights] = useState<any[]>([]);

    // Real-time System Stats
    const [queueSize, setQueueSize] = useState<number>(0);
    const [storageCount, setStorageCount] = useState<number>(0);

    // Selection states for dropdown outputs
    const [selectedRuleIndex, setSelectedRuleIndex] = useState<number>(0);
    const [selectedInsightIndex, setSelectedInsightIndex] = useState<number>(0);
    const [selectedSchema, setSelectedSchema] = useState<string>('tradeValidation');

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000); // Poll for queue updates
        return () => clearInterval(interval);
    }, []);

    const loadData = async () => {
        try {
            // 1. Intelligence Data
            const geminiSignals = await ReinforcementSignalService.getSignals(AIProvider.GEMINI, 20);
            setSignals(geminiSignals || []);

            setCalibration(storageService.loadSetting<ConfidenceCalibration>('confidence_calibration', initializeCalibration()));

            const r = storageService.loadLearningRules().rules || [];
            setRules(r);

            const iStats = getAttributedInsightsSummary();
            setInsights(iStats.topInsights || []);

            // 2. System Data
            setQueueSize(jobQueue.getQueueLength());

            // Simulate Storage Count (just for demo, usually async)
            const logs = await storageService.getTradeLogs();
            setStorageCount(logs.length + r.length + (iStats.totalInsights || 0));
        } catch (error) {
            console.error('[VersionHistoryDashboard] Failed to load data:', error);
        }
    };

    // -- Modern Card Component --
    const ModernCard = ({ title, value, subtitle, icon, accent = "blue", large = false, children }: any) => {
        const accentColors: any = {
            blue: "from-blue-500/20 to-cyan-500/5 border-blue-500/20 text-blue-400",
            purple: "from-purple-500/20 to-fuchsia-500/5 border-purple-500/20 text-purple-400",
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
        backdrop-blur-md rounded-3xl border border-white/5
        transition-all duration-300 hover:shadow-2xl hover:border-white/10 hover:-translate-y-1
        ${large ? 'col-span-1 md:col-span-2 row-span-2' : 'col-span-1'}
        flex flex-col group
      `}>
                <div className="p-6 flex-1 flex flex-col relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className={`p-2 rounded-2xl bg-white/5 ${config.split(' ').pop()} group-hover:scale-110 transition-transform`}>
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* 1.1 RL - Large Card */}
                        <ModernCard title="Reinforcement Loop" accent="emerald" icon={<Icons.Chart className="w-5 h-5" />} large>
                            <div className="h-48 w-full -ml-2 min-w-0">
                                <ResponsiveContainer width="100%" height="100%" minWidth={100}>
                                    <AreaChart data={signals.length ? signals : [{ timestamp: 0, rewardScore: 0 }]}>
                                        <defs>
                                            <linearGradient id="colorReward" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px' }}
                                            itemStyle={{ color: '#10B981' }}
                                        />
                                        <Area type="monotone" dataKey="rewardScore" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorReward)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex justify-between items-end mt-4">
                                <div className="text-2xl font-light text-emerald-400">
                                    {signals.length > 0 ? (signals.reduce((a, b) => a + b.rewardScore, 0) / signals.length).toFixed(2) : "0.00"}
                                    <span className="text-sm text-emerald-500/50 ml-2">Avg Reward</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="text-xs text-emerald-500/40 font-mono">Real-time Feedback</div>
                                    <div className="text-[10px] text-emerald-500/30">Last: {signals.length > 0 ? new Date(signals[signals.length - 1].timestamp).toLocaleTimeString() : '--:--'}</div>
                                </div>
                            </div>
                        </ModernCard>

                        {/* 1.2 Rule Extraction */}
                        <ModernCard title="Rule Extraction" accent="purple" icon={<Icons.Brain className="w-5 h-5" />}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-2xl font-light text-white">{rules.length}</div>
                                <div className="text-xs text-white/40">Rules Extracted</div>
                            </div>

                            {rules.length > 0 ? (
                                <div className="flex flex-col h-full bg-purple-500/5 rounded-xl border border-purple-500/10 overflow-hidden">
                                    <div className="p-2 border-b border-purple-500/10">
                                        <select
                                            value={selectedRuleIndex}
                                            onChange={(e) => setSelectedRuleIndex(Number(e.target.value))}
                                            className="w-full bg-transparent text-xs text-purple-300 focus:outline-none cursor-pointer"
                                        >
                                            {rules.map((rule, idx) => (
                                                <option key={idx} value={idx} className="bg-zinc-900 text-gray-300">
                                                    Rule #{idx + 1}: {rule.ifCondition.substring(0, 20)}...
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="p-3 overflow-y-auto max-h-[100px] scrollbar-thin scrollbar-thumb-purple-500/20">
                                        <p className="text-[10px] text-purple-200/80 font-mono leading-relaxed">
                                            <span className="text-purple-400 font-bold">IF</span> {rules[selectedRuleIndex]?.ifCondition} <br />
                                            <span className="text-purple-400 font-bold">THEN</span> {rules[selectedRuleIndex]?.thenAction}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-auto text-xs text-white/30 italic">No rules extracted yet.</div>
                            )}
                        </ModernCard>

                        {/* 1.3 Bayesian */}
                        <ModernCard
                            title="Bayesian Confidence"
                            value={calibration ? (getCalibrationSummary(calibration).high.winRate ?? 'N/A') + '%' : 'N/A'}
                            subtitle="High Confidence Accuracy"
                            accent="blue"
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
                                                <option key={idx} value={idx} className="bg-zinc-900 text-gray-300">
                                                    Insight #{idx + 1} ({insight.category})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="p-3 overflow-y-auto max-h-[100px] scrollbar-thin scrollbar-thumb-amber-500/20">
                                        <p className="text-[10px] text-amber-200/80 font-mono leading-relaxed">
                                            "{insights[selectedInsightIndex]?.insight}"
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-auto text-xs text-white/30 italic">No insights stored yet.</div>
                            )}
                        </ModernCard>

                        {/* 1.5 Global Learning */}
                        <ModernCard
                            title="Cross-Session Memory"
                            value="Active"
                            subtitle="Context Injection Online"
                            accent="zinc"
                            icon={<Icons.Server className="w-5 h-5" />}
                        />
                    </div>
                );

            case 'Algorithm':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                                <div className="flex-1 bg-black/40 rounded-xl p-3 font-mono text-[9px] text-zinc-400 overflow-auto border border-white/5 scrollbar-thin scrollbar-thumb-zinc-700">
                                    <div className="whitespace-pre">
                                        {JSON.stringify(validationSchemas[selectedSchema] || { type: 'object' }, null, 2)}
                                    </div>
                                </div>
                            </div>
                        </ModernCard>

                        <ModernCard title="Entry Timing" value="Wait/Enter" subtitle="Limit Order Logic" accent="blue" icon={<Icons.Zap className="w-5 h-5" />} />
                    </div>
                );

            case 'System':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" onClick={onClose} />

            {/* Main Container */}
            <div className="relative w-full max-w-6xl h-[85vh] bg-zinc-950 rounded-[2.5rem] border border-zinc-800 shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/5">

                {/* Header Section */}
                <div className="px-8 py-6 flex items-center justify-between bg-zinc-950/50 backdrop-blur-sm z-20">
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-br from-blue-600 to-cyan-400 p-0.5 rounded-xl shadow-lg shadow-blue-500/20">
                            <div className="bg-zinc-950 p-2 rounded-[10px]">
                                <Icons.Sparkles className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 w-6 h-6" />
                            </div>
                        </div>
                        <div>
                            <h1 className="text-xl font-medium text-white tracking-tight">System Intelligence</h1>
                            <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono mt-0.5">
                                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                v6.0.0 Live
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Version Selector Dropdown - Cleaned up (Removed v4/v5 per request) */}
                        <div className="relative group">
                            <select
                                value={selectedVersionId}
                                onChange={(e) => setSelectedVersionId(e.target.value)}
                                className="appearance-none bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-xl py-2 pl-4 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500 hover:bg-zinc-800 transition-colors"
                            >
                                <option value="v6">Version 6.0 (Current)</option>
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                                <Icons.ChevronDown className="w-4 h-4" />
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-all duration-200"
                        >
                            <Icons.Close className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="px-8 pb-2">
                    <div className="flex p-1 bg-zinc-900/80 rounded-2xl w-fit border border-white/5 backdrop-blur-sm">
                        {['Intelligence', 'Algorithm', 'System'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`
                       px-6 py-2 rounded-xl text-sm font-medium transition-all duration-300
                       ${activeTab === tab
                                        ? 'bg-zinc-800 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}
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
