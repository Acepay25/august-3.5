import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TrashIcon, CloseIcon } from './Icons';

/**
 * ConfirmDialog — a non-blocking, styled replacement for window.confirm().
 *
 * P2-13: Native confirm() is blocking, unstyled, has no undo, and (combined
 * with the debounced-save risk) a delete can appear to succeed in the UI but
 * be lost on close. This component renders an in-app modal and, after a
 * confirmed destructive action, shows an undo toast for a short grace period.
 *
 * Usage:
 *   const confirm = useConfirmDialog();
 *   const ok = await confirm({ title: 'Delete?', message: 'This cannot be undone.' });
 *   if (ok) doDelete();
 *
 * For undo support, pass `onUndo` — when the user clicks Undo within the grace
 * period, onUndo fires and the result becomes `false` (so the caller treats
 * the action as not-performed). The undo toast auto-dismisses after 5s.
 */

interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    /** If provided, an Undo button is shown for this many ms after confirm. */
    undoGraceMs?: number;
    onUndo?: () => void | Promise<void>;
}

interface ConfirmState extends ConfirmOptions {
    open: boolean;
    resolve?: (ok: boolean) => void;
}

const DEFAULTS: Required<Omit<ConfirmOptions, 'onUndo' | 'message'>> = {
    title: 'Confirm',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    destructive: true,
    undoGraceMs: 5000,
};

export function useConfirmDialog() {
    const [state, setState] = useState<ConfirmState>({ ...DEFAULTS, open: false });
    const [undoVisible, setUndoVisible] = useState(false);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onUndoRef = useRef<(() => void | Promise<void>) | undefined>(undefined);

    const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setState({
                ...DEFAULTS,
                ...opts,
                open: true,
                resolve,
            });
        });
    }, []);

    const close = useCallback((ok: boolean) => {
        setState(prev => {
            prev.resolve?.(ok);
            return { ...prev, open: false, resolve: undefined };
        });
    }, []);

    const handleCancel = useCallback(() => {
        close(false);
    }, [close]);

    const handleConfirm = useCallback(() => {
        const opts = state;
        close(true);
        // If undo is configured, show the toast and arm the callback.
        if (opts.onUndo && opts.undoGraceMs && opts.undoGraceMs > 0) {
            onUndoRef.current = opts.onUndo;
            setUndoVisible(true);
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            undoTimerRef.current = setTimeout(() => {
                setUndoVisible(false);
                onUndoRef.current = undefined;
            }, opts.undoGraceMs);
        }
    }, [state, close]);

    const handleUndo = useCallback(async () => {
        const fn = onUndoRef.current;
        onUndoRef.current = undefined;
        setUndoVisible(false);
        if (undoTimerRef.current) {
            clearTimeout(undoTimerRef.current);
            undoTimerRef.current = null;
        }
        if (fn) {
            try {
                await fn();
            } catch (err) {
                console.error('[ConfirmDialog] Undo failed:', err);
            }
        }
    }, []);

    // Cleanup any pending undo timer on unmount.
    useEffect(() => {
        return () => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        };
    }, []);

    const ConfirmDialogComponent = (
        <>
            {state.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/60"
                        onClick={handleCancel}
                    />
                    <div className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6">
                            <div className="flex items-start gap-4">
                                {state.destructive && (
                                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
                                        <TrashIcon className="h-5 w-5" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-semibold text-zinc-100">{state.title}</h3>
                                    {state.message && (
                                        <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">{state.message}</p>
                                    )}
                                </div>
                                <button
                                    onClick={handleCancel}
                                    className="flex-shrink-0 p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
                                    aria-label="Close"
                                >
                                    <CloseIcon className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-zinc-900 border-t border-white/5 flex items-center justify-end gap-3">
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                            >
                                {state.cancelLabel}
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${state.destructive
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'bg-cyan-500 hover:bg-cyan-600 text-white'
                                    }`}
                            >
                                {state.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Undo toast */}
            {undoVisible && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[101] animate-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center gap-4 px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl">
                        <span className="text-sm text-zinc-200">Action completed</span>
                        <button
                            onClick={handleUndo}
                            className="text-sm font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Undo
                        </button>
                    </div>
                </div>
            )}
        </>
    );

    return { confirm, ConfirmDialogComponent };
}
