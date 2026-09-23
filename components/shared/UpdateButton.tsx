import React from 'react';
import { RefreshCw, AlertCircle, Download, Loader2, Sparkles } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';
import StatusPill from '../ui/StatusPill';

/**
 * Header-level entry point for the desktop auto-update flow.
 *
 * Handles all states except active download/installation:
 * - idle: quiet version chip + icon-only refresh button
 * - checking: spinner with "Checking…" text
 * - available: Sparkle + v{version} chip + download button
 * - error: error indicator + retry button (with inline caption when verbose)
 *
 * The `downloading`, `downloaded`, and `installing` states are rendered
 * by the full-screen `<UpdateOverlay />` mounted at the app root.
 *
 * In the browser (non-Electron), this component renders nothing.
 */
export const UpdateButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { isElectron, appVersion, updateStatus, checkForUpdates, downloadUpdate, installUpdate } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, error, version, progress } = updateStatus;

    // Installing state is handled by the full-screen overlay
    if (status === 'installing') {
        return null;
    }

    const baseClasses = 'inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-lg text-ui-dense font-medium transition-[background-color,box-shadow,transform] duration-[150ms] ease-[var(--ease-snappy)]';
    const iconButtonClasses = 'inline-flex items-center justify-center h-7 w-7 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500';

    // Checking state — show spinner with text
    if (status === 'checking') {
        return (
            <div className={`flex items-center gap-1.5 ${className}`}>
                <span className="flex items-center gap-1.5 text-ui-dense text-cyan-400" role="status" aria-live="polite">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking…
                </span>
            </div>
        );
    }

    // Available state — Sparkle + version chip + download button
    if (status === 'available') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <span
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-ui-dense font-medium text-emerald-300"
                    title={`Version ${version} is available`}
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    v{version}
                </span>
                <button
                    onClick={downloadUpdate}
                    className={`${baseClasses} bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/25 active:scale-95`}
                    aria-label={`Download update version ${version}`}
                >
                    <Download className="h-3.5 w-3.5" />
                    Update
                </button>
            </div>
        );
    }

    // Downloading state — compact downloading pill with progress
    if (status === 'downloading') {
        return (
            <div className={`flex items-center gap-1.5 ${className}`} role="status" aria-live="polite">
                <StatusPill
                    tone="info"
                    className="font-mono tabular-nums"
                    icon={<Loader2 className="h-3 w-3 animate-spin" />}
                >
                    {Number.isFinite(progress) && progress > 0 ? `${progress}%` : 'Downloading…'}
                </StatusPill>
            </div>
        );
    }

    // Downloaded state — Restart button to apply
    if (status === 'downloaded') {
        return (
            <div className={`flex items-center gap-1.5 ${className}`}>
                <button
                    onClick={installUpdate}
                    className={`${baseClasses} bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/25 active:scale-95`}
                    aria-label={`Restart to apply version ${version ?? ''}`}
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    Restart
                </button>
            </div>
        );
    }

    // Error state — inline caption + retry button
    if (status === 'error') {
        const verboseError = (error || '').length > 30;
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <span
                    className={`flex items-center gap-1.5 text-ui-dense text-rose-400 ${verboseError ? 'max-w-[260px]' : ''}`}
                    title={error || ''}
                >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {verboseError && error ? <span className="truncate">{error}</span> : 'Update error'}
                </span>
                <button
                    onClick={checkForUpdates}
                    className={`${baseClasses} bg-zinc-800 hover:bg-zinc-700 text-zinc-300`}
                    aria-label="Retry update check"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                </button>
            </div>
        );
    }

    // Idle state — icon-only refresh + tiny version chip
    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            {appVersion && (
                <span
                    className="text-ui-xs text-zinc-600 font-mono"
                    title={`Installed version ${appVersion}`}
                >
                    v{appVersion}
                </span>
            )}
            <button
                onClick={checkForUpdates}
                className={iconButtonClasses}
                aria-label="Check for updates"
                title="Check for updates"
            >
                <RefreshCw className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

export default UpdateButton;
