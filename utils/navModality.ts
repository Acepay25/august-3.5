/**
 * Which input modality is allowed to paint a focus indicator.
 *
 * `:focus-visible` is modality-aware for buttons and links, but the spec makes a
 * deliberate exception for anything you can type into: a browser matches it after
 * a MOUSE CLICK too, because a clicked field is a field you are about to type in.
 * That answers "could this field be typed in", not "did the keyboard just move
 * focus here" — and the second question is the one a focus ring exists to answer.
 * So the app tracks it: a navigation key sets the flag, any pointer or wheel input
 * clears it, and typing an ordinary character leaves it alone (clicking into the
 * composer and then typing must not light a box up one keystroke later).
 *
 * `index.css` reads the attribute. Nothing here decides what an indicator looks
 * like; it only says when one is owed.
 */

const NAVIGATION_KEYS = new Set([
    'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

export type NavModality = 'keyboard' | 'pointer';

export const setNavModality = (modality: NavModality): void => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.navModality = modality;
};

export const readNavModality = (): NavModality | null => {
    if (typeof document === 'undefined') return null;
    const value = document.documentElement.dataset.navModality;
    return value === 'keyboard' || value === 'pointer' ? value : null;
};

const onKeyDown = (event: KeyboardEvent): void => {
    if (NAVIGATION_KEYS.has(event.key)) setNavModality('keyboard');
};

const toPointer = (): void => setNavModality('pointer');

let installed = false;

/** Idempotent: called from the entry, and from tests that need a clean slate. */
export const installNavModalityTracking = (): void => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    // Capture phase, because a control that stops propagation must not be able to
    // hide the fact that the mouse was used.
    window.addEventListener('pointerdown', toPointer, { capture: true });
    window.addEventListener('wheel', toPointer, { capture: true, passive: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
};
