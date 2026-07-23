
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { ConfidenceCalibration, TradeOutcome, GranularCalibrationEntry } from '../../../types';
import {
    initializeCalibration,
    updateGranularCalibration,
    updateCalibration
} from '../validation/ConfidenceCalibrationService';

const LEARNING_STATE_FILE = 'learning_state.json';

class GlobalLearningService {
    private static instance: GlobalLearningService;
    private _calibration: ConfidenceCalibration;
    private _isInitialized: boolean = false;

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

        try {
            await this.loadLearningState();
            this._isInitialized = true;
            console.log('[GlobalLearningService] Initialized and loaded state.');
        } catch (error) {
            console.error('[GlobalLearningService] Failed to initialize:', error);
            // Even if load fails, we have initialized empty state in constructor
            this._isInitialized = true;
        }
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
        try {
            const data = JSON.stringify(this._calibration, null, 2);
            await Filesystem.writeFile({
                path: LEARNING_STATE_FILE,
                data: data,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            // console.log('[GlobalLearningService] State saved.'); // Uncomment for debug
        } catch (error) {
            console.error('[GlobalLearningService] Failed to save state:', error);
        }
    }

    /**
     * Load the learning state from the filesystem
     */
    public async loadLearningState(): Promise<void> {
        try {
            // Check if file exists first (optional, readFile might throw if not found)
            const file = await Filesystem.readFile({
                path: LEARNING_STATE_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            if (file.data) {
                const parsed = JSON.parse(
                    typeof file.data === 'string' ? file.data : JSON.stringify(file.data)
                );
                // Basic validation could go here
                this._calibration = parsed;
                console.log('[GlobalLearningService] State loaded successfully.');
            }
        } catch (error: any) {
            // Check if error is "File does not exist" - if so, it's fine, we start fresh
            if (error?.message?.includes('does not exist') || error?.code === 'ENOENT') {
                console.log('[GlobalLearningService] No existing state file found. Starting fresh.');
            } else {
                console.error('[GlobalLearningService] Failed to load state:', error);
            }
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
