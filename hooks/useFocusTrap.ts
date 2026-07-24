import { useEffect, useRef, useCallback } from 'react';

/**
 * Traps keyboard focus within a container element while active.
 * Restores focus to the previously focused element on cleanup.
 *
 * Usage:
 *   const containerRef = useFocusTrap(isOpen);
 *   return <div ref={containerRef}>...</div>;
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(selectors.join(','))
    ).filter(el => el.offsetParent !== null); // visible only
  }, []);

  useEffect(() => {
    if (!active) return;

    // Save the currently focused element to restore later
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element in the container
    const focusFirst = () => {
      const elements = getFocusableElements();
      if (elements.length > 0) {
        elements[0].focus();
      } else {
        containerRef.current?.focus();
      }
    };

    // Delay to allow the container to render
    const raf = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const elements = getFocusableElements();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown, true);
      // Restore focus to the previously focused element
      previousFocusRef.current?.focus();
    };
  }, [active, getFocusableElements]);

  return containerRef;
}
