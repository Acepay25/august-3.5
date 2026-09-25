import { useEffect, useState } from 'react';

/** Which edge a surface arrived from, for the Chat ⇄ Chart AI hop. */
export type SurfaceEnterDirection = 'left' | 'right' | null;

/**
 * Apply the entering-surface animation exactly once, then clear the flag.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not check `prefers-reduced-motion`. The animation is a CSS
 *    keyframe (`.surface-enter-left` / `.surface-enter-right` in index.css),
 *    and the global reduced-motion block there already zeroes every
 *    animation — so the class can be applied unconditionally and the OS
 *    setting still wins. The surface morph is `Element.animate()`, which
 *    that CSS block cannot reach, which is why it has to check matchMedia
 *    itself. This is the cheaper arrangement.
 *
 *  - It does not re-trigger on re-render. The flag is consumed on mount, so
 *    navigating away and back animates again (correct) while a re-render in
 *    place does not (also correct — otherwise a state tick mid-hop would
 *    restart the animation and stutter).
 *
 * The class is applied to the SURFACE ROOT for one cycle, then removed so a
 * later visit re-animates cleanly rather than being pinned at the keyframe's
 * `both` fill state forever.
 */
/** Duration of the Chat ⇄ Chart AI resize, in ms. MUST match the
 *  `animation` shorthand on `.surface-enter-right/-left` in index.css — the
 *  class is cleared on a timer derived from this, so a mismatch truncates the
 *  animation mid-flight. tests/surfaceEnter.test.tsx asserts the two agree, so
 *  changing one without the other fails a test rather than silently snapping. */
export const SURFACE_ENTER_MS = 340;

export const useSurfaceEnter = (direction?: SurfaceEnterDirection | null): string => {
    const [className, setClassName] = useState('');

    useEffect(() => {
        if (!direction) {
            setClassName('');
            return;
        }
        setClassName(direction === 'left' ? 'surface-enter-left' : 'surface-enter-right');
        // Clear the applied class, but NOT the caller's flag — App owns that
        // and re-navigating should animate again.
        //
        // This used to clear on a hardcoded 260ms "one frame past the 220ms
        // animation". The animation is now SURFACE_ENTER_MS, and the stale
        // timer cut it off at ~76% — the class came off mid-flight and the
        // surface SNAPPED to its resting transform, which reads as the old
        // broken transition rather than as the new one. The duration is now
        // derived from the same constant index.css is asserted against in
        // tests/surfaceEnter.test.tsx, so the two cannot drift apart again.
        const t = setTimeout(() => setClassName(''), SURFACE_ENTER_MS + 40);
        return () => clearTimeout(t);
    }, [direction]);

    return className;
};
