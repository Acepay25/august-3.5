/**
 * ProviderManager — UI for configuring AI providers.
 * Dropdown to select provider, configure API key / base URL / format,
 * and add custom providers.
 */

import React, { useState, useCallback } from 'react';
import { ProviderConfig, ApiFormat, API_FORMAT_LABELS } from '../../types/provider';
import { testConnection } from '../../services/providers/GenericProviderService';

interface ProviderManagerProps {
    configs: ProviderConfig[];
    onUpdateProvider: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider: (provider: {
        name: string;
        baseUrl: string;
        apiKey: string;
        apiFormat: ApiFormat;
        models?: string[];
        selectedModel?: string;
    }) => Promise<void>;
    onRemoveProvider: (id: string) => Promise<void>;
    onToggleProvider: (id: string) => Promise<void>;
}

const ProviderManager: React.FC<ProviderManagerProps> = ({
    configs,
    onUpdateProvider,
    onAddCustomProvider,
    onRemoveProvider,
    onToggleProvider,
}) => {
    const [selectedProviderId, setSelectedProviderId] = useState<string>(configs[0]?.id || '');
    const [showApiKey, setShowApiKey] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // Custom provider form
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newBaseUrl, setNewBaseUrl] = useState('');
    const [newApiKey, setNewApiKey] = useState('');
    const [newFormat, setNewFormat] = useState<ApiFormat>('chat_completions');
    const [newModels, setNewModels] = useState('');

    const selectedProvider = configs.find(c => c.id === selectedProviderId);

    const handleTest = useCallback(async () => {
        if (!selectedProvider) return;
        setIsTesting(true);
        setTestResult(null);
        const result = await testConnection(selectedProvider);
        setTestResult(result);
        setIsTesting(false);
    }, [selectedProvider]);

    const handleAddProvider = useCallback(async () => {
        if (!newName.trim() || !newBaseUrl.trim()) return;
        await onAddCustomProvider({
            name: newName.trim(),
            baseUrl: newBaseUrl.trim(),
            apiKey: newApiKey.trim(),
            apiFormat: newFormat,
            models: newModels.split(',').map(m => m.trim()).filter(Boolean),
            selectedModel: newModels.split(',').map(m => m.trim()).filter(Boolean)[0] || 'default',
        });
        setNewName('');
        setNewBaseUrl('');
        setNewApiKey('');
        setNewFormat('chat_completions');
        setNewModels('');
        setShowAddForm(false);
    }, [newName, newBaseUrl, newApiKey, newFormat, newModels, onAddCustomProvider]);

    const inputClass = "w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors";
    const labelClass = "block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5";
    const selectClass = "w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer";

    return (
        <div className="space-y-4">
            {/* Provider Selector Dropdown */}
            <div>
                <label className={labelClass}>Select Provider</label>
                <select
                    value={selectedProviderId}
                    onChange={(e) => { setSelectedProviderId(e.target.value); setTestResult(null); setShowApiKey(false); }}
                    className={selectClass}
                >
                    <optgroup label="Built-in Providers">
                        {configs.filter(c => c.isBuiltIn).map(c => (
                            <option key={c.id} value={c.id}>
                                {c.name} {c.apiKey ? '🔑' : '⚠️ No Key'} {c.isEnabled ? '✅' : '⬜'}
                            </option>
                        ))}
                    </optgroup>
                    {configs.some(c => !c.isBuiltIn) && (
                        <optgroup label="Custom Providers">
                            {configs.filter(c => !c.isBuiltIn).map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name} {c.apiKey ? '🔑' : '⚠️ No Key'} {c.isEnabled ? '✅' : '⬜'}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
            </div>

            {/* Selected Provider Config */}
            {selectedProvider && (
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-700/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-zinc-200">{selectedProvider.name}</h4>
                        <div className="flex items-center gap-2">
                            {/* Enable/Disable Toggle */}
                            <button
                                onClick={() => onToggleProvider(selectedProvider.id)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                    selectedProvider.isEnabled
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-zinc-700/50 text-zinc-500 border border-zinc-600/30'
                                }`}
                            >
                                {selectedProvider.isEnabled ? 'Enabled' : 'Disabled'}
                            </button>
                            {/* Delete (custom only) */}
                            {!selectedProvider.isBuiltIn && (
                                <button
                                    onClick={() => { onRemoveProvider(selectedProvider.id); setSelectedProviderId(configs[0]?.id || ''); }}
                                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </div>

                    {/* API Key */}
                    <div>
                        <label className={labelClass}>API Key</label>
                        <div className="relative">
                            <input
                                type={showApiKey ? 'text' : 'password'}
                                value={selectedProvider.apiKey}
                                onChange={(e) => onUpdateProvider(selectedProvider.id, { apiKey: e.target.value })}
                                placeholder="Enter your API key..."
                                className={`${inputClass} pr-10`}
                            />
                            <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
                            >
                                {showApiKey ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>

                    {/* Base URL */}
                    <div>
                        <label className={labelClass}>Base URL</label>
                        <input
                            type="text"
                            value={selectedProvider.baseUrl}
                            onChange={(e) => onUpdateProvider(selectedProvider.id, { baseUrl: e.target.value })}
                            placeholder="https://api.example.com/v1"
                            className={inputClass}
                        />
                    </div>

                    {/* API Format */}
                    <div>
                        <label className={labelClass}>API Format</label>
                        <select
                            value={selectedProvider.apiFormat}
                            onChange={(e) => onUpdateProvider(selectedProvider.id, { apiFormat: e.target.value as ApiFormat })}
                            className={selectClass}
                        >
                            {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Model Selection */}
                    <div>
                        <label className={labelClass}>Model</label>
                        <select
                            value={selectedProvider.selectedModel}
                            onChange={(e) => onUpdateProvider(selectedProvider.id, { selectedModel: e.target.value })}
                            className={selectClass}
                        >
                            {selectedProvider.models.map(model => (
                                <option key={model} value={model}>{model}</option>
                            ))}
                        </select>
                    </div>

                    {/* Test Connection */}
                    <div className="flex items-center gap-3 pt-1">
                        <button
                            onClick={handleTest}
                            disabled={isTesting || !selectedProvider.apiKey}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {isTesting ? 'Testing...' : 'Test Connection'}
                        </button>
                        {testResult && (
                            <span className={`text-xs ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {testResult.success ? '✓' : '✕'} {testResult.message}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Add Custom Provider */}
            <div className="border-t border-zinc-800 pt-3">
                {!showAddForm ? (
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="w-full py-2.5 rounded-lg border border-dashed border-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
                    >
                        + Add Custom Provider
                    </button>
                ) : (
                    <div className="rounded-xl bg-zinc-900/60 border border-cyan-500/20 p-4 space-y-3">
                        <h4 className="text-sm font-bold text-cyan-400">New Custom Provider</h4>

                        <div>
                            <label className={labelClass}>Provider Name</label>
                            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g., My Local LLM, Together AI..." className={inputClass} />
                        </div>

                        <div>
                            <label className={labelClass}>Base URL</label>
                            <input type="text" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)}
                                placeholder="https://api.example.com/v1" className={inputClass} />
                        </div>

                        <div>
                            <label className={labelClass}>API Key</label>
                            <input type="password" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)}
                                placeholder="sk-..." className={inputClass} />
                        </div>

                        <div>
                            <label className={labelClass}>API Format</label>
                            <select value={newFormat} onChange={(e) => setNewFormat(e.target.value as ApiFormat)} className={selectClass}>
                                {(Object.entries(API_FORMAT_LABELS) as [ApiFormat, string][]).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className={labelClass}>Models (comma-separated)</label>
                            <input type="text" value={newModels} onChange={(e) => setNewModels(e.target.value)}
                                placeholder="model-1, model-2, model-3" className={inputClass} />
                        </div>

                        <div className="flex gap-2 pt-1">
                            <button onClick={handleAddProvider}
                                disabled={!newName.trim() || !newBaseUrl.trim()}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-zinc-900 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                Add Provider
                            </button>
                            <button onClick={() => setShowAddForm(false)}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
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
