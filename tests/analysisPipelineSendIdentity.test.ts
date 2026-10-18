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
        // Stage 19 deleted the branch this packet fed. The seat fetches the tape
        // INSIDE the turn, so what must stay false is a pre-captured market packet
        // threaded into a model call — and the path that answers is the tool turn.
        expect(src).not.toMatch(/currentHybridData: hybridAtSend,/);
        expect(src).toMatch(/toolTurn = await runChatSurfaceTurn\(\{/);
    });
});

describe('handleSendMessage — the casual send carries the composer tier', () => {
    /** A call slice, from its own start to its closing bracket. Scoped to the
     *  call rather than the whole file so a `reasoningEffort` mentioned in a
     *  comment somewhere else cannot fake the pass. The end bracket is found by
     *  shape, not by indentation: stage 20b wrapped this call in the bot-arm
     *  `if`, and a gate that breaks because a line moved is a gate that follows
     *  the layout instead of the contract. */
    const callSlice = (start: string, end: RegExp): string => {
        const at = src.indexOf(start);
        expect(at, `${start} is gone or renamed`).toBeGreaterThan(-1);
        const close = src.slice(at).search(end);
        expect(close, `${start} no longer ends where this scan expects`).toBeGreaterThan(-1);
        return src.slice(at, at + close);
    };
    const casualCall = (): string => callSlice(
        'responseText = await streamQuickResponse(',
        /\n\s*\);/,
    );

    it('passes the tier the surface sent, after the stream callbacks', () => {
        const call = casualCall();
        // Position is the contract: the parameter is the transport's 8th and is
        // positional, so the argument must ride after the chunk callback and be
        // the last thing in the call. Matching on whitespace would break on a
        // comment, so the order is measured instead.
        const deltaAt = call.indexOf('delta => {');
        expect(deltaAt, 'the visible-delta callback is not where this call should have it').toBeGreaterThan(-1);
        const effortAt = call.indexOf('options?.reasoningEffort,');
        expect(effortAt, 'the casual send no longer passes the composer tier').toBeGreaterThan(deltaAt);
        expect(call.slice(effortAt).trim()).toBe('options?.reasoningEffort,');
        // Declared on the options bag, or the argument reads a field no caller
        // is allowed to set.
        expect(src).toMatch(/reasoningEffort\?: ReasoningEffort;/);
    });

    it('carries the same tier into the desk arm, which is a tool turn now', () => {
        // 20b split this branch: a bot answers over the plain transport and the
        // desk over `runChatSurfaceTurn`. The dial is one control over both, so
        // a chip that only reaches one of them is half a chip — and the desk arm
        // is the one a trader actually uses.
        const call = callSlice('toolTurn = await runChatSurfaceTurn({', /\n\s*\}\);/);
        expect(call).toMatch(/effort: options\?\.reasoningEffort,/);
    });

    it('does not let the dial reach the debate', () => {
        // The composer tier is a chat control. If the ensemble started reading
        // it, one chip would silently re-tier every analyst seat — the seats'
        // effort comes from the role schedule (EFFORT_BY_TASK).
        expect(src).not.toMatch(/reasoningEffort:\s*options\?\.reasoningEffort/);
    });
});
