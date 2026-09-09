/**
 * EffortToggle — the composer's Fast/Quality dial (a port of Minara's
 * response-depth toggle). One user-intent knob over the whole role→effort
 * schedule: Quality keeps the built-in per-task depths; Fast steps every
 * reasoning task one tier down (quick tiers never drop further). It changes
 * how hard each call thinks, never what the pipeline does — the debate,
 * gates, and budget caps all still run.
 */

import React from 'react';
import { getHarnessSettings, saveHarnessSettings } from '../../utils/harnessSettings';

export type EffortProfile = 'fast' | 'quality';

interface EffortToggleProps {
    /** Optional control from above (tests / palette); defaults to the stored
     *  setting and persists on change. */
    value?: EffortProfile;
    onChange?: (next: EffortProfile) => void;
}

const LABELS: Record<EffortProfile, { label: string; hint: string }> = {
    fast: { label: 'Fast', hint: 'Fewer reasoning steps — quicker answers, lighter bill. Gates and debate still run.' },
    quality: { label: 'Quality', hint: 'Full reasoning depth per task — verdicts get the maximum effort tier.' },
};

const EffortToggle: React.FC<EffortToggleProps> = ({ value, onChange }) => {
    const [stored, setStored] = React.useState<EffortProfile>(() => getHarnessSettings().responseEffort);
    const current = value ?? stored;

    const pick = (next: EffortProfile): void => {
        if (value === undefined) {
            saveHarnessSettings({ responseEffort: next });
            setStored(next);
        }
        onChange?.(next);
    };

    return (
        <div
            role="radiogroup"
            aria-label="Reasoning depth"
            data-testid="effort-toggle"
            className="flex shrink-0 items-center rounded-full border border-white/10 bg-zinc-900/70 p-0.5"
        >
            {(['fast', 'quality'] as const).map(profile => (
                <button
                    key={profile}
                    type="button"
                    role="radio"
                    aria-checked={current === profile}
                    title={LABELS[profile].hint}
                    onClick={() => pick(profile)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                        current === profile ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                >
                    {LABELS[profile].label}
                </button>
            ))}
        </div>
    );
};

export default React.memo(EffortToggle);
