import { describe, it, expect } from 'vitest';

// Lens pods (Batch 12, plan §9.1): pod assignment, representative choice,
// transcript-cap scaling, pod-round prompt shape.

import {
    assignPods,
    withTrustRepresentatives,
    verdictTranscriptCap,
    buildPodRoundPrompt,
    formatPodPositionBlock,
    POD_TIER_MIN_SEATS,
} from '../services/providers/debatePods';

describe('assignPods', () => {
    it('maps lens roles to their pods', () => {
        const pods = assignPods(
            ['Macro A', 'Tech A', 'Risk A', 'Macro B', 'Tech B', 'Risk B'],
            n => n.startsWith('Macro') ? 'macro' : n.startsWith('Tech') ? 'technical' : 'risk',
        );
        expect(pods).toHaveLength(3);
        const macro = pods.find(p => p.name === 'macro')!;
        expect(macro.seats).toEqual(['Macro A', 'Macro B']);
    });
    it('round-robins unmarked seats into the least-populated pod, deterministic tie order', () => {
        const pods = assignPods(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
        expect(pods.map(p => p.seats)).toEqual([
            ['S1', 'S4', 'S7'],  // macro claims ties first
            ['S2', 'S5'],
            ['S3', 'S6'],
        ]);
    });
    it('non-pod lens roles (sentiment) round-robin like unmarked seats', () => {
        const pods = assignPods(['A', 'B', 'C', 'D'], n => n === 'A' ? 'sentiment' : 'macro');
        const macro = pods.find(p => p.name === 'macro')!;
        expect(macro.seats).toEqual(['B', 'C', 'D']);
        // A lands in the least-populated pod (technical)
        expect(pods.find(p => p.name === 'technical')!.seats).toEqual(['A']);
    });
    it('drops empty pods', () => {
        const pods = assignPods(['M1', 'M2', 'M3'], () => 'macro');
        expect(pods).toHaveLength(1);
        expect(pods[0].name).toBe('macro');
    });
});

describe('withTrustRepresentatives', () => {
    it('picks the highest-trust seat per pod; ties keep roster order', () => {
        // round-robin: A→macro, B→technical, C→risk, D→macro (tie → macro)
        const pods = assignPods(['A', 'B', 'C', 'D']);
        const trusted = withTrustRepresentatives(pods, n => n === 'D' ? 5 : n === 'B' ? 1 : 0);
        const byName = Object.fromEntries(trusted.map(p => [p.name, p.representative]));
        expect(byName.macro).toBe('D');      // trust 5 beats A's 0
        expect(byName.technical).toBe('B');  // solo
        expect(byName.risk).toBe('C');       // solo
    });
    it('representative is the trusted member even when not first', () => {
        const pods = assignPods(['A', 'B'], () => 'macro');
        const trusted = withTrustRepresentatives(pods, n => n === 'B' ? 9 : 0);
        expect(trusted[0].representative).toBe('B');
    });
});

describe('verdictTranscriptCap', () => {
    it('is the legacy 2400 at ≤5 seats and scales +400/seat above', () => {
        expect(verdictTranscriptCap(2)).toBe(2400);
        expect(verdictTranscriptCap(5)).toBe(2400);
        expect(verdictTranscriptCap(6)).toBe(2800);
        expect(verdictTranscriptCap(10)).toBe(4400);
    });
    it('pod tier starts at 6 seats', () => {
        expect(POD_TIER_MIN_SEATS).toBe(6);
    });
});

describe('pod round prompts', () => {
    it('the pod prompt shows only pod mates and demands position + dissent', () => {
        const pods = assignPods(['M1', 'M2', 'T1', 'T2', 'R1', 'R2'],
            n => n.startsWith('M') ? 'macro' : n.startsWith('T') ? 'technical' : 'risk');
        const macro = pods.find(p => p.name === 'macro')!;
        const prompt = buildPodRoundPrompt(macro, 'M1', [{ name: 'M2', text: 'macro opening' }]);
        expect(prompt).toContain('POD ROUND');
        expect(prompt).toContain('M2');
        expect(prompt).toContain('DISSENT');
        expect(prompt).toContain('macro opening');
        expect(prompt).not.toContain('T1'); // floor seats stay out
    });
    it('the position block carries the rep statement + mate summaries', () => {
        const pods = assignPods(['M1', 'M2', 'T1', 'T2', 'R1', 'R2'],
            n => n.startsWith('M') ? 'macro' : n.startsWith('T') ? 'technical' : 'risk');
        const macro = pods.find(p => p.name === 'macro')!;
        const block = formatPodPositionBlock(macro, { M1: 'pod position one', M2: 'pod position two' });
        expect(block).toContain('POD POSITION');
        expect(block).toContain('pod position one');
        expect(block).toContain('M2: pod position two');
    });
    it('solo pods emit no position block (nothing to carry)', () => {
        const block = formatPodPositionBlock({ name: 'risk', seats: ['R1'], representative: 'R1' }, { R1: 'x' });
        expect(block).toBe('');
    });
});
