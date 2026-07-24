import { useEffect } from 'react';

/**
 * Calls the provided handler when the Escape key is pressed while active.
 *
 * Usage:
 *   useEscapeClose(isOpen, () => setIsOpen(false));
 */
export function useEscapeClose(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active, onEscape]);
}
