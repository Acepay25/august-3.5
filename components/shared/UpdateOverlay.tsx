import React from 'react';
import { Download, CheckCircle, Loader2, Sparkles } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

/**
 * Full-screen overlay shown during the Electron auto-update flow.
 *
 * Only shows during active download/installation states:
 * - downloading: progress bar with percentage
 * - downloaded: ready to install (manual trigger)
 * - installing: animated installation screen
 *
 * The `idle`, `checking`, `available`, and `error` states are handled
 * by `UpdateButton` in the header so users have a non-blocking entry point.
 *
 * In the browser (non-Electron) this renders nothing.
 */
export const UpdateOverlay: React.FC = () => {
    const { isElectron, appVersion, updateStatus, installUpdate } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, progress, version } = updateStatus;

    // Only show overlay during active download/installation
    if (status !== 'downloading' && status !== 'downloaded' && status !== 'installing') {
        return null;
    }

    return (
        <div
            className="status-surface fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-live="assertive"
            aria-label="Application update in progress"
        >
            <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center text-center">
                {status === 'downloading' && (
                    <>
                        <div className="relative w-16 h-16 mb-6">
                            <div className="absolute inset-0 rounded-full border-4 border-zinc-800" />
                            <div
                                className="absolute inset-0 rounded-full border-4 border-t-cyan-500 border-r-cyan-500 border-b-transparent border-l-transparent animate-spin"
                                style={{ animationDuration: '1.5s' }}
                            />
                            <Download className="absolute inset-0 m-auto w-6 h-6 text-cyan-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">
                            Updating to v{version}
                        </h2>
                        <p className="text-sm text-zinc-500 mb-6">Downloading the latest version…</p>

                        <div className="w-full">
                            <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 bg-[length:200%_100%] animate-shimmer transition-all duration-300 rounded-full"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between mt-3">
                                <span className="text-xs text-zinc-500">Don't close the app</span>
                                <span className="text-sm font-mono font-semibold text-cyan-400">{progress}%</span>
                            </div>
                        </div>
                    </>
                )}

                {status === 'downloaded' && (
                    <>
                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6 animate-bounce-slow">
                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Update downloaded</h2>
                        <p className="text-sm text-zinc-500 mb-6">
                            v{version} is ready to install. The app will restart to complete the update.
                        </p>
                        <button
                            onClick={installUpdate}
                            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25 active:scale-95"
                            aria-label={`Install update version ${version}`}
                        >
                            <Sparkles className="w-4 h-4" />
                            Install &amp; Restart
                        </button>
                    </>
                )}

                {status === 'installing' && (
                    <>
                        <div className="relative w-20 h-20 mb-6">
                            {/* Animated rings */}
                            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping" style={{ animationDuration: '2s' }} />
                            <div className="absolute inset-2 rounded-full border-2 border-blue-500/30 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                            <div className="absolute inset-4 rounded-full border-2 border-cyan-500/30 animate-ping" style={{ animationDuration: '2s', animationDelay: '1s' }} />
                            {/* Center icon */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" style={{ animationDuration: '1s' }} />
                            </div>
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-2">Installing update…</h2>
                        <p className="text-sm text-zinc-500">
                            August 3.5 will relaunch in a moment. Please don't close this window.
                        </p>
                        {/* Animated dots */}
                        <div className="flex gap-1.5 mt-4">
                            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default UpdateOverlay;