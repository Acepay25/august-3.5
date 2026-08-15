export interface ComposerIntent {
    lanes: string[];
    skills: string[];
    rest: string;
}

const LANE_ALIASES: Record<string, string> = {
    macro: 'Macro',
    tech: 'Technical',
    technical: 'Technical',
    risk: 'Risk',
    mod: 'Moderator',
    moderator: 'Moderator',
};

export const parseComposerIntent = (raw: string): ComposerIntent => {
    const lanes: string[] = [];
    const skills: string[] = [];
    const rest = raw.replace(/(^|\s)@([A-Za-z]+)/g, (_, sp, name: string) => {
        const lane = LANE_ALIASES[name.toLowerCase()];
        if (lane && !lanes.includes(lane)) lanes.push(lane);
        return sp;
    }).replace(/(^|\s)\/([A-Za-z0-9_-]+)/g, (_, sp, slug: string) => {
        if (!skills.includes(slug)) skills.push(slug);
        return sp;
    });
    return { lanes, skills, rest: rest.replace(/\s+/g, ' ').trim() };
};

export const formatComposerSteer = (intent: ComposerIntent): string => {
    const bits: string[] = [];
    if (intent.lanes.length) bits.push(`Address ${intent.lanes.join(', ')} only.`);
    if (intent.skills.length) bits.push(`Apply notebook skill(s): ${intent.skills.join(', ')}.`);
    if (intent.rest) bits.push(intent.rest);
    return bits.join(' ');
};
