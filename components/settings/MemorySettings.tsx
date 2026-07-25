/**
 * MemorySettings - Memory provider/model configuration card.
 *
 * Extracted from SettingsMenu.tsx (AI Models & Providers view).
 * Lets the user choose which AI provider manages pattern memory
 * and trade history, along with the model to use.
 */

import React from 'react';
import { MemoryProvider, MEMORY_PROVIDER_OPTIONS, MEMORY_MODELS, getDefaultModelForProvider } from '../../services/learning/MemoryService';

export interface MemorySettingsProps {
    memoryProvider: MemoryProvider;
    setMemoryProvider: (provider: MemoryProvider) => void;
    memoryModel: string;
    setMemoryModel: (model: string) => void;
}

// Memory Provider
const MemorySettings: React.FC<MemorySettingsProps> = ({ memoryProvider, setMemoryProvider, memoryModel, setMemoryModel }) => (
    <div className="p-4 rounded-2xl bg-zinc-900/50 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🧠</span>
            <span className="text-sm font-bold text-purple-400">Memory Provider</span>
        </div>
        <p className="text-xs text-zinc-500 mb-3">The AI that manages pattern memory and trade history</p>
        <div className="space-y-2">
            <select
                value={memoryProvider || ''}
                onChange={(e) => {
                    const newProvider = e.target.value as MemoryProvider;
                    setMemoryProvider?.(newProvider);
                    setMemoryModel?.(getDefaultModelForProvider(newProvider));
                }}
                className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
            >
                {MEMORY_PROVIDER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            {/* Model dropdown based on provider */}
            {memoryProvider && MEMORY_MODELS[memoryProvider] && (
                <select
                    value={memoryModel || ''}
                    onChange={(e) => setMemoryModel?.(e.target.value)}
                    className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
                >
                    {MEMORY_MODELS[memoryProvider].map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>
            )}
        </div>
    </div>
);

export default MemorySettings;
