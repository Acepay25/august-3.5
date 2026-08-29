/**
 * quietHours — configurable silent window for alerts (Batch 7, plan §5.5).
 *
 * A 24/7 market with 24/7 notifications is a sleep-tax; the research on
 * alert fatigue is blunt that constant pings get ignored anyway. Alerts
 * during the window QUEUE instead of notifying — nothing is lost, the phone
 * just stays silent until the user is awake. Local wall-clock time (sleep is
 * local), wrap-around supported (23 → 7).
 */

export interface QuietHoursConfig {
    enabled: boolean;
    /** Local hour the window starts, 0-23 (inclusive). */
    startHour: number;
    /** Local hour the window ends, 0-23 (exclusive). Equal to start = off. */
    endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
    enabled: false,
    startHour: 23,
    endHour: 7,
};

/** True when `now` falls inside the silent window. */
export const isWithinQuietHours = (
    config: QuietHoursConfig,
    now: Date = new Date(),
): boolean => {
    if (!config.enabled) return false;
    if (config.startHour === config.endHour) return false;
    const h = now.getHours();
    if (config.startHour < config.endHour) {
        return h >= config.startHour && h < config.endHour;
    }
    // Wrap-around window (e.g. 23 → 07 spans midnight).
    return h >= config.startHour || h < config.endHour;
};

/** "23:00–07:00" label for the settings row. */
export const quietHoursLabel = (config: QuietHoursConfig): string =>
    `${String(config.startHour).padStart(2, '0')}:00–${String(config.endHour).padStart(2, '0')}:00`;
