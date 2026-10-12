/**
 * One JSX-aware walker for the source-shape gates.
 *
 * `tests/jsxNesting.test.ts` and the clipped-text block of
 * `tests/themeContrast.test.ts` each carried their own "find the tag's real end",
 * and the copies failed differently — which is the argument for keeping this here
 * rather than twice. What a regex over JSX cannot do, all learned from a gate that
 * passed while blind:
 *
 *  - A tag ends at its OWN depth-0 `>`, not at the first angle bracket. `=>`, a
 *    `[&>span]:truncate` variant selector and a `>` inside a `{…}` expression all
 *    contain one.
 *  - JSX *text* has no strings in it. `Don't close the app` opens a fake string in
 *    a naive walk, and every tag after it goes unread.
 *  - A regex literal is not division. `components/shared/UpdateOverlay.tsx` strips
 *    fenced markdown blocks with `/```[\s\S]*?```/g`; those backticks were read as
 *    three template literals and the walk stopped at line 36 of a 239-line file.
 *
 * Each of those was found by planting a violation in the region it hid and
 * watching the gate pass, so `openTags` is the only place that knows how JSX is
 * lexed here, and both gates inherit the same reach.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '..');

const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);

export interface Open {
    name: string;
    line: number;
    start: number;
    /** The raw attribute region, between the element name and the closing `>`. */
    attrs: string;
    selfClosed: boolean;
    /** Element names enclosing this tag, outermost first. */
    ancestors: string[];
    /** True when nothing encloses it: this is a component's root element. */
    isRoot: boolean;
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

const NOT_AN_OPERAND = '(,=:[!&|?{};+-*%^~<>';

/**
 * Does the `/` at `i` open a regex literal rather than divide? A `/` after
 * something that can end an operand (an identifier, `)`, `]`) divides; a `/`
 * after `(`, `,`, `=`, `return` and friends starts a pattern. `if (x) /re/.test()`
 * is read as division — the cost is that such a pattern's body is scanned as code,
 * and no source in this repo writes that form.
 */
function isRegexStart(src: string, i: number): boolean {
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const p = src[k];
    if (/^[A-Za-z0-9_$)\]]$/.test(p)) return /\b(?:return|case|in|of|do|else|yield|await|typeof|void|delete)$/.test(src.slice(0, k + 1));
    return NOT_AN_OPERAND.includes(p);
}

/** Index just past the regex literal that opens at `i`, or -1 if it is unterminated. */
function skipRegex(src: string, i: number): number {
    let k = i + 1;
    let cls = false;
    while (k < src.length) {
        const ch = src[k];
        if (ch === '\n') return -1;
        if (ch === BS) { k += 2; continue; }
        if (cls) { if (ch === ']') cls = false; k++; continue; }
        if (ch === '[') { cls = true; k++; continue; }
        if (ch === '/') { k++; break; }
        k++;
    }
    while (k < src.length && /[dgimsuyv]/.test(src[k])) k++;
    return k;
}

/** Index just past the depth-0 `>` that ends the tag opened at `lt`, or -1. */
function tagEnd(src: string, lt: number): number {
    const stack: { kind: string; ch?: string; depth: number }[] = [{ kind: 'code', depth: 0 }];
    let i = lt + 1;
    while (i < src.length) {
        const top = stack[stack.length - 1];
        const c = src[i];
        if (top.kind === 'str') {
            if (c === BS) { i += 2; continue; }
            if (c === top.ch) stack.pop();
            i++; continue;
        }
        if (top.kind === 'tmpl') {
            if (c === BS) { i += 2; continue; }
            if (c === BT) { stack.pop(); i++; continue; }
            if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'code', depth: 0 }); i += 2; continue; }
            i++; continue;
        }
        if (c === '"' || c === "'" || c === BT) {
            stack.push(c === BT ? { kind: 'tmpl', depth: 0 } : { kind: 'str', ch: c, depth: 0 });
            i++; continue;
        }
        // A comment or a regex literal inside the attribute region — including
        // BETWEEN attributes, which real source does (`components/settings/
        // CustomInstructionsEditor.tsx:194` explains a duration in `//` comments
        // above a `className`) — can hold a quote or an angle bracket. Neither may
        // end the tag, and a quote read as a quote here mis-places the tag's end.
        if (top.kind === 'code' && c === '/') {
            if (src[i + 1] === '/' || src[i + 1] === '*') {
                const line = src[i + 1] === '/';
                const e = line ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
                i = e < 0 ? src.length : line ? e + 1 : e + 2;
                continue;
            }
            if (isRegexStart(src, i)) {
                const e = skipRegex(src, i);
                if (e >= 0) { i = e; continue; }
            }
        }
        if (c === '{') { top.depth++; i++; continue; }
        if (c === '}') {
            top.depth--;
            if (top.depth < 0) { stack.pop(); i++; continue; }
            i++; continue;
        }
        if (c === '>' && top.kind === 'code' && top.depth === 0) {
            if (src[i - 1] === '=') { i++; continue; }
            return i + 1;
        }
        i++;
    }
    return -1;
}

/**
 * Every JSX opening tag in a source file, in order, with its attribute text and
 * element ancestry. Comments, strings, template literals, `${…}` and regex
 * literals are traversed as what they are; a `<` that directly follows an
 * identifier character is a type argument or a comparison, not a tag.
 */
function walk(src: string): { tags: Open[]; unclosed: number } {
    const out: Open[] = [];
    type Frame = { kind: 'code'; depth: number } | { kind: 'text'; tag: string } | { kind: 'str'; ch: string } | { kind: 'tmpl'; depth: number };
    const frames: Frame[] = [{ kind: 'code', depth: 0 }];
    let i = 0;
    while (i < src.length) {
        const top = frames[frames.length - 1];
        const c = src[i];

        if (top.kind === 'str') {
            if (c === BS) { i += 2; continue; }
            if (c === top.ch) frames.pop();
            i++; continue;
        }
        if (top.kind === 'tmpl') {
            if (c === BS) { i += 2; continue; }
            if (c === BT) { frames.pop(); i++; continue; }
            if (c === '$' && src[i + 1] === '{') { frames.push({ kind: 'code', depth: 0 }); i += 2; continue; }
            i++; continue;
        }
        if (top.kind === 'code') {
            if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
                const line = src[i + 1] === '/';
                const e = line ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
                i = e < 0 ? src.length : line ? e + 1 : e + 2;
                continue;
            }
            if (c === '"' || c === "'" || c === BT) {
                frames.push(c === BT ? { kind: 'tmpl', depth: 0 } : { kind: 'str', ch: c });
                i++; continue;
            }
            if (c === '/' && isRegexStart(src, i)) {
                const e = skipRegex(src, i);
                if (e >= 0) { i = e; continue; }
            }
            if (c === '{') { top.depth++; i++; continue; }
            if (c === '}') {
                if (top.depth > 0) top.depth--;
                else if (frames.length > 1) frames.pop();
                i++; continue;
            }
        } else if (c === '{') {
            // JSX text: `{` opens an expression container, which IS code. A quote
            // with no brace around it is a character in the sentence.
            frames.push({ kind: 'code', depth: 0 });
            i++; continue;
        }

        if (c === '<') {
            const n1 = src[i + 1] || '';
            if (n1 === '/') {
                const name = /^<\/([a-zA-Z][\w.]*)/.exec(src.slice(i, i + 60))?.[1];
                if (name) {
                    for (let k = frames.length - 1; k >= 0; k--) {
                        const f = frames[k];
                        if (f.kind === 'text' && f.tag === name) { frames.length = k; break; }
                    }
                    i += name.length + 3;
                    continue;
                }
            } else if (/[a-zA-Z]/.test(n1) && !(top.kind === 'code' && /[A-Za-z0-9_$.]/.test(src[i - 1] || ''))) {
                const m = /^<([a-zA-Z][\w.]*)/.exec(src.slice(i, i + 60));
                if (m) {
                    const end = tagEnd(src, i);
                    if (end > 0) {
                        const name = m[1];
                        const attrs = src.slice(i + name.length + 1, end - 1);
                        const selfClosed = attrs.trimEnd().endsWith('/') || VOID.has(name.toLowerCase());
                        const ancestors = frames.filter(f => f.kind === 'text').map(f => (f as { tag: string }).tag);
                        out.push({ name, line: src.slice(0, i).split('\n').length, start: i, attrs, selfClosed, ancestors, isRoot: ancestors.length === 0 });
                        if (!selfClosed) frames.push({ kind: 'text', tag: name });
                        i = end;
                        continue;
                    }
                }
            }
        }
        i++;
    }
    // A source the walker read correctly ends with only the base frame: every
    // string, template literal and JSX element it opened was closed. Leftovers are
    // the fingerprint of a desync — a quote read as a quote where there was none.
    return { tags: out, unclosed: frames.length - 1 };
}

export const openTags = (src: string): Open[] => walk(src).tags;

/** Frames still open at end of file. Zero says the walk finished what it started. */
export const unclosedFrames = (src: string): number => walk(src).unclosed;

/** Every `.tsx` under `dir`, recursively, as absolute paths. */
export function tsxFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return tsxFilesUnder(full);
        return entry.name.endsWith('.tsx') ? [full] : [];
    });
}

/**
 * The reach control for the walker, shared so both gates state it once. A scanner
 * that stops early makes any ban over it pass vacuously, which is the failure this
 * module exists to make impossible, and a ban reporting `0` cannot tell the two
 * apart by itself. Two independent signals, because each misses what the other
 * catches:
 *
 *  - `unclosedFrames` — the walk ended with a string, template literal or element
 *    still open. That is the shape of a desync: a quote that was not a quote. It
 *    does not care where in the file the walk died.
 *  - the last reported tag sitting in the first half of a file whose second half
 *    opens elements — the shape of a walk that resumed inside a fake string, which
 *    closes its frames and so leaves no imbalance behind.
 */
export function filesWalkedShortOfTheirEnd(files: { path: string; src: string }[]): string[] {
    return files.filter(({ src }) => {
        if (unclosedFrames(src) > 0) return true;
        const tags = openTags(src);
        const lines = src.split('\n');
        const last = tags.length ? tags[tags.length - 1].line : 0;
        const opensLate = lines.slice(Math.floor(lines.length / 2)).some(l => /^\s{2,}<([a-zA-Z])/.test(l));
        return opensLate && last < lines.length / 2;
    }).map(({ path }) => path);
}
