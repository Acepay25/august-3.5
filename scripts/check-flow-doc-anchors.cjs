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
const DOCS = ['docs/app-flow.md', 'docs/app-flow.html', 'docs/plans/debate-deletion-status.md'];
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
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = strip(lines[i]);
        if (!line.trim()) continue;
        const sym = symbolOf(lines[i]);
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
            if (!file) continue;
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
    return { found, spanned, unattributed };
}

function check(anchors) {
    const rep = { missingFile: [], outOfRange: [], blank: [], comment: [], symMiss: [] };
    for (const a of anchors) {
        const where = `${a.doc}:${a.docLine} → ${a.file}:${a.line}`;
        const src = linesOf(a.file);
        if (!src) { rep.missingFile.push(`${where} (no such file)`); continue; }
        if (a.line > src.length) { rep.outOfRange.push(`${where} (file has ${src.length} lines)`); continue; }
        const at = (src[a.line - 1] || '').trim();
        if (!at) { rep.blank.push(`${where} (blank line)`); continue; }
        // A citation never lands on a comment: the comment is prose ABOUT code, so
        // pointing at it proves nothing about the construct it describes.
        if (/^(\/\/|\/?\*)/.test(at)) { rep.comment.push(`${where} (comment line: ${at.slice(0, 60)})`); continue; }
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
    const blankInApp = linesOf('App.tsx').findIndex((l, i) => i > 0 && !l.trim() && linesOf('App.tsx')[i - 1].trim()) + 1;
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
for (const d of DOCS) {
    const { found, spanned, unattributed: u } = collect(d, fs.readFileSync(path.join(ROOT, d), 'utf8'));
    all.push(...found);
    for (const s of spanned) spanIndex.set(s.doc+":"+s.docLine+":"+s.file+":"+s.line, s.sym);
    unattributed.push(...u);
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
// weakness the moment they were written: 61 citations land on a comment line and
// 23 name a symbol that is not on the cited line (several are genuinely wrong —
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
const COMMENT_CEILING = 61;
const SYMMISS_CEILING = 16;

console.log(`flow docs: ${all.length} anchor references, ${unique.size} unique, across ${DOCS.join(' + ')}`);
console.log(`cited-line quality: ${rep.comment.length} land on a comment line (ceiling ${COMMENT_CEILING}), ${rep.symMiss.length} miss the symbol their own line names (ceiling ${SYMMISS_CEILING}) — both ratchet to 0`);
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
if (unique.size < 180) { console.log(`FAIL — only ${unique.size} unique anchors parsed; the scanner is broken, not the docs`); process.exit(1); }
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
