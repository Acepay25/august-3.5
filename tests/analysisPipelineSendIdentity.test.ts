/**
 * The send callback's identity must not churn with the composer.
 *
 * `handleSendMessage` is the app's central send path and it is depended on by
 * downstream memos and effects. It used to list `input`, `images` and
 * `currentHybridData` as `useCallback` dependencies — the first two change on
 * every keystroke and attachment, the third on every hybrid stream frame — so
 * the function was rebuilt continuously and dragged every consumer with it.
 *
 * They are now captured once, at the top of the send, which is behaviour
 * identical and leaves the array 36 entries instead of 39.
 *
 * WHY A SOURCE SCAN AND NOT A RENDERED HOOK. Mounting `useAnalysisPipeline`
 * means standing up a 3,400-line hook and its whole prop surface to observe one
 * thing about a `useCallback` — the very fragility the sibling suite's header
 * calls out when it moved its assertions to the extracted stage modules
 * ("pure units that are now testable without mounting the 3k-line send hook").
 * The property is a fact about the source, so it is asserted against the
 * source, and the assertions below import nothing.
 *
 * The floors are the important part: a regex that silently stopped matching
 * would make every assertion in this file pass for the wrong reason, which is
 * the classic vacuous-test failure this repo keeps encoding guards against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = join(process.cwd(), 'hooks', 'useAnalysisPipeline.ts');
const src = readFileSync(SOURCE, 'utf8');

/** The dependency array of the `handleSendMessage` useCallback, as a raw string. */
const sendCallbackDeps = (): string => {
    const start = src.indexOf('const handleSendMessage = useCallback(');
    expect(start).toBeGreaterThan(-1);
    // The callback is declared at the hook's body indent, so its closing dep
    // array is the next line matching exactly that indentation.
    const open = src.indexOf('\n    }, [', start);
    expect(open).toBeGreaterThan(start);
    const close = src.indexOf(']);', open);
    expect(close).toBeGreaterThan(open);
    return src.slice(open + '\n    }, ['.length, close);
};

const deps = (): string[] => sendCallbackDeps().split(',').map(s => s.trim()).filter(Boolean);

describe('handleSendMessage — composer state is not a dependency', () => {
    it('parses the real dependency array, not an empty or wrong one', () => {
        // If the extraction above ever breaks, it must fail HERE and loudly,
        // rather than letting the assertions below pass on an empty list.
        const list = deps();
        expect(list.length).toBeGreaterThan(30);
        // Spot-check a few names that were always there, so a regex that grabbed
        // some other array in the file cannot masquerade as a pass.
        expect(list).toContain('toast');
        expect(list).toContain('confirmDialog');
        expect(list).toContain('isEnsembleEnabled');
    });

    it('does not rebuild the send callback per keystroke or per stream frame', () => {
        const list = deps();
        // The three that churn: composer text, attachments, hybrid packet.
        expect(list).not.toContain('input');
        expect(list).not.toContain('images');
        expect(list).not.toContain('currentHybridData');
    });

    it('snapshots all three at the top of the send instead', () => {
        // Named so the read site and the snapshot cannot drift apart silently.
        expect(src).toMatch(/const composerInput = input;/);
        expect(src).toMatch(/const composerImages = images;/);
        expect(src).toMatch(/const hybridAtSend = currentHybridData;/);
    });

    it('keeps the hybrid snapshot OUT of a ref, which would change the data sent', () => {
        // A ref would be read at the hybrid-reuse decision, which sits AFTER the
        // `runNotebookQuickSave` await — so the analyst would be handed whatever
        // the stream had produced mid-run instead of the packet captured when
        // the trader pressed send. The local is the only safe shape here.
        expect(src).not.toMatch(/hybridAtSendRef/);
        // And the snapshot is what actually reaches the pipeline.
        expect(src).toMatch(/currentHybridData: hybridAtSend,/);
    });
});
