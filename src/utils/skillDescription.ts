/**
 * The deterministic mirror of `defaultPrediction` (utils/skillPrediction.ts):
 * a craft that arrives without the activation-key description gets one
 * synthesized in the same shape the craft prompts demand — what it does +
 * "Use this skill whenever <triggers>." + one brief exclusion clause.
 *
 * The deterministic draft constructors (session review, verdict citations,
 * pass mining, self-improvement, book seeds) build their crafts in code and
 * never set a description, and `parseCraftedSkill` keeps the field optional
 * so old queued drafts stay valid — so the GATES stamp the default, exactly
 * where they stamp the prediction.
 *
 * The exclusion phrase "Do NOT use for" is load-bearing beyond prose: the
 * description-overlap scorer splits the description at it before scoring,
 * so an exclusion naming a situation must never make that situation match
 * (MemoryRetrievalService). Do not reword it here or in the prompts without
 * updating that splitter.
 */

/** Structural view of the fields the synthesizer reads — satisfied by every
 *  CraftedSkill without importing the schema edge into utils/. */
interface DescriptionSource {
    when: string;
    whenNot?: string[];
}

export const defaultDescription = (crafted: DescriptionSource): string => {
    const trigger = crafted.when?.trim();
    if (!trigger) return '';
    const exclusion = crafted.whenNot?.map(w => w?.trim()).find(Boolean)?.replace(/\.+$/, '');
    return `Use this skill whenever ${trigger.replace(/\.+$/, '')}.`
        + (exclusion ? ` Do NOT use for ${exclusion.charAt(0).toLowerCase()}${exclusion.slice(1)}.` : '');
};
