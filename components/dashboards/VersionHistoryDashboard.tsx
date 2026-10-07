
import React, { useState, useEffect } from 'react';
import {ThumbsDown, ThumbsUp, Brain, Server, Target, AreaChart as AreaChartIcon} from '../shared/Icons';
import { Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { APP_VERSION } from '../../constants/version';

// Import services
import { ReinforcementSignalService, ReinforcementSignal } from '../../services/learning/ReinforcementSignalService';
import { getCalibrationSummary } from '../../services/validation/calibrationStore';
import { fmtPercent } from '../../utils/formatters';
import { chartColor } from '../../utils/themeColors';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
import { storageService } from '../../services/infrastructure/StorageService';
import { getAttributedInsightsSummary } from '../../services/learning/severityInsights';
import { recordInsightFeedback } from '../../services/learning/PatternMemorySynthesisService';
import { jobQueue } from '../../services/infrastructure/JobQueueService';
import { ConfidenceCalibration } from '../../types';
import { listSkills } from '../../services/learning/SkillMemoryService';
import { getMemoryFilesStats } from '../../services/learning/MemoryFilesService';

// -- ICONS (lucide-react) --

import { phtClockSeconds } from '../../utils/timezone';

const Icons = {
    Brain,
    Server,
    Chart: AreaChartIcon,
    Target,
};

export const VersionHistoryDashboard: React.FC = () => {
    // Stage 3: this dashboard has ONE home — the Learn surface's System tab.
    // Its header-overlay shell (opened by the header's clock button), the
    // tab strip and the "Algorithm" placeholder cards are all deleted; what
    // is left is real, measured data, stacked in one scroll.
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
            emerald: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400",
            amber: "from-amber-500/20 to-amber-500/5 border-amber-500/20 text-amber-400",
            yellow: "from-amber-500/20 to-amber-500/5 border-amber-500/20 text-amber-400",
            rose: "from-rose-500/20 to-rose-500/5 border-rose-500/20 text-rose-400",
            zinc: "from-zinc-800/50 to-zinc-900/50 border-zinc-700/50 text-zinc-400"
        };

        const config = accentColors[accent] || accentColors.blue;

        return (
            <div className={`
        relative overflow-hidden
        bg-gradient-to-br ${config.split(' ')[0]} ${config.split(' ')[1]}
        rounded-3xl border border-white/5
        transition-[border-color,box-shadow,transform] duration-[150ms] ease-[var(--ease-snappy)] hover:shadow-2xl hover:border-white/10 hover:-translate-y-1
        ${large ? 'col-span-1 md:col-span-2 row-span-2' : 'col-span-1'}
        flex flex-col group
      `}>
                <div className="p-6 flex-1 flex flex-col relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className={`p-2 rounded-2xl bg-zinc-800 ${config.split(' ').pop()} group-hover:scale-110 transition-transform duration-[150ms] ease-[var(--ease-snappy)]`}>
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
                <div className={`absolute -right-10 -bottom-10 w-40 h-40 bg-gradient-to-br rounded-full blur-[60px] opacity-0 group-hover:opacity-20 transition-opacity duration-[150ms] ${config.split(' ')[0]}`} />
            </div>
        );
    };

    // -- Dynamic Content Renderers --

    const renderContent = (section: 'Intelligence' | 'System'): React.ReactElement => {
        switch (section) {
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
                                                    <stop offset="5%" stopColor={chartColor('--color-emerald-400', '#2fc97f')} stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor={chartColor('--color-emerald-400', '#2fc97f')} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: chartColor('--color-zinc-900', '#141412'), border: `1px solid ${chartColor('--color-zinc-700', '#2f2f2f')}`, borderRadius: '12px' }}
                                                itemStyle={{ color: chartColor('--color-zinc-300', '#b7b7b1') }}
                                            />
                                            <Area type="monotone" dataKey="rewardScore" stroke={chartColor('--color-emerald-400', '#2fc97f')} strokeWidth={2} fillOpacity={1} fill="url(#colorReward)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-48 w-full min-w-0 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-500/20 bg-emerald-500/5 text-center">
                                    <Icons.Chart className="h-6 w-6 text-emerald-500/60" />
                                    <p className="text-sm font-medium text-zinc-200">No feedback yet</p>
                                    <p className="max-w-[240px] text-ui-dense leading-relaxed text-zinc-500">Resolved trades will create the first reinforcement signal.</p>
                                </div>
                            )}
                            <div className="flex justify-between items-end mt-4">
                                <div className="text-2xl font-light text-emerald-400">
                                    {signals.length > 0 ? (signals.reduce((a, b) => a + b.rewardScore, 0) / signals.length).toFixed(2) : '—'}
                                    <span className="text-sm text-emerald-500/50 ml-2">Avg Reward</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="text-xs text-emerald-500/40 font-mono">Real-time Feedback</div>
                                    <div className="text-ui-xs text-zinc-500">{signals.length > 0 ? `Last: ${phtClockSeconds(signals[signals.length - 1].timestamp)}` : 'Awaiting first resolved trade'}</div>
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
                                <div className="flex flex-col h-full">
                                    <div className="pb-2">
                                        <select
                                            value={selectedRuleIndex}
                                            onChange={(e) => setSelectedRuleIndex(Number(e.target.value))}
                                            className="hit-target w-full bg-transparent text-xs text-zinc-300 focus:outline-none cursor-pointer"
                                        >
                                            {rules.map((s, idx) => (
                                                <option key={idx} value={idx} className="bg-zinc-900 text-zinc-300">
                                                    Skill #{idx + 1}: {s.file.name.replace(/\.md$/i, '').substring(0, 24)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="border-t border-zinc-800/80 py-2 overflow-y-auto max-h-[100px] custom-scrollbar">
                                        <p className="text-ui-xs text-zinc-300 font-mono leading-relaxed">
                                            <span className="text-zinc-400 font-bold uppercase">{rules[selectedRuleIndex]?.meta.kind}</span> {' '}
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
                            value={highConfidenceWinRate != null ? fmtPercent(highConfidenceWinRate, 0) : 'No data'}
                            subtitle={highConfidenceWinRate != null ? 'High-confidence outcomes' : 'Log resolved high-confidence trades to calibrate'}
                            accent="zinc"
                            icon={<Icons.Target className="w-5 h-5" />}
                        />

                        {/* 1.4 Memory */}
                        <ModernCard title="Knowledge Base" accent="amber" icon={<Icons.Server className="w-5 h-5" />}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-2xl font-light text-white">{insights.length}</div>
                                <div className="text-xs text-white/40">Stored Insights</div>
                            </div>

                            {insights.length > 0 ? (
                                <div className="flex flex-col h-full">
                                    <div className="pb-2">
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
                                    <div className="border-t border-zinc-800/80 py-2 overflow-y-auto max-h-[100px] custom-scrollbar">
                                        <p className="text-ui-xs text-amber-200/80 font-mono leading-relaxed">
                                            "{insights[selectedInsightIndex]?.insight}"
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between border-t border-zinc-800/80 py-1.5">
                                        <span className="text-ui-2xs text-amber-200/50 font-mono">
                                            {insights[selectedInsightIndex]?.qualityScore ?? 50}/100 · {insights[selectedInsightIndex]?.timesUsed ?? 0} used · {insights[selectedInsightIndex]?.timesHelpful ?? 0} helpful
                                        </span>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleInsightFeedback(insights[selectedInsightIndex]?.id, true)}
                                                className="p-1 rounded text-ui-2xs bg-amber-500/10 hover:bg-amber-500/25 text-amber-200/80 hover:text-amber-200 transition-colors"
                                                title="Mark helpful"
                                                aria-label="Mark helpful"
                                            >
                                                <ThumbsUp className="h-3 w-3" />
                                            </button>
                                            <button
                                                onClick={() => handleInsightFeedback(insights[selectedInsightIndex]?.id, false)}
                                                className="p-1 rounded text-ui-2xs bg-amber-500/10 hover:bg-amber-500/25 text-amber-200/80 hover:text-amber-200 transition-colors"
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
                                <div className="mt-2 pt-2 border-t border-zinc-800/80">
                                    <div className="text-ui-2xs text-amber-200/50 font-mono mb-1">BY PROVIDER</div>
                                    <div className="flex flex-col gap-0.5">
                                        {Object.entries(providerStats)
                                            .sort((a, b) => b[1].count - a[1].count)
                                            .map(([provider, stat]) => (
                                                <div key={provider} className="flex items-center justify-between text-ui-2xs font-mono">
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


            case 'System':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full animate-fade-in">
                        {/* 3.4 Storage - Real Output */}
                        <ModernCard title="Unified Storage" accent="blue" icon={<Icons.Server className="w-5 h-5" />}>
                            <div className="mt-1">
                                <span className="text-3xl font-light text-white">{storageCount}</span>
                                <span className="text-xs text-zinc-400 ml-2">Items</span>
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
                        {/* "Schema Version v2.0.0" and "Rule Engine: Unified" cards are
                            deleted — hardcoded strings that measured nothing. */}
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col gap-4 bg-zinc-950" data-testid="system-intelligence-embedded">
            {/* Identity + the running version — the one place this screen says
                which build the trader is on. The Learn tab owns the chrome. */}
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2.5">
                <div className="flex items-center gap-2.5">
                    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5">
                        <Icons.Brain className="h-4 w-4 text-zinc-300" />
                    </div>
                    <div>
                        <h2 className="text-ui-caption font-medium text-zinc-100">System Intelligence</h2>
                        <p className="text-ui-2xs font-mono text-zinc-500">Learning &amp; runtime overview</p>
                    </div>
                </div>
                <span aria-label="System version" className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-ui-dense text-zinc-300">
                    v{APP_VERSION}
                </span>
            </div>

            {renderContent('Intelligence')}
            {renderContent('System')}
        </div>
    );
};
