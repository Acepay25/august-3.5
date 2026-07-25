import { useState, useEffect, useCallback } from 'react';

/**
 * Update status pushed from the Electron main process.
 */
interface UpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
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

    const installUpdate = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;
        await electronAPI.installUpdate();
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
