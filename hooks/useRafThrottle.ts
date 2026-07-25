/**
 * useRafThrottle — coalesce high-frequency calls into one per animation frame.
 *
 * Returns a stable function that, when called rapidly, schedules a single
 * invocation on the next `requestAnimationFrame`. The latest arguments win.
 *
 * Use case: streaming AI responses arrive token-by-token. Calling setState
 * on every token causes hundreds of full re-renders per response. Wrapping the
 * state update in a RAF throttle collapses them to ~60/sec (one per frame),
 * which is the fastest the browser can paint anyway.
 *
 * On unmount the pending frame is cancelled. The `flush` method runs any
 * pending update immediately and synchronously — call it at the end of a
 * stream so the final state is committed without waiting for the next frame.
 */
import { useRef, useCallback, useEffect } from 'react';

export function useRafThrottle<T extends (...args: any[]) => void>(fn: T): T & { flush: () => void } {
    const fnRef = useRef(fn);
    fnRef.current = fn; // always call the latest closure

    const frameRef = useRef<number | null>(null);
    const pendingArgsRef = useRef<any[] | null>(null);

    // Cancel any pending frame on unmount.
    useEffect(() => {
        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, []);

    const throttled = useCallback((...args: any[]) => {
        pendingArgsRef.current = args;
        if (frameRef.current !== null) return; // already scheduled

        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingArgsRef.current;
            pendingArgsRef.current = null;
            if (pending !== null) {
                fnRef.current(...pending);
            }
        });
    }, []) as T & { flush: () => void };

    throttled.flush = useCallback(() => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        const pending = pendingArgsRef.current;
        pendingArgsRef.current = null;
        if (pending !== null) {
            fnRef.current(...pending);
        }
    }, []);

    return throttled;
}
