import { useEffect, useRef, useState } from 'react';

/**
 * Reveal `target` without dumping a large blob in one paint.
 * Append-only token streams catch up immediately; sudden jumps
 * (opening statements) ease in over a few animation frames.
 */
export const useSmoothStreamText = (target: string, live: boolean): string => {
    const [shown, setShown] = useState(live ? '' : target);
    const shownRef = useRef(live ? '' : target);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        if (!live) {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            shownRef.current = target;
            setShown(target);
            return;
        }

        const tick = (): void => {
            const current = shownRef.current;
            if (current === target) {
                frameRef.current = null;
                return;
            }

            if (target.startsWith(current)) {
                const remain = target.length - current.length;
                const step = remain > 160 ? Math.ceil(remain / 5) : remain;
                shownRef.current = target.slice(0, current.length + step);
                setShown(shownRef.current);
                if (shownRef.current !== target) {
                    frameRef.current = requestAnimationFrame(tick);
                } else {
                    frameRef.current = null;
                }
                return;
            }

            shownRef.current = target;
            setShown(target);
            frameRef.current = null;
        };

        tick();
        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [target, live]);

    return shown;
};
