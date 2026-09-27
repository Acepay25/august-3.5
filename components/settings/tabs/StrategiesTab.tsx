// TAB: Playbooks — strategy book upload/management (SettingsMenu "Playbooks"
// nav entry, `strategies`).
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import StrategiesManager from '../StrategiesManager';
import type { ProviderConfig } from '../../../types/provider';
import type { SettingsTabProps } from './types';

export interface StrategiesTabProps extends SettingsTabProps {
    /** Master switch: inject enabled docs into analysis prompts. */
    isStrategiesEnabled?: boolean;
    setIsStrategiesEnabled?: (enabled: boolean) => void;
    /** Resolved global vision model config — transcribes scanned pages. */
    visionConfig?: ProviderConfig | null;
}

const StrategiesTab: React.FC<{ tab: StrategiesTabProps }> = ({ tab: props }) => {
    const {
        username,
        providerConfigs,
        visionConfig,
        isStrategiesEnabled,
        setIsStrategiesEnabled,
        onOpenStrategyStudio,
    } = props;

    return (
        <div className="h-full min-h-0 animate-fade-in flex flex-col">
            {onOpenStrategyStudio && (
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
                    <p className="text-ui-dense text-zinc-500">Upload playbooks below — or browse everything the harness knows as one library.</p>
                    <button
                        type="button"
                        onClick={onOpenStrategyStudio}
                        className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-ui-dense font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                    >
                        Strategy Studio
                    </button>
                </div>
            )}
            <StrategiesManager
                username={username}
                providerConfigs={providerConfigs ?? []}
                visionConfig={visionConfig ?? null}
                isStrategiesEnabled={isStrategiesEnabled}
                setIsStrategiesEnabled={setIsStrategiesEnabled}
            />
        </div>
    );
};

export default StrategiesTab;
