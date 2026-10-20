import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Every entry in `constants/promptRegistry.ts` is offered to the trader in
 * Settings → Prompts as an editable override. An entry whose id no live call
 * site passes to `getPrompt(id, fallback)` is therefore a lie the UI tells: the
 * box accepts text, stores it, validates it, and nothing ever reads it.
 *
 * The debate engine and Accuracy Mode were deleted in stages 17 and 19 and the
 * prompt layer was never re-measured, so 16 of 27 ids are now unreachable —
 * including a moderator prompt still instructing a model to "follow the Accuracy
 * Mode checks" and to emit a debate envelope no parser exists to read.
 *
 * Two directions are pinned, because only one of them can fail safely today:
 *  - a WIRED id must stay wired (this is what a refactor silently breaks: the
 *    entry survives, the call site goes, and the override stops taking effect);
 *  - the UNREACHABLE set is a measured ceiling that ratchets down only. Deleting
 *    an entry lowers it; nothing may raise it.
 */
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
    out.push({ path: 'App.tsx', text: readFileSync('App.tsx', 'utf8') });
    for (const r of ROOTS) walk(r);
    return out;
}

const ALL = sources();
// The registry itself lists ids; it is not a reader of them.
const REGISTRY = readFileSync(join('constants', 'promptRegistry.ts'), 'utf8');
const registryIds = [...REGISTRY.matchAll(/^\s+id: '([a-z0-9._]+)'/gm)].map(m => m[1]);

function readersOf(id: string): string[] {
    const call = new RegExp(`getPrompt\\(\\s*['"]${id.replace('.', '\\.')}['"]`, 'g');
    return ALL.filter(s => s.path !== join('constants', 'promptRegistry.ts') && call.test(s.text)).map(s => s.path);
}

const READERS: Record<string, string[]> = Object.fromEntries(registryIds.map(id => [id, readersOf(id)]));
const WIRED = registryIds.filter(id => READERS[id].length > 0);
const UNREACHABLE = registryIds.filter(id => READERS[id].length === 0);

// 2026-10-19: the ids a real call site reads. A prompt the app composes must
// never lose this wire while its entry is still on screen.
// 2026-10-20 (E-08): `learning.skill_refine` and `learning.skill_worth` joined
// this list — both call sites read them, and neither was a registry entry, so
// the Settings editor could neither show nor reset an override for them.
const MUST_STAY_WIRED = [
    'analysis.master', 'analysis.compact', 'analysis.risk_rules',
    'analysis.memory_enforcement', 'learning.chart_scan', 'learning.skill_craft',
    'learning.skill_refine', 'learning.skill_worth',
    'notebook.chat_note', 'notebook.note', 'strategy.ocr_page', 'strategy.summarize_pdf',
];

/** Live prompt ids that are deliberately NOT Settings-editable. They live in
 *  their service (moving them into the registry would import a module that
 *  already imports `getPrompt`, a cycle). Naming them here makes the inverse
 *  direction testable: a new unregistered live prompt is a failure, not a
 *  silent Settings gap.
 *
 *  EMPTY as of 2026-10-20 (E-08): the last two exemptions were promoted to
 *  registry entries, so the Settings editor can now show and reset them. The
 *  mechanism stays — a future prompt that must stay internal gets named here
 *  with its reason, and the exemption is checked for rot below. */
const INTERNAL_PROMPTS = new Set<string>([
]);

const liveIds = (() => {
    const ids = new Set<string>();
    for (const s of ALL) {
        for (const m of s.text.matchAll(/getPrompt\(\s*['"]([a-z0-9._]+)['"]/g)) ids.add(m[1]);
    }
    return ids;
})();

// Ratchets DOWN only. Each entry deleted from the registry lowers this number.
const UNREACHABLE_CEILING = 0;

describe('every prompt offered in Settings is one the app actually reads', () => {
    it('finds the registry, and the scanner has a population', () => {
        expect(registryIds.length).toBe(12);
        expect(WIRED.length).toBeGreaterThanOrEqual(MUST_STAY_WIRED.length);
        // A scanner that matched nothing would report every id unreachable and
        // still "pass" the ceiling if the ceiling were loose enough.
        expect(UNREACHABLE.length).toBeLessThan(registryIds.length);
    });

    it('proves the scanner reads a real call site, not a name mention', () => {
        expect(READERS['analysis.master']).toContain(join('services', 'providers', 'GenericAnalysisService.ts'));
        expect(READERS['notebook.note']).toContain(join('services', 'learning', 'NotebookWriterService.ts'));
        // The negative arm: an id nobody can have wired must report no reader.
        expect(readersOf('debate.definitely-not-a-prompt')).toEqual([]);
    });

    it.each(MUST_STAY_WIRED)('%s keeps the call site that passes it to getPrompt', (id) => {
        expect(READERS[id], `${id} is still listed in Settings but no code reads it`).not.toHaveLength(0);
    });

    it('the wired set is the whole registry', () => {
        // Guards against adding a call site without naming it above: the moment
        // a prompt becomes reachable it must be listed as must-stay-wired.
        expect(WIRED.slice().sort()).toEqual(MUST_STAY_WIRED.slice().sort());
    });

    it('every live getPrompt id is registered or explicitly internal', () => {
        // The forward direction above catches an entry with no reader. This is
        // the reverse: a call site reading an id nobody registered is a prompt
        // the trader cannot see or override, which the registry's own doc
        // promises. Internal ids are named above with their reason.
        const unaccounted = [...liveIds]
            .filter(id => !registryIds.includes(id) && !INTERNAL_PROMPTS.has(id))
            .sort();
        expect(unaccounted).toEqual([]);
    });

    it('the internal list is still live (an exemption must not rot)', () => {
        for (const id of INTERNAL_PROMPTS) {
            expect(liveIds.has(id), `${id} is exempt from the registry but no call site reads it`).toBe(true);
            expect(registryIds, `${id} is now registered; remove the internal exemption`).not.toContain(id);
        }
    });

    it(`reports the unreachable prompt entries against a ceiling that ratchets down only`, () => {
        const report = UNREACHABLE.map(id => `  ${id} -> ${REGISTRY.split('\n').find(l => l.includes(`id: '${id}'`))?.trim() ?? '?'}`);
        // Printed every run, not just on breach: a list that only appears when
        // it fails is a list nobody reads.
        console.log(`unreachable prompt entries (${UNREACHABLE.length}/${registryIds.length}, ceiling ${UNREACHABLE_CEILING}):\n${report.join('\n')}`);
        expect(UNREACHABLE.length, 'never raise this ceiling — delete the entry or wire the id').toBeLessThanOrEqual(UNREACHABLE_CEILING);
    });
});
