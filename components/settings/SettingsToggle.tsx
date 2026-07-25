/**
 * SettingsToggle - Reusable toggle switch primitive for the settings panel.
 *
 * Extracted from SettingsMenu.tsx to keep the settings components modular.
 */

import React from 'react';

export interface SettingsToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

// Toggle Switch
export const ToggleSwitch: React.FC<SettingsToggleProps> = ({ checked, onChange, disabled = false }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
        />
        <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600 peer-disabled:opacity-50"></div>
    </label>
);

export default ToggleSwitch;
