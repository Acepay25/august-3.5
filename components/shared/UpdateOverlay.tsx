import React from 'react';
import { Download, CheckCircle, Loader2 } from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';

/**
 * Full-screen overlay shown during the Electron auto-update flow.
 *
 * Replaces the tiny inline header widget (`UpdateButton`) for the
 * `checking` / `available` / `downloading` / `downloaded` / `installing`
 * states. The backdrop is SOLID (not translucent) so the progress is always
 * clearly visible — the previous widget sat on a near-identical-colored
 * header and was effectively invisible.
 *
 * The `idle` and `error` states are still handled by `UpdateButton` in the
 * header so users have a "Check for Updates" entry point.
 *
 * In the browser (non-Electron) this renders nothing.
 */
export const UpdateOverlay: React.FC = () => {
    const { isElectron, appVersion, updateStatus, downloadUpdate } = useAutoUpdate();

    if (!isElectron) return null;

    const { status, progress, version } = updateStatus;

    // Only the active update states show the overlay. idle/error stay in the header.
    if (status === 'idle' || status === 'error') return null;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-live="assertive"
            aria-label="Application update in progress"
        >
            <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center text-center">
                {status === 'checking' && (
                    <>
                        <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mb-5" />
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Checking for updates…</h2>
                        <p className="text-sm text-zinc-500">
                            Looking for a newer version of August 3.5
                        </p>
                    </>
                )}

                {status === 'available' && (
                    <>
                        <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
                            <Download className="w-7 h-7 text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">
                            v{version} is ready to install
                        </h2>
                        <p className="text-sm text-zinc-500 mb-6">
                            You're currently on v{appVersion}. Download the update and August 3.5 will restart automatically.
                        </p>
                        <button
                            onClick={downloadUpdate}
                            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg"
                            aria-label={`Download and install update version ${version}`}
                        >
                            <Download className="w-4 h-4" />
                            Download &amp; Update
                        </button>
                    </>
                )}

                {status === 'downloading' && (
                    <>
                        <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mb-5" />
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">
                            Updating to v{version}
                        </h2>
                        <p className="text-sm text-zinc-500 mb-6">Downloading the latest version…</p>

                        <div className="w-full">
                            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-zinc-500">Don't close the app</span>
                                <span className="text-sm font-mono font-semibold text-cyan-400">{progress}%</span>
                            </div>
                        </div>
                    </>
                )}

                {status === 'downloaded' && (
                    <>
                        <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
                            <CheckCircle className="w-7 h-7 text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Update downloaded</h2>
                        <p className="text-sm text-zinc-500 mb-6">Restarting August 3.5 to finish installing…</p>
                        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                    </>
                )}

                {status === 'installing' && (
                    <>
                        <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mb-5" />
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Installing update…</h2>
                        <p className="text-sm text-zinc-500">
                            August 3.5 will relaunch in a moment. Please don't close this window.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default UpdateOverlay;
