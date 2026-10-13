import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { openTags, unclosedFrames, declarations, ownerOf, tsxFilesUnder, filesWalkedShortOfTheirEnd, REPO_ROOT } from './jsxScan';

/**
 * A `<button>` cannot contain a `<button>`: React says so at render
 * ("In HTML, <button> cannot be a descendant of <button>. This will cause a
 * hydration error.") and the browser's parser fixes the markup by moving the
 * inner button out, so the row silently stops behaving like the source reads.
 *
 * Found by accident in `MemoryFilesManager.tsx`'s notebook folder rows — a row
 * button wrapping two reorder buttons — while reading a render log for something
 * else. This gate is the general form, and it needs two things a tag regex cannot
 * give it:
 *
 *  1. Where it is. The lexing lives in `./jsxScan` (JSX text vs code, regex
 *     literals vs division) because the clipped-text gate needs the same reach,
 *     and the two copies that existed failed differently.
 *  2. What a component renders. `<Button>` inside `<button>` is the same bug
 *     written with a capital letter, so interactivity is DERIVED per component
 *     from the tags its own file renders. A `/Button$/` name heuristic was tried
 *     first and is exactly the label-based check this repo already refuses.
 */

const FORBIDS_INTERACTIVE = /^(button|a|summary)$/;
/**
 * Two different questions, so two lists. `button`, `a` and `summary` are the
 * elements whose content model forbids interactive content inside them — React
 * warns about these. `label` and `dialog` are interactive content themselves but
 * happily contain a button, so treating them as forbidding would refuse markup
 * that is legal (a `<button>` inside a settings `<label>` is this app's own
 * checkbox shape). `input` belongs to the second list only: it is a void element,
 * so it can never be an ancestor, but `<button><input/></button>` still puts
 * interactive content inside a button.
 */
const INTERACTIVE_CONTENT = /^(button|a|summary|label|select|textarea|input)$/;

const label = (file: string): string => relative(REPO_ROOT, file).replace(/\\/g, '/');

const FILES = [...tsxFilesUnder(join(REPO_ROOT, 'components')), resolve(REPO_ROOT, 'App.tsx')].map(file => {
    const src = readFileSync(file, 'utf8');
    return { file, src, tags: openTags(src), decls: declarations(src) };
});

/** How many of the attributed declarations are nested inside another body.
 *  The gate used to know only column-0 ones, so this is the population the
 *  owner map gained, measured rather than claimed. */
const NESTED_DECLARATIONS = FILES.reduce((n, f) => n + f.decls.filter(d => d.indent > 0).length, 0);

/**
 * What each component renders. `forbidsRoot` = its outermost element is a
 * button/anchor/summary, so anything placed inside one lands inside that button;
 * `rendersInteractive` = it renders interactive content anywhere in its body, so
 * placing it inside a button puts a button there even when its own root is a div.
 * Both are deliberately over-approximated — a component that draws a button in one
 * branch refuses the same nesting in all of them — and these sets can only ever add
 * a refusal, never grant one.
 */
const forbidsRoot = new Set<string>();
const rendersInteractive = new Set<string>();
for (const f of FILES) {
    for (const t of f.tags) {
        if (!INTERACTIVE_CONTENT.test(t.name)) continue;
        const owner = ownerOf(f.decls, t.start);
        if (!owner) continue;
        rendersInteractive.add(owner);
        if (t.isRoot && FORBIDS_INTERACTIVE.test(t.name)) forbidsRoot.add(owner);
    }
}
// A component whose root is another such component (`const OpenChip = () =>
// <RetryChip />`) inherits both facts, until the sets stop growing.
for (;;) {
    let grew = false;
    for (const f of FILES) {
        for (const t of f.tags) {
            if (!t.isRoot) continue;
            const owner = ownerOf(f.decls, t.start);
            if (!owner || owner === t.name) continue;
            if ((FORBIDS_INTERACTIVE.test(t.name) || forbidsRoot.has(t.name)) && !forbidsRoot.has(owner)) {
                forbidsRoot.add(owner); grew = true;
            }
            if ((INTERACTIVE_CONTENT.test(t.name) || rendersInteractive.has(t.name)) && !rendersInteractive.has(owner)) {
                rendersInteractive.add(owner); grew = true;
            }
        }
    }
    if (!grew) break;
}

const isOuter = (name: string): boolean => FORBIDS_INTERACTIVE.test(name) || forbidsRoot.has(name);
const isInner = (name: string): boolean => INTERACTIVE_CONTENT.test(name) || rendersInteractive.has(name);

const nestedInteractive = (src: string, file: string): string[] =>
    openTags(src)
        .filter(t => isInner(t.name) && t.ancestors.some(isOuter))
        .map(t => {
            const outer = t.ancestors.filter(isOuter).pop()!;
            const how = FORBIDS_INTERACTIVE.test(outer) ? `<${outer}>` : `<${outer}>, which renders as a button`;
            return `${label(file)}: <${t.name}> at line ${t.line} inside ${how}`;
        });

/** Coverage control for the walker: the tag population it actually read. */
const TAGS_SEEN = FILES.reduce((n, f) => n + f.tags.length, 0);

const offenders: string[] = [];
for (const f of FILES) offenders.push(...nestedInteractive(f.src, f.file));

describe('interactive elements do not nest', () => {
    /**
     * A walker that stops mid-file is worse than one with no rule at all, because
     * the ban below then passes on the files it never read. `UpdateOverlay.tsx` was
     * exactly that: 8 of its 239 lines were walked after a regex literal was read as
     * three template literals, and a nested pair planted in the blind region passed
     * the gate. This asks each file a question the walk cannot answer without having
     * finished it.
     */
    it('walks to the end of every file it reads', () => {
        const blind = filesWalkedShortOfTheirEnd(FILES.map(f => ({ path: label(f.file), src: f.src })));
        expect(blind, blind.join('\n')).toEqual([]);
    });

    /**
     * Guard for the guard, because the reach control is itself a heuristic: the
     * frame-balance signal has to fire on a walk that ended inside an unclosed
     * string, or `filesWalkedShortOfTheirEnd` is only the midpoint test again.
     */
    it('notices a walk that ends inside something it opened', () => {
        expect(unclosedFrames('<div><span>ok</span></div>')).toBe(0);
        expect(unclosedFrames('const a = [1, 2];\n<button>x</button>')).toBe(0);
        expect(unclosedFrames("const broken = 'never closed;")).toBeGreaterThan(0);
        expect(unclosedFrames('const t = `never closed either')).toBeGreaterThan(0);
    });

    /**
     * The control for the derivation. If `openTags` quietly stopped parsing, the ban
     * would pass on an empty set; the measured count is in the test NAME so the run
     * reports it instead of leaving it as a comment, and the floor sits well below it
     * so a parser regression fails here rather than silently clearing the ban.
     */
    it(`reads every opening tag it is guarding (${TAGS_SEEN} read)`, () => {
        expect(TAGS_SEEN).toBeGreaterThanOrEqual(3000);
    });

    /**
     * Owner attribution, which decides what each derived set knows. A nested
     * component used to be invisible: its tags were credited to the enclosing
     * component and its own name was attributed nothing, so a rule written
     * against components could not see it.
     */
    it('attributes a component declared inside another one', () => {
        const src = [
            'export const Outer: React.FC = () => {',
            '    const InnerCard = (): React.ReactElement => (<button type="button">inner</button>);',
            '    return (<div><span>after the nested one</span></div>);',
            '};',
        ].join('\n');
        const decls = declarations(src);
        expect(decls.map(d => d.name).join(',')).toBe('Outer,InnerCard');
        const innerTag = src.indexOf('<button');
        const afterTag = src.indexOf('<span>');
        expect(ownerOf(decls, innerTag)).toBe('InnerCard');
        // …and the enclosing component still owns its own later markup, rather
        // than handing everything after the nested one to it.
        expect(ownerOf(decls, afterTag)).toBe('Outer');
        expect(decls.find(d => d.name === 'InnerCard')!.indent).toBeGreaterThan(0);
    });

    it('does not let a one-line constant own the rest of the file', () => {
        const src = [
            'const SEEN_KEY = \'a_key\';',
            'export const Panel = (): React.ReactElement => (<div><p>x</p></div>);',
        ].join('\n');
        const decls = declarations(src);
        expect(ownerOf(decls, src.indexOf('<p>'))).toBe('Panel');
    });

    it('reads prose punctuation inside JSX as prose', () => {
        const src = 'const Card = () => (<p>foo (x</p>);\nconst Next = () => (<b>y</b>);';
        const decls = declarations(src);
        expect(ownerOf(decls, src.indexOf('<b>'))).toBe('Next');
    });

    it('finds no interactive element inside another', () => {
        expect(offenders, offenders.slice(0, 10).join('\n')).toEqual([]);
    });

    it(`attributes ${NESTED_DECLARATIONS} declarations nested inside another body`, () => {
        // Not a debt count: the population the owner map has to get right. It
        // exists so the nested-attribution rule above is known to be load-bearing
        // in this repo, not just in the fixture.
        expect(NESTED_DECLARATIONS).toBeGreaterThan(0);
    });

    /**
     * Interactivity by definition, not by name: the components whose own root element
     * forbids interactive content. Pinned by inventory (2026-10-13) so a wrapper that
     * starts rendering a button shows up as a named change rather than a moved number.
     */
    it('knows a component by what it renders', () => {
        expect([...forbidsRoot].sort().join(',')).toBe(
            'ActionButton,CheckForUpdatesRow,CopyChip,ExportTray,NavTabButton,PinChip,PixelSeat,RailButton,RetryChip,SpeakChip,SupervisorIndicator,ToggleSwitch',
        );
        // This list is a MEASUREMENT, and it moved when the walker learned to skip a
        // `//` comment sitting between attributes (`CustomInstructionsEditor.tsx:194`
        // writes one): the mis-terminated tag had credited `CustomInstructionsEditor`
        // with a button root it does not have (its own root is the scroll `<div>` at
        // `:157`) and hid `PixelSeat`, whose root really is a `<button>` (`:167`).
        // `label` roots are interactive content but not forbidden containers, so they
        // must NOT appear above — a button inside a settings label is legal.
        expect(forbidsRoot.has('FieldLabel')).toBe(false);
        // and a wrapper whose root is a div is not a button either…
        expect(forbidsRoot.has('SelectMenuInner')).toBe(false);
        // …but it does render one, so it may not go inside a button.
        expect(rendersInteractive.has('SelectMenuInner')).toBe(true);
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
        // legal despite looking interactive: a dialog and a label may hold a button
        expect(nestedInteractive('<dialog><button>ok</button></dialog>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<label><button>toggle</button></label>', 'probe.tsx')).toHaveLength(0);
        // but a void interactive element still may not sit inside a button
        expect(nestedInteractive('<button><input type="text" /></button>', 'probe.tsx')).toHaveLength(1);
    });

    /**
     * The apostrophe bug, planted. "Don't" used to open a fake string and every tag
     * after it — including this nested pair — went unread.
     */
    it('reads JSX text as text, not as a string that started somewhere', () => {
        expect(nestedInteractive("<p>Don't close the app</p><button><button>x</button></button>", 'probe.tsx')).toHaveLength(1);
        expect(nestedInteractive("<p>It's fine here</p>", 'probe.tsx')).toHaveLength(0);
        // A real string inside an expression container is still a string: its `<` is
        // not markup, and its quote must not run on past the `}`.
        expect(nestedInteractive("<button>{'a<b'}{'y>z'}</button>", 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<button>{"5 < 6" && "7 > 8"}</button>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive("<p>She's here</p><p>{'x'} and y</p><button><button>n</button></button>", 'probe.tsx')).toHaveLength(1);
    });

    /**
     * The class that really blinded the walk for 200 lines: a regex literal whose
     * body holds quotes or backticks, written the way `UpdateOverlay.tsx` writes it
     * (it strips fenced markdown blocks).
     */
    it('reads a regex literal as a regex, not as three template literals', () => {
        const src = [
            'const strip = (raw: string): string[] => raw',
            '    .replace(/```[\\s\\S]*?```/g, "")',
            '    .split("")',
            '<button><button>x</button></button>',
        ].join('\n');
        expect(nestedInteractive(src, 'probe.tsx')).toHaveLength(1);
        // Division must not be read as a regex either, or `a / b` swallows the line.
        expect(nestedInteractive('const half = total / 2;\n<button><button>x</button></button>', 'probe.tsx')).toHaveLength(1);
        expect(nestedInteractive('const re = /a[b"c]/g;\n<button><button>x</button></button>', 'probe.tsx')).toHaveLength(1);
    });

    /**
     * The capital-letter form of the same bug, which no HTML-name rule can see:
     * `<button>` wrapping a component that IS a button.
     */
    it('catches a component that renders a button placed inside one', () => {
        expect(nestedInteractive('<button><RetryChip /></button>', 'probe.tsx')).toHaveLength(1);
        expect(nestedInteractive('<RetryChip><button>x</button></RetryChip>', 'probe.tsx')).toHaveLength(1);
        expect(nestedInteractive('<button><FadingText text={t} /></button>', 'probe.tsx')).toHaveLength(0);
        expect(nestedInteractive('<div><RetryChip /></div>', 'probe.tsx')).toHaveLength(0);
    });
});
