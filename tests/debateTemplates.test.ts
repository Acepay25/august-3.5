import { describe, it, expect } from 'vitest';
import { DEBATE_TEMPLATES, debateTemplateMarker, extractDebateTemplate } from '../utils/debateTemplates';

describe('debateTemplates', () => {
    it('exposes the four presets with steering text', () => {
        expect(DEBATE_TEMPLATES.map(t => t.id)).toEqual(['scalp', 'swing', 'devils-advocate', 'risk-only']);
        for (const t of DEBATE_TEMPLATES) {
            expect(t.steering.length).toBeGreaterThan(20);
            expect(t.label.length).toBeGreaterThan(0);
        }
    });

    it('only risk-only skips straight to the verdict', () => {
        expect(DEBATE_TEMPLATES.find(t => t.id === 'risk-only')?.skipToVerdict).toBe(true);
        expect(DEBATE_TEMPLATES.filter(t => t.skipToVerdict)).toHaveLength(1);
    });

    it('debateTemplateMarker wraps the label in [[ ]]', () => {
        expect(debateTemplateMarker('scalp')).toBe('[[Scalp check]]');
        expect(debateTemplateMarker('nope')).toBe('');
    });

    it('extractDebateTemplate strips the marker and returns the template', () => {
        const { template, cleanText } = extractDebateTemplate('[[Swing thesis]] analyze BTCUSDT long');
        expect(template?.id).toBe('swing');
        expect(cleanText).toBe('analyze BTCUSDT long');
    });

    it('extractDebateTemplate returns null template and untouched text when no marker', () => {
        const { template, cleanText } = extractDebateTemplate('analyze ETH short');
        expect(template).toBeNull();
        expect(cleanText).toBe('analyze ETH short');
    });

    it('removes every occurrence of a repeated marker', () => {
        const { cleanText } = extractDebateTemplate('[[Risk-only pass]] BTC [[Risk-only pass]]');
        expect(cleanText).toBe('BTC');
    });
});
