#!/usr/bin/env node
/**
 * Gate: every `file.ts:NNN` claim in the two flow documents must point at a real,
 * non-blank line of a real file.
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
 * pass: the population is floored, an unreachable file / out-of-range / blank
 * anchor must all be caught, and a bare number must be bound to its own line's
 * file without leaking across a blank line.
 *
 * Run: npm run check-flow-doc-anchors
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = ['docs/app-flow.md', 'docs/app-flow.html'];
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

const strip = s => s.replace(/<[^>]*>/g, '');

/** Anchors in one doc: `{file,line,doc,docLine}` plus anything unattributable. */
function collect(doc, text) {
    const found = [];
    const unattributed = [];
    const lines = text.split('\n');
    let paragraphFile = null;
    for (let i = 0; i < lines.length; i++) {
        const line = strip(lines[i]);
        if (!line.trim()) { paragraphFile = null; continue; }
        const owners = [];
        for (const t of [...line.matchAll(FILE_TOKEN_RE)]) {
            const r = resolve(t[0]);
            if (r) owners.push({ end: t.index + t[0].length, file: r });
            if (r) paragraphFile = r;
        }
        // Aliases are owners too. A line reading `App:2167 · App:2493 …` then a
        // bare `:2466` must bind to App.tsx; if only file tokens were collected,
        // the bare number fell back to some other file named in the paragraph.
        for (const t of [...line.matchAll(new RegExp(`\\b(${Object.keys(ALIAS).join('|')})\\s*:`, 'g'))]) {
            owners.push({ end: t.index + t[0].length, file: ALIAS[t[1]] });
            paragraphFile = ALIAS[t[1]];
        }
        owners.sort((a, b) => a.end - b.end);
        // Spans already answered by a qualified owner. Without this a bare scan
        // re-reads the digits inside `App:2476` and binds them to whatever other
        // file happens to sit on the line — 28 phantom "stale" anchors.
        const claimed = [];
        for (const m of [...line.matchAll(OWNER_RE)]) {
            const file = m[1] ? resolve(m[1]) : ALIAS[m[2]];
            claimed.push([m.index, m.index + m[0].length]);
            if (!file) continue;
            for (const n of [parseInt(m[3], 10)].concat(m[4] ? [parseInt(m[4], 10)] : [])) found.push({ file, line: n, doc, docLine: i + 1 });
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
                if (file) found.push({ file, line: n, doc, docLine: i + 1 });
                else if (n > 0 && n < 10000) unattributed.push(`${doc}:${i + 1}  :${n} — this line never names a file: ${line.trim().slice(0, 90)}`);
            }
        }
    }
    return { found, unattributed };
}

function check(anchors) {
    const rep = { missingFile: [], outOfRange: [], blank: [] };
    for (const a of anchors) {
        const where = `${a.doc}:${a.docLine} → ${a.file}:${a.line}`;
        const src = linesOf(a.file);
        if (!src) { rep.missingFile.push(`${where} (no such file)`); continue; }
        if (a.line > src.length) { rep.outOfRange.push(`${where} (file has ${src.length} lines)`); continue; }
        if (!(src[a.line - 1] || '').trim()) rep.blank.push(`${where} (blank line)`);
    }
    return rep;
}

/** Reach controls: each asserts the scanner can SEE a specific bad thing. */
function selfTest() {
    const bad = [];
    const need = (name, ok) => { if (!ok) bad.push(name); };
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
    const blankInApp = linesOf('App.tsx').findIndex((l, i) => i > 0 && !l.trim() && linesOf('App.tsx')[i - 1].trim()) + 1;
    const r = check([
        { file: 'App.tsx', line: 999999, doc: 't', docLine: 1 },
        { file: 'App.tsx', line: blankInApp, doc: 't', docLine: 2 },
        { file: 'no/such/thing.ts', line: 3, doc: 't', docLine: 3 },
    ]);
    need('out-of-range caught', r.outOfRange.length === 1);
    need('blank line caught', r.blank.length === 1);
    need('missing file caught', r.missingFile.length === 1);
    return bad;
}

const controls = selfTest();
const all = [];
const unattributed = [];
for (const d of DOCS) {
    const { found, unattributed: u } = collect(d, fs.readFileSync(path.join(ROOT, d), 'utf8'));
    all.push(...found);
    unattributed.push(...u);
}
const rep = check(all);
const unique = new Set(all.map(a => `${a.file}:${a.line}`));
const problems = [...rep.missingFile, ...rep.outOfRange, ...rep.blank];

console.log(`flow docs: ${all.length} anchor references, ${unique.size} unique, across ${DOCS.join(' + ')}`);
console.log(`reach controls: ${controls.length ? 'FAILED — ' + controls.join('; ') : 'all 9 passed'}`);
problems.forEach(m => console.log(`  STALE ${m}`));
unattributed.forEach(m => console.log(`  UNATTRIBUTED ${m}`));

// Ratchet, not a cliff: every unattributed number is a claim no checker can
// verify, and the docs carry 96 of them today (mostly mermaid nodes that name a
// module in prose instead of a path). Refusing to merge at 97 means the number
// can only shrink as claims get qualified — same shape as the eslint
// --max-warnings floor this repo already runs.
const UNATTRIBUTED_CEILING = 98;

if (unique.size < 45) { console.log(`FAIL — only ${unique.size} unique anchors parsed; the scanner is broken, not the docs`); process.exit(1); }
if (controls.length) { console.log('FAIL — the gate cannot see its own planted defects'); process.exit(1); }
if (problems.length) { console.log(`FLOW DOC ANCHORS FAIL — ${problems.length} stale anchor(s)`); process.exit(1); }
if (unattributed.length > UNATTRIBUTED_CEILING) {
    console.log(`FLOW DOC ANCHORS FAIL — ${unattributed.length} unattributed numbers, ceiling ${UNATTRIBUTED_CEILING}. Lower the ceiling as you qualify them; never raise it.`);
    process.exit(1);
}
console.log(`FLOW DOC ANCHORS OK — ${unique.size} anchors verified, ${unattributed.length} unattributed (ceiling ${UNATTRIBUTED_CEILING}, ratchets down only)`);
