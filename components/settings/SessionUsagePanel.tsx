import React, { useEffect, useMemo, useState } from 'react';
import { clearSessionUsage, loadSessionUsage, SessionUsageEntry, summarizeModelUsage, summarizeUsagePeriod } from '../../utils/sessionUsage';
import { getHarnessSettings, saveHarnessSettings } from '../../utils/harnessSettings';
import { loadChecklistConfig, saveChecklistConfig } from '../../utils/checklist';
import { formatChars } from '../../utils/runUsage';
import { formatModelDisplayName } from '../../utils/providerUtils';

const SLICE_COLORS = ['#8aabd8', '#b0b0b6', '#648dc6', '#6f6f78', '#d2d2d6', '#39587f', '#85858d'];

const startOfToday = (): number => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

const polar = (cx: number, cy: number, r: number, angle: number): { x: number; y: number } => {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arcPath = (start: number, sweep: number): string => {
    const s = polar(40, 40, 28, start);
    const e = polar(40, 40, 28, start + sweep);
    return `M ${s.x} ${s.y} A 28 28 0 ${sweep > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
};

const SessionUsagePanel: React.FC = () => {
    const [entries, setEntries] = useState<SessionUsageEntry[]>([]);

    useEffect(() => {
        void loadSessionUsage().then(setEntries);
    }, []);

    const today = useMemo(() => summarizeUsagePeriod(entries, startOfToday()), [entries]);
    const week = useMemo(() => summarizeUsagePeriod(entries, Date.now() - 7 * 24 * 60 * 60 * 1000), [entries]);
    const models = useMemo(() => summarizeModelUsage(entries, startOfToday()), [entries]);
    const topModel = models[0];
    const todayTokens = today.promptTokens + today.completionTokens || today.tokensEst;

    const renderSummary = (label: string, s: ReturnType<typeof summarizeUsagePeriod>): React.ReactNode => {
        const tokens = s.promptTokens + s.completionTokens || s.tokensEst;
        return (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[11px] text-zinc-500">{label}</p>
                <p className="mt-1 text-sm text-zinc-100">{s.runs} runs · {Math.round(s.durationMs / 1000)}s</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                    {s.tokensExact ? '' : '~'}{formatChars(tokens)} tok
                    {s.costUsd > 0 ? ` · $${s.costUsd.toFixed(3)}` : ''}
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div>
                <h4 className="text-sm font-bold text-white">Usage</h4>
                <p className="text-xs text-zinc-500 mt-0.5">Tokens from provider responses when available; otherwise estimated from output size.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {renderSummary('Today', today)}
                {renderSummary('Last 7 days', week)}
            </div>
            {models.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Today by model</p>
                    <div className="mt-3 flex items-center gap-4">
                        <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0" aria-hidden="true">
                            {models.reduce<{ offset: number; nodes: React.ReactNode[] }>((acc, slice, index) => {
                                const sweep = Math.max(2, slice.share * 360);
                                acc.nodes.push(
                                    <path
                                        key={slice.modelId}
                                        d={arcPath(acc.offset, Math.min(359.9, sweep))}
                                        fill="none"
                                        stroke={SLICE_COLORS[index % SLICE_COLORS.length]}
                                        strokeWidth="10"
                                    />,
                                );
                                acc.offset += sweep;
                                return acc;
                            }, { offset: 0, nodes: [] }).nodes}
                            <circle cx="40" cy="40" r="18" fill="#161618" />
                        </svg>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-zinc-100">{today.tokensExact ? '' : '~'}{formatChars(todayTokens)} tok today</p>
                            {topModel && (
                                <p className="mt-1 text-[11px] text-zinc-400">
                                    Top model · {formatModelDisplayName(topModel.modelId)} · {Math.round(topModel.share * 100)}%
                                </p>
                            )}
                            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label="Token share by model">
                                {models.map((slice, index) => (
                                    <div
                                        key={slice.modelId}
                                        className="h-full"
                                        style={{ width: `${Math.max(2, slice.share * 100)}%`, background: SLICE_COLORS[index % SLICE_COLORS.length] }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                    <ul className="mt-3 space-y-1">
                        {models.map((slice, index) => (
                            <li key={slice.modelId} className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                                <span className="flex min-w-0 items-center gap-2">
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }} />
                                    <span className="truncate" title={slice.modelId}>{formatModelDisplayName(slice.modelId)}</span>
                                </span>
                                <span className="shrink-0 tabular-nums">{formatChars(slice.tokens)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {entries.length > 0 && (
                <button
                    type="button"
                    className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    onClick={() => { void clearSessionUsage().then(() => setEntries([])); }}
                >
                    Clear usage history
                </button>
            )}
            <HarnessControls />
        </div>
    );
};

const HarnessControls: React.FC = () => {
    const [settings, setSettings] = useState(getHarnessSettings);
    const [checklist, setChecklist] = useState(loadChecklistConfig);
    const persist = (next: Partial<ReturnType<typeof getHarnessSettings>>): void => {
        setSettings(saveHarnessSettings(next));
    };
    return (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Harness</p>
            <label className="block text-[11px] text-zinc-400">
                Account equity (USD)
                <input
                    type="number"
                    min={100}
                    value={settings.equityUsd}
                    onChange={e => persist({ equityUsd: Number(e.target.value) || 10_000 })}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                />
            </label>
            <label className="block text-[11px] text-zinc-400">
                Risk per ticket (%)
                <input
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={settings.riskPercent}
                    onChange={e => persist({ riskPercent: Math.min(10, Math.max(0.1, Number(e.target.value) || 1)) })}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                />
            </label>
            <label className="block text-[11px] text-zinc-400">
                Prompt A/B (control lane)
                <select
                    value={String(settings.promptAbRate)}
                    onChange={e => persist({ promptAbRate: Number(e.target.value) as 0 | 0.1 | 0.5 })}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                >
                    <option value="0">Off</option>
                    <option value="0.1">10%</option>
                    <option value="0.5">50%</option>
                </select>
            </label>
            {/* Session-guard limits (plan §3b/§14-8): preset + overrides.
                Takes effect immediately here; the in-the-moment cap change
                rule (typed confirm) applies to the banner, not this panel. */}
            <label className="block text-[11px] text-zinc-400">
                Session guard preset
                <select
                    value={settings.guardPreset ?? 'default'}
                    onChange={e => persist({ guardPreset: e.target.value as 'default' | 'ftmo' })}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                >
                    <option value="default">Tight — 2% day / 2 trades / 4h cooldown</option>
                    <option value="ftmo">FTMO — 3% day / 3 trades / 4h cooldown</option>
                </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-zinc-400">
                    Daily loss limit (%)
                    <input
                        type="number"
                        min={0.5}
                        max={25}
                        step={0.5}
                        placeholder="preset"
                        value={settings.guardDailyLossPct ?? ''}
                        onChange={e => persist({ guardDailyLossPct: e.target.value === '' ? undefined : Math.min(25, Math.max(0.5, Number(e.target.value))) })}
                        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                    />
                </label>
                <label className="block text-[11px] text-zinc-400">
                    Max trades / day
                    <input
                        type="number"
                        min={1}
                        max={20}
                        placeholder="preset"
                        value={settings.guardMaxTradesPerDay ?? ''}
                        onChange={e => persist({ guardMaxTradesPerDay: e.target.value === '' ? undefined : Math.min(20, Math.max(1, Math.floor(Number(e.target.value)))) })}
                        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                    />
                </label>
            </div>
            {/* Pre-trade checklist (plan §4.3): OFF by default; when on, the
                capture modal shows the items and completion rides onto the
                trade (checklistCompleted) feeding adherence stats. */}
            <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={checklist.enabled}
                    onChange={e => setChecklist(saveChecklistConfig({ ...checklist, enabled: e.target.checked }))}
                    className="rounded border-zinc-700 bg-zinc-950"
                />
                Pre-trade checklist at capture (off by default)
            </label>
            <label className="block text-[11px] text-zinc-400">
                Debate cost cap (USD, 0 = off)
                <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={settings.debateCostCapUsd}
                    onChange={e => persist({ debateCostCapUsd: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                />
            </label>
        </div>
    );
};

export default React.memo(SessionUsagePanel);
