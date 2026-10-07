import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The tracker behind "no blue box when I click the composer".
 *
 * The CSS in index.css keys off `html[data-nav-modality]`, and jsdom cannot
 * resolve a stylesheet — so this suite pins the FLAG, and scripts/render-probe.cjs
 * pins what the flag actually paints in a real browser. Neither is enough alone:
 * a tracker that sets the attribute on every keydown would pass here and still
 * light the composer up the moment the trader typed their first character.
 */

import { installNavModalityTracking, readNavModality, setNavModality } from '../utils/navModality';

const key = (k: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};
const pointer = (): void => {
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};

beforeAll(() => {
    installNavModalityTracking();
    setNavModality('pointer');
});

describe('nav modality tracking', () => {
    it('starts on pointer, so a fresh boot shows no ring on a typed-into field', () => {
        expect(readNavModality()).toBe('pointer');
        expect(document.documentElement.dataset.navModality).toBe('pointer');
    });

    it('a navigation key is what earns the ring', () => {
        key('Tab');
        expect(readNavModality()).toBe('keyboard');
        key('ArrowDown');
        expect(readNavModality()).toBe('keyboard');
        key('Home');
        expect(readNavModality()).toBe('keyboard');
    });

    it('a pointer or wheel input takes it away again', () => {
        key('Tab');
        expect(readNavModality()).toBe('keyboard');
        pointer();
        expect(readNavModality()).toBe('pointer');
        key('Tab');
        window.dispatchEvent(new Event('wheel', { bubbles: true }));
        expect(readNavModality()).toBe('pointer');
    });

    it('typing a character leaves the modality alone', () => {
        pointer();
        for (const ch of ['h', 'e', 'l', 'l', 'o', ' ', 'Enter']) key(ch);
        expect(readNavModality()).toBe('pointer');
        // And the same keystrokes after a Tab do not clear the ring the Tab earned.
        key('Tab');
        key('h');
        expect(readNavModality()).toBe('keyboard');
    });

    it('installation is idempotent', () => {
        installNavModalityTracking();
        installNavModalityTracking();
        pointer();
        expect(readNavModality()).toBe('pointer');
    });
});
