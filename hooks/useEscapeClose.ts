import { useEffect } from 'react';

/**
 * Calls the provided handler when the Escape key is pressed while active.
 *
 * Usage:
 *   useEscapeClose(isOpen, () => setIsOpen(false));
 *
 * An open flyout owns this Escape FIRST: while any component marks
 * `data-menu-open` on <body> (SelectMenu does while open), this hook stands
 * down — the menu closes, and the NEXT Escape reaches the host. Without this,
 * the capture-phase listener here closed the whole modal under a dropdown
 * dismiss.
 */
export function useEscapeClose(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.body.getAttribute('data-menu-open') === '1') return;
      e.stopPropagation();
      onEscape();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active, onEscape]);
}
