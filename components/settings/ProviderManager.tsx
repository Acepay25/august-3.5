/**
 * ProviderManager — Configure AI providers: API keys, base URLs, API format.
 * Edit-and-save flow: changes are staged locally and committed via the Save button.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ProviderConfig, ApiFormat, API_FORMAT_LABELS } from '../../types/provider';
import { testConnection } from '../../services/providers/GenericProviderService';

interface ProviderManagerProps {
    configs: ProviderConfig[];
    onUpdateProvider: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider: (provider: {
        name: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat;
        models?: string[]; selectedModel?: string;
    }) => Promise<void>;
    onRemoveProvider: (id: string) => Promise<void>;
    onToggleProvider: (id: string) => Promise<void>;
}

// ─── Small presentational bits ──────────────────────────────────────────────

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.14em] mb-1.5">
        {children}
    </label>
);

const inputBase =
    'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950/70 border border-zinc-700/60 text-sm text-zinc-100 ' +
    'placeholder-zinc-600 font-mono focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/15 ' +
    'transition-all duration-200';

const selectBase =
    'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950/70 border border-zinc-700/60 text-sm text-zinc-100 ' +
    'focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/15 transition-all duration-200 ' +
    'appearance-none cursor-pointer bg-no-repeat bg-[right_0.9rem_center] ' +
    "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')]";

// ─── Main component ─────────────────────────────────────────────────────────

const ProviderManager: React.FC<ProviderManagerProps> = ({
    configs, onUpdateProvider, onAddCustomProvider, onRemoveProvider, onToggleProvider,
}) => {
    const [selectedId, setSelectedId] = useState<string>(configs[0]?.id || '');

    // Draft (staged) values — committed only on Save
    const [draftKey, setDraftKey] = useState('');
    const [draftUrl, setDraftUrl] = useState('');
    const [draftFormat, setDraftFormat] = useState<ApiFormat>('chat_completions');
    const [draftModel, setDraftModel] = useState('');
    const [showKey, setShowKey] = useState(false);

    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // Add-provider form
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState('');
    const [newUrl, setNewUrl] = useState('');
    const [newKey, setNewKey] = useState('');
    const [newFormat, setNewFormat] = useState<ApiFormat>('chat_completions');
    const [newModels, setNewModels] = useState('');

    const selected = useMemo(() => configs.find(c => c.id === selectedId), [configs, selectedId]);

    // Sync draft from the selected provider whenever selection or saved config changes
    useEffect(() => {
        if (selected) {
            setDraftKey(selected.apiKey);
            setDraftUrl(selected.baseUrl);
            setDraftFormat(selected.apiFormat);
            setDraftModel(selected.selectedModel);
            setShowKey(false);
            setSaveState('idle');
            setTestResult(null);
        }
    }, [selectedId, selected?.apiKey, selected?.baseUrl, selected?.apiFormat, selected?.selectedModel]);

    const isDirty = useMemo(() => {
        if (!selected) return false;
        return (
            draftKey !== selected.apiKey ||
            draftUrl !== selected.baseUrl ||
            draftFormat !== selected.apiFormat ||
            draftModel !== selected.selectedModel
        );
    }, [selected, draftKey, draftUrl, draftFormat, draftModel]);

    const handleSave = useCallback(async () => {
        if (!selected || !isDirty) return;
        setSaveState('saving');
        await onUpdateProvider(selected.id, {
            apiKey: draftKey,
            baseUrl: draftUrl.trim(),
            apiFormat: draftFormat,
            selectedModel: draftModel,
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1800);
    }, [selected, isDirty, draftKey, draftUrl, draftFormat, draftModel, onUpdateProvider]);

    const handleTest = useCallback(async () => {
        if (!selected) return;
        setIsTesting(true);
        setTestResult(null);
        // Test with the staged (draft) values so the user can verify before saving
        const result = await testConnection({ ...selected, apiKey: draftKey, baseUrl: draftUrl.trim(), apiFormat: draftFormat, selectedModel: draftModel });
        setTestResult(result);
        setIsTesting(false);
    }, [selected, draftKey, draftUrl, draftFormat, draftModel]);

    const handleAdd = useCallback(async () => {
        if (!newName.trim() || !newUrl.trim()) return;
        const models = newModels.split(',').map(m => m.trim()).filter(Boolean);
        await onAddCustomProvider({
            name: newName.trim(), baseUrl: newUrl.trim(), apiKey: newKey.trim(),
            apiFormat: newFormat, models, selectedModel: models[0] || 'default',
        });
        setNewName(''); setNewUrl(''); setNewKey(''); setNewFormat('chat_completions'); setNewModels('');
        setShowAdd(false);
    }, [newName, newUrl, newKey, newFormat, newModels, onAddCustomProvider]);

    const hasKey = (c: ProviderConfig) => c.apiKey.trim().length > 0;

    return (
        <div className="space-y-5">
            {/* ── Provider selector ── */}
            <div>
                <FieldLabel>Provider</FieldLabel>
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={selectBase}>
                    <optgroup label="Built-in">
                        {configs.filter(c => c.isBuiltIn).map(c => (
                            <option key={c.id} value={c.id}>
                                {c.name}{hasKey(c) ? '' : ' — no key'}{c.isEnabled ? '' : ' (off)'}
                            </option>
                        ))}
                    </optgroup>
                    {configs.some(c => !c.isBuiltIn) && (
                        <optgroup label="Custom">
                            {configs.filter(c => !c.isBuiltIn).map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name}{hasKey(c) ? '' : ' — no key'}{c.isEnabled ? '' : ' (off)'}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
            </div>

            {/* ── Selected provider editor ── */}
            {selected && (
                <div className="rounded-2xl bg-zinc-900/60 border border-zinc-700/40 overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/70 bg-zinc-900/40">
                        <div className="flex items-center gap-2.5">
                            <span className={`w-2 h-2 rounded-full ${hasKey(selected) ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-zinc-600'}`} />
                            <h4 className="text-sm font-bold text-zinc-100 tracking-tight">{selected.name}</h4>
                            {isDirty && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                                    Unsaved
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => onToggleProvider(selected.id)}
                                className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${selected.isEnabled ? 'bg-cyan-500/70' : 'bg-zinc-700'}`}
                                title={selected.isEnabled ? 'Enabled' : 'Disabled'}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 ${selected.isEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                            </button>
                            {!selected.isBuiltIn && (
                                <button
                                    onClick={() => { onRemoveProvider(selected.id); setSelectedId(configs[0]?.id || ''); }}
                                    className="text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-2 py-1 rounded-lg transition-colors"
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Card body */}
                    <div className="p-4 space-y-4">
                        {/* API Key */}
                        <div>
                            <FieldLabel>API Key</FieldLabel>
                            <div className="relative">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    value={draftKey}
                                    onChange={(e) => setDraftKey(e.target.value)}
                                    placeholder="sk-…"
                                    className={`${inputBase} pr-11`}
                                    autoComplete="off"
                                />
                                <button
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                                    title={showKey ? 'Hide' : 'Show'}
                                >
                                    {showKey ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>

                        {/* Base URL */}
                        <div>
                            <FieldLabel>Base URL</FieldLabel>
                            <input
                                type="text"
                                value={draftUrl}
                                onChange={(e) => setDraftUrl(e.target.value)}
                                placeholder="https://api.example.com/v1"
                                className={inputBase}
                            />
                        </div>

                        {/* API Format — dropdown */}
                        <div>
                            <FieldLabel>API Format</FieldLabel>
                            <select
                                value={draftFormat}
                                onChange={(e) => setDraftFormat(e.target.value as ApiFormat)}
                                className={selectBase}
                            >
                                {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Model */}
                        <div>
                            <FieldLabel>Model</FieldLabel>
                            <select
                                value={draftModel}
                                onChange={(e) => setDraftModel(e.target.value)}
                                className={selectBase}
                            >
                                {selected.models.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2.5 pt-1">
                            <button
                                onClick={handleSave}
                                disabled={!isDirty || saveState === 'saving'}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                                    saveState === 'saved'
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : isDirty
                                            ? 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300 active:scale-[0.98] shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]'
                                            : 'bg-zinc-800/60 text-zinc-600 border border-zinc-700/40 cursor-not-allowed'
                                }`}
                            >
                                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save'}
                            </button>
                            <button
                                onClick={handleTest}
                                disabled={isTesting || !draftKey.trim()}
                                className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                            >
                                {isTesting ? 'Testing…' : 'Test'}
                            </button>
                        </div>

                        {testResult && (
                            <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs border animate-fade-in ${
                                testResult.success
                                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                    : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                            }`}>
                                <span className="font-bold">{testResult.success ? '✓' : '✕'}</span>
                                <span className="break-all leading-relaxed">{testResult.message}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Add custom provider ── */}
            <div>
                {!showAdd ? (
                    <button
                        onClick={() => setShowAdd(true)}
                        className="w-full py-3 rounded-xl border border-dashed border-zinc-700/70 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 hover:text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all duration-200"
                    >
                        + Add Custom Provider
                    </button>
                ) : (
                    <div className="rounded-2xl bg-zinc-900/60 border border-cyan-500/25 p-4 space-y-4 animate-fade-in">
                        <h4 className="text-sm font-bold text-cyan-400 tracking-tight">New Custom Provider</h4>

                        <div>
                            <FieldLabel>Provider Name</FieldLabel>
                            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Together AI, Local LLM…" className={inputBase} />
                        </div>
                        <div>
                            <FieldLabel>Base URL</FieldLabel>
                            <input type="text" value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="https://api.example.com/v1" className={inputBase} />
                        </div>
                        <div>
                            <FieldLabel>API Key</FieldLabel>
                            <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
                                placeholder="sk-…" className={inputBase} autoComplete="off" />
                        </div>
                        <div>
                            <FieldLabel>API Format</FieldLabel>
                            <select value={newFormat} onChange={(e) => setNewFormat(e.target.value as ApiFormat)} className={selectBase}>
                                {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <FieldLabel>Models <span className="normal-case tracking-normal text-zinc-600">(comma-separated)</span></FieldLabel>
                            <input type="text" value={newModels} onChange={(e) => setNewModels(e.target.value)}
                                placeholder="model-a, model-b" className={inputBase} />
                        </div>

                        <div className="flex gap-2.5 pt-1">
                            <button onClick={handleAdd} disabled={!newName.trim() || !newUrl.trim()}
                                className="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-cyan-400 text-zinc-950 hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200">
                                Add Provider
                            </button>
                            <button onClick={() => setShowAdd(false)}
                                className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 border border-zinc-700/40 transition-colors">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(ProviderManager);
