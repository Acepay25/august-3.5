import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The radius tokens are `rounded-control` (8px), `rounded-bubble` (12px) and
 * `rounded-full` — the three legal radii (docs/plans/
 * redesign-plan-claude-chatgpt-haze-2026-10-10.md, Part 3.5). Everything else
 * — `rounded-lg`/`xl`/`2xl`/`md`, bare `rounded`, px literals — is drift from
 * before the tokens existed: 662 sites at this gate's birth, the survivors of
 * the old 650-vs-110 census.
 *
 * Like themeContrast's clipped-text ratchet, this holds the count at or under
 * the baseline so drift can only go DOWN. The sweep onto the tokens is a
 * planned per-surface pass, not this test's job — this test's job is that no
 * new off-token radius ever ships again.
 */

const BASELINE = 662;

const OFF_TOKEN = /rounded-(?!control\b|bubble\b|full\b)[a-z0-9[\]/.%-]*|(?<![-\w])rounded(?![-\w])/g;

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

describe('radius tokens own every non-token radius', () => {
    it(`holds the off-token radius count at or under ${BASELINE}`, () => {
        const offenders: string[] = [];
        let count = 0;
        for (const path of [...walk('components'), 'App.tsx']) {
            if (!path.endsWith('.tsx')) continue;
            const src = readFileSync(path, 'utf8');
            const matches = src.match(OFF_TOKEN) ?? [];
            count += matches.length;
            if (matches.length > 0) {
                offenders.push(`${relative(process.cwd(), path)}: ${matches.length}`);
            }
        }
        expect(count, offenders.sort((a, b) => b.localeCompare(a)).slice(0, 12).join(' | ')).toBeLessThanOrEqual(BASELINE);
    });

    it('really sees an off-token radius when one is typed', () => {
        expect('rounded-lg rounded-xl rounded-2xl rounded-md rounded'.match(OFF_TOKEN)).toHaveLength(5);
        expect('rounded-control rounded-bubble rounded-full'.match(OFF_TOKEN)).toBeNull();
    });
});
