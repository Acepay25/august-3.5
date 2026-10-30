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
            <StrategiesManager
                username={username}
                providerConfigs={providerConfigs ?? []}
                visionConfig={visionConfig ?? null}
                isStrategiesEnabled={isStrategiesEnabled}
                setIsStrategiesEnabled={setIsStrategiesEnabled}
                onOpenStrategyStudio={onOpenStrategyStudio}
            />
        </div>
    );
};

export default StrategiesTab;
