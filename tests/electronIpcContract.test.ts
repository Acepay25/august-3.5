/**
 * The Electron IPC contract.
 *
 * `tsconfig.json` EXCLUDES `electron/`, and no test imports the main process
 * — so the only CI gate on the desktop shell is `node --check`, which proves
 * the file parses and nothing more. Every other gate is blind to it. That is
 * not theoretical: the deep-dive 2026-09-24 found a change to the provider
 * chunk bridge that made the whole run's token ledger NaN (and silently
 * disabled the per-debate spend cap) while typecheck, 3900 unit tests, lint,
 * e2e, boot-probe and render-probe all stayed green.
 *
 * The highest-value class of that bug is DRIFT: preload exposes a channel the
 * main process never handles (or vice versa). At runtime the renderer gets
 * `undefined` or a silent no-op, with no compile error anywhere, because the
 * channel name is just a string on both sides. Nothing else in CI can see it.
 *
 * This pins the contract from the source on both sides, so the pair cannot
 * drift without a test failing. Pure string analysis over the two files — no
 * Electron runtime, so it is deterministic on every platform.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');

/** Every channel name, de-duplicated. */
const channels = (src: string, re: RegExp): string[] =>
    [...new Set([...src.matchAll(re)].map(m => m[1]))].sort();

const handled = (): string[] => channels(main, /ipcMain\.handle\(\s*'([^']+)'/g);
const listened = (): string[] => channels(main, /ipcMain\.on\(\s*'([^']+)'/g);
const invoked = (): string[] => channels(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g);
const sent = (): string[] => channels(preload, /ipcRenderer\.send\(\s*'([^']+)'/g);

describe('Electron IPC contract', () => {
    it('every channel the preload invokes is handled by the main process', () => {
        const missing = invoked().filter(c => !handled().includes(c));
        expect(
            missing,
            'preload invokes channels main.cjs never handles — the renderer would '
            + 'get undefined at runtime and nothing else in CI can see it',
        ).toEqual([]);
    });

    it('every channel the preload sends is listened for by the main process', () => {
        const missing = sent().filter(c => !listened().includes(c));
        expect(missing, 'fire-and-forget sends with no ipcMain.on listener').toEqual([]);
    });

    it('every handled channel is reachable from the preload', () => {
        // The reverse drift: a handler nothing calls is dead surface, and it is
        // usually a sign a rename landed on one side only.
        const exposed = [...invoked(), ...sent()];
        const orphans = handled().filter(c => !exposed.includes(c));
        expect(orphans, 'handlers no renderer path can reach — rename drift or dead code').toEqual([]);
    });

    it('the two surfaces are described in one place, not by convention', () => {
        // If this file ever needs editing to go green, the fix belongs in the
        // two source files — never by relaxing the comparison.
        expect(handled().length).toBeGreaterThan(0);
        expect(invoked().length).toBeGreaterThan(0);
    });
});
