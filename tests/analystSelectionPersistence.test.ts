import { describe, it, expect, beforeEach } from 'vitest';
// Real services (no PreferencesService mock): proves the analyst model
// selections the user makes in the chat-input picker / lens settings survive
// an app restart via the localStorage round-trip. The saves mirror into
// localStorage on every platform, so the sync load helpers find them at
// first render even on native (Capacitor), where Preferences is async.
import {
    loadEnsembleModelSelection,
    saveEnsembleModelSelection,
    retainEnsembleSelection,
    loadLastModeratorPick,
    saveLastModeratorPick,
    loadLensConfig,
    saveLensConfig,
} from '../services/ui/AnalystLensService';
import { PREF_KEYS } from '../services/infrastructure/PreferencesService';
import { AnalystLensConfig } from '../types/lens';
import { AnalystRole } from '../types/enums';

describe('Analyst model selection persistence (save → load round-trip)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('persists the ordinary ensemble model selection through save → load', () => {
        const selection = [
            { providerId: 'gemini', model: 'gemini-2.5-pro' },
            { providerId: 'deepseek', model: 'deepseek-chat' },
        ];
        saveEnsembleModelSelection(selection);
        expect(loadEnsembleModelSelection()).toEqual(selection);
    });

    it('caps the ensemble selection at 3 entries on save', () => {
        saveEnsembleModelSelection([
            { providerId: 'a', model: 'm1' },
            { providerId: 'b', model: 'm2' },
            { providerId: 'c', model: 'm3' },
            { providerId: 'd', model: 'm4' },
        ]);
        expect(loadEnsembleModelSelection()).toHaveLength(3);
    });

    it('mirrors the ensemble selection into localStorage for the sync loader', () => {
        saveEnsembleModelSelection([{ providerId: 'zhipu', model: 'glm-4' }]);
        const stored = localStorage.getItem(PREF_KEYS.ENSEMBLE_MODEL_SELECTION);
        expect(stored).toBeTruthy();
        expect(JSON.parse(stored!)).toEqual([{ providerId: 'zhipu', model: 'glm-4' }]);
    });

    it('persists lens assignments (role → provider/model) through save → load', () => {
        const config: AnalystLensConfig = {
            enabled: true,
            assignments: [
                { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: 'gemini', assignedModel: 'gemini-2.5-pro' },
                { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: 'deepseek', assignedModel: 'deepseek-chat' },
                { role: AnalystRole.RISK_EXECUTION, assignedProvider: 'zhipu' },
            ],
            tradingStyle: 'swing',
        };
        saveLensConfig(config);
        const loaded = loadLensConfig();
        expect(loaded.enabled).toBe(true);
        expect(loaded.assignments).toEqual(config.assignments);
        expect(loaded.tradingStyle).toBe('swing');
        // Also lands in localStorage so a fresh app load (no module cache)
        // finds it without waiting on the native Preferences sync.
        const stored = localStorage.getItem(PREF_KEYS.ANALYST_LENS_CONFIG);
        expect(stored).toBeTruthy();
        expect(JSON.parse(stored!).assignments).toEqual(config.assignments);
    });

    it('does not wipe picks when the provider list has not loaded yet', () => {
        const selection = [{ providerId: 'kilocode', model: 'deepseek-v4-flash' }];
        expect(retainEnsembleSelection(selection, [])).toEqual(selection);
    });

    it('keeps a saved model even when it is not in the provider catalog yet', () => {
        const kept = retainEnsembleSelection(
            [
                { providerId: 'kilocode', model: 'stepfun/step-3.7-flash:free' },
                { providerId: 'gone', model: 'x' },
            ],
            ['kilocode'],
        );
        expect(kept).toEqual([{ providerId: 'kilocode', model: 'stepfun/step-3.7-flash:free' }]);
    });

    it('persists the last moderator pick through save → load', () => {
        saveLastModeratorPick({ providerId: 'kilocode', model: 'deepseek-v4-flash' });
        expect(loadLastModeratorPick()).toEqual({ providerId: 'kilocode', model: 'deepseek-v4-flash' });
    });
});
