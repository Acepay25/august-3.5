/**
 * useSaveOnUnload — flush pending state to storage on tab close / hide.
 *
 * The main autosave in App.tsx is debounced (1500ms). If the user logs a trade
 * and closes the tab within that window, the debounced save never fires and
 * the data is lost. This hook installs synchronous flush handlers for the
 * lifecycle events that signal the page is being torn down or backgrounded:
 *
 *   - `pagehide`         — fires reliably on mobile/desktop tab close + iOS Safari
 *   - `beforeunload`     — desktop fallback (Chrome/Firefox)
 *   - `visibilitychange` — fires when tab is hidden (Chrome flushes JS on hide;
 *                          this also catches "user switches app then swipes away")
 *
 * Strategy: the caller passes a `getSnapshot` function returning the latest
 * serializable profile + a `save` function. We keep a ref to the freshest
 * snapshot so the flush handler always saves the most recent state, and we
 * skip the work if no mutation has happened since the last successful save.
 *
 * On native (Capacitor) `pagehide`/`beforeunload` do not fire on backgrounding,
 * so the `visibilitychange` path is what protects mobile users.
 */
import { useEffect, useRef, useCallback } from 'react';

export interface SaveOnUnloadOptions<T> {
    /** Build the latest snapshot. Should be cheap (no IO). */
    getSnapshot: () => T | null;
    /** Persist the snapshot. Should be as fast as possible (IndexedDB write). */
    save: (snapshot: T) => Promise<void> | void;
    /** True when there is pending unsaved data to flush. */
    isDirty: () => boolean;
    /** Optional: called after a successful flush. */
    onFlushed?: () => void;
    /** Skip wiring entirely (e.g., no active user). When true, listeners are not installed. */
    enabled?: boolean;
}

export function useSaveOnUnload<T>({ getSnapshot, save, isDirty, onFlushed, enabled = true }: SaveOnUnloadOptions<T>): void {
    // Always-current snapshot + dirty flag so the synchronous unload handler
    // can read the freshest data without re-running React effects.
    const snapshotRef = useRef<T | null>(null);
    const dirtyRef = useRef<boolean>(false);
    const flushingRef = useRef<boolean>(false);

    // Keep the snapshot ref fresh on every render. This is cheap because
    // getSnapshot() must not perform IO — it just builds the payload object.
    if (enabled) {
        const next = getSnapshot();
        if (next !== null) snapshotRef.current = next;
        dirtyRef.current = isDirty();
    }

    const flush = useCallback(async () => {
        // Reentrancy guard — pagehide + visibilitychange can both fire.
        if (flushingRef.current) return;
        if (!dirtyRef.current) return;
        const snapshot = snapshotRef.current;
        if (snapshot === null) return;

        flushingRef.current = true;
        try {
            await save(snapshot);
            dirtyRef.current = false;
            onFlushed?.();
        } catch (err) {
            // Don't rethrow — unload handlers cannot block reliably anyway.
            console.error('[useSaveOnUnload] Flush failed:', err);
        } finally {
            flushingRef.current = false;
        }
    }, [save, onFlushed]);

    useEffect(() => {
        if (!enabled) return;

        const onPageHide = (event: PageTransitionEvent) => {
            // `persisted` is true for bfcache restores — those don't need a flush.
            if (event.persisted) return;
            flush();
        };

        const onBeforeUnload = () => {
            flush();
        };

        const onVisibilityChange = () => {
            // Only flush when transitioning to hidden. On visible we let the
            // normal debounced save path resume.
            if (document.visibilityState === 'hidden') {
                flush();
            }
        };

        // pagehide is the most reliable cross-browser close signal (incl. iOS Safari).
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('beforeunload', onBeforeUnload);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('beforeunload', onBeforeUnload);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [enabled, flush]);
}
