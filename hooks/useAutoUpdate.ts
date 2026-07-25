import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Update status pushed from the Electron main process.
 *
 * States:
 *   idle        — no update activity
 *   checking    — checking GitHub releases for a newer version
 *   available   — a newer version is available, awaiting download
 *   downloading — update package is downloading (see `progress`)
 *   downloaded  — update fully downloaded, will auto-install shortly
 *   installing  — installer is running; app is about to quit & relaunch
 *   error       — the update flow failed (see `error`)
 */
interface UpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
    progress: number;
    version: string | null;
    error: string | null;
}

const IDLE_STATUS: UpdateStatus = {
    status: 'idle',
    progress: 0,
    version: null,
    error: null,
};

/**
 * Delay (ms) between "downloaded" being received and auto-installing.
 * Lets the overlay show a "Restarting…" state before the app quits.
 */
const AUTO_INSTALL_DELAY_MS = 800;

/**
 * Hook for managing app auto-updates in Electron.
 *
 * In the browser (non-Electron), all operations are no-ops and
 * `isUpdateAvailable` is always false.
 *
 * Usage:
 *   const { isElectron, appVersion, updateStatus, checkForUpdates, downloadUpdate, installUpdate } = useAutoUpdate();
 */
export function useAutoUpdate() {
    const [isElectron, setIsElectron] = useState(false);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(IDLE_STATUS);

    // Track the auto-install timer so we can cancel it if the component
    // unmounts or the status changes before the timer fires.
    const installTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Keep a ref to the latest installUpdate so the timer closure always
    // calls the current implementation.
    const installUpdateRef = useRef<() => Promise<void>>(async () => {});

    useEffect(() => {
        // Detect if running in Electron
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;

        setIsElectron(true);

        // Get current app version
        electronAPI.getVersion().then((v: string) => {
            if (v) setAppVersion(v);
        });

        // Subscribe to status updates from main process
        const unsubscribe = electronAPI.onUpdateStatus((status: UpdateStatus) => {
            setUpdateStatus(status);
        });

        // Fetch initial status
        electronAPI.getUpdateStatus().then((status: UpdateStatus) => {
            if (status) setUpdateStatus(status);
        });

        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    const installUpdate = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;
        await electronAPI.installUpdate();
    }, []);

    installUpdateRef.current = installUpdate;

    // Auto-install once an update has been downloaded. After a short delay
    // we call installUpdate(), which tells the main process to push an
    // 'installing' status and then quitAndInstall(). The overlay shows a
    // brief "Restarting…" state (status === 'downloaded') during the delay,
    // then switches to "Installing…" once the main process pushes 'installing'.
    useEffect(() => {
        if (updateStatus.status !== 'downloaded') return;

        installTimerRef.current = setTimeout(() => {
            installUpdateRef.current();
        }, AUTO_INSTALL_DELAY_MS);

        return () => {
            if (installTimerRef.current) {
                clearTimeout(installTimerRef.current);
                installTimerRef.current = null;
            }
        };
    }, [updateStatus.status]);

    const checkForUpdates = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;
        await electronAPI.checkForUpdates();
    }, []);

    const downloadUpdate = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;
        await electronAPI.downloadUpdate();
    }, []);

    return {
        isElectron,
        appVersion,
        updateStatus,
        isUpdateAvailable: updateStatus.status === 'available' || updateStatus.status === 'downloaded',
        checkForUpdates,
        downloadUpdate,
        installUpdate,
    };
}
