#!/usr/bin/env node
/**
 * Gate: every `file.ts:NNN` claim in the two flow documents must point at a real
 * line of a real file that holds what the doc says it holds.
 *
 * Three tiers, added in that order as each weakness was demonstrated:
 *  1. resolution — the file exists and the number is in range, and the line is not
 *     blank. Every anchor must name its file on its own line (ceiling 0).
 *  2. comment lines — a citation landing on a comment proves nothing about the
 *     construct it names.
 *  3. symbol proximity — when the doc line names exactly one symbol and cites
 *     exactly one anchor, the cited line (or the two above it) must contain it.
 *
 * Tiers 2 and 3 exist because "non-blank" is a byte property, not a claim about
 * content: in one day three citations survived tier 1 while pointing at the wrong
 * thing (`boot-probe.cjs:120` landed on the comment under the wait,
 * `smoke.spec.ts:55` on a different assertion, `types/message.ts:322` shifted 28
 * lines when the type lost fields). They ship as measured ceilings that ratchet
 * down only — see COMMENT_CEILING — because a gate that is red on the day it is
 * written gets switched off rather than fixed. Both target 0.
 *
 * A doc line number is a claim, not a citation. These docs carry ~60 of them and
 * went stale twice during the debate deletion; a third pass found six anchors
 * written as a bare `:874`, whose filename sat earlier in the paragraph — the
 * shape a naive scanner never sees. So attribution here is positional: the nearest
 * owner token to the LEFT of each number on its own line, falling back to that
 * paragraph's file only when the line carries none.
 *
 * The controls run on every invocation, because a scanner whose regex stops
 * matching reports zero anchors and zero problems, which looks exactly like a
 * pass: the population is floored, an unreachable file / out-of-range / blank /
 * comment anchor must all be caught, the symbol rule must catch a wrong line AND
 * pass a right one, and a bare number must be bound to its own line's file
 * without leaking across a blank line.
 *
 * Run: npm run check-flow-doc-anchors
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// The stage ledger is scanned too: it carries file:line claims about the code it
// is deleting, and an unchecked one ages faster than the flow doc's because the
// ledger is written the same day the code moves.
const DOCS = ['AGENTS.md', 'docs/app-flow.md', 'docs/app-flow.html', 'docs/plans/debate-deletion-status.md'];
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'dist_electron', 'android', 'ios', 'coverage', '.probe-artifacts', '.github'];
// The printable view cites the root component as `App:2445`.
const ALIAS = { App: 'App.tsx' };
const OWNER_RE = new RegExp(`(?:([A-Za-z0-9_\\-./@]+\\.(?:tsx?|jsx?|cjs|mjs))|\\b(${Object.keys(ALIAS).join('|')})\\b)\\s*:\\s*(\\d{1,5})(?:\\s*-\\s*(\\d{1,5}))?`, 'g');
const BARE_RE = /(?<![\w.]):\s?(\d{1,5})(?:\s*-\s*(\d{1,5}))?/g;
const FILE_TOKEN_RE = /[A-Za-z0-9_\-./@]+\.(?:tsx?|jsx?|cjs|mjs)/g;

const INDEX = { byName: {} };
(function build(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (!e.isDirectory()) {
            if (/\.(tsx?|jsx?|cjs|mjs)$/.test(e.name)) (INDEX.byName[e.name] ||= []).push(dir ? `${dir}/${e.name}` : e.name);
            continue;
        }
        if (SKIP_DIRS.includes(e.name)) continue;
        build(dir ? `${dir}/${e.name}` : e.name);
    }
})('');

function resolve(token) {
    const direct = token.replace(/^\.?\//, '');
    const p = path.join(ROOT, direct);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return direct;
    const hits = INDEX.byName[direct.split('/').pop()] || [];
    if (hits.length === 1) return hits[0];
    const suffixed = hits.filter(h => h.endsWith(direct));
    if (suffixed.length === 1) return suffixed[0];
    return null;
}

const lineCache = new Map();
function linesOf(file) {
    if (!lineCache.has(file)) {
        const p = path.join(ROOT, file);
        lineCache.set(file, fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : null);
    }
    return lineCache.get(file);
}

// A tag is a gap in the text, so it becomes a space — and it must be padded to the tag's own
// length, not collapsed to one character. Deleting a tag outright spliced the label onto the
// citation beside it (12 flow-doc citations became unresolvable tokens and were skipped, not
// checked); collapsing to one space fixes that but makes the stripped line shorter than the raw
// one, so the raw span offsets that symbol pairing needs stop being comparable to the stripped
// offsets the anchor loops use. Pad to length and both coordinate spaces coincide by construction.
const strip = s => s.replace(/<[^>]*>/g, m => " ".repeat(m.length));

/**
 * The symbol a doc line claims its citation points at, when the line names
 * exactly one.
 *
 * A citation that is non-blank but holds something else is the failure this gate
 * could not see, and it fired three times in one day: `boot-probe.cjs:120`
 * drifted onto the comment under the wait, `smoke.spec.ts:55` landed on a
 * different assertion, and `types/message.ts:322` shifted by 28 lines when the
 * type lost fields. Non-blank is a byte property, not a claim about content.
 *
 * So when the doc line itself names a symbol — in backticks, or a `<code>` span —
 * the cited line must contain it, or the declaration must sit up to two lines
 * above (how a function header or a field comment reads). Exactly one candidate
 * on the line, or none: a line that names two files and two symbols cannot be
 * matched positionally without inventing findings, and inventing findings is what
 * the attribution rule below refuses.
 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)?$/;
function symbolOf(rawLine) {
    const spans = [...rawLine.matchAll(/`([^`\n]+)`|<code>([^<]+)<\/code>/g)].map(m => (m[1] ?? m[2]).trim());
    const cands = [];
    for (const s of spans) {
        const tok = s.includes(':') ? s.split(':')[0].trim() : s;
        if (!IDENT_RE.test(tok)) continue;
        if (/\.(tsx?|jsx?|cjs|mjs)$/.test(tok)) continue;
        const leaf = tok.includes('.') ? tok.split('.').pop() : tok;
        if (leaf && !cands.includes(leaf)) cands.push(leaf);
    }
    return cands.length === 1 ? cands[0] : null;
}

/**
 * Anchors inside a `backtick` / <code> span, each paired with the identifier
 * written immediately before its file token.
 *
 * This is the coverage the line-level rule could not have: the docs cite in the
 * shape `symbol path:NNN`, several per line, and `symbolOf` returns null for any
 * line naming more than one symbol — so section H's 55 arrow rows were checked
 * for resolution and never for content, which is exactly the blind spot the
 * review called "not verified". Pairing inside the span follows the SHAPE (the
 * symbol is the token the author put beside the path) instead of the layout, so
 * a wrapped paragraph or a crowded table row cannot disarm it, and prose words
 * outside a span are not mistaken for claims.
 */
function spanAnchors(rawLine) {
    const out = [];
    for (const sp of rawLine.matchAll(/`([^`\n]+)`|<code>([^<]+)<\/code>/g)) {
        const txt = sp[1] ?? sp[2];
        for (const a of txt.matchAll(OWNER_RE)) {
            const file = a[1] ? resolve(a[1]) : ALIAS[a[2]];
            if (!file) continue;
            const t = txt.slice(0, a.index).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
            const sym = t && t[1].length > 2 && !/\.(tsx?|jsx?|cjs|mjs)$/.test(t[1]) ? t[1] : null;
            for (const n of [parseInt(a[3], 10)].concat(a[4] ? [parseInt(a[4], 10)] : [])) {
                out.push({ file, line: n, sym, doc: null, docLine: 0 });
            }
        }
    }
    return out;
}

/** Anchors in one doc: `{file,line,doc,docLine,sym}` plus anything unattributable. */
function collect(doc, text) {
    const found = [];
    const spanned = [];
    const unattributed = [];
    const missing = [];
    let carrySym = null;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = strip(lines[i]);
        if (!line.trim()) { carrySym = null; continue; }
        // The arrow list is written "`path:NNN`, `symbol` at" and puts the
        // symbol's own citation on the NEXT line. So a line that ENDS on a
        // connector owns no symbol for its own number: its number belongs to the
        // previous line's symbol, and its symbol is carried forward. The
        // connector test must allow the closing backtick that sits before "at" —
        // requiring a word character there is what made the first attempt inert.
        const symOwn = symbolOf(lines[i]);
        // The connector must be a WORD, not a suffix: the shipped test had no boundary,
        // so "`…` does read it. That" matched the `at` inside "That" and the row was
        // treated as dangling for a reason that has nothing to do with a connective.
        // Requiring whitespace before at|is|to kills that class and cannot touch the
        // real shape, "`SYM` at", where the backtick is followed by a space. Arrows and
        // a bare colon are standalone already, so they need no boundary.
        const dangling = !!symOwn && /(?:\s(?:at|is|to)\b|[→–:]|->)[ \t]*$/i.test(line.trim());
        const sym = dangling ? carrySym : (symOwn ?? carrySym);
        carrySym = dangling ? symOwn : null;
        const owners = [];
        for (const t of [...line.matchAll(FILE_TOKEN_RE)]) {
            const r = resolve(t[0]);
            if (r) owners.push({ end: t.index + t[0].length, file: r });
        }
        // Aliases are owners too. A line reading `App:2167 · App:2493 …` then a
        // bare `:2466` must bind to App.tsx; if only file tokens were collected,
        // the bare number fell back to some other file named in the paragraph.
        for (const t of [...line.matchAll(new RegExp(`\\b(${Object.keys(ALIAS).join('|')})\\s*:`, 'g'))]) {
            owners.push({ end: t.index + t[0].length, file: ALIAS[t[1]] });
        }
        owners.sort((a, b) => a.end - b.end);
        // Spans already answered by a qualified owner. Without this a bare scan
        // re-reads the digits inside `App:2476` and binds them to whatever other
        // file happens to sit on the line — 28 phantom "stale" anchors.
        const claimed = [];
        for (const m of [...line.matchAll(OWNER_RE)]) {
            const file = m[1] ? resolve(m[1]) : ALIAS[m[2]];
            claimed.push([m.index, m.index + m[0].length]);
            if (!file) {
                // A citation to a file that is not in the tree used to be DROPPED here:
                // collect() skipped it, so check() never saw it and rep.missingFile could
                // only fire for a file that resolved at collect time and vanished during
                // the run — which is never. Deleted-file citations therefore passed while
                // the doc claimed a line number in a file that no longer exists. Measured
                // instance: the ledger cites verdictFinalizer.ts:645 and that file is gone.
                missing.push(`${doc}:${i + 1}  ${m[0]} — no such file in the tree (a deleted file's line number is not evidence)`);
                continue;
            }
            for (const n of [parseInt(m[3], 10)].concat(m[4] ? [parseInt(m[4], 10)] : [])) found.push({ file, line: n, doc, docLine: i + 1, sym });
        }
        const inside = (pos) => claimed.some(([a, b]) => pos >= a && pos < b);
        for (const m of [...line.matchAll(BARE_RE)]) {
            if (inside(m.index)) continue;
            const before = m.index;
            const owner = owners.filter(o => o.end <= before).pop();
            // Deliberately NO guessing. An identifier on the line (`SurfaceSwitch
            // :2176`) does not prove the number lives in that file — md:31 meant
            // App.tsx:2167 — so a name-based fallback would let the gate invent
            // findings. A number whose line never names a path is reported
            // unattributed instead, and the ceiling below ratchets that count.
            const file = owner ? owner.file : null;
            for (const n of [parseInt(m[1], 10)].concat(m[2] ? [parseInt(m[2], 10)] : [])) {
                if (file) found.push({ file, line: n, doc, docLine: i + 1, sym });
                else if (n > 0 && n < 10000) unattributed.push(`${doc}:${i + 1}  :${n} — this line never names a file: ${line.trim().slice(0, 90)}`);
            }
        }
        for (const a of spanAnchors(lines[i])) spanned.push({ ...a, doc, docLine: i + 1 });
    }
    return { found, spanned, unattributed, missing };
}

function check(anchors) {
    const rep = { missingFile: [], outOfRange: [], blank: [], comment: [], commentOk: [], symMiss: [] };
    for (const a of anchors) {
        const where = `${a.doc}:${a.docLine} → ${a.file}:${a.line}`;
        const src = linesOf(a.file);
        if (!src) { rep.missingFile.push(`${where} (no such file)`); continue; }
        if (a.line > src.length) { rep.outOfRange.push(`${where} (file has ${src.length} lines)`); continue; }
        const at = (src[a.line - 1] || '').trim();
        if (!at) { rep.blank.push(`${where} (blank line)`); continue; }
        // A citation never lands on a comment: the comment is prose ABOUT code, so
        // pointing at it proves nothing about the construct it describes.
        // EXEMPTION, shaped not laid out: sometimes the comment IS the claim — the
        // ledger cites two of them to record that they assert something false. Then a
        // code line would be the wrong anchor. So a citation to a comment is accepted
        // only when the doc line itself calls it a comment, and every such case is
        // printed, because an exemption nobody can see is just a blind spot.
        if (/^(\/\/|\/?\*)/.test(at)) {
            // selfTest cites a synthetic label ('t'), not a file, so linesOf can
            // legitimately return null here; no exemption without a real doc line.
            const docLines = linesOf(a.doc) || [];
            const docLineText = docLines[a.docLine - 1] || '';
            if (/\bcomments?\b/i.test(docLineText)) { rep.commentOk.push(`${where} (cited AS a comment: ${at.slice(0, 48)})`); continue; }
            rep.comment.push(`${where} (comment line: ${at.slice(0, 60)})`); continue;
        }
        if (a.sym) {
            const win = src.slice(Math.max(0, a.line - 3), a.line).join('\n');
            // Match the way the docs actually name things: case-insensitively, as a
            // sub-token (`NavRail` inside `setIsNavRailExpanded`), and in the SCREAMING
            // spelling of a camelCase constant (`chatSurfaceSystemPrompt` is declared
            // `CHAT_SURFACE_SYSTEM_PROMPT`). A check that fails on those is not
            // finding stale anchors; it is an always-red rule that gets switched off.
            const snake = a.sym.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
            if (!new RegExp(`${a.sym}|${snake}`, 'i').test(win)) {
                rep.symMiss.push(`${where} names \`${a.sym}\`; it is not on that line nor the two above (${at.slice(0, 64)})`);
            }
        }
    }
    return rep;
}

/** Reach controls: each asserts the scanner can SEE a specific bad thing. */
function selfTest() {
    const bad = [];
    let ran = 0;
    const need = (name, ok) => { ran++; if (!ok) bad.push(name); };
    selfTest.ran = () => ran;
    const sample = [
        'Qualified hooks/useSurface.ts:24 here and then :16 on the same line.',
        '',
        'A fresh paragraph with a bare :999999 of its own.',
        '',
        'Alias form App:189 and App:2167.',
    ].join('\n');
    const got = collect('t', sample).found.map(a => `${a.file}:${a.line}`);
    need('qualified anchor read', got.includes('hooks/useSurface.ts:24'));
    need('same-line bare number inherits that line’s file', got.includes('hooks/useSurface.ts:16'));
    need('no leak across a blank line', !got.some(x => x.startsWith('hooks/useSurface.ts:999999')));
    need('App: alias resolves to App.tsx', got.includes('App.tsx:189') && got.includes('App.tsx:2167'));

    // The span view needs its own reach control: a pairing regex that stopped
    // matching would report zero symbol findings on the arrow table and look
    // identical to a pass. Lines are located by measurement, not hardcoded, so
    // this control cannot go stale the way the citations it guards do.
    const pipeSrc = linesOf('hooks/useAnalysisPipeline.ts');
    const symTok = 'streamQuickResponse';
    const goodLine = pipeSrc.findIndex(l => l.includes(symTok + '(')) + 1;
    let badLine = goodLine + 3;
    // The cited line's window is [line-2, line], so a "wrong" line one step below
    // the real one still reads as correct. Plant where NO line in the window
    // carries the token, or the control proves nothing.
    const cleanAt = (n) => n >= 3 && [0, 1, 2].every(o => pipeSrc[n - 1 - o] && pipeSrc[n - 1 - o].trim() && !pipeSrc[n - 1 - o].includes(symTok) && !/^\s*(\/\/|\*|\/\*)/.test(pipeSrc[n - 1 - o]));
    while (badLine < pipeSrc.length && !cleanAt(badLine)) badLine++;
    const sp = collect('t', '`' + symTok + ' hooks/useAnalysisPipeline.ts:' + goodLine + '` streams it, and `' + symTok + ' hooks/useAnalysisPipeline.ts:' + badLine + '` does not.').spanned;
    need('span view pairs a symbol with its own citation', sp.filter(a => a.sym === symTok).length === 2);
    const spRep = check(sp.map((a, k) => ({ ...a, doc: 't', docLine: k + 1 })));
    need('a planted wrong span pairing is caught', spRep.symMiss.length === 1 && spRep.symMiss[0].includes(':' + badLine));
    need('the correct half of that planted pair is not reported', !spRep.symMiss.some(m => m.includes(':' + goodLine)));

    // Forward binding, in both directions, because "the count did not move" is
    // how an inert rule hides: the arrow list writes "`path:X`, `SYM` at" with the
    // symbol in its OWN span, and puts that symbol's real citation on the NEXT
    // line. So a row pairing X with SYM is wrong and must not be reported, while
    // the next line's number inherits SYM and must be checked against it. The
    // fixtures are written the way the docs are written: a symbol sharing a span
    // with a path is not a symbol claim at all, and an earlier draft of this
    // control used exactly that, so its "accurate row" arm passed vacuously.
    const fwdTrue = [
        '`hooks/useAnalysisPipeline.ts:' + badLine + '` runs first, and `' + symTok + '` at',
        '`hooks/useAnalysisPipeline.ts:' + goodLine + '`, which is where it is declared.',
    ].join('\n');
    const fwdWrong = [
        '`hooks/useAnalysisPipeline.ts:' + goodLine + '` runs first, and `' + symTok + '` at',
        '`hooks/useAnalysisPipeline.ts:' + badLine + '`, which is somewhere else entirely.',
    ].join('\n');
    const fwdBound = collect('t', fwdTrue).found;
    need('the forward fixture does pair the symbol with the NEXT line', fwdBound.some(a => a.sym === symTok && a.line === goodLine));
    const fwdRep = check(fwdBound.map((a, k) => ({ ...a, doc: 't', docLine: k + 1 })));
    need('a forward-bound row that is accurate reports nothing', fwdRep.symMiss.length === 0);
    const wrRep = check(collect('t', fwdWrong).found.map((a, k) => ({ ...a, doc: 't', docLine: k + 1 })));
    need('a forward-bound row that is wrong is caught', wrRep.symMiss.length === 1 && wrRep.symMiss[0].includes(':' + badLine));

    // A connector is a WORD, not a suffix. The shipped test had no boundary, so a row
    // that merely wraps onto "That" was read as dangling and LOST its own pairing —
    // 42 doc lines end in that|this|into|seat|analysis, and one of those absences was
    // hiding a real stale citation. This control fails under the unbounded regex and
    // passes under `\sat\b`, which is the only reason the difference is visible at all.
    const suffixArm = [
        '`' + symTok + '` was reported unread, and `hooks/useAnalysisPipeline.ts:' + goodLine + '` reads it. That',
        '`hooks/useAnalysisPipeline.ts:' + badLine + '` is a different row entirely.',
    ].join('\n');
    const sBound = collect('t', suffixArm).found;
    need('a row wrapping onto "That" still owns its own symbol', sBound.some(a => a.line === goodLine && a.sym === symTok));
    need('and does not hand that symbol to the next row', !sBound.some(a => a.line === badLine && a.sym === symTok));
    const blankInApp = linesOf('App.tsx').findIndex((l, i) => i > 0 && !l.trim() && linesOf('App.tsx')[i - 1].trim()) + 1;
    // The deleted-file branch must be PROVEN reachable: it lives in collect(), not check(),
    // so the existing `no such file caught` control (which calls check() directly) would keep
    // passing even if collect() went back to swallowing these. One planted citation, one
    // finding, or this rule is invisible exactly like the old one was.
    need('collect() reports a citation to a file that is not in the tree',
        collect('t', 'See `services/trade/definitely-not-here.ts:12` for it.').missing.length === 1);
    const r = check([
        { file: 'App.tsx', line: 999999, doc: 't', docLine: 1 },
        { file: 'App.tsx', line: blankInApp, doc: 't', docLine: 2 },
        { file: 'no/such/thing.ts', line: 3, doc: 't', docLine: 3 },
    ]);
    need('out-of-range caught', r.outOfRange.length === 1);
    need('blank line caught', r.blank.length === 1);
    need('missing file caught', r.missingFile.length === 1);

    // The two checks added on 2026-10-19, after three citations survived the
    // non-blank rule while pointing at the wrong construct. Planted against real
    // lines, so a future edit that stops classifying comments or stops matching
    // the named symbol fails here rather than silently passing the docs.
    const commentLine = linesOf('App.tsx').findIndex(l => /^\s*(\/\/|\*|\/\*)/.test(l)) + 1;
    const codeLine = linesOf('App.tsx').findIndex(l => /^\s*(export )?(const|function|class)\s/.test(l)) + 1;
    const rc = check([
        { file: 'App.tsx', line: commentLine, doc: 't', docLine: 1 },
        { file: 'App.tsx', line: codeLine, doc: 't', docLine: 2, sym: 'noSuchConstructAnywhere' },
    ]);
    need('comment line caught', rc.comment.length === 1);
    need('named symbol missing from the cited line caught', rc.symMiss.length === 1);
    // …and the positive arms: the SAME line with the symbol the file really
    // declares there must pass, and a symbol named on a comment line must still be
    // seen, or the rule is an always-fail gate nobody can satisfy.
    const codeText = (linesOf('App.tsx')[codeLine - 1] || '').trim();
    const realSym = (codeText.match(/\b([A-Za-z_$][A-Za-z0-9_$]{3,})\b/) || [])[1];
    need('a real symbol on its own line passes',
        !!realSym && check([{ file: 'App.tsx', line: codeLine, doc: 't', docLine: 3, sym: realSym }]).symMiss.length === 0);
    const cmtText = (linesOf('App.tsx')[commentLine - 1] || '').trim();
    const cmtSym = (cmtText.match(/\b([A-Za-z_$][A-Za-z0-9_$]{4,})\b/) || [])[1];
    need('a symbol named inside the cited comment is still matched',
        !!cmtSym && check([{ file: 'App.tsx', line: commentLine, doc: 't', docLine: 4, sym: cmtSym }]).symMiss.length === 0);
    return bad;
}

const controls = selfTest();
const TOTAL_CONTROLS = selfTest.ran();
const all = [];
const spanIndex = new Map();
const unattributed = [];
const missingRefs = [];
for (const d of DOCS) {
    const { found, spanned, unattributed: u, missing: mi } = collect(d, fs.readFileSync(path.join(ROOT, d), 'utf8'));
    all.push(...found);
    for (const s of spanned) spanIndex.set(s.doc+":"+s.docLine+":"+s.file+":"+s.line, s.sym);
    unattributed.push(...u);
    missingRefs.push(...mi);
}
// A symbol is only attributed to a citation when its doc line carries exactly one
// of each. `App.tsx:2532 · App.tsx:2560 · onAnalyze · onRunAnalysis` names two
// anchors and two symbols, and pairing them by order is inventing a finding — the
// same reason bare numbers are never guessed below.
{
    const perLine = new Map();
    for (const a of all) perLine.set(`${a.doc}:${a.docLine}`, (perLine.get(`${a.doc}:${a.docLine}`) || 0) + 1);
    for (const a of all) {
        if (perLine.get(`${a.doc}:${a.docLine}`) === 1) continue;
        // The line view gives up on a crowded line, but a citation written as
        // `symbol path:NNN` inside one backtick span is unambiguous by SHAPE, so the
        // span view rescues it. That is what finally covers section H arrow rows —
        // without it, a 55-row table of citations is checked for resolution only.
        a.sym = spanIndex.get(a.doc+":"+a.docLine+":"+a.file+":"+a.line) ?? null;
    }
}
const rep = check(all);
const unique = new Set(all.map(a => `${a.file}:${a.line}`));
const problems = [...rep.missingFile, ...rep.outOfRange, ...rep.blank];
// Two newer checks measure rather than refuse, on purpose. Both found real
// weakness the moment they were written: 61 citations land on a comment line, and
// 23 named a symbol that was not on the cited line (several were genuinely wrong —
// a run of arrow-table rows cites the previous row's line, so `planPanelTurn`
// points at `createDebateMailbox`). A gate that goes red on the day it ships gets
// deleted, not fixed, so each starts at its measured count, ratchets down only,
// and prints its list on every run — the same shape as UNATTRIBUTED_CEILING below.
// Both targets are 0. Never raise either number; fix the citation.
// Seven of the original 23 WERE wrong and are now fixed (`onRunAnalysis`
// App:2532→2485, `onAnalyze` 2628→2581, `runEnsembleEnabled` 556→535,
// `MAX_HISTORY_RUNS` 199→191, `AccountRow` 2675→2637, `allowedTools` 641→634,
// `streamChatWithDeskTools` 3684→3754), which is the proof the rule fires on the
// drift it was written for. The 16 left are a known FALSE-POSITIVE class, not doc
// errors: when one sentence wraps, the symbol sits on the neighbour of its number,
// so pairing by line is unsound. Fix that by zipping symbols to anchors per
// paragraph, and only then drive this to 0.
// THESE TWO COUNTS UNDER-REPORT. Chasing one stale `runEnsembleEnabled …:556`
// turned up four more copies of the same wrong number that neither rule flagged,
// because both exempt the line they cannot read: symMiss skips any doc line
// carrying more than one anchor, and comment/symMiss both look at a single line,
// so a sentence that wraps puts its number out of reach of its symbol. 16 and 68
// are "what the rule can see", not "what is broken" — do not cite them as a
// defect count, and do not answer a doubt about a wrapped sentence by trusting
// this ceiling: re-measure the anchor by hand.
const COMMENT_CEILING = 0;
const SYMMISS_CEILING = 0;

console.log(`flow docs: ${all.length} anchor references, ${unique.size} unique, across ${DOCS.join(' + ')}`);
// A citation naming a file that is not in the tree. The two flow docs describe the app AS IT IS,
// so for them this is a hard zero. The stage ledger's dated entries cite files as they stood at
// that commit — there the FILE NAME is the history and the line number is not a live claim, so
// the count is printed every run and ratchets down only, exactly the policy already used for the
// unattributed numbers in this same file. Before this rule existed, every deleted-file citation
// was dropped in collect() and reported nothing at all: a green gate that could not see a whole
// class of rot.
const missingLive = missingRefs.filter(m => !m.startsWith('docs/plans/'));
console.log(`deleted-file citations: ${missingLive.length} in the live flow docs (must be 0), ${missingRefs.length - missingLive.length} in the dated stage ledger (history; ratchets down only)`);
missingRefs.slice(0, 12).forEach(m => console.log(`  NO SUCH FILE ${m}`));
if (missingLive.length) { console.log(`FLOW DOC ANCHORS FAIL — ${missingLive.length} citation(s) in the live flow docs point at a file that is not in the tree`); process.exit(1); }
console.log(`cited-line quality: ${rep.comment.length} land on a comment line (${rep.commentOk.length} more cite a comment and SAY so — exempt, listed) (ceiling ${COMMENT_CEILING}), ${rep.symMiss.length} miss the symbol their own line names (ceiling ${SYMMISS_CEILING}) — both ratchet to 0`);
console.log(`reach controls: ${controls.length ? 'FAILED — ' + controls.join('; ') : `all ${TOTAL_CONTROLS} passed`}`);
problems.forEach(m => console.log(`  STALE ${m}`));
// The stage ledger is checked for ACCURACY (its anchors must still land on a real,
// non-blank line) but not for ATTRIBUTION: a run log cites TCP ports (`:3000`) and
// planted example numbers (`:1234`) that are not file:line claims at all.
const attributable = unattributed.filter(m => m.startsWith('docs/app-flow.'));
const ledgerBare = unattributed.length - attributable.length;
attributable.forEach(m => console.log(`  UNATTRIBUTED ${m}`));
if (ledgerBare) console.log(`  (${ledgerBare} bare numbers in the stage ledger are ports or examples, not anchors — not counted)`);

// Ratchet, not a cliff. Every line number in the flow docs now names its file,
// so the ceiling is zero: a bare `:NNN` with no path on its line is unverifiable
// by construction, and this gate refuses the merge rather than let one ride in.
// Measured 2026-10-18 after qualifying all 98 that used to be listed here —
// qualifying them is what found six of them pointing at the wrong line.
const UNATTRIBUTED_CEILING = 0;

// 180, not 120: the flow docs alone measure 145, so a floor under that would let
// the stage ledger silently drop out of the scan and still report "OK".
// Both quality lists print on EVERY run, not only when they breach: a counted
// number whose evidence is invisible is not a measurement, and at exactly the
// ceiling the list used to print nothing at all.
rep.commentOk.forEach(m => console.log(`  CITED AS COMMENT ${m}`));
rep.symMiss.forEach(m => console.log(`  SYMBOL MISS ${m}`));
rep.comment.forEach(m => console.log(`  COMMENT LINE ${m}`));

// The flow docs QUOTE this gate's own output ("N anchors verified"), and every
// time a citation was added or a span narrowed the quoted number rotted — twice
// this session. A self-referential claim is still a claim, so the gate checks it.
// SCOPE: the two flow docs only. The stage ledger is exempt for the same reason
// its bare numbers are exempt above — it is a dated run log, and "248 anchors
// verified" there records what the scan measured that day, which is history, not
// a live claim. A doc line that wants to stay current must name itself a flow doc.
const QUOTA_RE = /(\d{2,4})\s+(?:unique\s+)?anchors\s+verified|(\d{2,4})\s+verified,\s*0\b/g;
function selfQuota(text, label, measured) {
    const out = [];
    for (const m of text.matchAll(QUOTA_RE)) {
        const n = parseInt(m[1] ?? m[2], 10);
        if (n !== measured) out.push(`${label} states "${m[0].replace(/\s+/g, ' ')}" while the scan measures ${measured}`);
    }
    return out;
}
// The rule is only a rule if a wrong number is visible to it. Both arms, and the
// second wording shape, planted here rather than trusted to the real docs.
const quotaControls = [
    ...selfQuota('says 97 anchors verified today', 'probe-wrong', 100).length === 1 ? [] : ['wrong self-quota missed'],
    ...selfQuota('says 100 anchors verified today', 'probe-right', 100).length === 0 ? [] : ['correct self-quota flagged'],
    ...selfQuota('(249 verified,\n0 unattributed)', 'probe-tail', 250).length === 1 ? [] : ['ledger-shaped self-quota missed'],
];
const quota = DOCS.filter(d => d.startsWith('docs/app-flow.'))
    .flatMap(d => selfQuota(fs.readFileSync(d, 'utf8'), d, unique.size));
quota.forEach(m => console.log(`  STALE SELF-QUOTA ${m}`));
console.log(`self-quota: ${quota.length} quoted anchor count(s) disagree with the measurement`);

if (unique.size < 180) { console.log(`FAIL — only ${unique.size} unique anchors parsed; the scanner is broken, not the docs`); process.exit(1); }
if (quotaControls.length) { console.log(`FLOW DOC ANCHORS FAIL — the self-quota rule cannot see its own planted numbers: ${quotaControls.join('; ')}`); process.exit(1); }
// An empty population is not a pass. This rule went green once while BOTH flow docs
// had stopped stating any count at all, because the sentences it compares had been
// deleted by a bad restatement — a scanner whose regex matches nothing reports zero.
const QUOTED = /(?:unique )?anchors verified/;
const stating = DOCS.filter(d => d.startsWith('docs/app-flow.'))
    .filter(d => QUOTED.test(fs.readFileSync(d, 'utf8')));
if (stating.length !== 2) {
    console.log(`FLOW DOC ANCHORS FAIL — only ${stating.length} of 2 flow docs state their anchor count; the self-quota rule has an empty population, which is not a pass`);
    process.exit(1);
}
if (quota.length) { console.log(`FLOW DOC ANCHORS FAIL — ${quota.length} doc statement(s) quote an anchor count the gate no longer measures. Re-run and restate; do not loosen the rule.`); process.exit(1); }

// ── Census self-check: a quoted measurement must equal the recipe that made it ──
// The flow docs quote numbers produced by a RECIPE — a grep census, a row count, a
// `git log --diff-filter=D` deletion list. They rotted silently until this file
// policed them: an earlier draft of section D asserted 189/57 and 105/~35, true the
// day they were taken and untrue from the next deletion onward, and the outside
// review could not falsify "one service replacing nine" at all, so it wrote
// "unfalsifiable" and moved on.
// The rule therefore EXECUTES the recipe out of the doc's own sentence rather than
// hard-coding a figure: change the filter and the gate measures the new one; keep a
// stale figure and the gate shows the number the recipe can no longer produce.
// POPULATION for the grep recipes: every .ts/.tsx the anchor index walks (measured
// 996 files — equal to `git ls-files '*.ts' '*.tsx'` and to the documented
// `grep -rE … --include="*.ts" --include="*.tsx" .`, because nothing under
// node_modules/.git carries these tokens). The floor below is what makes that
// equality load-bearing: a walk that quietly found no files would still "measure".
const { execFileSync } = require('child_process');
const SRC = [...new Set(Object.values(INDEX.byName).flat())].filter(p => /\.(ts|tsx)$/.test(p));
function censusOf(pattern) {
    const re = new RegExp(pattern);
    let lines = 0;
    const files = new Set();
    for (const p of SRC) {
        for (const l of fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n')) {
            if (re.test(l)) { lines++; files.add(p); }
        }
    }
    return { lines, files: files.size };
}
// Markup is AROUND the claim, so the printable mirror must bind the same numbers as
// the markdown. But the two formats need different normalization: in a .md a `<` is
// prose or a placeholder (`class <ProviderName>Service`), and a tag-stripping regex
// then eats whole paragraphs — measured, the first version deleted the census
// sentence AND the row-count sentence from the md, and the rule reported a clean
// zero findings over an empty population. Stripping here rather than in strip(),
// which has to preserve offsets for the anchor tiers.
const plain = (t, html) => (html ? t.replace(/<[^>]*>/g, ' ') : t).replace(/[`*]/g, '');
const isHtml = (d) => /\.html$/.test(d);
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordNum(w) {
    const k = String(w).toLowerCase();
    if (ONES[k]) return ONES[k];
    if (TENS[k]) return TENS[k];
    const hy = k.match(/^([a-z]+)-([a-z]+)$/);
    if (hy && TENS[hy[1]] && ONES[hy[2]]) return TENS[hy[1]] + ONES[hy[2]];
    const n = parseInt(k, 10);
    return Number.isNaN(n) ? null : n;
}
// A table's row count, by whichever shape that file uses for the arrow table.
const rowCount = (t) => (t.match(/^\|\s*\d+\s*\|/gm) || []).length || (t.match(/<tr><td>\d+<\/td>/g) || []).length;
function censusClaims(text, label) {
    const out = [];
    const t = plain(text, isHtml(label));
    const recipes = [...t.matchAll(/grep\s+-rE\s+"((?:[^"\\]|\\.)*)"/g)];
    recipes.forEach((r, i) => {
        // Bind to the nearest figure that is still inside THIS recipe's sentence:
        // scanning forward without stopping at the next recipe would let a doc that
        // lost one figure blame the next one for being wrong.
        const stop = i + 1 < recipes.length ? recipes[i + 1].index : Math.min(t.length, r.index + r[0].length + 320);
        const fig = t.slice(r.index + r[0].length, stop).match(/(\d+)\s+lines\s+in\s+(\d+)\s+files/);
        if (!fig) return;                       // a recipe quoted for its lesson, not its number
        const m = censusOf(r[1]);
        if (+fig[1] !== m.lines || +fig[2] !== m.files) {
            out.push(`${label}: grep -rE ${JSON.stringify(r[1])} measures ${m.lines} lines in ${m.files} files; the doc states ${fig[1]} in ${fig[2]}`);
        }
    });
    // \s+ because tag-stripping leaves the gap the <b> stood in: the md reads
    // "becomes **38**" and the mirror "becomes <b>38</b>" → "becomes  38".
    for (const b of t.matchAll(/\bbecomes\s+(\d+)\b/g)) {
        const rs = [...t.slice(0, b.index).matchAll(/grep\s+-rE\s+"((?:[^"\\]|\\.)*)"/g)].pop();
        if (!rs) continue;
        const loose = rs[1].replace(/\\b/g, '');
        if (loose === rs[1]) continue;
        const m = censusOf(loose);
        if (+b[1] !== m.lines) out.push(`${label}: "becomes ${b[1]}" while the same recipe with the word boundary dropped measures ${m.lines}`);
    }
    for (const m of t.matchAll(/arrow\s+table\s+is\s+(\d+)\s+rows/g)) {
        const n = rowCount(text);
        if (+m[1] !== n) out.push(`${label}: states the arrow table is ${m[1]} rows; ${n} are in the file`);
    }
    return out;
}
// "One service replacing nine", made falsifiable: the doc NAMES the removed files, so
// each name must appear in `git log --diff-filter=D` for that directory, and the three
// counts in the sentence (the list, the total, the remainder) and the two counts of
// what is left must all agree with the tree.
function providerClaims(text, label, deleted, left) {
    const out = [];
    const t = plain(text, isHtml(label));
    const head = t.match(/exactly\s+([A-Za-z0-9-]+)\s+provider-client\s+services\s+removed:\s*(.{0,700}?)(?:What\s+is\s+left|$)/s);
    if (!head) return out;
    const names = [...head[2].matchAll(/([A-Za-z][A-Za-z0-9]*)Service(?!\.\w)/g)].map(m => m[1] + 'Service');
    const n = wordNum(head[1]);
    if (n === null) out.push(`${label}: "exactly ${head[1]} provider-client services" is not a countable number`);
    else if (n !== names.length) out.push(`${label}: says exactly ${n} provider-client services were removed but names ${names.length} (${names.join(', ')})`);
    if (deleted) names.forEach(s => { if (!deleted.has(`${s}.ts`)) out.push(`${label}: names ${s} as removed from services/providers/, and no commit deletes it`) });
    const tot = t.match(/([A-Za-z0-9-]+)\s+files\s+in\s+total\s+have\s+been\s+deleted\s+from\s+that\s+directory/);
    if (tot && deleted) {
        const v = wordNum(tot[1]);
        if (v !== deleted.size) out.push(`${label}: says ${v} files in total were deleted from services/providers/; git names ${deleted.size}`);
        const rest = t.match(/the\s+other\s+([A-Za-z0-9-]+)\s+were/);
        if (rest && wordNum(rest[1]) !== deleted.size - names.length) {
            out.push(`${label}: "the other ${rest[1]}" while the list is ${names.length} of ${deleted.size} (so ${deleted.size - names.length})`);
        }
    }
    const leftC = t.match(/left\s+in\s+that\s+directory\s+is\s+([A-Za-z0-9-]+)\s+clients.*?plus\s+([A-Za-z0-9-]+)\s+helpers/s);
    if (leftC) {
        const c = wordNum(leftC[1]), h = wordNum(leftC[2]);
        const clients = left.filter(f => /Service\.ts$/.test(f));
        if (c === null || h === null) out.push(`${label}: the "left in that directory" counts are not countable numbers`);
        else {
            if (c !== clients.length) out.push(`${label}: says ${c} clients remain in services/providers/; ${clients.length} file(s) there end in Service.ts (${clients.join(', ')})`);
            if (c + h !== left.length) out.push(`${label}: says ${c} clients plus ${h} helpers remain; the directory holds ${left.length} files`);
        }
    }
    return out;
}
const LIVE = DOCS.filter(d => d.startsWith('docs/app-flow.'));
const censusControls = [
    ...((() => { const m = censusOf('postMortem'); return censusClaims(`grep -rE "postMortem" . measures ${m.lines} lines in ${m.files} files`, 'probe-right').length === 0 ? [] : ['a correct census figure was flagged']; })()),
    ...((censusClaims('grep -rE "postMortem" . measures 99999 lines in 1 files', 'probe-wrong').length === 1 ? [] : ['a wrong census figure was missed'])),
    ...((censusClaims('grep -rE "postMortem" . is how you size this, the trap is the boundary', 'probe-lesson').length === 0 ? [] : ['a recipe with no figure invented a finding'])),
    // The mirror wraps FIGURES in tags, so a rule that only reads markdown is blind
    // across the whole html copy. Planted with the <b> inside the figure itself:
    // unnormalised, the regex cannot see the number at all.
    ...((censusClaims('<p>grep -rE "postMortem" . measures <b>99999</b> lines in <b>1</b> files</p>', 'docs/app-flow.html').length === 1 ? [] : ['the html mirror is invisible to the census rule'])),
    ...((() => { const b = censusOf('\\.postMortem\\b'); return censusClaims(`grep -rE "\\.postMortem\\b" measures ${b.lines} lines in ${b.files} files`, 'probe-bound-right').length === 0 ? [] : ['a correct boundary census was flagged']; })()),
    ...((() => { const b = censusOf('\\.postMortem\\b'), l = censusOf('\\.postMortem'); return censusClaims(`grep -rE "\\.postMortem\\b" measures ${b.lines} lines in ${b.files} files. Drop the boundary and it becomes ${l.lines}`, 'probe-bound-ok').length === 0 ? [] : ['a correct boundary claim was flagged']; })()),
    ...((censusClaims('grep -rE "\\.postMortem\\b" measures 34 lines in 23 files. Drop the boundary and it becomes 999', 'probe-bound-wrong').length === 1 ? [] : ['a wrong boundary figure was missed'])),
    ...((censusClaims('the arrow table is 3 rows\n| 1 | a | b |\n| 2 | a | b |', 'probe-rows').length === 1 ? [] : ['a wrong row count was missed'])),
    ...((censusClaims('the arrow table is 2 rows\n| 1 | a | b |\n| 2 | a | b |', 'probe-rows-right').length === 0 ? [] : ['a correct row count was flagged'])),
    ...((censusClaims('<table><tr><td>7</td></tr><tr><td>8</td></tr></table>the arrow table is 5 rows', 'docs/app-flow.html').length === 1 ? [] : ['a wrong html row count was missed'])),
    ...((wordNum('Twenty-four') === 24 && wordNum('nine') === 9 && wordNum('47') === 47 && wordNum('forty-two') === 42 ? [] : ['wordNum cannot read a count'])),
    ...((providerClaims('names exactly two provider-client services removed: `AIProviderService` and `NotARealDeletedService`. What is left', 'probe-deleted', new Set(['AIProviderService.ts']), ['a.ts']).some(m => /NotARealDeletedService/.test(m)) ? [] : ['a fabricated deletion name passed'])),
    ...((providerClaims('names exactly one provider-client service removed: `AIProviderService`. What is left', 'probe-deleted-ok', new Set(['AIProviderService.ts']), ['a.ts']).length === 0 ? [] : ['a true deletion name was flagged'])),
    ...((providerClaims('names exactly nine provider-client services removed: `AIProviderService`. What is left. Twenty-four files in total have been deleted from that directory. the other fifteen were. left in that directory is two clients — `GenericProviderService.ts` plus four helpers', 'probe-counts', new Set(['AIProviderService.ts']), ['a.ts']).length >= 3 ? [] : ['a wrong provider count was missed'])),
];
const census = LIVE.flatMap(d => censusClaims(fs.readFileSync(d, 'utf8'), d));
census.forEach(m => console.log(`  STALE CENSUS ${m}`));
let deletedProviders = null, providersSkip = '';
const leftProviders = fs.readdirSync(path.join(ROOT, 'services', 'providers')).filter(f => /\.ts$/.test(f));
try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8' }).trim() === 'true';
    if (shallow) providersSkip = 'SKIPPED (shallow clone: actions/checkout defaults to fetch-depth 1, so history-dependent counts do not exist here)';
    else {
        deletedProviders = new Set(execFileSync('git', ['log', '--diff-filter=D', '--name-only', '--format=', '--', 'services/providers/'],
            { cwd: ROOT, encoding: 'utf8' }).split('\n').map(l => l.trim()).filter(l => l.startsWith('services/providers/') && l.includes('.')).map(l => l.split('/').pop()));
    }
} catch (e) { providersSkip = `SKIPPED (git unreadable: ${e.message.split('\n')[0]})`; }
const providers = deletedProviders
    ? LIVE.flatMap(d => providerClaims(fs.readFileSync(d, 'utf8'), d, deletedProviders, leftProviders))
    : [];
// ── AGENTS.md numbers, measured the same way ─────────────────────────────────
// AGENTS.md is the first file an agent reads, and its citations are scanned above,
// but it also carries counts no rule reached: how many smoke tests Playwright runs,
// the vitest census, and which npm steps exist in one workflow and not the other.
// Each is recomputed from the tree — a claim that cannot be reproduced is a claim
// the gate should refuse, not a sentence someone re-reads by eye.
const AGENTS_FILE = path.join(ROOT, 'AGENTS.md');
function smokeTests() {
    return (fs.readFileSync(path.join(ROOT, 'e2e', 'smoke.spec.ts'), 'utf8').match(/^\s*test\(/gm) || []).length;
}
function trackedTestFiles() {
    return execFileSync('git', ['ls-files', 'tests'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map(l => l.trim()).filter(l => /\.test\.[cm]?[jt]sx?$/.test(l)).length;
}
function wfRuns(rel) {
    return new Set((fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/npm run [a-z0-9:._-]+/g) || [])
        .map(x => x.slice('npm run '.length)));
}
function asymmetry() {
    const ci = wfRuns(path.join('.github', 'workflows', 'ci.yml'));
    const release = wfRuns(path.join('.github', 'workflows', 'release.yml'));
    return { ciOnly: [...ci].filter(x => !release.has(x)), relOnly: [...release].filter(x => !ci.has(x)) };
}
// A step is NAMED only as a whole token: the "test" inside "tests" or "typecheck"
// is not the doc claiming CI has a bare `npm run test` step.
function namesWholeWord(text, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9:._-])' + esc + '($|[^a-z0-9:._-])').test(text);
}
function agentsClaims(atext) {
    const out = [];
    const smoke = smokeTests();
    for (const m of atext.matchAll(/(\d+)\s+smoke tests/g)) {
        if (+m[1] !== smoke) out.push(`AGENTS.md says ${m[1]} smoke tests; e2e/smoke.spec.ts defines ${smoke}`);
    }
    if (smoke === 0) out.push('the smoke census measured 0 tests in e2e/smoke.spec.ts — the scan has no population');
    const testFiles = trackedTestFiles();
    const c = atext.match(/(\d+)\s+tests\s+in\s+(\d+)\s+files:\s*(\d+)\s+pass\s+in\s+(\d+)\s+and\s+(\d+)\s+skip/);
    if (!c) out.push('AGENTS.md no longer states the vitest census in the form the gate can check');
    else {
        const [, t, f, p, pf, sk] = c;
        if (+t !== +p + +sk) out.push(`AGENTS.md census: ${t} tests, but ${p} pass + ${sk} skip = ${+p + +sk}`);
        // The skipped-FILE count is read from the sentence (it defaulted to a
        // hard-coded 1 while one measure file was skipped wholesale; that file
        // went with the analyst-role deletion, so 0 is now a legal state).
        const skipMatch = atext.match(/(\d+)\s+wholly-skipped files?/);
        const skippedFiles = skipMatch ? +skipMatch[1] : 1;
        if (+f !== +pf + skippedFiles) out.push(`AGENTS.md census: ${f} files, but ${pf} pass + ${skippedFiles} wholly-skipped = ${+pf + skippedFiles}`);
        if (+f !== testFiles) out.push(`AGENTS.md census says ${f} test files; git tracks ${testFiles} under tests/`);
    }
    if (testFiles < 400) out.push(`git ls-files tests returned ${testFiles} files; the census has no population to bind to`);
    const { ciOnly, relOnly } = asymmetry();
    // The asymmetry is only a claim while the doc prints its recipe beside it, so
    // the names are checked in that paragraph — not "somewhere in a 160-line file".
    const lines = atext.split('\n');
    const at = lines.findIndex(l => l.includes('comm -13'));
    const window = at < 0 ? '' : lines.slice(at, at + 15).join('\n');
    if (!window) out.push('AGENTS.md no longer quotes the comm -13 recipe, so its workflow-asymmetry sentence binds to nothing');
    // Floor: an empty asymmetry would make the loop below vacuously true.
    if (ciOnly.length + relOnly.length < 4) out.push(`the workflow scan found only ${ciOnly.length + relOnly.length} asymmetric npm steps — the scan is broken, not the doc`);
    for (const n of [...ciOnly, ...relOnly]) {
        if (window && !namesWholeWord(window, n)) out.push(`AGENTS.md no longer names the asymmetric workflow step "${n}" beside its own recipe`);
    }
    return out;
}
// Controls mutate the REAL doc one number at a time. A control built from an
// invented string can pass while the shipped sentence goes unchecked — here the
// population IS this file, so every arm has to be a planted edit to it.
const AGENTS_TEXT = fs.readFileSync(AGENTS_FILE, 'utf8');
const plant = (re, rep) => agentsClaims(AGENTS_TEXT.replace(re, rep));
const agentsArms = [
    { msg: 'a +2 smoke-test count planted in the real sentence passed', check: () => plant(/(\d+)\s+smoke tests/, (m, d) => `${+d + 2} smoke tests`).some(m => /smoke tests; e2e/.test(m)) },
    { msg: 'a census total planted 1 too high passed the arithmetic', check: () => plant(/(\d+)\s+tests\s+in\s+(\d+)\s+files:/, (m, t, f) => `${+t + 1} tests in ${f} files:`).some(m => /pass \+ \d+ skip =/.test(m)) },
    { msg: 'a file count planted 7 off git ls-files passed', check: () => plant(/tests\s+in\s+(\d+)\s+files/, (m, f) => `tests in ${+f + 7} files`).some(m => /git tracks/.test(m)) },
    { msg: 'a per-file pass count planted 1 off passed', check: () => plant(/pass\s+in\s+(\d+)/, (m, pf) => `pass in ${+pf + 1}`).some(m => /wholly-skipped =/.test(m)) },
    { msg: 'deleting the release-only step name from its own paragraph passed', check: () => plant(/`installer-smoke` is the only command/, () => 'the only command').some(m => /no longer names the asymmetric workflow step "installer-smoke"/.test(m)) },
    { msg: 'a doc that stopped naming its own recipe passed', check: () => plant(/comm -13/, () => 'comm -NN').some(m => /no longer quotes the comm -13 recipe/.test(m)) },
];
const agentsControls = agentsArms.filter(a => !a.check()).map(a => a.msg);
// Floor: the arm COUNT is a figure too. An arm quietly deleted from the list above
// would make the pass silent, so the number of planted defects is asserted here.
if (agentsArms.length < 6) agentsControls.push(`only ${agentsArms.length} AGENTS.md arms are planted; a rule with no defect to catch is not a rule`);
if (agentsControls.some((c) => !c)) agentsControls.push('an AGENTS.md control arm produced an empty finding — it asserts nothing');
const agents = agentsClaims(AGENTS_TEXT);
agents.forEach(m => console.log(`  STALE CENSUS ${m}`));
const asym = asymmetry();
console.log(`agents-census: ${agents.length} AGENTS.md claim(s) disagree with the tree; ${agentsControls.length} of ${agentsArms.length} control arms failed — smoke tests ${smokeTests()}, test files ${trackedTestFiles()}, asymmetry ci-only [${asym.ciOnly.join(' ')}] release-only [${asym.relOnly.join(' ')}]`);
providers.forEach(m => console.log(`  STALE CENSUS ${m}`));
const COVER_FLOOR = 52;
const COVER_CITED_FLOOR = 52;
// ── How much of the arrow table can the gate actually SEE? ───────────────────────
// Every row of section H is line-resolved; only a row that writes `symbol path:NNN`
// gives the gate a claim to test. Counting the difference turns "unverified beyond
// the probed subset" into a figure, and the floor below makes it impossible to lose
// coverage silently — a row rewritten without its symbol used to look like progress.
function arrowCoverage() {
    const lines = fs.readFileSync(path.join(ROOT, 'docs', 'app-flow.md'), 'utf8').split('\n');
    const s = lines.findIndex(l => /^## H\b/.test(l));
    const e = lines.findIndex((l, i) => i > s && /^## /.test(l));
    if (s < 0 || e < 0) return { rows: 0, bound: 0, pairs: 0, cited: 0 };
    const rows = lines.slice(s + 1, e).filter(l => /^\|/.test(l) && !/^\|[\s:-]*\|/.test(l)).map(l => l.replace(/^\|[^|]*\|/, '|')).slice(1);
    let bound = 0, pairs = 0, cited = 0;
    for (const l of rows) {
        if (/\.(?:tsx|ts|cjs|js|css|json):\d+/.test(l)) cited++;
        const withSym = spanAnchors(l).filter(a => a.sym).length;
        pairs += withSym;
        if (withSym) bound++;
    }
    return { rows: rows.length, bound, pairs, cited };
}
const cover = arrowCoverage();
// Control: the counter must answer for a planted row and stay silent for a bare one,
// otherwise "N rows bound" is a number about nothing.
const coverControls = [
    ...((spanAnchors('| x | `assemblePipelineMemoryContext hooks/useAnalysisPipeline.ts:1021` |').filter(a => a.sym).length === 1 ? [] : ['the coverage counter cannot pair a symbol with its own citation'])),
    ...((spanAnchors('| x | `App.tsx:2493` |').filter(a => a.sym).length === 0 ? [] : ['a bare citation counted as bound coverage'])),
];
if (cover.bound < COVER_FLOOR) coverControls.push(`arrow-table coverage fell to ${cover.bound} of ${cover.rows} rows (floor ${COVER_FLOOR}): a row that stopped naming its symbol is no longer a check`);
if (cover.cited < COVER_CITED_FLOOR) coverControls.push(`${cover.cited} arrow row(s) cite a file, floor ${COVER_CITED_FLOOR} — a row whose citation was dropped cannot be checked at all`);
console.log(`arrow coverage: ${cover.bound}/${cover.rows} rows pair a symbol with a citation (${cover.pairs} pairs, floor ${COVER_FLOOR}), ${cover.cited} rows cite a file (floor ${COVER_CITED_FLOOR}); ${cover.rows - cover.bound} rows are line-resolved only; ${coverControls.length} coverage control failure(s)`);
const stated = LIVE.filter(d => /lines\s+in\s+\d+\s+files/.test(plain(fs.readFileSync(d, 'utf8'), isHtml(d))));
const rowStated = LIVE.filter(d => /arrow\s+table\s+is\s+\d+\s+rows/.test(plain(fs.readFileSync(d, 'utf8'), isHtml(d))));
console.log(`census: ${census.length} recipe figure(s) disagree with the measurement; ${censusControls.length} census control failure(s) (arms answer only when wrong); ${stated.length}/2 docs quote a grep census, ${rowStated.length}/2 state the table size; providers ${providers.length} finding(s) — ${providersSkip || `git names ${deletedProviders.size} deleted files, ${leftProviders.length} remain`}`);
if (SRC.length < 500) { console.log(`FLOW DOC ANCHORS FAIL — the census walk sees ${SRC.length} source files; a census measured against that is not a measurement`); process.exit(1); }
if (censusControls.some((c) => !c)) censusControls.push('a census control arm produced an empty finding — it asserts nothing');
if (censusControls.length) { console.log(`FLOW DOC ANCHORS FAIL — the census rule cannot see its own planted numbers: ${censusControls.join('; ')}`); process.exit(1); }
// Empty population is not a pass: this is the exact hole that let the self-quota rule
// go green while both docs had stopped stating a count at all.
if (stated.length !== 2 || rowStated.length < 1) {
    console.log(`FLOW DOC ANCHORS FAIL — only ${stated.length} of 2 flow docs quote a grep census and ${rowStated.length} state the table size; the census rule has lost its population`);
    process.exit(1);
}
if (!providersSkip && deletedProviders.size < 20) {
    console.log(`FLOW DOC ANCHORS FAIL — git names only ${deletedProviders.size} deleted files under services/providers/; the deletion census has no population`);
    process.exit(1);
}
if (census.length) { console.log(`FLOW DOC ANCHORS FAIL — ${census.length} doc statement(s) quote a measurement their own recipe no longer produces. Re-run the recipe and restate; do not loosen the rule.`); process.exit(1); }
if (providers.length) { console.log(`FLOW DOC ANCHORS FAIL — ${providers.length} statement(s) about the provider-directory census disagree with git/the tree.`); process.exit(1); }
if (agentsControls.length) { console.log(`FLOW DOC ANCHORS FAIL — the AGENTS.md rule cannot see its own planted numbers: ${agentsControls.join('; ')}`); process.exit(1); }
if (agents.length) { console.log(`FLOW DOC ANCHORS FAIL — ${agents.length} AGENTS.md statement(s) disagree with the tree. Re-measure and restate; do not loosen the rule.`); process.exit(1); }
if (coverControls.length) { console.log(`FLOW DOC ANCHORS FAIL — the arrow-table coverage rule is blind or coverage fell: ${coverControls.join('; ')}`); process.exit(1); }
if (controls.length) { console.log('FAIL — the gate cannot see its own planted defects'); process.exit(1); }
if (problems.length) { console.log(`FLOW DOC ANCHORS FAIL — ${problems.length} stale anchor(s)`); process.exit(1); }
if (rep.symMiss.length > SYMMISS_CEILING) {
    console.log(`FLOW DOC ANCHORS FAIL — ${rep.symMiss.length} citations name a symbol that is not on the cited line (ceiling ${SYMMISS_CEILING}). Fix the citation; never raise the ceiling.`);
    rep.symMiss.slice(0, 15).forEach(m => console.log(`  SYMBOL MISS ${m}`));
    process.exit(1);
}
if (rep.comment.length > COMMENT_CEILING) {
    console.log(`FLOW DOC ANCHORS FAIL — ${rep.comment.length} citations land on a comment line, ceiling ${COMMENT_CEILING}. Move each to the code it names; lower the ceiling as you go.`);
    rep.comment.slice(0, 15).forEach(m => console.log(`  COMMENT LINE ${m}`));
    process.exit(1);
}
if (attributable.length > UNATTRIBUTED_CEILING) {
    console.log(`FLOW DOC ANCHORS FAIL — ${attributable.length} unattributed numbers, ceiling ${UNATTRIBUTED_CEILING}. Lower the ceiling as you qualify them; never raise it.`);
    process.exit(1);
}
console.log(`FLOW DOC ANCHORS OK — ${unique.size} anchors verified, ${attributable.length} unattributed (ceiling ${UNATTRIBUTED_CEILING}, ratchets down only)`);
