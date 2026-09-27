// TAB: Roles — analyst lens/persona assignment (the SettingsMenu nav section
// between Analysis and Prompts).
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import AnalystLensSettings from '../AnalystLensSettings';
import { SettingsPageHeader } from './shared';
import type { AnalystLensConfig } from '../../../types/lens';
import type { SettingsTabProps } from './types';

export interface LensesTabProps extends SettingsTabProps {
    lensConfig: AnalystLensConfig;
    onSetLensConfig: (config: AnalystLensConfig) => void;
}

const LensesTab: React.FC<{ tab: LensesTabProps }> = ({ tab: props }) => {
    const { lensConfig, onSetLensConfig, providerConfigs } = props;

    return (
        <div className="space-y-5 animate-fade-in">
            <SettingsPageHeader
                title="Analyst roles"
                description="Assign Technical, Risk, and Macro personas to models."
            />
            <AnalystLensSettings
                config={lensConfig}
                onChange={onSetLensConfig}
                providers={providerConfigs ?? []}
            />
        </div>
    );
};

export default LensesTab;
