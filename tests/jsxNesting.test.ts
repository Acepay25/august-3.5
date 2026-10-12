import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A `<button>` cannot contain a `<button>`: React says so at render
 * ("In HTML, <button> cannot be a descendant of <button>. This will cause a
 * hydration error.") and the browser's parser fixes the markup by moving the
 * inner button out, so the row silently stops behaving like the source reads.
 *
 * Found by accident in `MemoryFilesManager.tsx`'s notebook folder rows — a row
 * button wrapping two reorder buttons — while reading a render log for something
 * else. This gate is the general form: it walks every element in `components/**`
 * with a real JSX-aware scanner (strings, template literals, `${…}` and `{…}`
 * attribute expressions traversed, `=>` refused, comments skipped) and fails if
 * any interactive element opens inside another one.
 */

const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);

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
            if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'expr', depth: 1 }); i += 2; continue; }
            i++; continue;
        }
        if (c === '"' || c === "'" || c === BT) {
            stack.push(c === BT ? { kind: 'tmpl' } : { kind: 'str', ch: c });
            i++; continue;
        }
        if (c === '{') { top.depth++; i++; continue; }
        if (c === '}') {
            top.depth--;
            if (top.kind === 'expr' && top.depth === 0) { stack.pop(); i++; continue; }
            if (top.depth < 0) return -1;
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

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
// Interactive per HTML: these may not contain each other.
const INTERACTIVE = /^(button|a|summary|label|select|textarea|dialog)$/;

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

const nestedInteractive = (src: string, file: string): string[] => {
    const found: string[] = [];
    const stack: { name: string; line: number }[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n + 1; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
        if (c === '"' || c === "'" || c === BT) {
            i++;
            while (i < src.length && src[i] !== c) { if (src[i] === BS) i++; i++; }
            i++; continue;
        }
        if (c === '<' && /[a-zA-Z/]/.test(src[i + 1] || '')) {
            if (src[i + 1] === '/') {
                const name = /^<\/([a-zA-Z][\w.]*)/.exec(src.slice(i, i + 40))?.[1];
                if (name) {
                    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { stack.length = k; break; }
                    i += name.length + 3;
                    continue;
                }
            } else {
                const m = /^<([a-zA-Z][\w.]*)/.exec(src.slice(i, i + 60));
                if (m) {
                    const end = tagEnd(src, i);
                    if (end > 0) {
                        const name = m[1];
                        const selfClosed = src.slice(i + m[0].length, end - 1).trimEnd().endsWith('/') || VOID.has(name.toLowerCase());
                        if (INTERACTIVE.test(name) && stack.some(a => INTERACTIVE.test(a.name))) {
                            const outer = stack.filter(a => INTERACTIVE.test(a.name)).pop()!;
                            found.push(`${relative(process.cwd(), file)}: <${name}> at line ${src.slice(0, i).split('\n').length} inside <${outer.name}> at line ${outer.line}`);
                        }
                        if (!selfClosed) stack.push({ name, line: src.slice(0, i).split('\n').length });
                        i = end;
                        continue;
                    }
                }
            }
        }
        i++;
    }
    return found;
};

describe('interactive elements do not nest', () => {
    const offenders: string[] = [];
    for (const path of [...walk('components'), 'App.tsx']) {
        if (!path.endsWith('.tsx')) continue;
        offenders.push(...nestedInteractive(readFileSync(path, 'utf8'), path));
    }

    it(`finds no interactive element inside another (${offenders.length} offender(s))`, () => {
        expect(offenders, offenders.slice(0, 10).join('\n')).toEqual([]);
    });

    it('really catches a button inside a button', () => {
        expect(nestedInteractive('<button><span><button type="button">x</button></span></button>', 'probe.tsx')).toHaveLength(1);
        // and does not cry wolf on the shapes that look like one
        expect(nestedInteractive('<button type="button" onClick={() => x()}>label</button>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<button><img src="a" alt="" /></button>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<div><button>a</button><button>b</button></div>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<button className="[&_svg]:hidden">x</button>', 'probe.tsx')).toHaveLength(0);
        // a row that is a div wrapping buttons is exactly the fix applied to
        // MemoryFilesManager's folder rows, so it must pass.
        expect(nestedInteractive('<div role="list"><button>open</button><span><button>up</button></span></div>', 'probe.tsx')).toHaveLength(0);
    });
});
