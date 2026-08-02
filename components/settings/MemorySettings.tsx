/**
 * MemorySettings - Memory provider/model configuration card.
 *
 * Extracted from SettingsMenu.tsx (AI Models & Providers view).
 * Lets the user choose which AI provider manages pattern memory
 * and trade history, along with the model to use.
 *
 * Providers are now user-configured `ProviderConfig`s. The parent
 * passes the full list of available provider configs plus the
 * currently selected memory config (or null) and a change callback.
 */

import React from 'react';
import { ProviderConfig } from '../../types/provider';

export interface MemorySettingsProps {
    /** All available provider configs to choose from. */
    providerConfigs: ProviderConfig[];
    /** The provider config currently selected for memory operations, or null. */
    memoryConfig: ProviderConfig | null;
    /** Called when the user picks a different provider config for memory. */
    onMemoryConfigChange: (config: ProviderConfig | null) => void;
}

// Memory Provider
const MemorySettings: React.FC<MemorySettingsProps> = ({ providerConfigs, memoryConfig, onMemoryConfigChange }) => (
    <div className="p-4 rounded-2xl bg-zinc-900/50 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-3">
            <span className="text-xl"></span>
            <span className="text-sm font-bold text-purple-400">Memory Provider</span>
        </div>
        <p className="text-xs text-zinc-500 mb-3">The AI that manages pattern memory and trade history</p>
        <div className="space-y-2">
            <select
                value={memoryConfig?.id ?? ''}
                onChange={(e) => {
                    const selected = providerConfigs.find(p => p.id === e.target.value) ?? null;
                    onMemoryConfigChange?.(selected);
                }}
                className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
            >
                <option value="">Select a provider</option>
                {providerConfigs.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                ))}
            </select>
            {/* Model dropdown based on selected provider */}
            {memoryConfig && memoryConfig.models.length > 0 && (
                <select
                    value={memoryConfig.selectedModel || ''}
                    onChange={(e) => {
                        const updated: ProviderConfig = { ...memoryConfig, selectedModel: e.target.value };
                        onMemoryConfigChange?.(updated);
                    }}
                    className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
                >
                    {memoryConfig.models.map(m => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
            )}
        </div>
    </div>
);

export default MemorySettings;
