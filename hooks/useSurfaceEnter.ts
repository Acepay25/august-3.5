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
export const useSurfaceEnter = (direction?: SurfaceEnterDirection | null): string => {
    const [className, setClassName] = useState('');

    useEffect(() => {
        if (!direction) {
            setClassName('');
            return;
        }
        setClassName(direction === 'left' ? 'surface-enter-left' : 'surface-enter-right');
        // Clear the applied class, but NOT the caller's flag — App owns that
        // and re-navigating should animate again. The timeout is one frame
        // past the 220ms animation in index.css.
        const t = setTimeout(() => setClassName(''), 260);
        return () => clearTimeout(t);
    }, [direction]);

    return className;
};
