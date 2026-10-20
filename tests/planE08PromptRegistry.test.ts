import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * E-08 — the prompt registry must not restate a prompt.
 *
 * Three registry entries used to carry their OWN copy of the text they
 * shadowed, and the copies had drifted:
 *
 *  · `strategy.summarize_pdf` was 366 characters short and dropped the
 *    mandatory `Family` line, so "Reset to default" in Settings installed a
 *    prompt that made every uploaded strategy parse with no `strategyFamily`
 *    — the field the strategy×regime matrix and the skill attribution read.
 *  · `notebook.note` and `notebook.chat_note` were each 107 characters short
 *    and missing the line that forbids writing into `skills/`, so a reset
 *    installed an override that permitted skill writes.
 *
 * The fix is structural: the registry IMPORTS the constant the call site
 * passes to `getPrompt`, so there is one string and it cannot drift. This
 * file pins that in two ways — the content facts that drifted, and a
 * source-shape gate that fails if anyone re-inlines a copy.
 *
 * It also pins the two ids that were read by a call site but were NOT
 * registry entries (`learning.skill_refine`, `learning.skill_worth`): the
 * Settings editor could neither show nor reset an override for them.
 */

import { PROMPT_REGISTRY } from '../constants/promptRegistry';
import { DEFAULT_SUMMARIZE_PROMPT } from '../services/learning/strategySummarizer';
import { NOTEBOOK_NOTE_FALLBACK, CHAT_NOTE_FALLBACK } from '../services/learning/NotebookWriterService';
import { SKILL_CRAFT_FALLBACK, SKILL_REFINE_FALLBACK } from '../services/learning/SkillCraftService';
import { SKILL_WORTH_FALLBACK } from '../services/learning/skillWorthGate';
import { CHART_SCAN_FALLBACK_PROMPT } from '../services/learning/chartScanSkills';
import { DEFAULT_OCR_PAGE_PROMPT } from '../services/learning/pdfOcrService';

const entry = (id: string) => {
    const found = PROMPT_REGISTRY.find(e => e.id === id);
    expect(found, `${id} is not a registry entry`).toBeTruthy();
    return found!;
};

describe('E-08 — every registry fallback IS the constant it shadows', () => {
    it('the three drifted entries are byte-identical to the live constant', () => {
        expect(entry('strategy.summarize_pdf').fallback).toBe(DEFAULT_SUMMARIZE_PROMPT);
        expect(entry('notebook.note').fallback).toBe(NOTEBOOK_NOTE_FALLBACK);
        expect(entry('notebook.chat_note').fallback).toBe(CHAT_NOTE_FALLBACK);
    });

    it('the entries that were already in sync are still byte-identical', () => {
        expect(entry('learning.skill_craft').fallback).toBe(SKILL_CRAFT_FALLBACK);
        expect(entry('learning.chart_scan').fallback).toBe(CHART_SCAN_FALLBACK_PROMPT);
        expect(entry('strategy.ocr_page').fallback).toBe(DEFAULT_OCR_PAGE_PROMPT);
    });

    it('the summarizer default still demands the Family line (the drift that cost strategyFamily)', () => {
        const text = entry('strategy.summarize_pdf').fallback;
        expect(text).toContain('Family:');
        expect(text).toContain('trend_following');
        expect(text).toContain('market_neutral');
        expect(text).toContain('Family is mandatory');
    });

    it('the notebook defaults still forbid writing into skills/ (the drift that permitted it)', () => {
        for (const id of ['notebook.note', 'notebook.chat_note']) {
            expect(entry(id).fallback, `${id} lost the skills/ prohibition`).toContain('Never write to skills/');
        }
    });
});

describe('E-08 — the registry never restates a prompt', () => {
    const src = readFileSync(join('constants', 'promptRegistry.ts'), 'utf8');

    it('every fallback is an imported identifier, not an inline template', () => {
        // The structural gate: a restated copy is a `fallback: \`…\`` line.
        // Every entry's fallback must be a bare identifier, so the text can
        // only live in the module that owns it.
        const restated = [...src.matchAll(/id: '([a-z0-9._]+)',[\s\S]*?fallback: (`)/g)].map(m => m[1]);
        expect(restated, 'these entries restate their prompt instead of importing it').toEqual([]);
    });

    it('the registry imports every constant it falls back to', () => {
        for (const name of [
            'DEFAULT_SUMMARIZE_PROMPT',
            'NOTEBOOK_NOTE_FALLBACK',
            'CHAT_NOTE_FALLBACK',
            'SKILL_CRAFT_FALLBACK',
            'SKILL_REFINE_FALLBACK',
            'SKILL_WORTH_FALLBACK',
            'CHART_SCAN_FALLBACK_PROMPT',
            'DEFAULT_OCR_PAGE_PROMPT',
        ]) {
            const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);
            expect(imported, `${name} is used as a fallback but not imported`).toBe(true);
        }
    });
});

describe('E-08 — every id the app resolves is a registry entry', () => {
    const ROOTS = ['services', 'utils', 'hooks', 'components', 'constants', 'schemas', 'shared'];
    const SKIP = ['node_modules', '.git', 'dist', 'dist_electron', 'android', 'ios', 'coverage'];

    function sources(): { path: string; text: string }[] {
        const out: { path: string; text: string }[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (e.isDirectory()) {
                    if (!SKIP.includes(e.name)) walk(join(dir, e.name));
                    continue;
                }
                if (!/\.(ts|tsx)$/.test(e.name)) continue;
                const p = join(dir, e.name);
                out.push({ path: p, text: readFileSync(p, 'utf8') });
            }
        };
        for (const r of ROOTS) walk(r);
        out.push({ path: 'App.tsx', text: readFileSync('App.tsx', 'utf8') });
        return out;
    }

    const ALL = sources();
    const registryIds = new Set(PROMPT_REGISTRY.map(e => e.id));

    /** Live prompt ids that are deliberately NOT Settings-editable. Kept in
     *  step with `tests/promptsAreWired.test.ts`'s INTERNAL_PROMPTS — empty
     *  since E-08 promoted the last two (learning.skill_refine,
     *  learning.skill_worth) to registry entries. */
    const INTERNAL_PROMPT_IDS = new Set<string>([]);

    it('no call site resolves an id the Settings editor cannot show or reset', () => {
        const orphans = new Set<string>();
        for (const s of ALL) {
            if (s.path === join('constants', 'promptRegistry.ts')) continue;
            for (const m of s.text.matchAll(/getPrompt\(\s*'([a-z0-9._]+)'/g)) {
                if (!registryIds.has(m[1]) && !INTERNAL_PROMPT_IDS.has(m[1])) {
                    orphans.add(`${m[1]} (${s.path})`);
                }
            }
        }
        expect([...orphans], 'these getPrompt ids are not registry entries').toEqual([]);
    });

    it('the two previously-unregistered ids are now listed', () => {
        expect(registryIds.has('learning.skill_refine')).toBe(true);
        expect(registryIds.has('learning.skill_worth')).toBe(true);
        expect(entry('learning.skill_refine').fallback).toBe(SKILL_REFINE_FALLBACK);
        expect(entry('learning.skill_worth').fallback).toBe(SKILL_WORTH_FALLBACK);
    });
});
