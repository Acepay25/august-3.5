export type PromptAbRate = 0 | 0.1 | 0.5;

export interface HarnessSettings {
    equityUsd: number;
    promptAbRate: PromptAbRate;
    debateCostCapUsd: number;
    pinnedPromptLane?: 'live' | 'control';
}

const KEY = 'harness_settings_v1';

const read = (): Partial<HarnessSettings> => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Partial<HarnessSettings>;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export const getHarnessSettings = (): HarnessSettings => {
    const stored = typeof localStorage === 'undefined' ? {} : read();
    const rate = stored.promptAbRate;
    return {
        equityUsd: typeof stored.equityUsd === 'number' && stored.equityUsd > 0 ? stored.equityUsd : 10_000,
        promptAbRate: rate === 0 || rate === 0.1 || rate === 0.5 ? rate : 0.1,
        debateCostCapUsd: typeof stored.debateCostCapUsd === 'number' && stored.debateCostCapUsd >= 0
            ? stored.debateCostCapUsd
            : 0.5,
        pinnedPromptLane: stored.pinnedPromptLane === 'live' || stored.pinnedPromptLane === 'control'
            ? stored.pinnedPromptLane
            : undefined,
    };
};

export const saveHarnessSettings = (next: Partial<HarnessSettings>): HarnessSettings => {
    const merged = { ...getHarnessSettings(), ...next };
    try {
        localStorage.setItem(KEY, JSON.stringify(merged));
    } catch { /* ignore */ }
    return merged;
};
