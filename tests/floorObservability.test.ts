import { describe, it, expect } from 'vitest';

// Batch 13 (§10.2 + §10.1): the pure substrates behind floor observability
// and skill citations — audit-line parsing, glyph rendering, slug extraction.

import { deriveSeatWireStates, seatWireGlyphs } from '../utils/floorSeatWire';
import type { DebateRunEvent } from '../types/message';
import { skillSlugsFromRecords } from '../components/chat/SkillCitationChips';

const budget = (detail: string): DebateRunEvent => ({
    at: new Date().toISOString(),
    kind: 'budget',
    detail,
});

const baseInputs = (over: Partial<Parameters<typeof deriveSeatWireStates>[0]> = {}) => ({
    runLog: [] as DebateRunEvent[],
    providerNameToId: { Gemini: 'gemini', 'xAI Grok': 'xai' } as Record<string, string>,
    healthFor: () => undefined,
    cooldownFor: () => 0,
    seatNames: ['Gemini', 'xAI Grok'],
    ...over,
});

describe('deriveSeatWireStates', () => {
    it('parses applied thinking lines (multi-word provider names)', () => {
        const states = deriveSeatWireStates(baseInputs({
            runLog: [
                budget('wire: Gemini opening applied — thinking enabled (effort high)'),
                budget('wire: xAI Grok r2 applied — reasoning_effort=high'),
            ],
        }));
        expect(states['Gemini'].thinking).toBe('on');
        expect(states['Gemini'].effort).toBe('high');
        expect(states['xAI Grok'].thinking).toBe('on');
        expect(states['xAI Grok'].effort).toBe('high');
    });

    it('classifies deliberate off, pinned off, fail-closed, and auto no-op', () => {
        const states = deriveSeatWireStates(baseInputs({
            runLog: [
                budget('wire: Gemini clarification applied — thinking disabled (fast answer)'),
                budget('wire: xAI Grok opening no-op — xai route pinned off by a harness wire lesson (re-probe to clear)'),
            ],
        }));
        expect(states['Gemini'].thinking).toBe('off');
        expect(states['Gemini'].pinnedOff).toBe(false);
        expect(states['xAI Grok'].pinnedOff).toBe(true);
        expect(states['xAI Grok'].thinking).toBe('off');
    });

    it('fail-closed no-route reads as off; auto no-knob reads as unknown', () => {
        const states = deriveSeatWireStates(baseInputs({
            runLog: [
                budget('wire: Gemini opening no-op — no verified reasoning route for this wire shape (fail closed)'),
                budget('wire: xAI Grok opening no-op — xai route: effort=auto sends no knob'),
            ],
        }));
        expect(states['Gemini'].thinking).toBe('off');
        expect(states['xAI Grok'].thinking).toBe('unknown');
    });

    it('last line per provider wins (rounds progress)', () => {
        const states = deriveSeatWireStates(baseInputs({
            runLog: [
                budget('wire: Gemini opening applied — thinking enabled (effort high)'),
                budget('wire: Gemini clarification applied — thinking disabled (fast answer)'),
            ],
        }));
        expect(states['Gemini'].thinking).toBe('off');
    });

    it('cooldown benches the seat; recent errors degrade it', () => {
        const states = deriveSeatWireStates(baseInputs({
            cooldownFor: id => (id === 'gemini' ? 5 * 60_000 : 0),
            healthFor: id => (id === 'xai'
                ? { providerId: 'xai', requestCount: 5, errorCount: 3, rateLimitCount: 0, recentErrorAts: ['a', 'b'] }
                : undefined),
        }));
        expect(states['Gemini'].fitness).toBe('benched');
        expect(states['xAI Grok'].fitness).toBe('degraded');
        expect(seatWireGlyphs(states['Gemini'])).toContain('⏸5m');
        expect(seatWireGlyphs(states['xAI Grok'])).toContain('⚠errors');
    });

    it('xhigh maps to max; seats with no evidence still exist', () => {
        const states = deriveSeatWireStates(baseInputs({
            runLog: [budget('wire: Gemini opening applied — reasoning_effort=xhigh')],
        }));
        expect(states['Gemini'].effort).toBe('max');
        expect(states['xAI Grok'].thinking).toBe('unknown');
        expect(seatWireGlyphs(states['xAI Grok'])).toContain('◌wire?');
    });
});

describe('skillSlugsFromRecords', () => {
    it('extracts unique skill slugs from kind:skill sources only', () => {
        const out = skillSlugsFromRecords([
            { stage: 'opening', sources: [
                { path: 'skills/fade-at-resistance', kind: 'skill' },
                { path: 'profile/memory', kind: 'identity' },
            ] },
            { stage: 'rebuttal', sources: [
                { path: 'skills/fade-at-resistance', kind: 'skill' },
                { path: 'skills/higher-lows-holds', kind: 'skill' },
            ] },
        ]);
        expect(out).toEqual([
            { slug: 'fade-at-resistance', stage: 'opening' },
            { slug: 'higher-lows-holds', stage: 'rebuttal' },
        ]);
    });
    it('empty records yield no chips', () => {
        expect(skillSlugsFromRecords([])).toEqual([]);
    });
});
