import React, { useState, useEffect } from 'react';
import { clearThinkingLeakBin, loadThinkingLeakBin, ThinkingLeakEntry } from '../../utils/thinkingLeakBin';

interface ErrorLog {
    timestamp: string;
    type: string;
    message: string;
    stack?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
}

/**
 * DiagnosticsPanel — displays recent runtime errors captured by the global
 * error handlers in index.tsx. Useful for debugging production issues.
 */
export const DiagnosticsPanel: React.FC = () => {
    const [promiseError, setPromiseError] = useState<ErrorLog | null>(null);
    const [globalError, setGlobalError] = useState<ErrorLog | null>(null);
    const [showStack, setShowStack] = useState<string | null>(null);
    const [leaks, setLeaks] = useState<ThinkingLeakEntry[]>([]);

    useEffect(() => {
        try {
            const pe = localStorage.getItem('lastPromiseError');
            const ge = localStorage.getItem('lastGlobalError');
            if (pe) setPromiseError(JSON.parse(pe));
            if (ge) setGlobalError(JSON.parse(ge));
        } catch {
            // Ignore parse errors
        }
        setLeaks(loadThinkingLeakBin());
    }, []);

    const clearErrors = (): void => {
        localStorage.removeItem('lastPromiseError');
        localStorage.removeItem('lastGlobalError');
        setPromiseError(null);
        setGlobalError(null);
        setShowStack(null);
    };

    const hasErrors = promiseError || globalError;

    const renderError = (error: ErrorLog, label: string): React.ReactNode => (
        <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/20 space-y-1">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400">{label}</span>
                <span className="text-[10px] text-zinc-500">
                    {new Date(error.timestamp).toLocaleString()}
                </span>
            </div>
            <p className="text-xs text-zinc-300 break-all">{error.message}</p>
            {error.filename && (
                <p className="text-[10px] text-zinc-500">
                    {error.filename}:{error.lineno}:{error.colno}
                </p>
            )}
            {error.stack && (
                <>
                    <button
                        onClick={() => setShowStack(showStack === label ? null : label)}
                        className="text-[10px] text-zinc-400 underline hover:text-zinc-200"
                    >
                        {showStack === label ? 'Hide stack' : 'Show stack'}
                    </button>
                    {showStack === label && (
                        <pre className="text-[10px] text-zinc-500 overflow-x-auto whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto">
                            {error.stack}
                        </pre>
                    )}
                </>
            )}
        </div>
    );

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Diagnostics</h3>
                {hasErrors && (
                    <button
                        onClick={clearErrors}
                        className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
                    >
                        Clear Errors
                    </button>
                )}
            </div>

            {hasErrors ? (
                <div className="space-y-2">
                    {promiseError && renderError(promiseError, 'Unhandled Promise Rejection')}
                    {globalError && renderError(globalError, 'Uncaught Error')}
                </div>
            ) : (
                <p className="text-xs text-zinc-500">No runtime errors recorded. ✓</p>
            )}

            <div className="flex items-center justify-between pt-2">
                <h4 className="text-xs font-semibold text-zinc-400">Thinking leak bin</h4>
                {leaks.length > 0 && (
                    <button
                        type="button"
                        onClick={() => {
                            clearThinkingLeakBin();
                            setLeaks([]);
                        }}
                        className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        Clear leaks
                    </button>
                )}
            </div>
            {leaks.length > 0 ? (
                <ul className="space-y-2">
                    {leaks.map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                            <p className="text-[10px] text-zinc-600">
                                {entry.at ? new Date(entry.at).toLocaleString() : 'Unknown time'}
                            </p>
                            <p className="mt-1 text-xs text-zinc-400 break-words">{entry.snippet}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-zinc-500">No thinking leaks recorded. The splitter logs leftovers here when CoT still appears in Final output.</p>
            )}
        </div>
    );
};
