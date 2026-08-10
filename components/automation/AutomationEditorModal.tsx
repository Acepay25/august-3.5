import React, { useState } from 'react';
import { AutomationConfig, AutomationInputSource, AutomationMode, AutomationModelPick } from '../../types/automation';
import { parseCron, nextCronTime } from '../../services/automation/cronParser';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { useEscapeClose } from '../../hooks/useEscapeClose';

export interface ModelOption {
    value: string; // `${providerId}::${modelId}`
    label: string;
}

const CRON_PRESETS: { label: string; cron: string }[] = [
    { label: 'Every 15 min', cron: '*/15 * * * *' },
    { label: 'Every 30 min', cron: '*/30 * * * *' },
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Every 6 hours', cron: '0 */6 * * *' },
    { label: 'Daily 09:00', cron: '0 9 * * *' },
    { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
];

interface AutomationEditorModalProps {
    isVisible: boolean;
    /** The automation being edited; undefined = create new. */
    initial?: AutomationConfig;
    modelOptions: ModelOption[];
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

const AutomationEditorModal: React.FC<AutomationEditorModalProps> = ({ isVisible, initial, modelOptions, onClose, onSave, onDelete }) => {
    const [name, setName] = useState(initial?.name ?? '');
    const [cron, setCron] = useState(initial?.schedule.cron ?? '0 * * * *');
    const [inputSource, setInputSource] = useState<AutomationInputSource>(initial?.inputSource ?? 'template');
    const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? '');
    const [mode, setMode] = useState<AutomationMode>(initial?.mode ?? 'standard');
    const [useLenses, setUseLenses] = useState(initial?.useLenses ?? false);
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

    useEscapeClose(isVisible, onClose);
    if (!isVisible) return null;

    const cronValid = parseCron(cron) !== null;
    const nextRun = cronValid ? nextCronTime(cron, new Date()) : null;

    // Lens mode needs exactly 3 DISTINCT models; normal mode needs 1-3.
    const requiredSelections = useLenses ? 3 : 1;
    const filledSelections = analystSelections.filter(s => s !== '');
    const distinctSelections = new Set(filledSelections);
    const selectionsValid = filledSelections.length >= requiredSelections
        && (useLenses ? distinctSelections.size === 3 : true);

    const handleSave = () => {
        setError(null);
        if (!name.trim()) { setError('Give the automation a name.'); return; }
        if (!cronValid) { setError('The schedule is not a valid 5-field cron expression.'); return; }
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
            schedule: { cron: cron.trim() },
            inputSource,
            promptTemplate: inputSource === 'template' ? promptTemplate.trim() : undefined,
            mode,
            useLenses,
            analystModels,
            moderatorModel,
            createdAt: initial?.createdAt ?? now,
            updatedAt: now,
            lastRunAt: initial?.lastRunAt,
            runCount: initial?.runCount ?? 0,
        });
    };

    const modelSelect = (label: string, value: string, onChange: (v: string) => void, placeholder: string, disabledOptions: Set<string> | undefined) => (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-zinc-400">{label}</span>
            </div>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer"
            >
                <option value="">Select provider/model</option>
                {modelOptions.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={disabledOptions?.has(opt.value)}>
                        {opt.label}{disabledOptions?.has(opt.value) ? ' (assigned)' : ''}
                    </option>
                ))}
            </select>
        </div>
    );

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

                    {/* Schedule */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1.5" htmlFor="automation-cron">Schedule (cron)</label>
                        <input
                            id="automation-cron"
                            type="text"
                            value={cron}
                            onChange={(e) => setCron(e.target.value)}
                            placeholder="0 * * * *"
                            spellCheck={false}
                            className={`w-full bg-zinc-950 border rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/50 ${cronValid ? 'border-white/10' : 'border-rose-500/50'}`}
                        />
                        <p className="text-[10px] text-zinc-600 mt-1 font-mono">minute hour day month weekday · e.g. 0 * * * * = every hour, 0 9 * * 1-5 = weekdays 09:00</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                            {CRON_PRESETS.map(p => (
                                <button
                                    key={p.cron}
                                    type="button"
                                    onClick={() => setCron(p.cron)}
                                    className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider border transition-all ${cron === p.cron ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        {nextRun && cronValid && (
                            <p className="text-[10px] text-emerald-400/90 mt-1.5">Next run: {nextRun.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
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
                                return modelSelect(label, analystSelections[i], (v) => {
                                    setAnalystSelections(prev => prev.map((p, idx) => idx === i ? v : p));
                                }, 'Select provider/model', others);
                            })}
                        </div>
                    </div>

                    {/* Moderator */}
                    {modelSelect('Moderator model', moderatorSelection, setModeratorSelection, 'Select provider/model', undefined)}

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
