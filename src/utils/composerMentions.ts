/**
 * The composer's `@lane` mentions named the four built-in analyst seats and the
 * moderator, and every one of them is deleted (owner ruling, 2026-10-19). What
 * survived was the wire text: `@mod` still produced "Address Moderator only."
 * inside the prompt, so the model was told to speak to a seat that does not
 * exist — an instruction it can neither satisfy nor report, because nothing in
 * the reply says which lanes the harness thinks are live.
 *
 * The skill half (`/slug`) is real and stays: a slug names a notebook skill the
 * seat can `recall`. Removing a gesture that was never wired is not a feature
 * decision; the gesture stopped existing when the engine did.
 */
export interface ComposerIntent {
    skills: string[];
    rest: string;
}

export const parseComposerIntent = (raw: string): ComposerIntent => {
    const skills: string[] = [];
    // `@name` is left in the text on purpose now. It used to be stripped when it
    // matched a lane, which silently deleted the trader's own words on a mention
    // that routes nothing — `@alice` for a bot they named stayed, `@tech`
    // vanished, and neither did anything.
    const rest = raw.replace(/(^|\s)\/([A-Za-z0-9_-]+)/g, (_, sp, slug: string) => {
        if (!skills.includes(slug)) skills.push(slug);
        return sp;
    });
    return { skills, rest: rest.replace(/\s+/g, ' ').trim() };
};

export const formatComposerSteer = (intent: ComposerIntent): string => {
    const bits: string[] = [];
    if (intent.skills.length) bits.push(`Apply notebook skill(s): ${intent.skills.join(', ')}.`);
    if (intent.rest) bits.push(intent.rest);
    return bits.join(' ');
};
