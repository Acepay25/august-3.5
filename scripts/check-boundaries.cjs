#!/usr/bin/env node
/**
 * check-boundaries — the import edges this app promises never to grow back.
 *
 * WHY THIS EXISTS. `AGENTS.md` names the canonical modules and says a second
 * implementation is how the numbers drift, but nothing could see an import
 * that crossed a layer: a service reaching into a component at runtime drags
 * the whole UI (and its libraries) into a path that never renders, and a util
 * reaching up turns a leaf into part of the screen. The compiler accepts all
 * of it. This gate reads every `import` / `export … from` / dynamic `import()`
 * / `require()` with the TypeScript parser and compares the resolved path with
 * a small table of allowed edges.
 *
 * TWO KINDS OF RULE.
 *  - `any`   — not even a type may cross. Used where the layers are different
 *              runtimes (electron/main), or where the lower module is the
 *              vocabulary every implementation imports (types, schemas).
 *  - `value` — a type-only import is erased at build time and is the correct
 *              way to share a shape across a boundary; a value import is not.
 *
 * REACH CONTROL. A scanner that silently stops seeing imports reports `0
 * violations` forever. Before scanning the tree, the same collector runs over
 * an inline fixture with one of each shape and must classify all six — and the
 * file count must clear a floor — or the gate fails as broken rather than
 * green.
 *
 * Usage: node scripts/check-boundaries.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

/** `from` is a repo-relative directory; `to` entries are repo-relative prefixes. */
const RULES = [
    {
        from: 'src/types',
        to: ['src/services', 'src/components', 'src/hooks', 'src/schemas', 'src/constants', 'src/utils'],
        kind: 'any',
        why: 'types are the shared vocabulary; they may not depend on an implementation',
    },
    {
        from: 'src/schemas',
        to: ['src/services', 'src/components', 'src/hooks'],
        kind: 'any',
        why: 'a boundary schema knows shapes, not services or screens',
    },
    {
        from: 'src/utils',
        to: ['src/components'],
        kind: 'any',
        why: 'utils are imported by services; a component import drags the UI into them',
    },
    {
        from: 'src/services',
        to: ['src/components'],
        kind: 'value',
        why: 'a service may take a component TYPE; importing a component VALUE pulls the render layer into a service',
    },
    {
        from: 'src/services',
        to: ['src/hooks'],
        kind: 'value',
        why: 'a service may take a hook TYPE; a hook value is React state, not service logic',
    },
    {
        from: 'src/hooks',
        to: ['src/components'],
        kind: 'value',
        why: 'a hook may take a component TYPE; a component value would invert the render tree',
    },
    {
        from: 'src/components',
        to: ['electron'],
        kind: 'any',
        why: 'the renderer never reaches the desktop main process',
    },
    {
        from: 'shared',
        to: ['src'],
        kind: 'any',
        why: 'shared runs under Electron main and the Vite config; it cannot depend on the app',
    },
    {
        from: 'electron',
        to: ['src'],
        kind: 'any',
        why: 'the desktop shell is a separate runtime from the bundled renderer',
    },
];

/** Files this gate reads. `src` is TypeScript; the two cjs roots are the
 *  cross-runtime modules where a `require('../src/…')` would be fatal at
 *  launch and invisible to tsc. */
const SCAN_ROOTS = ['src', 'shared', 'electron'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist_electron', '.probe-artifacts', '.git', 'test-results']);
const TS_EXT = /\.(ts|tsx)$/;
const CJS_EXT = /\.cjs$/;

const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            out.push(...walk(path.join(dir, entry.name)));
        } else if (entry.isFile() && (TS_EXT.test(entry.name) || CJS_EXT.test(entry.name))) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
};

const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/');

const resolveSpecifier = (fromFile, rawSpec) => {
    const spec = rawSpec.split('?')[0]; // ?raw / ?worker / ?url are Vite suffixes
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.cjs`,
        path.join(base, 'index.ts'),
        path.join(base, 'index.tsx'),
    ];
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile()) return rel(candidate);
        } catch { /* try the next shape */ }
    }
    return null;
};

/** One import/export/require edge, classified. Type-only declarations are
 *  erased at build time; everything else is a runtime edge. */
const collectImports = (filePath, text, scriptKind) => {
    const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
    const found = [];
    const add = (node, spec, kind) => {
        if (!spec) return;
        found.push({
            spec,
            kind,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
    };
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
            const clause = node.importClause;
            let kind = 'value';
            if (clause?.isTypeOnly) kind = 'type';
            else if (clause && ts.isNamedImports(clause.namedBindings ?? {})
                && clause.namedBindings.elements.length > 0
                && clause.namedBindings.elements.every(spec => spec.isTypeOnly)) {
                kind = 'type';
            }
            add(node, node.moduleSpecifier.text, kind);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
            let kind = 'value';
            if (node.isTypeOnly) kind = 'type';
            else if (node.exportClause && ts.isNamedExports(node.exportClause)
                && node.exportClause.elements.length > 0
                && node.exportClause.elements.every(spec => spec.isTypeOnly)) {
                kind = 'type';
            }
            add(node, node.moduleSpecifier.text, kind);
        } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
            const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (dynamicImport || requireCall) add(node, node.arguments[0].text, 'value');
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
};

/** Reach control: the collector must see all six shapes before the tree is
 *  trusted. A scanner that stops seeing `import` reports zero forever. */
const reachControl = () => {
    const fixture = [
        "import { a } from './value';",
        "import type { A } from './type';",
        "import { type A2, b } from './mixed';",
        "import('./dynamic');",
        "const c = require('./cjs');",
        "export type { T } from './exportType';",
    ].join('\n');
    const kinds = collectImports('reach-control.ts', fixture, ts.ScriptKind.TS).map(edge => edge.kind);
    const expected = ['value', 'type', 'value', 'value', 'value', 'type'];
    return {
        ok: kinds.length === expected.length && kinds.every((kind, i) => kind === expected[i]),
        detail: kinds.join(','),
    };
};

const rulesFor = (file) => RULES.filter(rule => file === rule.from || file.startsWith(`${rule.from}/`));

const matchesTarget = (resolved, target) => resolved === target || resolved.startsWith(`${target}/`);

const main = () => {
    const reach = reachControl();
    if (!reach.ok) {
        console.error(`check-boundaries: REACH CONTROL FAILED — the collector classified ${reach.detail}`);
        console.error('The gate is broken, not the tree. Fix collectImports before trusting a green run.');
        process.exit(1);
    }

    const files = SCAN_ROOTS.flatMap(root => {
        const abs = path.join(ROOT, root);
        return fs.existsSync(abs) ? walk(abs) : [];
    });
    const FLOOR = 400;
    if (files.length < FLOOR) {
        console.error(`check-boundaries: only ${files.length} files found (floor ${FLOOR}).`);
        console.error('A scan with a collapsed population reports 0 violations by construction.');
        process.exit(1);
    }

    const violations = [];
    let edges = 0;
    for (const file of files) {
        const fileRel = rel(file);
        const rules = rulesFor(fileRel);
        if (rules.length === 0) continue;
        const scriptKind = TS_EXT.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
        const source = fs.readFileSync(file, 'utf8');
        for (const edge of collectImports(file, source, scriptKind)) {
            const resolved = resolveSpecifier(file, edge.spec);
            if (!resolved) continue; // a bare package or an unresolvable path: tsc's problem
            edges += 1;
            for (const rule of rules) {
                if (!rule.to.some(target => matchesTarget(resolved, target))) continue;
                if (rule.kind === 'value' && edge.kind === 'type') continue;
                violations.push({
                    file: fileRel,
                    line: edge.line,
                    spec: edge.spec,
                    resolved,
                    rule,
                    kind: edge.kind,
                });
                break;
            }
        }
    }

    console.log(`check-boundaries: reach control ${reach.detail}; ${files.length} files, ${edges} relative edges, ${RULES.length} rules.`);
    if (violations.length > 0) {
        for (const v of violations) {
            console.error(`  ${v.file}:${v.line} ${v.kind} import ${v.spec} -> ${v.resolved}`);
            console.error(`    ${v.rule.from} -> ${v.rule.to.join(' / ')} (${v.rule.kind}): ${v.rule.why}`);
        }
        console.error(`\ncheck-boundaries: ${violations.length} violation(s).`);
        process.exit(1);
    }
    console.log('check-boundaries: OK — every rule holds.');
};

main();
