/**
 * ProviderManager — Configure AI providers matching reference UI layout:
 * - Left sidebar list of Providers and Custom providers with status dot indicators
 * - Bottom "+ Add provider" button on sidebar
 * - Right panel with Provider name (editable), Enabled/Disable toggle pills, and Delete icon
 * - Base URL, API format, API key with SVG eye toggle
 * - Model list container with model ID rows, context badges, SVG edit/delete/link actions, and "+ Add model" button
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ProviderConfig, ApiFormat, API_FORMAT_LABELS } from '../../types/provider';
import { testConnection } from '../../services/providers/GenericProviderService';
import { getProviderHealth, resetProviderHealth } from '../../services/infrastructure/ProviderHealthService';
import { validateProviderUrl } from '../../utils/providerUrlValidation';
import { useConfirmDialog } from '../shared/ConfirmDialog';

interface ProviderManagerProps {
    configs: ProviderConfig[];
    /** False while the provider configs are still being loaded from storage —
     *  prevents the "No providers configured" empty state from flashing. */
    isLoaded?: boolean;
    onUpdateProvider: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider: (provider: {
        name: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat;
        models?: string[]; selectedModel?: string;
    }) => Promise<void>;
    onRemoveProvider: (id: string) => Promise<void>;
    onToggleProvider: (id: string) => Promise<void>;
    onAddModel?: (providerId: string, modelId: string) => Promise<void>;
    onRemoveModel?: (providerId: string, modelId: string) => Promise<void>;
    onUpdateModel?: (providerId: string, oldModelId: string, newModelId: string) => Promise<void>;
    /** Reports staged-edit dirtiness so the host can confirm before closing. */
    onDirtyChange?: (dirty: boolean) => void;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const CubeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4 text-zinc-400" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
);

const PencilIcon: React.FC<{ className?: string }> = ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);

const LinkIcon: React.FC<{ className?: string }> = ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);

const EyeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
);

// ─── Presentational Helpers ───────────────────────────────────────────────────

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
        {children}
    </label>
);

const inputBase =
    'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 ' +
    'placeholder-zinc-600 font-mono focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 ' +
    'transition-all duration-200';

const selectBase =
    'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 ' +
    'focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all duration-200 ' +
    'appearance-none cursor-pointer bg-no-repeat bg-[right_0.9rem_center] ' +
    "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')]";

function getContextBadge(modelId: string): string {
    const m = modelId.toLowerCase();
    if (m.includes('1m') || m.includes('flash-free') || m.includes('deepseek-v4') || m.includes('nemotron') || m.includes('laguna')) return '1M';
    if (m.includes('262k') || m.includes('hy3') || m.includes('ling-3')) return '262K';
    if (m.includes('128k') || m.includes('glm-4') || m.includes('llama-4')) return '128K';
    if (m.includes('32k') || m.includes('qwen3-32b')) return '32K';
    return '1M';
}

const ProviderManager: React.FC<ProviderManagerProps> = ({
    configs,
    isLoaded = true,
    onUpdateProvider,
    onAddCustomProvider,
    onRemoveProvider,
    onToggleProvider,
    onAddModel,
    onRemoveModel,
    onUpdateModel,
    onDirtyChange,
}) => {
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [selectedId, setSelectedId] = useState<string>(configs[0]?.id || '');
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');

    // Draft (staged) values for right panel
    const [draftKey, setDraftKey] = useState('');
    const [draftUrl, setDraftUrl] = useState('');
    const [draftFormat, setDraftFormat] = useState<ApiFormat>('chat_completions');
    const [draftModel, setDraftModel] = useState('');
    const [showKey, setShowKey] = useState(false);

    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // Add new model inline state
    const [showAddModelInput, setShowAddModelInput] = useState(false);
    const [newModelInput, setNewModelInput] = useState('');

    // Edit model inline state
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const [editModelInput, setEditModelInput] = useState('');

    // Add new provider modal/inline state
    const [showAddProvider, setShowAddProvider] = useState(false);
    const [newName, setNewName] = useState('');
    const [newUrl, setNewUrl] = useState('');
    const [newKey, setNewKey] = useState('');
    const [newFormat, setNewFormat] = useState<ApiFormat>('chat_completions');
    const [newModels, setNewModels] = useState('');
    const [addError, setAddError] = useState('');

    // Track the "saved" badge timer so it's cleared on unmount / next save.
    const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const selected = useMemo(() => configs.find(c => c.id === selectedId) || configs[0], [configs, selectedId]);

    useEffect(() => {
        if (selected) {
            setDraftKey(selected.apiKey);
            setDraftUrl(selected.baseUrl);
            setDraftFormat(selected.apiFormat);
            setDraftModel(selected.selectedModel);
            setNameDraft(selected.name);
            setIsEditingName(false);
            setShowKey(false);
            setSaveState('idle');
            setTestResult(null);
            setShowAddModelInput(false);
            setEditingModelId(null);
        }
    }, [selected?.id, selected?.apiKey, selected?.baseUrl, selected?.apiFormat, selected?.selectedModel, selected?.name]);

    const draftUrlValidation = useMemo(() => validateProviderUrl(draftUrl), [draftUrl]);
    const newUrlValidation = useMemo(() => validateProviderUrl(newUrl), [newUrl]);

    const isDirty = useMemo(() => {
        if (!selected) return false;
        return (
            draftKey !== selected.apiKey ||
            draftUrl !== selected.baseUrl ||
            draftFormat !== selected.apiFormat ||
            draftModel !== selected.selectedModel ||
            (!!nameDraft.trim() && nameDraft.trim() !== selected.name)
        );
    }, [selected, draftKey, draftUrl, draftFormat, draftModel, nameDraft]);

    // Surface dirtiness to the host (SettingsMenu) so closing the modal while
    // a draft is staged can warn instead of silently discarding edits.
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const handleSave = useCallback(async () => {
        if (!selected || !draftUrlValidation.valid) return;
        setSaveState('saving');
        const updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>> = {
            // Trim the key — a pasted key with a trailing newline passed the
            // "ready" check (getReadyProviders trims) but failed every auth.
            apiKey: draftKey.trim(),
            baseUrl: draftUrl.trim(),
            apiFormat: draftFormat,
            selectedModel: draftModel,
        };
        if (nameDraft.trim() && nameDraft.trim() !== selected.name) {
            updates.name = nameDraft.trim();
        }
        try {
            await onUpdateProvider(selected.id, updates);
            setIsEditingName(false);
            setSaveState('saved');
            // Track the timer so it's cleared on unmount / next save — a bare
            // setTimeout here could setState after unmount.
            clearTimeout(saveStateTimerRef.current);
            saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1800);
        } catch (error) {
            clearTimeout(saveStateTimerRef.current);
            setSaveState('idle');
            setTestResult({ success: false, message: error instanceof Error ? error.message : 'Provider settings could not be saved.' });
            return;
        }
    }, [selected, draftKey, draftUrl, draftFormat, draftModel, nameDraft, draftUrlValidation, onUpdateProvider]);

    const handleTest = useCallback(async () => {
        if (!selected || !draftUrlValidation.valid || !draftModel.trim()) {
            setTestResult({ success: false, message: 'Choose a model before testing the connection.' });
            return;
        }
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await testConnection({
                ...selected,
                apiKey: draftKey.trim(),
                baseUrl: draftUrlValidation.normalizedUrl,
                apiFormat: draftFormat,
                selectedModel: draftModel.trim()
            });
            setTestResult(result);
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : 'Connection test failed.'
            });
        } finally {
            setIsTesting(false);
        }
    }, [selected, draftKey, draftUrl, draftFormat, draftModel, draftUrlValidation]);

    const handleAddProvider = useCallback(async () => {
        if (!newName.trim() || !newUrlValidation.valid) return;
        const models = newModels.split(',').map(m => m.trim()).filter(Boolean);
        // No fake 'default-model' entries — a provider without models is
        // unusable and the user would have to discover/delete the stub row.
        if (models.length === 0) {
            setAddError('Add at least one model ID (comma-separated) before creating the provider.');
            return;
        }
        setAddError('');
        await onAddCustomProvider({
            name: newName.trim(),
            baseUrl: newUrl.trim(),
            apiKey: newKey.trim(),
            apiFormat: newFormat,
            models,
            selectedModel: models[0],
        });
        setNewName(''); setNewUrl(''); setNewKey(''); setNewFormat('chat_completions'); setNewModels('');
        setShowAddProvider(false);
    }, [newName, newUrl, newUrlValidation, newKey, newFormat, newModels, onAddCustomProvider]);

    const handleAddModelSubmit = useCallback(async () => {
        if (!selected || !newModelInput.trim()) return;
        const modelId = newModelInput.trim();
        if (onAddModel) {
            await onAddModel(selected.id, modelId);
        } else {
            const updatedModels = [...selected.models, modelId];
            await onUpdateProvider(selected.id, { models: updatedModels, selectedModel: selected.selectedModel || modelId });
        }
        setNewModelInput('');
        setShowAddModelInput(false);
    }, [selected, newModelInput, onAddModel, onUpdateProvider]);

    const handleRemoveModelSubmit = useCallback(async (modelId: string) => {
        if (!selected) return;
        if (onRemoveModel) {
            await onRemoveModel(selected.id, modelId);
        } else {
            const updatedModels = selected.models.filter(m => m !== modelId);
            const newSelected = selected.selectedModel === modelId ? (updatedModels[0] || '') : selected.selectedModel;
            await onUpdateProvider(selected.id, { models: updatedModels, selectedModel: newSelected });
        }
    }, [selected, onRemoveModel, onUpdateProvider]);

    const handleUpdateModelSubmit = useCallback(async (oldModelId: string) => {
        if (!selected || !editModelInput.trim()) return;
        const trimmed = editModelInput.trim();
        if (onUpdateModel) {
            await onUpdateModel(selected.id, oldModelId, trimmed);
        } else {
            const updatedModels = selected.models.map(m => m === oldModelId ? trimmed : m);
            const newSelected = selected.selectedModel === oldModelId ? trimmed : selected.selectedModel;
            await onUpdateProvider(selected.id, { models: updatedModels, selectedModel: newSelected });
        }
        setEditingModelId(null);
        setEditModelInput('');
    }, [selected, editModelInput, onUpdateModel, onUpdateProvider]);

    return (
        <div className="space-y-4">
            {ConfirmDialogComponent}
            {/* Top Bar / Subtitle */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
                <p className="text-xs text-zinc-400 font-medium">
                    Manage custom model providers. Once configured, they can be selected during chat.
                </p>
                <button
                    onClick={() => setTestResult(null)}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
                    title="Refresh"
                >
                    <RefreshIcon />
                </button>
            </div>

            {/* Main Content Layout: Left Sidebar + Right Detail Panel */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                {/* Left Sidebar */}
                <div className="md:col-span-4 space-y-4 flex flex-col justify-between">
                    <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                        {/* Configured Providers Section */}
                        <div>
                            <h5 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 px-1">
                                Configured Providers
                            </h5>
                            {configs.length > 0 ? (
                                <div className="space-y-1">
                                    {configs.map(c => {
                                        const isSelected = selected?.id === c.id;
                                        const isReady = c.isEnabled && c.apiKey.trim().length > 0;
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => { setSelectedId(c.id); setShowAddProvider(false); }}
                                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
                                                    isSelected && !showAddProvider
                                                        ? 'bg-zinc-800 border border-zinc-700/80 text-zinc-100 shadow-sm font-semibold'
                                                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="w-5 h-5 rounded-md bg-zinc-900 border border-zinc-700/60 flex items-center justify-center shrink-0">
                                                        <CubeIcon className="w-3.5 h-3.5 text-zinc-400" />
                                                    </div>
                                                    <span className="text-xs truncate font-medium">{c.name}</span>
                                                </div>
                                                <span
                                                    className={`w-2 h-2 rounded-full shrink-0 ${isReady ? 'bg-emerald-400 shadow-[0_0_6px_rgba(228,228,231,0.8)]' : c.isEnabled ? 'bg-amber-400' : 'bg-zinc-600'}`}
                                                    title={isReady ? 'Ready' : c.isEnabled ? 'Enabled, API key missing' : 'Disabled'}
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-2 py-4 text-xs text-zinc-500 text-center">
                                    {isLoaded
                                        ? 'No providers configured. Click "+ Add provider" below to create one.'
                                        : 'Loading providers…'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Add Provider Button at bottom of sidebar */}
                    <button
                        onClick={() => setShowAddProvider(true)}
                        className="w-full mt-2 py-2.5 px-3 rounded-xl border border-dashed border-zinc-700/70 text-xs font-semibold text-zinc-400 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/5 flex items-center justify-center gap-1.5 transition-all"
                    >
                        <span className="text-sm font-bold">+</span>
                        <span>Add provider</span>
                    </button>
                </div>

                {/* Right Configuration Detail Panel */}
                <div className="md:col-span-8 bg-zinc-800 border border-zinc-800/80 rounded-2xl p-4.5 space-y-4">
                    {showAddProvider ? (
                        /* New Custom Provider Form */
                        <div className="space-y-4 animate-fade-in">
                            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                                <h4 className="text-sm font-bold text-cyan-400">Add New Provider</h4>
                                <button
                                    onClick={() => setShowAddProvider(false)}
                                    className="text-xs text-zinc-500 hover:text-zinc-300"
                                >
                                    Cancel
                                </button>
                            </div>

                            <div>
                                <FieldLabel>Provider Name</FieldLabel>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="e.g. Opencode Zen, Local LLM"
                                    className={inputBase}
                                />
                            </div>

                            <div>
                                <FieldLabel>Base URL</FieldLabel>
                                <input
                                    type="text"
                                    value={newUrl}
                                    onChange={(e) => setNewUrl(e.target.value)}
                                    placeholder="https://opencode.ai/zen/v1"
                                     className={inputBase}
                                />
                                {!newUrlValidation.valid && newUrl.trim() && <p className="mt-1 text-xs text-red-300">{newUrlValidation.message}</p>}
                            </div>

                            <div>
                                <FieldLabel>API Format</FieldLabel>
                                <select
                                    value={newFormat}
                                    onChange={(e) => setNewFormat(e.target.value as ApiFormat)}
                                    className={selectBase}
                                >
                                    {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([val, label]) => (
                                        <option key={val} value={val}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <FieldLabel>API Key</FieldLabel>
                                <input
                                    type="password"
                                    value={newKey}
                                    onChange={(e) => setNewKey(e.target.value)}
                                    placeholder="sk-…"
                                    className={inputBase}
                                    autoComplete="off"
                                />
                            </div>

                            <div>
                                <FieldLabel>Model List (comma-separated)</FieldLabel>
                                <input
                                    type="text"
                                    value={newModels}
                                    onChange={(e) => { setNewModels(e.target.value); setAddError(''); }}
                                    placeholder="deepseek-v4-flash-free, nemotron-3-ultra-free"
                                    className={inputBase}
                                />
                                {addError && <p className="mt-1 text-xs text-red-300">{addError}</p>}
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={handleAddProvider}
                                    disabled={!newName.trim() || !newUrlValidation.valid}
                                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    Create Provider
                                </button>
                            </div>
                        </div>
                    ) : selected ? (
                        /* Selected Provider Configuration Panel */
                        <div className="space-y-4">
                            {/* Provider Header: Title + Enable/Disable Pills + Trash Icon */}
                            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
                                <div className="flex items-center gap-3">
                                    {isEditingName ? (
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                type="text"
                                                value={nameDraft}
                                                onChange={(e) => setNameDraft(e.target.value)}
                                                className="px-2 py-1 rounded-lg bg-zinc-950 border border-cyan-500/50 text-sm font-bold text-zinc-100 focus:outline-none"
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => setIsEditingName(false)}
                                                className="text-xs text-cyan-400 hover:text-cyan-300 font-bold px-1.5"
                                            >
                                                ✓
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-bold text-zinc-100 tracking-tight">
                                                {nameDraft.trim() || selected.name}
                                            </h3>
                                            <button
                                                onClick={() => setIsEditingName(true)}
                                                className="text-xs text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800 transition-colors"
                                                title="Edit Name"
                                            >
                                                <PencilIcon className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-200" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Enabled / Disable Toggle Pills */}
                                    <div className="flex items-center bg-zinc-950 border border-zinc-800/80 p-0.5 rounded-lg text-xs font-semibold ml-2">
                                        <button
                                            onClick={() => { if (!selected.isEnabled) onToggleProvider(selected.id); }}
                                            className={`px-3 py-1 rounded-md transition-all text-xs ${
                                                selected.isEnabled
                                                    ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                                                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                                            }`}
                                        >
                                            Enabled
                                        </button>
                                        <button
                                            onClick={() => { if (selected.isEnabled) onToggleProvider(selected.id); }}
                                            className={`px-3 py-1 rounded-md transition-all text-xs ${
                                                !selected.isEnabled
                                                    ? 'bg-zinc-700 text-zinc-200 font-bold shadow-sm'
                                                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                                            }`}
                                        >
                                            Disable
                                        </button>
                                    </div>
                                </div>

                                {/* Delete Provider Icon */}
                                <button
                                    disabled={selected.isBuiltIn}
                                    onClick={async () => {
                                        if (selected.isBuiltIn) return;
                                        const ok = await confirm({
                                            title: `Delete ${selected.name}?`,
                                            message: 'This removes the provider, its API key, and its models. Analyses already logged are unaffected.',
                                            confirmLabel: 'Delete',
                                        });
                                        if (!ok) return;
                                        onRemoveProvider(selected.id);
                                        // Drop the deleted provider's health
                                        // telemetry — it would otherwise linger
                                        // in the module Map forever.
                                        resetProviderHealth(selected.id);
                                        const remaining = configs.filter(c => c.id !== selected.id);
                                        if (remaining.length > 0) setSelectedId(remaining[0].id);
                                    }}
                                    className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                                    title={selected.isBuiltIn ? 'Built-in providers cannot be deleted' : 'Delete Provider'}
                                    aria-label={selected.isBuiltIn ? 'Built-in provider cannot be deleted' : `Delete ${selected.name}`}
                                >
                                    <TrashIcon className="w-4 h-4 text-zinc-400 hover:text-rose-400" />
                                </button>
                            </div>

                            {/* Base URL */}
                            <div>
                                <FieldLabel>Base URL</FieldLabel>
                                <input
                                    type="text"
                                    value={draftUrl}
                                    onChange={(e) => setDraftUrl(e.target.value)}
                                    placeholder="https://opencode.ai/zen/v1"
                                    className={inputBase}
                                />
                                {!draftUrlValidation.valid && draftUrl.trim() && <p className="mt-1 text-xs text-red-300">{draftUrlValidation.message}</p>}
                            </div>

                            {/* API Format */}
                            <div>
                                <FieldLabel>API format</FieldLabel>
                                <select
                                    value={draftFormat}
                                    onChange={(e) => setDraftFormat(e.target.value as ApiFormat)}
                                    className={selectBase}
                                >
                                    {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([val, label]) => (
                                        <option key={val} value={val}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* API Key */}
                            <div>
                                <FieldLabel>API key</FieldLabel>
                                <div className="relative">
                                    <input
                                        type={showKey ? 'text' : 'password'}
                                        value={draftKey}
                                        onChange={(e) => setDraftKey(e.target.value)}
                                        placeholder="••••••••••••••••••••••••••••••••"
                                        className={`${inputBase} pr-10`}
                                        autoComplete="off"
                                    />
                                    <button
                                        onClick={() => setShowKey(!showKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                                        title={showKey ? 'Hide Key' : 'Show Key'}
                                    >
                                        {showKey ? <EyeOffIcon className="w-4 h-4 text-zinc-400" /> : <EyeIcon className="w-4 h-4 text-zinc-400" />}
                                    </button>
                                </div>
                            </div>

                            {/* Model List Section */}
                            <div className="space-y-2 pt-1">
                                <FieldLabel>Model list</FieldLabel>
                                <div className="space-y-2 bg-zinc-950 border border-zinc-800/80 rounded-xl p-2.5">
                                    {selected.models.map((m) => {
                                        const isSelectedModel = draftModel === m;
                                        const isEditingThis = editingModelId === m;
                                        const badgeText = getContextBadge(m);

                                        return (
                                            <div
                                                key={m}
                                                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all ${
                                                    isSelectedModel
                                                        ? 'bg-zinc-900 border-zinc-700/90 text-zinc-100 shadow-sm'
                                                        : 'bg-zinc-800 border-zinc-800/70 text-zinc-300 hover:border-zinc-700'
                                                }`}
                                            >
                                                {isEditingThis ? (
                                                    <div className="flex items-center gap-2 flex-1 mr-2">
                                                        <input
                                                            type="text"
                                                            value={editModelInput}
                                                            onChange={(e) => setEditModelInput(e.target.value)}
                                                            className="w-full px-2 py-1 rounded bg-zinc-950 border border-cyan-500/50 text-xs font-mono text-zinc-100 focus:outline-none"
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={() => handleUpdateModelSubmit(m)}
                                                            className="text-xs text-cyan-400 hover:text-cyan-300 font-bold px-1"
                                                        >
                                                            ✓
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingModelId(null)}
                                                            className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs font-mono truncate mr-2">{m}</span>
                                                )}

                                                <div className="flex items-center gap-2.5 shrink-0">
                                                    {/* Context Badge */}
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 font-mono">
                                                        {badgeText}
                                                    </span>

                                                    {/* Set Active / Link Icon */}
                                                    <button
                                                        onClick={() => setDraftModel(m)}
                                                        className={`p-1 rounded transition-colors ${
                                                            isSelectedModel
                                                                ? 'text-cyan-400 font-bold'
                                                                : 'text-zinc-500 hover:text-zinc-300'
                                                        }`}
                                                        title={isSelectedModel ? 'Active Model' : 'Set as Active Model'}
                                                    >
                                                        <LinkIcon className={`w-3.5 h-3.5 ${isSelectedModel ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'}`} />
                                                    </button>

                                                    {/* Edit Model Pencil Icon */}
                                                    <button
                                                        onClick={() => {
                                                            setEditingModelId(m);
                                                            setEditModelInput(m);
                                                        }}
                                                        className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                                                        title="Edit Model ID"
                                                    >
                                                        <PencilIcon className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-200" />
                                                    </button>

                                                    {/* Delete Model Trash Icon */}
                                                    <button
                                                        onClick={async () => {
                                                            // Confirm before removing a carefully-typed model id — the
                                                            // provider delete already confirms; this was the silent one.
                                                            const ok = await confirm({
                                                                title: `Remove model "${m}"?`,
                                                                message: 'The model id will be removed from this provider\'s list.',
                                                                confirmLabel: 'Remove',
                                                            });
                                                            if (ok) handleRemoveModelSubmit(m);
                                                        }}
                                                        className="p-1 text-zinc-500 hover:text-rose-400 transition-colors"
                                                        title="Remove Model"
                                                    >
                                                        <TrashIcon className="w-3.5 h-3.5 text-zinc-500 hover:text-rose-400" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* + Add Model Button / Input */}
                                    {showAddModelInput ? (
                                        <div className="flex items-center gap-2 pt-1 animate-fade-in">
                                            <input
                                                type="text"
                                                value={newModelInput}
                                                onChange={(e) => setNewModelInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddModelSubmit()}
                                                placeholder="e.g. deepseek-v4-flash-free"
                                                className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-cyan-500/50 text-xs font-mono text-zinc-100 focus:outline-none"
                                                autoFocus
                                            />
                                            <button
                                                onClick={handleAddModelSubmit}
                                                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-bold transition-all"
                                            >
                                                Add
                                            </button>
                                            <button
                                                onClick={() => setShowAddModelInput(false)}
                                                className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition-all"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowAddModelInput(true)}
                                            className="w-full py-2 px-3 rounded-lg border border-dashed border-zinc-800 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 flex items-center gap-1.5 transition-all mt-1"
                                        >
                                            <span className="font-bold text-sm">+</span>
                                            <span>Add model</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Save and Test Actions */}
                            <div className="flex items-center gap-2.5 pt-2">
                                <button
                                    onClick={handleSave}
                                    disabled={!isDirty || saveState === 'saving'}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                                        saveState === 'saved'
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                            : isDirty
                                                ? 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300 active:scale-[0.98] shadow-md'
                                                : 'bg-zinc-800 text-zinc-600 border border-zinc-700/40 cursor-not-allowed'
                                    }`}
                                >
                                    {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save'}
                                </button>

                                <button
                                    onClick={handleTest}
                                    disabled={isTesting || !draftUrlValidation.valid || !draftModel.trim()}
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    {isTesting ? 'Testing…' : 'Test'}
                                </button>
                            </div>

                            {/* Test Result Message */}
                            {testResult && (
                                <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs border animate-fade-in ${
                                    testResult.success
                                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                        : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                                }`}>
                                    <span className="font-bold">{testResult.success ? '✓' : '✕'}</span>
                                    <span className="break-all leading-relaxed">{testResult.message}</span>
                                </div>
                            )}

                            {/* Provider health telemetry — live request counts, latency, last error */}
                            <HealthStrip providerId={selected.id} />
                        </div>
                    ) : (
                        <div className="py-12 text-center text-xs text-zinc-500">
                            Select a provider from the left sidebar or click "+ Add provider" to create a new provider.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Live provider health strip — reads ProviderHealthService telemetry and
 * refreshes every 5s while the provider panel is open.
 */
const HealthStrip: React.FC<{ providerId: string }> = ({ providerId }) => {
    const [, setTick] = useState(0);
    useEffect(() => {
        // Pause the 5s health poll while the tab is backgrounded — no point
        // re-rendering the strip (and burning the health cache) when nobody
        // can see it.
        if (typeof document === 'undefined') return;
        let interval: ReturnType<typeof setInterval> | null = null;
        const start = (): void => {
            if (interval) return;
            interval = setInterval(() => setTick(t => t + 1), 5000);
        };
        const stop = (): void => {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
        };
        start();
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'visible') start();
            else stop();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);
    const health = getProviderHealth(providerId);
    if (!health || health.requestCount === 0) {
        return (
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">
                No requests recorded for this session yet — run an analysis or press Test.
            </div>
        );
    }
    return (
        <div className="space-y-1 rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-2 text-[10px]">
            <div className="flex items-center gap-2 uppercase tracking-wider text-zinc-500">
                <span>Session health</span>
                <span className="ml-auto font-mono text-zinc-400">{health.requestCount} req · {health.errorCount} err · {health.rateLimitCount} rate-limited</span>
            </div>
            {typeof health.avgLatencyMs === 'number' && (
                <div className="flex items-center gap-2 text-zinc-500">
                    <span>Avg latency</span>
                    <span className="ml-auto font-mono text-zinc-300">{health.avgLatencyMs}ms</span>
                </div>
            )}
            {health.lastSuccessAt && (
                <div className="flex items-center gap-2 text-zinc-500">
                    <span>Last success</span>
                    <span className="ml-auto font-mono text-zinc-300">{new Date(health.lastSuccessAt).toLocaleTimeString()}</span>
                </div>
            )}
            {health.lastError && (
                <div className="rounded-md bg-rose-500/10 border border-rose-500/25 px-2 py-1 text-rose-300 break-all leading-relaxed">
                    Last error: {health.lastError}
                </div>
            )}
        </div>
    );
};

export default React.memo(ProviderManager);
