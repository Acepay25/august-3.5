import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The motion inventory (redesign plan Part 3.7): index.css carried 38
 * @keyframes against a doctrine exception list of 2. This gate holds the
 * COUNT at or under that baseline so no new animation ships while the
 * inventory is unpruned, and fails on duplicate names (two @keyframes with
 * one name is silent override drift). Pruning dead animations toward the
 * exception list is a planned pass, not this test's job.
 */

const BASELINE = 38;

describe('motion inventory', () => {
    const css = readFileSync('index.css', 'utf8');
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);

    it(`holds the @keyframes count at or under ${BASELINE}`, () => {
        expect(names.length).toBeLessThanOrEqual(BASELINE);
    });

    it('declares no keyframe name twice', () => {
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dupes, [...new Set(dupes)].join(', ')).toEqual([]);
    });

    it('really reads the keyframes out of the stylesheet', () => {
        expect(names.length).toBeGreaterThan(0);
        expect(names).toContain('chat-fade-in');
    });
});
