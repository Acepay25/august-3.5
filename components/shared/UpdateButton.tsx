import React from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

/**
 * Header-level entry point for the desktop auto-update flow.
 *
 * Handles only the `idle` and `error` states (the "Check for Updates"
 * button + version label + retry). All active update states
 * (`checking`, `available`, `downloading`, `downloaded`, `installing`)
 * are rendered by the full-screen `<UpdateOverlay />` mounted at the app
 * root, which is solid, prominent, and impossible to miss.
 *
 * In the browser (non-Electron), this component renders nothing.
 */
export const UpdateButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { isElectron, appVersion, updateStatus, checkForUpdates } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, error } = updateStatus;

    // The active update states are shown in the full-screen overlay —
    // hide the inline widget while an update is in progress to avoid
    // duplicate UI.
    if (status === 'checking' || status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing') {
        return null;
    }

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

    // Idle state — show version + check button (entry point for the flow)
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
