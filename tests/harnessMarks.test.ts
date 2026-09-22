/**
 * The harness-withholding notes have ONE owner (2026-09-21).
 *
 * Before this, five files wrote their own clipping marker and six sites typed
 * `DATA_UNAVAILABLE:` by hand. That is not a tidiness problem: the fence around
 * third-party tool output tells a model which lines it may ACT on, and that
 * legend was hand-written — it named "[<tool> output clipped: …]", a shape no
 * code ever emitted, while the markers that did appear went untaught. So the
 * one note in a block the model was allowed to trust was the one it had been
 * told to distrust.
 *
 * These assertions are the seam. The parity cases pin the exact text a model
 * has been reading, so consolidating could not silently reword it; the legend
 * case fails if an emitter appears that the fence does not name; and the source
 * scan fails the moment anyone writes a marker outside the owner again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
    CLIP_NOTE_PREFIX,
    CLIP_RECEIPT_PREFIX,
    DATA_UNAVAILABLE_PREFIX,
    HARNESS_NOTE_PREFIXES,
    HARNESS_TURN_MARK,
    MINIMAL_CLIP_NOTE,
    clipNote,
    clipReceipt,
    dataUnavailable,
    findClipIn,
    harnessNoteLegend,
    harnessTurn,
    isDataUnavailable,
} from '../utils/harnessMarks';
import { RECEIPT_CHARS } from '../services/analysis/toolArtifactStore';

describe('clipNote', () => {
    it('names the loss with numbers, which is the whole point of the note', () => {
        expect(clipNote({ source: 'order_book', kept: 4, total: 118 }))
            .toBe('…[truncated order_book: first 4 of 118 chars. The rest is MISSING, '
                + 'not absent — treat the withheld part as unknown, not as absent.]');
    });

    it('reproduces the desk tool’s historical wording byte for byte', () => {
        // This is the text a model has been reading since the note was written,
        // rebuilt from the shared owner. If this line moves, the consolidation
        // changed model-facing behavior and must be argued for on its merits.
        expect(clipNote({
            source: 'order_book',
            kept: 4,
            total: 118,
            guidance: 'treat unlisted levels as unknown, not zero',
        })).toBe('…[truncated order_book: first 4 of 118 chars. '
            + 'The rest is MISSING, not absent — treat unlisted levels as unknown, not zero.]');
    });

    it('counts in the unit the clip actually used', () => {
        expect(clipNote({ source: 'array', kept: 5, total: 12, unit: 'items' }))
            .toContain('first 5 of 12 items');
    });
});

describe('dataUnavailable', () => {
    it('reproduces the historical sentinel byte for byte', () => {
        expect(dataUnavailable('web_search', 'network down')).toBe(
            'DATA_UNAVAILABLE: web_search — network down. The source FAILED; '
            + 'treat this as UNKNOWN, not as absence of evidence.');
    });

    it('lets a payload keep its own conclusion without losing the prefix', () => {
        const line = dataUnavailable('scan_setups', 'not enough candles for BTCUSDT 1h',
            'The source failed; do not infer an empty tape');
        expect(line).toBe('DATA_UNAVAILABLE: scan_setups — not enough candles for BTCUSDT 1h. '
            + 'The source failed; do not infer an empty tape.');
        expect(isDataUnavailable(line)).toBe(true);
    });

    it('is detected by prefix alone, since the guidance varies', () => {
        expect(isDataUnavailable(dataUnavailable('x', 'y'))).toBe(true);
        expect(isDataUnavailable('BTCUSDT last price 108412.5')).toBe(false);
    });
});

describe('the spill receipt', () => {
    it('reproduces the historical locator byte for byte', () => {
        expect(clipReceipt('ta-0000')).toBe(
            '…[clipped: full result is id "ta-0000"; call read_tool_output with this id to page through it]');
    });

    it('is what the cap arithmetic reserves room for', () => {
        // RECEIPT_CHARS is derived from this function; the desk prepends "\n".
        // If the two ever disagree, a receipt can be appended past the budget
        // that tailReserve exists to protect.
        expect(RECEIPT_CHARS).toBe(clipReceipt('ta-0000').length + 1);
    });
});

describe('the fence legend', () => {
    it('names every marker the owner can emit', () => {
        const emitted = [
            clipNote({ source: 'order_book', kept: 1, total: 2 }),
            MINIMAL_CLIP_NOTE,
            clipReceipt('ta-0000'),
            dataUnavailable('web_search', 'boom'),
        ];
        for (const note of emitted) {
            expect(HARNESS_NOTE_PREFIXES.some(p => note.startsWith(p))).toBe(true);
        }
    });

    it('lists each prefix, so the legend cannot describe a marker that never ships', () => {
        const legend = harnessNoteLegend();
        for (const prefix of HARNESS_NOTE_PREFIXES) {
            expect(legend).toContain(prefix);
        }
        expect(legend).toContain(CLIP_NOTE_PREFIX);
        expect(legend).toContain(CLIP_RECEIPT_PREFIX);
        expect(legend).toContain(DATA_UNAVAILABLE_PREFIX);
    });

    it('still tells the model what to do with them', () => {
        expect(harnessNoteLegend()).toMatch(/system notes, not page content/);
        expect(harnessNoteLegend()).toMatch(/act on them/);
    });
});

describe('reading a clip back', () => {
    it('recovers the counts the seat was given', () => {
        const content = `{"buyWalls":[]}\n${clipNote({ source: 'order_book', kept: 4, total: 118 })}`;
        expect(findClipIn(content)).toEqual({ kept: 4, total: 118 });
    });

    it('works for any unit, because the note is one dialect', () => {
        expect(findClipIn(clipNote({ source: 'array', kept: 5, total: 12, unit: 'items' })))
            .toEqual({ kept: 5, total: 12 });
    });

    it('is null for a complete payload, so an honest line stays clean', () => {
        expect(findClipIn('{"buyWalls":[1,2,3]}')).toBeNull();
        expect(findClipIn(dataUnavailable('get_order_book', 'timeout'))).toBeNull();
    });

    it('ignores the minimal note, which carries no counts to report', () => {
        expect(findClipIn(MINIMAL_CLIP_NOTE)).toBeNull();
    });
});

describe('who is speaking inside a user-role turn', () => {
    it('marks the harness turn without rewriting the body', () => {
        expect(harnessTurn('Continue. No JSON, no tool tags.'))
            .toBe(`${HARNESS_TURN_MARK} Continue. No JSON, no tool tags.`);
    });

    it('is named verbatim by every prompt that claims the user role', () => {
        // The exact failure mode the fence legend had: prose describing a marker
        // from memory, then drifting from the marker actually emitted. Both Floor
        // prompts assert what a user turn IS, so they must quote the real mark.
        const prompts = readFileSync(join('constants', 'prompts', 'debatePrompts.ts'), 'utf8');
        const claims = prompts.split('\n').filter(line => line.includes('chat "user" role'));
        expect(claims.length).toBeGreaterThanOrEqual(2);
        for (const line of claims) {
            expect(line).toContain(HARNESS_TURN_MARK);
        }
    });

    it('leaves the trader’s own steering as the unmarked, higher-authority case', () => {
        // The prompts tell a seat that USER STEERING is the human. That only
        // holds while the harness never uses the same label for itself.
        const debate = readFileSync(join('services', 'providers', 'ensembleService.ts'), 'utf8');
        expect(debate).toContain('**USER STEERING');
        expect(HARNESS_TURN_MARK).not.toMatch(/USER STEERING/);
    });
});

describe('one owner, enforced against the source', () => {
    const OWNER = join('utils', 'harnessMarks.ts');
    const ROOTS = ['services', 'utils', 'hooks', 'components', 'constants', 'schemas'];

    /** Strip comments so the scan looks at what the code SAYS to a model rather
     *  than at prose about the history. Char-scans with a block-comment toggle,
     *  because pairing block-comment delimiters by regex mis-pairs on the first
     *  opener inside a URL and then leaves a real comment body in the scan —
     *  which is how this guard first failed, on two explanatory comments. Blind
     *  to string literals, so a double slash in a URL truncates the rest of that
     *  line: this can only weaken the guard, never fire on a clean tree. */
    const codeOnly = (src: string): string => {
        let inBlock = false;
        return src.split('\n').map(line => {
            let out = '';
            let i = 0;
            while (i < line.length) {
                if (inBlock) {
                    const end = line.indexOf('*/', i);
                    if (end === -1) { i = line.length; } else { inBlock = false; i = end + 2; }
                    continue;
                }
                if (line.startsWith('/*', i)) { inBlock = true; i += 2; continue; }
                if (line.startsWith('//', i)) break;
                out += line[i];
                i += 1;
            }
            return out;
        }).join('\n');
    };

    const sources = ROOTS.flatMap(root => readdirSync(root, { recursive: true })
        .filter(entry => typeof entry === 'string' && /\.tsx?$/.test(entry) && !entry.endsWith('.d.ts'))
        .map(entry => join(root, entry as string)))
        .filter(p => p !== OWNER);

    // Case-insensitive and anchored on the opening bracket. The pattern this
    // replaces demanded a literal `…[truncated`, so `...[Truncated to fit
    // context memory]` — a hand-written note that named neither how much was
    // kept nor how much existed — sailed through it, and so did a note that
    // opened with `[Memory budget reached…`. The 25-character window is what
    // keeps schema identifiers like ['incomplete-plan', 'truncated-plan'] and
    // object literals like { missing: [...] } from being reported as markers.
    const CLIP_MARKER_RE = /\[[^\]]{0,25}\b(?:truncated|clipped)\b/i;

    it('finds the marker literals in the scan at all (a guard that cannot fail is not a guard)', () => {
        const owner = codeOnly(readFileSync(OWNER, 'utf8'));
        expect(CLIP_MARKER_RE.test(owner)).toBe(true);
        expect(owner).toMatch(/['"`]DATA_UNAVAILABLE:/);
    });

    it('finds no clipping marker written outside utils/harnessMarks.ts', () => {
        const offenders: string[] = [];
        for (const file of sources) {
            if (CLIP_MARKER_RE.test(codeOnly(readFileSync(file, 'utf8')))) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });

    it('finds no hand-typed DATA_UNAVAILABLE literal outside the owner', () => {
        const offenders: string[] = [];
        for (const file of sources) {
            const code = codeOnly(readFileSync(file, 'utf8'));
            if (/DATA_UNAVAILABLE:/.test(code)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
