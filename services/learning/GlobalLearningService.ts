
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { ConfidenceCalibration, TradeOutcome, GranularCalibrationEntry } from '../../types';
import {
    initializeCalibration,
    updateGranularCalibration,
    updateCalibration
} from '../validation/ConfidenceCalibrationService';
import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';

const LEARNING_STATE_FILE = 'learning_state.json';

class GlobalLearningService {
    private static instance: GlobalLearningService;
    private _calibration: ConfidenceCalibration;
    private _isInitialized: boolean = false;
    // Per-user state: calibration is keyed by the active profile so switching
    // users doesn't leak one user's calibration into another's analysis.
    private _activeUser: string | null = null;
    // Generation counter: incremented on every setActiveUser call. When an
    // in-flight initialize() resolves, it checks whether the generation has
    // advanced — if so, a newer profile switch superseded it and the stale
    // results must be discarded.
    private _initGeneration: number = 0;

    private get stateFile(): string {
        return this._activeUser ? `learning_state_${this._activeUser}.json` : LEARNING_STATE_FILE;
    }

    private get prefKey(): string {
        return this._activeUser ? `global_learning_state_${this._activeUser}` : 'global_learning_state';
    }

    private constructor() {
        this._calibration = initializeCalibration();
    }

    public static getInstance(): GlobalLearningService {
        if (!GlobalLearningService.instance) {
            GlobalLearningService.instance = new GlobalLearningService();
        }
        return GlobalLearningService.instance;
    }

    /**
     * Initialize the service by loading data from the filesystem
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) return;

        const gen = this._initGeneration;
        try {
            await this.loadLearningState();
            // A newer setActiveUser() call has superseded this one — discard
            // the results so we don't overwrite the newer user's state.
            if (this._initGeneration !== gen) return;
            this._isInitialized = true;
            console.log('[GlobalLearningService] Initialized and loaded state.');
        } catch (error) {
            console.error('[GlobalLearningService] Failed to initialize:', error);
            if (this._initGeneration !== gen) return;
            // Even if load fails, we have initialized empty state in constructor
            this._isInitialized = true;
        }
    }

    /**
     * Switch the active profile: reloads calibration from that user's state
     * file (and re-arms the guarded init so a profile switch reloads).
     */
    public async setActiveUser(username: string | null): Promise<void> {
        this._activeUser = username;
        this._isInitialized = false;
        this._initGeneration++;
        await this.initialize();
    }

    /**
     * Get the current calibration state
     */
    public getCalibration(): ConfidenceCalibration {
        return this._calibration;
    }

    /**
     * Update calibration with a new trade outcome and auto-save
     */
    public async updateCalibration(entry: GranularCalibrationEntry): Promise<void> {
        const oldState = this._calibration;

        // Use granular update if possible, otherwise fallback is handled within updateGranularCalibration
        this._calibration = updateGranularCalibration(oldState, entry);

        // Save state asynchronously
        await this.saveLearningState();
    }

    /**
     * Save the current learning state to the filesystem
     */
    public async saveLearningState(): Promise<void> {
        const data = JSON.stringify(this._calibration, null, 2);
        let saved = false;
        try {
            await Filesystem.writeFile({
                path: this.stateFile,
                data: data,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            saved = true;
        } catch (error) {
            // Web builds can't write to the Capacitor filesystem — fall back
            // to Preferences so calibration survives reloads there too.
            console.warn('[GlobalLearningService] Filesystem save failed (web?), falling back to Preferences:', error);
        }
        if (!saved) {
            try {
                await setPreferenceObject(this.prefKey, this._calibration);
            } catch (e) {
                console.error('[GlobalLearningService] Preferences fallback save failed:', e);
            }
        }
    }

    /**
     * Load the learning state from the filesystem
     */
    public async loadLearningState(): Promise<void> {
        let parsed: ConfidenceCalibration | null = null;
        try {
            const file = await Filesystem.readFile({
                path: this.stateFile,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            if (file.data) {
                parsed = JSON.parse(
                    typeof file.data === 'string' ? file.data : JSON.stringify(file.data)
                );
            }
        } catch (error: any) {
            // File does not exist is fine (fresh start); other errors fall
            // back to Preferences (web builds).
            if (!(error?.message?.includes('does not exist') || error?.code === 'ENOENT')) {
                console.warn('[GlobalLearningService] Filesystem load failed (web?), falling back to Preferences:', error);
            }
        }
        if (!parsed) {
            try {
                parsed = await getPreferenceObject<ConfidenceCalibration>(this.prefKey);
            } catch (e) {
                console.warn('[GlobalLearningService] Preferences load failed:', e);
            }
        }
        if (!parsed && this._activeUser) {
            // Per-user scoping orphaned pre-upgrade calibration — fall back to
            // the legacy unscoped key once and copy it into the scoped slot so
            // existing installs don't silently lose their calibration history.
            try {
                const legacy = await getPreferenceObject<ConfidenceCalibration>('global_learning_state');
                if (legacy) {
                    parsed = legacy;
                    await setPreferenceObject(this.prefKey, legacy).catch(e =>
                        console.warn('[GlobalLearningService] Legacy calibration copy failed:', e)
                    );
                }
            } catch (e) {
                console.warn('[GlobalLearningService] Legacy calibration fallback failed:', e);
            }
        }
        if (parsed) {
            this._calibration = parsed;
            console.log('[GlobalLearningService] State loaded successfully.');
        }
    }

    /**
     * Reset state (useful for testing or hard reset)
     */
    public async resetState(): Promise<void> {
        this._calibration = initializeCalibration();
        await this.saveLearningState();
    }
}

export default GlobalLearningService.getInstance();
