import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary - Catches React rendering errors and prevents blank screen crashes
 * Particularly important for Android WebView where unhandled errors cause black screens
 */
class ErrorBoundary extends Component<Props, State> {
    state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    static getDerivedStateFromError(error: Error): Partial<State> {
        // Update state so the next render shows the fallback UI
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log error details for debugging
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Error info:', errorInfo);

        this.setState({ errorInfo });

        // Store error in localStorage for debugging on mobile
        try {
            const errorLog = {
                timestamp: new Date().toISOString(),
                message: error.message,
                stack: error.stack,
                componentStack: errorInfo.componentStack
            };
            localStorage.setItem('lastCrashError', JSON.stringify(errorLog));
        } catch (e) {
            console.error('[ErrorBoundary] Failed to save error log:', e);
        }
    }

    handleReload = (): void => {
        // Clear error state and reload
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.reload();
    };

    handleClearAndReload = (): void => {
        // Clear potentially corrupt session data and reload
        try {
            // Only clear session-related data, not user data
            sessionStorage.clear();
            localStorage.removeItem('lastCrashError');
        } catch (e) {
            console.error('[ErrorBoundary] Failed to clear storage:', e);
        }
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="fixed inset-0 bg-zinc-900 flex flex-col items-center justify-center p-6 text-white">
                    <div className="max-w-md w-full text-center space-y-6">
                        {/* Error Icon */}
                        <div className="text-6xl mb-4">⚠️</div>

                        {/* Title */}
                        <h1 className="text-2xl font-bold text-rose-400">
                            Something went wrong
                        </h1>

                        {/* Description */}
                        <p className="text-zinc-400 text-sm">
                            The app encountered an unexpected error. This sometimes happens
                            when processing trade data. Your data is safe.
                        </p>

                        {/* Error Details (Collapsed) */}
                        <details className="text-left bg-zinc-800 rounded-lg p-3 text-xs">
                            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                                Technical Details
                            </summary>
                            <pre className="mt-2 overflow-auto max-h-32 text-rose-300 whitespace-pre-wrap">
                                {this.state.error?.message || 'Unknown error'}
                            </pre>
                        </details>

                        {/* Action Buttons */}
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={this.handleReload}
                                className="w-full py-3 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-colors"
                            >
                                Reload App
                            </button>
                            <button
                                onClick={this.handleClearAndReload}
                                className="w-full py-2 px-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
                            >
                                Clear Session &amp; Reload
                            </button>
                        </div>

                        {/* Help Text */}
                        <p className="text-zinc-600 text-xs">
                            If this keeps happening, try switching users or exporting your data.
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
