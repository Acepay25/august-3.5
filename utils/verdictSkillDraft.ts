/**
 * Auto-queue a skill draft when the moderator's verdict cites a pattern the
 * notebook does not know yet. Deterministic — no LLM call: the verdict's own
 * pattern family + direction become the IF/THEN, and the draft lands in the
 * approval inbox so the user (not the model) decides whether it becomes a
 * notebook skill.
 */

import { TradeAnalysis } from '../types';
import { CraftedSkill } from '../schemas/learning';
import { listSkills, skillMatchesSetup } from '../services/learning/SkillMemoryService';
import { isMeaningfulLabel } from './meaningfulLabel';
import { queueSkillDraft, isDraftTombstoned, draftTriggerKey, SkillDraft } from './skillDrafts';

const cleanLine = (text: string, max: number): string =>
    text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Build the draft's IF/THEN from the verdict's pattern citation. */
export const craftedSkillFromVerdict = (analysis: TradeAnalysis): CraftedSkill | null => {
    const family = analysis.detectedPatternFamily || analysis.marketConditions?.pattern;
    // The schema defaults missing pattern fields to the literal 'N/A' — a
    // truthy string. Drafting a skill about the "N/A pattern" is junk, so
    // placeholder labels are treated as no citation at all.
    if (!isMeaningfulLabel(family)) return null;
    const coin = analysis.coinName?.toUpperCase().replace(/USDT?$/, '') || 'the asset';
    const direction = analysis.direction === 'Long' || analysis.direction === 'Short'
        ? analysis.direction
        : undefined;
    const isAvoid = analysis.confidence === 'Avoid' || analysis.direction === 'Neutral';
    const kind: CraftedSkill['kind'] = isAvoid ? 'avoid' : 'repeat';

    const ifCondition = cleanLine(
        direction
            ? `${coin} ${direction.toLowerCase()} setup showing the ${family} pattern`
            : `${coin} setup showing the ${family} pattern`,
        140,
    );
    const strategyLine = cleanLine(analysis.strategy || '', 200);
    const thenAction = cleanLine(
        isAvoid
            ? `stand aside — the ${family} pattern is not confirmed on ${coin}`
            : strategyLine
                ? `follow the moderator's plan: ${strategyLine}`
                : `take the ${direction?.toLowerCase() ?? coin} only while the ${family} pattern holds`,
        200,
    );

    return {
        name: cleanLine(`${kind === 'avoid' ? 'Avoid' : 'Repeat'} ${coin} ${direction ?? ''} ${family}`.trim(), 60),
        kind,
        when: cleanLine(`The moderator's verdict cites the ${family} pattern on ${coin}.`, 160),
        inputs: [coin, direction ?? 'any direction', family].filter(Boolean),
        steps: isAvoid
            ? ['Confirm the pattern is actually present on the chart', 'If absent, skip the trade']
            : ['Confirm the pattern is present', "Follow the verdict's entry/stop/targets", 'Invalidate on thesis break'],
        validate: `The ${family} pattern is visible and the regime matches the verdict.`,
        output: isAvoid ? 'Skip the setup' : 'Take the setup per the verdict plan',
        approval: 'Always — verdict-sourced skills are drafts until the user approves them.',
        ifCondition,
        thenAction,
    };
};

/**
 * Queue a skill draft for a concluded debate verdict when it cites a pattern
 * no existing notebook skill already covers. Returns the queued draft, or
 * null when there is nothing new to learn.
 */
export const maybeQueueVerdictSkillDraft = (
    messageId: string,
    analysis: TradeAnalysis | undefined,
    username?: string,
): SkillDraft | null => {
    if (!analysis) return null;
    const crafted = craftedSkillFromVerdict(analysis);
    if (!crafted) return null;
    const setup = {
        coin: analysis.coinName,
        direction: analysis.direction,
        family: analysis.detectedPatternFamily,
        pattern: analysis.marketConditions?.pattern,
    };
    const alreadyKnown = listSkills().some(({ meta }) => skillMatchesSetup(meta, setup));
    if (alreadyKnown) return null;
    // A recently rejected trigger stays quiet for the cooldown window.
    if (isDraftTombstoned(draftTriggerKey(analysis.coinName, crafted), username)) return null;
    return queueSkillDraft({
        tradeId: messageId,
        coin: analysis.coinName,
        crafted,
    }, username);
};
