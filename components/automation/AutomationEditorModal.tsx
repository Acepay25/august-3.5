import React, { useMemo, useState } from 'react';
import { AutomationConfig, AutomationInputSource, AutomationMode, AutomationModelPick } from '../../types/automation';
import { parseCron, nextCronTime, humanizeCron } from '../../services/automation/cronParser';
import { ProviderConfig } from '../../types/provider';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import ModelPicker from '../shared/ModelPicker';
import { useEscapeClose } from '../../hooks/useEscapeClose';

export interface ModelOption {
    value: string; // `${providerId}::${modelId}`
    label: string;
}

/** Days of the week in cron dow values (0 = Sunday), display order Mon..Sun. */
const WEEK_DAYS: { dow: number; label: string }[] = [
    { dow: 1, label: 'Mon' },
    { dow: 2, label: 'Tue' },
    { dow: 3, label: 'Wed' },
    { dow: 4, label: 'Thu' },
    { dow: 5, label: 'Fri' },
    { dow: 6, label: 'Sat' },
    { dow: 0, label: 'Sun' },
];

const ALL_DAYS = WEEK_DAYS.map(d => d.dow);

const DAY_PRESETS: { label: string; days: number[] }[] = [
    { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
    { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
    { label: 'Weekends', days: [0, 6] },
    { label: 'Every other day', days: [1, 3, 5, 0] }, // Mon, Wed, Fri, Sun
];

interface ParsedDailySchedule {
    days: number[];
    hour: number;
    minute: number;
    second: number;
}

export type AutomationFrequencyMode = 'daily' | 'minutes' | 'hours';

interface ParsedScheduleState {
    frequency: AutomationFrequencyMode;
    /** Step for 'minutes'/'hours' modes (e.g. 30 for every 30 min). */
    every: number;
    days: number[];
    hour: number;
    minute: number;
    second: number;
}

/** Arithmetic step of a sorted value set (used to recover star-slash-N steps). */
const stepOf = (values: number[]): number => (values.length >= 2 ? values[1] - values[0] : 1);

/**
 * Parse an existing cron back into the editor state. Handles:
 *   daily   — 6-field "s m h * * dow" or legacy 5-field "m h * * dow"
 *   minutes — minute-step shape (e.g. every 30 min: "star/30 * * * dow")
 *   hours   — hour-step shape (e.g. every 3 h: "0 star/3 * * dow")
 * Returns null for custom expressions (kept in the Advanced field).
 */
const parseScheduleState = (cron: string | undefined): ParsedScheduleState | null => {
    const fields = cron ? parseCron(cron) : null;
    if (!fields) return null;
    if (fields.dom !== null || fields.month !== null) return null;

    // '*' fields mean the full range.
    const minutes = fields.minute !== null
        ? [...fields.minute].sort((a, b) => a - b)
        : Array.from({ length: 60 }, (_, i) => i);
    const hours = fields.hour !== null
        ? [...fields.hour].sort((a, b) => a - b)
        : Array.from({ length: 24 }, (_, i) => i);
    const second = fields.second !== null ? [...fields.second][0] ?? 0 : 0;

    const dowValues = fields.dow !== null ? [...fields.dow].map(v => (v === 7 ? 0 : v)) : ALL_DAYS;

    // Frequency shapes: a stepped minute field over all hours = "every N
    // minutes"; a stepped hour field with a single minute = "every N hours".
    if (minutes.length > 1 && hours.length === 24) {
        return { frequency: 'minutes', every: stepOf(minutes), days: dowValues, hour: hours[0], minute: minutes[0], second };
    }
    if (hours.length > 1 && minutes.length === 1) {
        return { frequency: 'hours', every: stepOf(hours), days: dowValues, hour: hours[0], minute: minutes[0], second };
    }
    if (minutes.length === 1 && hours.length === 1) {
        return { frequency: 'daily', every: 1, days: dowValues, hour: hours[0], minute: minutes[0], second };
    }
    return null;
};

/** Build the storage cron from the editor state. */
const buildScheduleCron = (
    frequency: AutomationFrequencyMode,
    every: number,
    days: number[],
    hour: number,
    minute: number,
    second: number
): string => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const dow = sorted.length === 0 ? '*' : sorted.join(',');

    if (frequency === 'minutes') {
        // Every N minutes: minute step, all hours, selected days.
        // (5-field: minute hour dom month dow — "star/30 * * * dow".)
        return every <= 1 ? `* * * * ${dow}` : `*/${every} * * * ${dow}`;
    }
    if (frequency === 'hours') {
        // Every N hours: minute 0, hour step, selected days.
        return every <= 1 ? `0 * * * ${dow}` : `0 */${every} * * ${dow}`;
    }
    // Once per day at the chosen time on the selected days.
    return `${second} ${minute} ${hour} * * ${dow}`;
};

interface AutomationEditorModalProps {
    isVisible: boolean;
    /** The automation being edited; undefined = create new. */
    initial?: AutomationConfig;
    modelOptions: ModelOption[];
    providers: ProviderConfig[];
    onClose: () => void;
    onSave: (config: AutomationConfig) => void;
    onDelete?: () => void;
}

const splitOption = (value: string): { providerId: string; modelId: string } => {
    const sep = value.indexOf('::');
    return sep >= 0
        ? { providerId: value.slice(0, sep), modelId: value.slice(sep + 2) }
        : { providerId: value, modelId: '' };
};

const AutomationEditorModal: React.FC<AutomationEditorModalProps> = ({ isVisible, initial, modelOptions, providers, onClose, onSave, onDelete }) => {
    const [name, setName] = useState(initial?.name ?? '');
    // Schedule = frequency (once per day, or every N minutes/hours) +
    // days-of-week toggles + a time of day (h/m/s for the daily mode).
    // The storage cron is generated from these; a custom cron can override
    // them via the Advanced field (existing non-daily schedules).
    const [frequencyMode, setFrequencyMode] = useState<AutomationFrequencyMode>(() => parseScheduleState(initial?.schedule.cron)?.frequency ?? 'daily');
    const [frequencyEvery, setFrequencyEvery] = useState<number>(() => {
        const p = parseScheduleState(initial?.schedule.cron);
        return p && p.frequency !== 'daily' ? p.every : 30;
    });
    const [scheduleDays, setScheduleDays] = useState<number[]>(() => parseScheduleState(initial?.schedule.cron)?.days ?? ALL_DAYS);
    const [scheduleTime, setScheduleTime] = useState<{ h: number; m: number; s: number }>(() => {
        const p = parseScheduleState(initial?.schedule.cron);
        return p ? { h: p.hour, m: p.minute, s: p.second } : { h: 9, m: 0, s: 0 };
    });
    const [advancedCron, setAdvancedCron] = useState<string>(() => {
        // Pre-fill the advanced field ONLY when the existing schedule is a
        // custom expression the day/time UI cannot represent.
        return parseScheduleState(initial?.schedule.cron) ? '' : (initial?.schedule.cron ?? '');
    });
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [inputSource, setInputSource] = useState<AutomationInputSource>(initial?.inputSource ?? 'template');
    const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? '');
    const [mode, setMode] = useState<AutomationMode>(initial?.mode ?? 'standard');
    const [useLenses, setUseLenses] = useState(initial?.useLenses ?? false);
    const [lensTradingStyle, setLensTradingStyle] = useState<'position' | 'swing' | 'scalp' | 'auto'>(initial?.lensTradingStyle ?? 'swing');
    const [analystSelections, setAnalystSelections] = useState<string[]>(() => {
        const picks = initial?.analystModels ?? [];
        return [0, 1, 2].map(i => {
            const p = picks[i];
            return p ? `${p.providerId}::${p.modelId}` : '';
        });
    });
    const [moderatorSelection, setModeratorSelection] = useState<string>(() => {
        const m = initial?.moderatorModel;
        return m && m.providerId ? `${m.providerId}::${m.modelId}` : '';
    });
    const [error, setError] = useState<string | null>(null);

    // Runs-per-day estimate for the frequency modes (selected days only).
    // NOTE: this must live BEFORE the `if (!isVisible) return null;` early
    // return — the modal stays mounted and is toggled via isVisible, so a
    // hook after the conditional return changes the hook count when the
    // editor opens ("Rendered more hooks than during the previous render").
    const runsPerDay = useMemo(() => {
        const dayCount = Math.max(1, scheduleDays.length) / 7;
        if (frequencyMode === 'minutes') return Math.round((1440 / Math.max(1, frequencyEvery)) * dayCount);
        if (frequencyMode === 'hours') return Math.round((24 / Math.max(1, frequencyEvery)) * dayCount);
        return dayCount;
    }, [frequencyMode, frequencyEvery, scheduleDays.length]);

    useEscapeClose(isVisible, onClose);
    if (!isVisible) return null;

    // The generated cron is the source of truth unless a custom cron was
    // typed into the Advanced field.
    const generatedCron = buildScheduleCron(frequencyMode, frequencyEvery, scheduleDays, scheduleTime.h, scheduleTime.m, scheduleTime.s);
    const effectiveCron = advancedCron.trim() ? advancedCron.trim() : generatedCron;
    const cronValid = parseCron(effectiveCron) !== null;
    const nextRun = cronValid ? nextCronTime(effectiveCron, new Date()) : null;

    // Lens mode needs exactly 3 DISTINCT models; normal mode needs 1-3.
    const requiredSelections = useLenses ? 3 : 1;
    const filledSelections = analystSelections.filter(s => s !== '');
    const distinctSelections = new Set(filledSelections);
    const selectionsValid = filledSelections.length >= requiredSelections
        && (useLenses ? distinctSelections.size === 3 : true);

    const handleSave = () => {
        setError(null);
        if (!name.trim()) { setError('Give the automation a name.'); return; }
        if (!cronValid) { setError('The schedule is not a valid cron expression.'); return; }
        if (scheduleDays.length === 0 && !advancedCron.trim()) { setError('Toggle at least one day of the week.'); return; }
        if (inputSource === 'template' && !promptTemplate.trim()) { setError('Enter the prompt template the automation should send.'); return; }
        if (!selectionsValid) { setError(useLenses ? 'Lens mode needs 3 distinct analyst models.' : 'Pick at least one analyst model.'); return; }
        if (!moderatorSelection) { setError('Pick the moderator model.'); return; }

        const analystModels: AutomationModelPick[] = filledSelections.slice(0, 3).map(splitOption);
        const moderatorModel = splitOption(moderatorSelection);
        const now = Date.now();

        onSave({
            id: initial?.id ?? `automation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            name: name.trim(),
            enabled: initial?.enabled ?? true,
            schedule: { cron: effectiveCron },
            inputSource,
            promptTemplate: inputSource === 'template' ? promptTemplate.trim() : undefined,
            mode,
            useLenses,
            lensTradingStyle,
            analystModels,
            moderatorModel,
            createdAt: initial?.createdAt ?? now,
            updatedAt: now,
            lastRunAt: initial?.lastRunAt,
            runCount: initial?.runCount ?? 0,
        });
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl animate-fade-in"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={initial ? `Edit automation ${initial.name}` : 'New automation'}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60">
                    <h3 className="text-sm font-bold text-white tracking-tight">{initial ? 'Edit automation' : 'New automation'}</h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors text-lg leading-none" aria-label="Close">✕</button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Name */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5" htmlFor="automation-name">Name</label>
                        <input
                            id="automation-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. BTCUSDT hourly check"
                            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                        />
                    </div>

                    {/* Schedule — frequency + days of the week + time */}
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5">Schedule</span>

                        {/* Frequency: once per day, or every N minutes/hours */}
                        <div className="flex items-center gap-2 flex-wrap mb-2.5">
                            <span className="text-[10px] font-medium text-zinc-400">Frequency</span>
                            <div className="flex gap-1">
                                {([['daily', 'Once per day'], ['minutes', 'Every N minutes'], ['hours', 'Every N hours']] as [AutomationFrequencyMode, string][]).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setFrequencyMode(value)}
                                        className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider border transition-all ${frequencyMode === value ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {frequencyMode !== 'daily' && (
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        min={1}
                                        max={frequencyMode === 'minutes' ? 59 : 24}
                                        value={frequencyEvery}
                                        onChange={(e) => setFrequencyEvery(Math.max(1, Math.min(frequencyMode === 'minutes' ? 59 : 24, parseInt(e.target.value, 10) || 1)))}
                                        className="w-14 bg-zinc-950 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50"
                                        aria-label={frequencyMode === 'minutes' ? 'Minutes between runs' : 'Hours between runs'}
                                    />
                                    <span className="text-[10px] text-zinc-500">{frequencyMode === 'minutes' ? 'min' : 'h'}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[10px] font-medium text-zinc-400">Days of the week</span>
                            <div className="flex gap-1">
                                {DAY_PRESETS.map(p => (
                                    <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => setScheduleDays(p.days)}
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all ${JSON.stringify([...scheduleDays].sort()) === JSON.stringify([...p.days].sort()) ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                            {WEEK_DAYS.map(d => {
                                const on = scheduleDays.includes(d.dow);
                                return (
                                    <button
                                        key={d.dow}
                                        type="button"
                                        onClick={() => setScheduleDays(prev => on ? prev.filter(x => x !== d.dow) : [...prev, d.dow])}
                                        className={`w-11 h-9 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${on ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                        title={on ? `Remove ${d.label} — this day will not trigger` : `Add ${d.label} — this day triggers the automation`}
                                        aria-pressed={on}
                                    >
                                        {d.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Time of day — hour, minute, second (daily mode only) */}
                        {frequencyMode === 'daily' && (
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Time</span>
                                <div className="flex items-center gap-1">
                                    <select
                                        value={scheduleTime.h}
                                        onChange={(e) => setScheduleTime(prev => ({ ...prev, h: parseInt(e.target.value, 10) }))}
                                        className="bg-zinc-950 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50 cursor-pointer"
                                        aria-label="Hour"
                                    >
                                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                                    </select>
                                    <span className="text-zinc-600 text-xs">:</span>
                                    <select
                                        value={scheduleTime.m}
                                        onChange={(e) => setScheduleTime(prev => ({ ...prev, m: parseInt(e.target.value, 10) }))}
                                        className="bg-zinc-950 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50 cursor-pointer"
                                        aria-label="Minute"
                                    >
                                        {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                                    </select>
                                    <span className="text-zinc-600 text-xs">:</span>
                                    <select
                                        value={scheduleTime.s}
                                        onChange={(e) => setScheduleTime(prev => ({ ...prev, s: parseInt(e.target.value, 10) }))}
                                        className="bg-zinc-950 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50 cursor-pointer"
                                        aria-label="Second"
                                    >
                                        {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}

                        <p className="text-[10px] text-emerald-400/90 mt-2">
                            {scheduleDays.length === 0
                                ? 'Toggle at least one day to schedule the automation.'
                                : frequencyMode === 'daily'
                                    ? `${humanizeCron(generatedCron)} — the automation triggers once on each selected day at this time.`
                                    : `${humanizeCron(generatedCron)} — about ${runsPerDay} run${runsPerDay === 1 ? '' : 's'} per day on the selected days.`}
                        </p>
                        {advancedCron.trim() && (
                            <p className="text-[10px] text-amber-400/90 mt-1">Using a custom cron (Advanced): <span className="font-mono">{advancedCron.trim()}</span> — the day/time selection above is ignored.</p>
                        )}

                        {/* Advanced: raw cron (existing custom schedules) */}
                        <details className="mt-2" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
                            <summary className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer select-none font-mono">
                                Advanced: raw cron
                            </summary>
                            <input
                                type="text"
                                value={advancedCron}
                                onChange={(e) => setAdvancedCron(e.target.value)}
                                placeholder="Leave empty to use the day/time schedule above"
                                spellCheck={false}
                                className={`w-full mt-1.5 bg-zinc-950 border rounded px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50 ${cronValid ? 'border-white/10' : 'border-rose-500/50'}`}
                            />
                        </details>

                        {nextRun && cronValid && (
                            <p className="text-[10px] text-zinc-400 mt-1.5">Next run: <span className="text-cyan-300 font-mono">{nextRun.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></p>
                        )}
                    </div>

                    {/* Input source */}
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5">What it analyzes</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setInputSource('template')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-left transition-all ${inputSource === 'template' ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-zinc-900 border-white/10 hover:border-white/20'}`}
                            >
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${inputSource === 'template' ? 'text-cyan-300' : 'text-zinc-400'}`}>Fixed prompt</span>
                                <span className="block text-[10px] text-zinc-500 mt-0.5">Every run sends the template below</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setInputSource('last_analysis')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-left transition-all ${inputSource === 'last_analysis' ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-zinc-900 border-white/10 hover:border-white/20'}`}
                            >
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${inputSource === 'last_analysis' ? 'text-cyan-300' : 'text-zinc-400'}`}>Repeat last</span>
                                <span className="block text-[10px] text-zinc-500 mt-0.5">Re-analyze your last manual analysis (prompt + chart)</span>
                            </button>
                        </div>
                        {inputSource === 'template' && (
                            <textarea
                                value={promptTemplate}
                                onChange={(e) => setPromptTemplate(e.target.value)}
                                placeholder="Analyze BTCUSDT on the 1h chart for a long setup with entry, stop loss, targets and invalidation."
                                spellCheck={false}
                                rows={3}
                                className="w-full mt-2 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 resize-y"
                            />
                        )}
                    </div>

                    {/* Mode */}
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5">Mode</span>
                        <div className="flex gap-2">
                            {([['standard', 'Standard'], ['original', 'Accuracy'], ['pure_ai', 'Pure AI']] as [AutomationMode, string][]).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setMode(value)}
                                    className={`flex-1 px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all ${mode === value ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Lenses toggle */}
                    <div className="flex items-center justify-between bg-zinc-900 border border-white/10 rounded-lg px-3 py-2.5">
                        <div>
                            <p className="text-xs font-bold text-zinc-300">Analyst Lenses</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Macro / Technical / Risk personas (needs 3 distinct models)</p>
                        </div>
                        <ToggleSwitch checked={useLenses} onChange={() => setUseLenses(!useLenses)} label="Toggle lenses" />
                    </div>

                    {/* Analyst models */}
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5">
                            {useLenses ? 'Analyst roles' : 'Analyst models'} {useLenses ? '(3 required)' : '(1-3)'}
                        </span>
                        <div className="space-y-2">
                            {[0, 1, 2].map(i => {
                                const label = useLenses
                                    ? ['Macro & Volatility', 'Technical Analyst', 'Risk & Execution'][i]
                                    : `Model ${i + 1}`;
                                const others = new Set(filledSelections.filter(s => s !== analystSelections[i]));
                                return (
                                    <div key={i}>
                                        <span className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">{label}</span>
                                        <ModelPicker
                                            providers={providers}
                                            value={analystSelections[i]}
                                            onChange={(v) => setAnalystSelections(prev => prev.map((p, idx) => idx === i ? v : p))}
                                            mode="provider-model"
                                            disabledValues={others}
                                            placeholder="Select provider/model"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Lens trading style — position/scalp/auto were previously
                        impossible in automations (runtime hardcoded 'swing'). */}
                    {useLenses && (
                        <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5">Lens trading style</span>
                            <div className="flex gap-1.5">
                                {(['auto', 'position', 'swing', 'scalp'] as const).map(style => (
                                    <button
                                        key={style}
                                        type="button"
                                        onClick={() => setLensTradingStyle(style)}
                                        className={`flex-1 px-2 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all ${lensTradingStyle === style ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {style}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Moderator */}
                    <div>
                        <span className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">Moderator model</span>
                        <ModelPicker
                            providers={providers}
                            value={moderatorSelection}
                            onChange={setModeratorSelection}
                            mode="provider-model"
                            placeholder="Select provider/model"
                        />
                    </div>

                    {error && (
                        <p className="text-[11px] text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-2">
                    {onDelete && initial ? (
                        <button
                            onClick={onDelete}
                            className="px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                        >
                            Delete
                        </button>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 text-[10px] font-bold uppercase tracking-widest transition-colors">
                            Cancel
                        </button>
                        <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold uppercase tracking-widest transition-colors">
                            {initial ? 'Save changes' : 'Create automation'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AutomationEditorModal;
