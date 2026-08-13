/**
 * MemorySettings - Memory provider/model picker.
 *
 * Lets the user choose which AI provider manages pattern memory
 * and trade history, along with the model to use.
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

const MemorySettings: React.FC<MemorySettingsProps> = ({ providerConfigs, memoryConfig, onMemoryConfigChange }) => (
    <label className="flex flex-col gap-2 min-w-[220px] flex-1">
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">Memory model</span>
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
    </label>
);

export default MemorySettings;
