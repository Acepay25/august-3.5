
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
    // Memoized in-flight initialize() promise — without it, two concurrent
    // callers (boot + updateCalibration, or two settled trades) both run
    // loadLearningState and race each other's cache writes.
    private _initPromise: Promise<void> | null = null;
    // The generation the memoized _initPromise was created for — a profile
    // switch (which bumps _initGeneration) must NOT reuse a stale in-flight
    // load; the next initialize() starts one for the new user.
    private _initPromiseGen: number = -1;
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
     * Initialize the service by loading data from the filesystem.
     *
     * `_isInitialized` flips ONLY after a successful load. A failed load
     * leaves it false so the next updateCalibration() re-attempts the load
     * (and refuses to save while it fails) — marking it initialized on
     * failure used to let the next update persist the constructor's EMPTY
     * calibration over the user's real on-disk history.
     */
    public initialize(): Promise<void> {
        if (this._isInitialized) return Promise.resolve();
        if (this._initPromise && this._initPromiseGen === this._initGeneration) {
            return this._initPromise;
        }
        const gen = this._initGeneration;
        this._initPromiseGen = gen;
        const run = (async () => {
            try {
                await this.loadLearningState();
                // A newer setActiveUser() call has superseded this one — discard
                // the results so we don't overwrite the newer user's state.
                if (this._initGeneration !== gen) return;
                this._isInitialized = true;
                console.log('[GlobalLearningService] Initialized and loaded state.');
            } catch (error) {
                console.error('[GlobalLearningService] Failed to initialize:', error);
                // Deliberately NOT marking initialized: the next caller retries
                // the load, and updateCalibration refuses to save until a load
                // has actually succeeded.
            }
        })();
        this._initPromise = run;
        void run.finally(() => {
            if (this._initPromise === run) {
                this._initPromise = null;
                this._initPromiseGen = -1;
            }
        });
        return run;
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
        // Guard against the constructor's empty default: if the on-disk state
        // hasn't loaded yet, applying the update would build on an empty
        // baseline and the following saveLearningState() would OVERWRITE the
        // user's real calibration history with it. Re-attempt the load; if it
        // still hasn't succeeded, REFUSE the save — losing one entry is
        // recoverable, clobbering months of calibration is not.
        if (!this._isInitialized) {
            await this.initialize();
        }
        if (!this._isInitialized) {
            console.error(
                '[GlobalLearningService] Calibration state not loaded (load failed) — ' +
                'refusing to persist an update onto the empty baseline.'
            );
            return;
        }
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
        // True when the Preferences fallback itself threw. The Filesystem
        // failure is not the signal — on web it ALWAYS fails (that's the
        // documented fallback leg) — only an unreadable Preferences store
        // means the persisted calibration might exist but is unreachable.
        let storageFailed = false;
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
                storageFailed = true;
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
                storageFailed = true;
                console.warn('[GlobalLearningService] Legacy calibration fallback failed:', e);
            }
        }
        if (parsed) {
            this._calibration = parsed;
            console.log('[GlobalLearningService] State loaded successfully.');
            return;
        }
        // Nothing was found AND a storage read errored — this is not a fresh
        // start, it's an unreachable store. Throw so initialize() does NOT
        // mark the service ready (updateCalibration would otherwise persist
        // the empty constructor state over the user's real history).
        if (storageFailed) {
            throw new Error('[GlobalLearningService] Calibration storage unreadable — state not loaded');
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
