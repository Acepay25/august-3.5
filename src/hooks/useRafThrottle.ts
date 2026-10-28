import { useRef, useCallback, useEffect } from 'react';

/**
 * `keyOf` coalesces PER KEY instead of per throttle.
 *
 * One pending slot for the whole app meant two conversations streaming at once
 * overwrote each other's paint: only the last call's arguments survived to the
 * next frame, so the other row skipped a frame of text (and could miss its final
 * one) — the global-writer defect in the 2026-10-27 audit L-7. Each key now keeps its
 * own latest arguments and one frame flushes them all.
 */
export function useRafThrottle<T extends (...args: any[]) => void>(
    fn: T,
    keyOf?: (...args: Parameters<T>) => string,
): T & { flush: () => void } {
    const fnRef = useRef(fn);
    fnRef.current = fn; // always call the latest closure

    const frameRef = useRef<number | null>(null);
    const pendingRef = useRef<Map<string, any[]>>(new Map());
    const DEFAULTS = '';

    // Cancel any pending frame on unmount.
    useEffect(() => {
        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            pendingRef.current.clear();
        };
    }, []);

    const drain = useCallback(() => {
        const batch = [...pendingRef.current.values()];
        pendingRef.current.clear();
        for (const args of batch) fnRef.current(...args);
    }, []);

    const throttled = useCallback((...args: any[]) => {
        pendingRef.current.set(keyOf ? keyOf(...(args as Parameters<T>)) : DEFAULTS, args);
        if (frameRef.current !== null) return; // already scheduled

        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            drain();
        });
    }, [keyOf, drain]) as T & { flush: () => void };

    throttled.flush = useCallback(() => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        drain();
    }, [drain]);

    return throttled;
}
