/**
 * Composer modes (a port of Minara's slash-mode composer). The `/` menu has
 * always completed notebook SKILLS; a mode you cannot see is a mode nobody
 * uses, so the same menu now surfaces app-level COMMANDS too — Deep Research
 * and Visualize Data — above the skill list. Selecting one is a removable
 * chip: it re-frames the run WITHOUT rewriting the user's sentence (the same
 * non-destructive rule as steering notes).
 *
 * The mode is composer STATE, not text (a leading "/research " token would
 * collide with the skill-slug grammar). handleSendMessage receives it so the
 * pipeline can route: research forces the ensemble debate + a structured
 * report; visualize forces the data-visualization reply shape.
 */

export type ComposerMode = 'research' | 'visualize';

export interface ComposerCommand {
    id: ComposerMode;
    /** The `/` token (lowercased) that matches it. */
    token: string;
    label: string;
    hint: string;
    /** Alternative `/` tokens that resolve to this command. */
    aliases?: string[];
}

export const COMPOSER_COMMANDS: ComposerCommand[] = [
    {
        id: 'research',
        token: 'research',
        label: 'Deep Research',
        hint: 'Force the ensemble debate at full protocol and return a cited, downloadable report.',
        aliases: ['deep', 'deep-research', 'debate', 'analyze'],
    },
    {
        id: 'visualize',
        token: 'visualize',
        label: 'Visualize Data',
        hint: 'Answer with the data tables + chart series for this setup, not prose.',
        aliases: ['chart', 'data', 'visualise', 'plot'],
    },
];

/** Resolve a typed `/token` fragment to a command (exact token, then alias). */
export const matchComposerCommand = (fragment: string): ComposerCommand | null => {
    const q = (fragment || '').toLowerCase().replace(/^\/+/, '');
    if (!q) return null;
    for (const cmd of COMPOSER_COMMANDS) {
        if (cmd.token === q || cmd.aliases?.includes(q)) return cmd;
    }
    // Prefix match on the primary token or any alias, so "/res" → research.
    for (const cmd of COMPOSER_COMMANDS) {
        if (cmd.token.startsWith(q) || cmd.aliases?.some(a => a.startsWith(q))) return cmd;
    }
    return null;
};

/** The command behind a set mode id (for the chip). */
export const composerCommandFor = (mode: ComposerMode | null | undefined): ComposerCommand | null =>
    COMPOSER_COMMANDS.find(c => c.id === mode) ?? null;
