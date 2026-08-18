/**
 * Debate templates — one-tap presets that steer the Floor's framing.
 * A chip inserts a `[[Label]]` marker into the composer; the pipeline
 * extracts it, strips it from the prompt, and applies the steering text
 * (and optional rebuttal skip) to the run.
 */

export interface DebateTemplate {
    id: string;
    label: string;
    hint: string;
    /** Steering text injected into the debate's steering queue. */
    steering: string;
    /** Skip rebuttals and head straight to the verdict (risk-only pass). */
    skipToVerdict?: boolean;
}

export const DEBATE_TEMPLATES: DebateTemplate[] = [
    {
        id: 'scalp',
        label: 'Scalp check',
        hint: 'Fast scalp framing — exact trigger, tight invalidation, quick targets',
        steering: 'TEMPLATE (Scalp check): frame this as a SCALP. Demand an exact trigger (candle/level), tight invalidation, and quick targets (1-2R). Prefer speed and precision over depth; reject the setup outright if no clean trigger exists.',
    },
    {
        id: 'swing',
        label: 'Swing thesis',
        hint: 'Multi-day thesis — structure, regime, and wider invalidation',
        steering: 'TEMPLATE (Swing thesis): frame this as a SWING. Argue the multi-day thesis: market structure, regime, and catalysts. Invalidation may be wide but must be explicit; targets in stages over days, not minutes.',
    },
    {
        id: 'devils-advocate',
        label: "Devil's advocate",
        hint: 'Every seat argues the opposite side first — stress-test the consensus',
        steering: "TEMPLATE (Devil's advocate): in your rebuttal, FIRST argue the OPPOSITE side of your opening position with full conviction (best steelman), then return to your true view and say which side survived. The moderator must weigh the steelmen explicitly before the verdict.",
    },
    {
        id: 'risk-only',
        label: 'Risk-only pass',
        hint: 'Skip rebuttals — straight to invalidation, stops, and sizing',
        steering: 'TEMPLATE (Risk-only pass): focus exclusively on RISK — what kills this trade, where the stop must sit, and how big the position may be. Do not invent new entries; the verdict is about invalidation and size only.',
        skipToVerdict: true,
    },
];

const markerFor = (template: DebateTemplate): string => `[[${template.label}]]`;

/** The composer marker for a template (inserted by the chip). */
export const debateTemplateMarker = (id: string): string => {
    const template = DEBATE_TEMPLATES.find(t => t.id === id);
    return template ? markerFor(template) : '';
};

/**
 * Extract a template marker from the user's message text. Returns the
 * matched template and the text with the marker removed.
 */
export const extractDebateTemplate = (text: string): { template: DebateTemplate | null; cleanText: string } => {
    for (const template of DEBATE_TEMPLATES) {
        const marker = markerFor(template);
        if (text.includes(marker)) {
            return {
                template,
                cleanText: text.split(marker).join('').trim(),
            };
        }
    }
    return { template: null, cleanText: text };
};
