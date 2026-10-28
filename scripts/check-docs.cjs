#!/usr/bin/env node
/**
 * check-docs — the living documentation gate.
 *
 * Four rules, each with a reach control so a broken scanner cannot report a
 * clean tree:
 *
 *  1. LINKS — every relative link in a live doc resolves to a file in this repo.
 *  2. SYMBOLS — every `path` › `symbol` citation names a file that exists and a
 *     symbol that occurs in it. Line numbers are deliberately not part of the
 *     format: they rot on the next edit, and a doc that has to be re-anchored
 *     every time code moves stops being read.
 *  3. GATES — every `npm run <script>` named in AGENTS.md exists in package.json.
 *  4. NO LINE NUMBERS — a live doc must not cite `path.ts:123`. The plan
 *     register is exempt: it is a dated measurement at a pinned HEAD.
 *
 * "Live docs" are the reading path: AGENTS, README, CONTRIBUTING, docs/README,
 * and docs/{product,architecture,engineering,plan/README,plan/roadmap,plan/decisions}.
 * The research corpus and the plan's dated evidence keep whatever citations
 * they were written with.
 *
 * Run: npm run check:docs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = [
    'AGENTS.md',
    'README.md',
    'CONTRIBUTING.md',
    'docs/README.md',
    'docs/product',
    'docs/architecture',
    'docs/engineering',
    'docs/plan/README.md',
    'docs/plan/roadmap.md',
    'docs/plan/decisions.md',
];

const scriptDirRel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function docsUnder(entry) {
    const abs = path.join(ROOT, entry);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [abs];
    const out = [];
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const p = path.join(abs, e.name);
        if (e.isDirectory()) out.push(...docsUnder(path.relative(ROOT, p)));
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

const DOCS = LIVE.flatMap(docsUnder);
const textCache = new Map();
const textOf = (p) => {
    if (!textCache.has(p)) textCache.set(p, fs.readFileSync(p, 'utf8'));
    return textCache.get(p);
};

// ---- file index for bare filenames -----------------------------------------
const byName = new Map();
(function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', 'dist_electron', '.local-archive', 'android', 'ios', 'docs'].includes(e.name)) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) walk(rel);
        else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(e.name)) {
            const list = byName.get(e.name) || [];
            list.push(rel);
            byName.set(e.name, list);
        }
    }
})('');

const MOVED = new Set(['components', 'services', 'hooks', 'utils', 'constants', 'schemas', 'types', 'lib', 'plugins']);
function resolveSource(tok) {
    tok = tok.replace(/^\.\//, '');
    const cands = [tok];
    const first = tok.split('/')[0];
    if (MOVED.has(first)) cands.push('src/' + tok);
    if (/^(App|index)\.(tsx?|css)$/.test(tok)) cands.push('src/' + tok);
    if (tok.startsWith('src/')) cands.unshift(tok);
    for (const c of cands) {
        const abs = path.join(ROOT, c);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
    }
    const hits = byName.get(tok.split('/').pop()) || [];
    const suffixed = hits.filter((h) => h.endsWith(tok));
    if (suffixed.length === 1) return suffixed[0];
    if (hits.length === 1) return hits[0];
    return null;
}

// ---- rules -----------------------------------------------------------------
const findings = { links: [], symbols: [], gates: [], lineNumbers: [] };
const counts = { docs: DOCS.length, links: 0, symbols: 0, gates: 0 };

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const SYMBOL_RE = /([A-Za-z0-9_./@-]+\.(?:tsx?|jsx?|cjs|mjs))`?\s*›\s*`?([A-Za-z_$][\w$]*)/g;
const LINE_RE = /([A-Za-z0-9_./@-]+\.(?:tsx?|jsx?|cjs|mjs)):(\d{1,5})(?:-\d{1,5})?/g;

function linkResolves(docAbs, target) {
    const clean = target.split('#')[0];
    if (!clean) return true;
    return fs.existsSync(path.resolve(path.dirname(docAbs), clean));
}

function citationVerdict(fileToken, sym) {
    const file = resolveSource(fileToken);
    if (!file) return { ok: false, file: null, reason: 'no file' };
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const re = new RegExp(`\\b${sym.replace(/[$]/g, '\\$&')}\\b`);
    return { ok: re.test(src), file, reason: re.test(src) ? '' : `no ${sym}` };
}

function checkLinks(docPath) {
    const text = textOf(docPath);
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text))) {
        const target = m[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        counts.links++;
        if (!linkResolves(docPath, target)) {
            findings.links.push(`${scriptDirRel(docPath)} → ${target}`);
        }
    }
}

function checkSymbols(docPath) {
    const text = textOf(docPath);
    let m;
    SYMBOL_RE.lastIndex = 0;
    while ((m = SYMBOL_RE.exec(text))) {
        counts.symbols++;
        const verdict = citationVerdict(m[1], m[2]);
        if (!verdict.ok) findings.symbols.push(`${scriptDirRel(docPath)}: ${verdict.file || m[1]} — ${verdict.reason}`);
    }
}

function checkLineNumbers(docPath) {
    if (docPath.includes(`${path.sep}plan${path.sep}`)) return;
    const text = textOf(docPath);
    let m;
    LINE_RE.lastIndex = 0;
    while ((m = LINE_RE.exec(text))) {
        findings.lineNumbers.push(`${scriptDirRel(docPath)}: ${m[0]}`);
    }
}

for (const p of DOCS) {
    checkLinks(p);
    checkSymbols(p);
    checkLineNumbers(p);
}

const AGENTS = textOf(path.join(ROOT, 'AGENTS.md'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let gm;
const GATE_RE = /npm run ([a-z0-9:._-]+)/g;
while ((gm = GATE_RE.exec(AGENTS))) {
    counts.gates++;
    if (!pkg.scripts[gm[1]]) findings.gates.push(`AGENTS.md names a missing script: npm run ${gm[1]}`);
}

// ---- reach controls --------------------------------------------------------
const controls = [];
const control = (name, ok) => { controls.push({ name, ok: !!ok }); };
const AGENTS_ABS = path.join(ROOT, 'AGENTS.md');
control('link resolver accepts a real link', linkResolves(AGENTS_ABS, 'docs/README.md'));
control('link resolver rejects a missing file', !linkResolves(AGENTS_ABS, 'docs/__no_such_doc__.md'));
control('symbol resolver accepts a real citation', citationVerdict('src/App.tsx', 'App').ok);
control('symbol resolver rejects a missing symbol', !citationVerdict('src/App.tsx', '__no_such_symbol__').ok);
control('symbol resolver rejects a missing file', !citationVerdict('src/__no_such_file__.ts', 'App').ok);
control('gate scanner rejects an unknown script', !pkg.scripts['no-such-gate-for-control']);
control('link population is real', counts.links >= 25);
control('symbol population is real', counts.symbols >= 150);

// ---- report ----------------------------------------------------------------
const failedControls = controls.filter((c) => !c.ok);
const failed =
    Object.values(findings).reduce((n, list) => n + list.length, 0) + failedControls.length;

console.log(`docs: ${counts.docs} live files, ${counts.links} relative links, ${counts.symbols} symbol citations, ${counts.gates} gate names`);
for (const [key, list] of Object.entries(findings)) {
    for (const f of list) console.log(`  ${key.toUpperCase()} ${f}`);
}
for (const c of failedControls) console.log(`  CONTROL FAILED ${c.name}`);
console.log(`reach controls: ${controls.length - failedControls.length}/${controls.length} passed`);

if (failed) {
    console.error(`DOC CHECK FAIL — ${failed} finding(s)`);
    process.exit(1);
}
console.log('DOC CHECK OK — links resolve, symbol citations exist, gate names are real, no line-number citations in the live docs.');
