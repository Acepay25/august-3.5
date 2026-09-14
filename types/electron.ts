/**
 * Shared contract for the Electron preload bridge (`window.electronAPI`).
 * Only the pieces consumed by the renderer that AREN'T provider transport
 * (which is typed alongside GenericProviderService's own ChatMessage/turn
 * types). Centralizing the auto-update status shape here means the hook and
 * the ambient bridge type never drift apart.
 *
 * States:
 *   idle        — no update activity
 *   checking    — checking GitHub releases for a newer version
 *   available   — a newer version is available, awaiting download
 *   downloading — update package is downloading (see `progress`)
 *   downloaded  — update fully downloaded, ready to install
 *   installing  — installer is running; app is about to quit & relaunch
 *   error       — the update flow failed (see `error`)
 */
export interface ElectronUpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
    progress: number;
    version: string | null;
    error: string | null;
    /** Download telemetry from electron-updater (downloading phase). */
    bytesPerSecond?: number;
    transferred?: number;
    total?: number;
    /** GitHub release body (available/downloaded phases) — "What's new". */
    releaseNotes?: string | null;
}
