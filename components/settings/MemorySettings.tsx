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
import ModelPicker from '../shared/ModelPicker';

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
    <div className="p-4 rounded-2xl bg-zinc-800 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-3">
            <span className="text-xl"></span>
            <span className="text-sm font-bold text-purple-400">Memory Provider</span>
        </div>
        <p className="text-xs text-zinc-500 mb-3">The AI that manages pattern memory and trade history</p>
        <div className="space-y-2">
            <ModelPicker
                providers={providerConfigs}
                value={memoryConfig?.id && memoryConfig?.selectedModel ? `${memoryConfig.id}::${memoryConfig.selectedModel}` : memoryConfig?.id ?? ''}
                onChange={(value) => {
                    const separator = value.indexOf('::');
                    if (separator >= 0) {
                        const providerId = value.slice(0, separator);
                        const modelId = value.slice(separator + 2);
                        const selected = providerConfigs.find(p => p.id === providerId) ?? null;
                        if (selected) {
                            onMemoryConfigChange?.({ ...selected, selectedModel: modelId });
                        }
                    } else {
                        const selected = providerConfigs.find(p => p.id === value) ?? null;
                        onMemoryConfigChange?.(selected);
                    }
                }}
                mode="provider-model"
                placeholder="Select provider/model"
            />
        </div>
    </div>
);

export default MemorySettings;
