import React from 'react';
import { RefreshCw, AlertCircle, Download, Loader2 } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

/**
 * Header-level entry point for the desktop auto-update flow.
 *
 * Handles all states except active download/installation:
 * - idle: "Check for Updates" button + version label
 * - checking: spinner with "Checking…" text
 * - available: "Update Available" badge + download button
 * - error: error indicator + retry button
 *
 * The `downloading`, `downloaded`, and `installing` states are rendered
 * by the full-screen `<UpdateOverlay />` mounted at the app root.
 *
 * In the browser (non-Electron), this component renders nothing.
 */
export const UpdateButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { isElectron, appVersion, updateStatus, checkForUpdates, downloadUpdate } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, error, version } = updateStatus;

    // Active download/installation states are shown in the full-screen overlay
    if (status === 'downloading' || status === 'downloaded' || status === 'installing') {
        return null;
    }

    const baseClasses = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all';

    // Checking state — show spinner
    if (status === 'checking') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <span className="flex items-center gap-1.5 text-xs text-cyan-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Checking…
                </span>
            </div>
        );
    }

    // Available state — show update badge + download button
    if (status === 'available') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    v{version} available
                </span>
                <button
                    onClick={downloadUpdate}
                    className={`${baseClasses} bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/25 active:scale-95`}
                    aria-label={`Download update version ${version}`}
                >
                    <Download className="w-3.5 h-3.5" />
                    Update
                </button>
            </div>
        );
    }

    // Error state — show error + retry
    if (status === 'error') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <span className="flex items-center gap-1.5 text-xs text-rose-400" title={error || ''}>
                    <AlertCircle className="w-3.5 h-3.5" />
                    Update error
                </span>
                <button
                    onClick={checkForUpdates}
                    className={`${baseClasses} bg-zinc-800 hover:bg-zinc-700 text-zinc-300`}
                    aria-label="Retry update check"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                </button>
            </div>
        );
    }

    // Idle state — show version + check button
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            {appVersion && (
                <span className="text-[10px] text-zinc-600 font-mono">v{appVersion}</span>
            )}
            <button
                onClick={checkForUpdates}
                className={`${baseClasses} bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-cyan-400`}
                aria-label="Check for updates"
            >
                <RefreshCw className="w-3.5 h-3.5" />
                Check for Updates
            </button>
        </div>
    );
};

export default UpdateButton;