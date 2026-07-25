import React from 'react';
import { RefreshCw, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

/**
 * Update button for the desktop app.
 *
 * Shows different states:
 * - idle: "Check for Updates" button
 * - checking: spinner + "Checking..."
 * - available: "Download v{version}" button (green)
 * - downloading: progress bar + "{progress}%"
 * - downloaded: "Restart to Update" button (green, pulsing)
 * - error: error message + "Retry" button
 *
 * In the browser (non-Electron), this component renders nothing.
 */
export const UpdateButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { isElectron, appVersion, updateStatus, checkForUpdates, downloadUpdate, installUpdate } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, progress, version, error } = updateStatus;

    // Don't render if idle and we haven't checked yet (cleaner UI)
    if (status === 'idle' && !appVersion) return null;

    const baseClasses = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all';

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

    if (status === 'checking') {
        return (
            <div className={`${baseClasses} text-zinc-400 ${className}`}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking...
            </div>
        );
    }

    if (status === 'available') {
        return (
            <button
                onClick={downloadUpdate}
                className={`${baseClasses} bg-emerald-600 hover:bg-emerald-500 text-white ${className}`}
                aria-label={`Download update version ${version}`}
            >
                <Download className="w-3.5 h-3.5" />
                Download v{version}
            </button>
        );
    }

    if (status === 'downloading') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <div className="flex items-center gap-1.5 text-xs text-cyan-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {progress}%
                </div>
                <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-cyan-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        );
    }

    if (status === 'downloaded') {
        return (
            <button
                onClick={installUpdate}
                className={`${baseClasses} bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse ${className}`}
                aria-label="Restart and install update"
            >
                <CheckCircle className="w-3.5 h-3.5" />
                Restart to Update
            </button>
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
