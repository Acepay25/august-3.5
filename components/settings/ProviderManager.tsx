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
import { GOOGLE_GEMINI_DEFAULT_BASE } from '../../utils/googleGeminiFormat';
import { testConnection } from '../../services/providers/GenericProviderService';
import { discoverProviderModels } from '../../services/infrastructure/ProviderConfigService';
import { resetProviderHealth } from '../../services/infrastructure/ProviderHealthService';
import { validateProviderUrl } from '../../utils/providerUrlValidation';
import { mergeDiscoveredModels, sortModelsFreeFirst } from '../../utils/providerUtils';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { useToastActions } from '../shared/Toast';
import { LoadingIcon } from '../shared/Icons';

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

const BoltIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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
    'placeholder-zinc-600 font-mono focus:outline-none focus:border-zinc-600 ' +
    'transition-all duration-200';

const selectBase =
    'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 ' +
    'focus:outline-none focus:border-zinc-600 transition-all duration-200 ' +
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
    const toast = useToastActions();
    const [selectedId, setSelectedId] = useState<string>(configs[0]?.id || '');
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');

    // Draft (staged) values for right panel
    const [draftKey, setDraftKey] = useState('');
    const [draftUrl, setDraftUrl] = useState('');
    const [draftFormat, setDraftFormat] = useState<ApiFormat>('chat_completions');
    const [draftModel, setDraftModel] = useState('');
    const [draftInputUsd, setDraftInputUsd] = useState('');
    const [draftOutputUsd, setDraftOutputUsd] = useState('');
    const [showKey, setShowKey] = useState(false);

    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [testingModelId, setTestingModelId] = useState<string | null>(null);
    const [modelTests, setModelTests] = useState<Record<string, { ok: boolean; message: string }>>({});
    // "Discover models" — /models endpoint import (per-provider + add form).
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [isDiscoveringNew, setIsDiscoveringNew] = useState(false);

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
            setDraftInputUsd(selected.inputUsdPer1k !== undefined ? String(selected.inputUsdPer1k) : '');
            setDraftOutputUsd(selected.outputUsdPer1k !== undefined ? String(selected.outputUsdPer1k) : '');
            setNameDraft(selected.name);
            setIsEditingName(false);
            setShowKey(false);
            setSaveState('idle');
            setTestResult(null);
            setModelTests({});
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
            draftInputUsd !== (selected.inputUsdPer1k !== undefined ? String(selected.inputUsdPer1k) : '') ||
            draftOutputUsd !== (selected.outputUsdPer1k !== undefined ? String(selected.outputUsdPer1k) : '') ||
            (!!nameDraft.trim() && nameDraft.trim() !== selected.name)
        );
        }, [selected, draftKey, draftUrl, draftFormat, draftModel, draftInputUsd, draftOutputUsd, nameDraft]);

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
            inputUsdPer1k: draftInputUsd.trim() ? Number(draftInputUsd) : undefined,
            outputUsdPer1k: draftOutputUsd.trim() ? Number(draftOutputUsd) : undefined,
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
    }, [selected, draftKey, draftUrl, draftFormat, draftModel, draftInputUsd, draftOutputUsd, nameDraft, draftUrlValidation, onUpdateProvider]);

    const handleTestModel = useCallback(async (modelId: string): Promise<{ success: boolean; message: string }> => {
        if (!selected || !draftUrlValidation.valid) {
            const failed = { success: false, message: 'Fix the base URL before testing a model.' };
            setModelTests(prev => ({ ...prev, [modelId]: { ok: false, message: failed.message } }));
            return failed;
        }
        setTestingModelId(modelId);
        try {
            const result = await testConnection({
                ...selected,
                apiKey: draftKey.trim(),
                baseUrl: draftUrlValidation.normalizedUrl,
                apiFormat: draftFormat,
                selectedModel: modelId,
            });
            setModelTests(prev => ({ ...prev, [modelId]: { ok: result.success, message: result.message } }));
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Connection test failed.';
            setModelTests(prev => ({ ...prev, [modelId]: { ok: false, message } }));
            return { success: false, message };
        } finally {
            setTestingModelId(current => current === modelId ? null : current);
        }
    }, [selected, draftKey, draftFormat, draftUrlValidation]);

    const handleTest = useCallback(async () => {
        if (!selected || !draftUrlValidation.valid || selected.models.length === 0) {
            setTestResult({ success: false, message: 'Add at least one model before testing.' });
            return;
        }
        setIsTesting(true);
        setTestResult(null);
        let passed = 0;
        let lastFail = '';
        for (const modelId of selected.models) {
            const result = await handleTestModel(modelId);
            if (result.success) passed += 1;
            else lastFail = result.message;
        }
        setTestResult({
            success: passed === selected.models.length,
            message: passed === selected.models.length
                ? `All ${selected.models.length} models replied OK`
                : `${passed}/${selected.models.length} models passed.${lastFail ? ` Last error: ${lastFail}` : ''}`,
        });
        setIsTesting(false);
    }, [selected, draftUrlValidation, handleTestModel]);

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

    // Discover every model the provider exposes via /models and merge the
    // fresh ids into the model list (existing ids are kept untouched).
    const handleDiscoverModels = useCallback(async () => {
        if (!selected) return;
        setIsDiscovering(true);
        try {
            const discovered = await discoverProviderModels({
                baseUrl: draftUrl || selected.baseUrl,
                apiKey: draftKey || selected.apiKey,
                apiFormat: draftFormat || selected.apiFormat,
            });
            const existing = new Set(selected.models);
            const fresh = discovered.filter(m => !existing.has(m));
            if (fresh.length === 0) {
                toast.success('Models up to date', 'All models from this provider are already in the list.');
            } else {
                await onUpdateProvider(selected.id, { models: mergeDiscoveredModels(selected.models, discovered) });
                toast.success('Models discovered', `Added ${fresh.length} model${fresh.length === 1 ? '' : 's'} from /models.`);
            }
        } catch (e) {
            console.error('[ProviderManager] Model discovery failed:', e);
            toast.error('Model discovery failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsDiscovering(false);
        }
    }, [selected, draftUrl, draftKey, draftFormat, onUpdateProvider, toast]);

    // Discover models into the Add-Provider form's comma-separated field.
    const handleDiscoverNewModels = useCallback(async () => {
        setIsDiscoveringNew(true);
        try {
            const discovered = await discoverProviderModels({ baseUrl: newUrl, apiKey: newKey, apiFormat: newFormat });
            setNewModels(sortModelsFreeFirst(discovered).join(', '));
            setAddError('');
            toast.success('Models discovered', `${discovered.length} models found — review them, then create the provider.`);
        } catch (e) {
            console.error('[ProviderManager] Model discovery failed (new provider):', e);
            toast.error('Model discovery failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsDiscoveringNew(false);
        }
    }, [newUrl, newKey, newFormat, toast]);

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

    const catalogRefreshed = useRef<Record<string, number>>({});
    const [catalogStatus, setCatalogStatus] = useState<string>('');

    const refreshCatalog = useCallback(async (cfg: ProviderConfig, silent: boolean): Promise<void> => {
        if (!cfg.apiKey.trim() || !cfg.baseUrl.trim()) return;
        if (!silent) setCatalogStatus(`Updating ${cfg.name}…`);
        try {
            const discovered = await discoverProviderModels({
                baseUrl: cfg.baseUrl,
                apiKey: cfg.apiKey,
                apiFormat: cfg.apiFormat,
            });
            const models = mergeDiscoveredModels(cfg.models, discovered);
            const selectedModel = models.includes(cfg.selectedModel) ? cfg.selectedModel : (models[0] || cfg.selectedModel);
            catalogRefreshed.current[cfg.id] = Date.now();
            if (models.join('\0') !== cfg.models.join('\0') || selectedModel !== cfg.selectedModel) {
                await onUpdateProvider(cfg.id, { models, selectedModel });
            }
            if (!silent) setCatalogStatus(`Updated ${cfg.name} · ${models.length} models`);
        } catch {
            if (!silent) setCatalogStatus(`Could not update ${cfg.name} — keeping the saved list.`);
        }
    }, [onUpdateProvider]);

    useEffect(() => {
        let cancelled = false;
        const STALE_MS = 10 * 60 * 1000;
        const run = async (): Promise<void> => {
            for (const cfg of configs) {
                if (cancelled) return;
                if (!cfg.isEnabled || !cfg.apiKey.trim() || !cfg.baseUrl.trim()) continue;
                const last = catalogRefreshed.current[cfg.id] || 0;
                if (Date.now() - last < STALE_MS) continue;
                try {
                    await refreshCatalog(cfg, true);
                } catch {
                    /* keep the saved list */
                }
            }
        };
        void run();
        return () => { cancelled = true; };
    }, [configs, refreshCatalog]);

    const listedModels = selected ? sortModelsFreeFirst(selected.models) : [];

    return (
        <div className="space-y-4">
            {ConfirmDialogComponent}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-zinc-100">Model settings</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                        Manage custom model providers. Once configured, they can be selected during chat.
                        {catalogStatus ? ` ${catalogStatus}` : ''}
                    </p>
                </div>
                <button
                    onClick={() => { if (selected) void refreshCatalog(selected, false); }}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    title="Refresh model catalogs"
                >
                    <RefreshIcon />
                </button>
            </div>

            <div className="grid min-h-[540px] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 md:grid-cols-[280px_minmax(0,1fr)]">
                <div className="flex flex-col border-b border-zinc-800 p-3 md:border-b-0 md:border-r">
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
                        {([
                            { title: 'Providers', items: configs.filter(c => c.isBuiltIn) },
                            { title: 'Custom providers', items: configs.filter(c => !c.isBuiltIn) },
                        ] as const).filter(section => section.title === 'Custom providers' || section.items.length > 0).map(section => (
                            <div key={section.title}>
                                <h5 className="mb-2 px-2 text-[13px] text-zinc-500">{section.title}</h5>
                                <div className="space-y-0.5">
                                    {section.items.map(c => {
                                        const isSelectedRow = selected?.id === c.id && !showAddProvider;
                                        const isReady = c.isEnabled && c.apiKey.trim().length > 0;
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => { setSelectedId(c.id); setShowAddProvider(false); }}
                                                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left ${
                                                    isSelectedRow ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                                                }`}
                                            >
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-950">
                                                        <CubeIcon className="h-3.5 w-3.5 text-zinc-400" />
                                                    </span>
                                                    <span className="truncate text-[13px] font-medium">{c.name}</span>
                                                </span>
                                                <span className={`status-surface h-1.5 w-1.5 shrink-0 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => setShowAddProvider(true)}
                        className="mt-3 flex w-full items-center justify-center rounded-lg border border-dashed border-zinc-700 py-2 text-[13px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    >
                        + Add provider
                    </button>
                </div>

                <div className="min-w-0 p-5">
                    {showAddProvider ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-zinc-100">Add provider</h4>
                                <button onClick={() => setShowAddProvider(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
                            </div>
                            <div>
                                <FieldLabel>Provider Name</FieldLabel>
                                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Opencode Zen" className={inputBase} />
                            </div>
                            <div>
                                <FieldLabel>Base URI</FieldLabel>
                                <input type="text" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder={newFormat === 'google' ? GOOGLE_GEMINI_DEFAULT_BASE : 'https://opencode.ai/zen/v1'} className={inputBase} />
                                {!newUrlValidation.valid && newUrl.trim() && <p className="mt-1 text-xs text-red-300">{newUrlValidation.message}</p>}
                            </div>
                            <div>
                                <FieldLabel>Endpoint</FieldLabel>
                                <select value={newFormat} onChange={(e) => {
                                    const next = e.target.value as ApiFormat;
                                    setNewFormat(next);
                                    if (next === 'google' && !newUrl.trim()) setNewUrl(GOOGLE_GEMINI_DEFAULT_BASE);
                                }} className={selectBase}>
                                    {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([val, label]) => (
                                        <option key={val} value={val}>{label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <FieldLabel>API key</FieldLabel>
                                <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={newFormat === 'google' ? 'AIza…' : 'sk-…'} className={inputBase} autoComplete="off" />
                            </div>
                            <div>
                                <FieldLabel>Model list (comma-separated)</FieldLabel>
                                <div className="flex gap-2">
                                    <input type="text" value={newModels} onChange={(e) => { setNewModels(e.target.value); setAddError(''); }} placeholder={newFormat === 'google' ? 'gemini-2.5-flash, gemini-2.5-pro' : 'deepseek-v4-flash-free, mimo-v2.5-free'} className={`${inputBase} min-w-0 flex-1`} />
                                    <button type="button" onClick={handleDiscoverNewModels} disabled={isDiscoveringNew || !newUrl.trim() || !newKey.trim()} className="shrink-0 rounded-xl border border-zinc-700 px-3 text-xs text-zinc-400 disabled:opacity-40">
                                        {isDiscoveringNew ? '…' : 'Discover'}
                                    </button>
                                </div>
                                {addError && <p className="mt-1 text-xs text-red-300">{addError}</p>}
                            </div>
                            <button onClick={handleAddProvider} disabled={!newName.trim() || !newUrlValidation.valid} className="w-full rounded-xl bg-zinc-100 py-2 text-xs font-bold text-zinc-950 disabled:opacity-40">
                                Create provider
                            </button>
                        </div>
                    ) : selected ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    {isEditingName ? (
                                        <>
                                            <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm font-semibold text-zinc-100 focus:outline-none" autoFocus />
                                            <button onClick={() => setIsEditingName(false)} className="text-xs text-zinc-400">Done</button>
                                        </>
                                    ) : (
                                        <>
                                            <h3 className="truncate text-[15px] font-semibold text-zinc-100">{nameDraft.trim() || selected.name}</h3>
                                            <button onClick={() => setIsEditingName(true)} className="p-1 text-zinc-500 hover:text-zinc-200" title="Edit name">
                                                <PencilIcon className="h-3.5 w-3.5" />
                                            </button>
                                        </>
                                    )}
                                    <div className="status-surface ml-1 flex items-center gap-1">
                                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${selected.isEnabled ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                                            {selected.isEnabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                        <button type="button" onClick={() => { void onToggleProvider(selected.id); }} className="rounded-md px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                                            {selected.isEnabled ? 'Disable' : 'Enable'}
                                        </button>
                                    </div>
                                </div>
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
                                        resetProviderHealth(selected.id);
                                        const remaining = configs.filter(c => c.id !== selected.id);
                                        if (remaining.length > 0) setSelectedId(remaining[0].id);
                                    }}
                                    className="p-1.5 text-zinc-500 hover:text-rose-400 disabled:opacity-30"
                                    title={selected.isBuiltIn ? 'Built-in providers cannot be deleted' : 'Delete provider'}
                                >
                                    <TrashIcon className="h-4 w-4" />
                                </button>
                            </div>

                            <div>
                                <FieldLabel>Base URI</FieldLabel>
                                <input type="text" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder={draftFormat === 'google' ? GOOGLE_GEMINI_DEFAULT_BASE : 'https://opencode.ai/zen/v1'} className={inputBase} />
                                {!draftUrlValidation.valid && draftUrl.trim() && <p className="mt-1 text-xs text-red-300">{draftUrlValidation.message}</p>}
                            </div>
                            <div>
                                <FieldLabel>Endpoint</FieldLabel>
                                <select value={draftFormat} onChange={(e) => {
                                    const next = e.target.value as ApiFormat;
                                    setDraftFormat(next);
                                    if (next === 'google' && !draftUrl.trim()) setDraftUrl(GOOGLE_GEMINI_DEFAULT_BASE);
                                }} className={selectBase}>
                                    {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([val, label]) => (
                                        <option key={val} value={val}>{label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <FieldLabel>API key</FieldLabel>
                                <div className="relative">
                                    <input type={showKey ? 'text' : 'password'} value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="••••••••••••••••••••••••••••••••" className={`${inputBase} pr-10`} autoComplete="off" />
                                    <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300" title={showKey ? 'Hide key' : 'Show key'}>
                                        {showKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <FieldLabel>Model list</FieldLabel>
                                <div className="max-h-[320px] min-h-[168px] space-y-2 overflow-y-auto">
                                    {listedModels.map((m) => {
                                        const isSelectedModel = draftModel === m;
                                        const isEditingThis = editingModelId === m;
                                        const badgeText = getContextBadge(m);
                                        const modelTest = modelTests[m];
                                        const isTestingThis = testingModelId === m;
                                        return (
                                            <div key={m} className="space-y-1">
                                            <div
                                                className={`flex h-[48px] items-center rounded-xl px-3.5 ${
                                                    isSelectedModel ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800'
                                                }`}
                                            >
                                                {isEditingThis ? (
                                                    <div className="flex min-w-0 flex-1 items-center gap-2" onClick={e => e.stopPropagation()}>
                                                        <input type="text" value={editModelInput} onChange={(e) => setEditModelInput(e.target.value)} className="w-full rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 focus:outline-none" autoFocus />
                                                        <button onClick={() => handleUpdateModelSubmit(m)} className="text-xs text-zinc-300">✓</button>
                                                        <button onClick={() => setEditingModelId(null)} className="text-xs text-zinc-500">✕</button>
                                                    </div>
                                                ) : (
                                                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m}</span>
                                                )}
                                                <div className="ml-4 flex shrink-0 items-center gap-2.5" onClick={e => e.stopPropagation()}>
                                                    <span className="font-mono text-[10px] font-medium text-zinc-500">{badgeText}</span>
                                                    <button type="button" onClick={() => void handleTestModel(m)} disabled={isTestingThis || isTesting || !draftUrlValidation.valid} className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-40" title={modelTest?.message || `Test ${m}`}>
                                                        {isTestingThis ? <LoadingIcon className="h-3.5 w-3.5 animate-spin" /> : <BoltIcon className="h-3.5 w-3.5" />}
                                                    </button>
                                                    <button onClick={() => { setEditingModelId(m); setEditModelInput(m); }} className="p-1 text-zinc-500 hover:text-zinc-200" title="Edit model ID">
                                                        <PencilIcon className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const ok = await confirm({
                                                                title: `Remove model "${m}"?`,
                                                                message: 'The model id will be removed from this provider\'s list.',
                                                                confirmLabel: 'Remove',
                                                            });
                                                            if (ok) handleRemoveModelSubmit(m);
                                                        }}
                                                        className="p-1 text-zinc-500 hover:text-rose-400"
                                                        title="Remove model"
                                                    >
                                                        <TrashIcon className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            {isTestingThis && (
                                                <p className="px-3.5 text-[11px] text-zinc-500">Testing…</p>
                                            )}
                                            {modelTest && !isTestingThis && modelTest.ok && (
                                                <p className="status-surface px-3.5 text-[11px] font-medium text-emerald-400">Connected!</p>
                                            )}
                                            {modelTest && !isTestingThis && !modelTest.ok && (
                                                <p className="status-surface px-3.5 text-[11px] leading-relaxed text-rose-400">{modelTest.message}</p>
                                            )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {showAddModelInput ? (
                                    <div className="mt-2 flex gap-2">
                                        <input type="text" value={newModelInput} onChange={(e) => setNewModelInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddModelSubmit()} placeholder="model id" className={`${inputBase} flex-1`} autoFocus />
                                        <button onClick={handleAddModelSubmit} className="rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-950">Add</button>
                                        <button onClick={() => setShowAddModelInput(false)} className="rounded-xl px-3 text-xs text-zinc-500">Cancel</button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowAddModelInput(true)} className="mt-2 flex w-full items-center justify-center rounded-lg border border-dashed border-zinc-700 py-2 text-[13px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
                                        + Add model
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="py-16 text-center text-xs text-zinc-500">Select a provider or add one.</p>
                    )}
                </div>
            </div>

            {selected && !showAddProvider && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={handleSave}
                            disabled={!isDirty || saveState === 'saving'}
                            className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider ${
                                saveState === 'saved'
                                    ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                                    : isDirty
                                        ? 'bg-zinc-100 text-zinc-950'
                                        : 'cursor-not-allowed border border-zinc-800 text-zinc-600'
                            }`}
                        >
                            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
                        </button>
                        <button onClick={handleDiscoverModels} disabled={isDiscovering || !(draftUrl || selected.baseUrl).trim() || !(draftKey || selected.apiKey).trim()} className="rounded-xl px-3 py-2 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-40">
                            {isDiscovering ? 'Discovering…' : 'Discover models'}
                        </button>
                        <button onClick={handleTest} disabled={isTesting || !draftUrlValidation.valid || selected.models.length === 0} className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 disabled:opacity-40">
                            {isTesting ? 'Testing…' : 'Test all'}
                        </button>
                    </div>
                    {testResult && (
                        <p className={`text-xs ${testResult.success ? 'text-zinc-300' : 'text-rose-300'}`}>{testResult.message}</p>
                    )}
                    <details className="text-[11px] text-zinc-500">
                        <summary className="cursor-pointer">Token pricing (optional)</summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                            <input type="number" min="0" step="0.001" value={draftInputUsd} onChange={(e) => setDraftInputUsd(e.target.value)} placeholder="Input $/1k" className={inputBase} />
                            <input type="number" min="0" step="0.001" value={draftOutputUsd} onChange={(e) => setDraftOutputUsd(e.target.value)} placeholder="Output $/1k" className={inputBase} />
                        </div>
                    </details>
                </div>
            )}
        </div>
    );
};

export default React.memo(ProviderManager);
