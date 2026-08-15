import { LoggedTrade } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { getQuickResponse } from '../providers/GenericProviderService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { CraftedSkill, parseCraftedSkill } from '../../schemas/learning';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { parseIfThenClauses } from '../../utils/ifThenSkill';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';

export const SKILL_CRAFT_FALLBACK = `You turn a closed-trade post-mortem into ONE reusable trading skill.

A skill is a procedure, not a diary sentence. Grok-style fields:
1. when to use it
2. required inputs
3. sequence of work (steps)
4. how to validate
5. what to return (the ticket action)
6. what requires human approval

KIND:
- avoid — the trade lost or the lesson is "do not take this"
- repeat — the trade won and the lesson is "take this only when the IF holds"

IF/THEN must be mechanical (price, candle close, level, volume, regime). No vibes.

Output ONLY JSON:
{
  "name": "short kebab-or-title (max 8 words)",
  "kind": "avoid" | "repeat",
  "when": "trigger in one sentence",
  "inputs": ["coin", "direction", "timeframe or family"],
  "steps": ["step 1", "step 2", "step 3"],
  "validate": "how to know the IF still holds",
  "output": "what the next ticket should do",
  "approval": "when a human must confirm (size, new coin, conflicting skill)",
  "ifCondition": "IF clause without the word IF",
  "thenAction": "THEN clause without the word THEN"
}`;

export const formatCraftedSkillBody = (skill: CraftedSkill): string => [
    `**When:** ${skill.when}`,
    `**Inputs:** ${skill.inputs.join(', ') || 'matching setup'}`,
    '**Steps:**',
    ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
    `**Validate:** ${skill.validate}`,
    `**Return:** ${skill.output}`,
    `**Approval:** ${skill.approval}`,
    `**Trigger:** IF ${skill.ifCondition}`,
    `**Procedure:** THEN ${skill.thenAction}`,
].join('\n');

export const craftSkillFromPostMortem = async (
    trade: LoggedTrade,
    config: ProviderConfig,
): Promise<CraftedSkill | null> => {
    const pm = trade.postMortem || '';
    if (pm.length < 40) return null;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return null;
    const clauses = parseIfThenClauses(pm);
    const details = [
        `Coin: ${trade.analysis?.coinName || '?'}`,
        `Direction: ${trade.analysis?.direction || '?'}`,
        `Family: ${trade.analysis?.detectedPatternFamily || '?'}`,
        `Outcome: ${trade.outcome}`,
        clauses[0] ? `Extracted IF/THEN: IF ${clauses[0].ifCondition} THEN ${clauses[0].thenAction}` : '',
    ].filter(Boolean).join('\n');
    const prompt = `${getPrompt('learning.skill_craft', SKILL_CRAFT_FALLBACK)}

TRADE:
${details}

POST-MORTEM:
${pm.slice(0, 6000)}`;
    try {
        const text = await getQuickResponse(config, prompt, 'You output JSON only. You craft trading skills.');
        return parseCraftedSkill(extractAndParseJson(text));
    } catch (e) {
        console.warn('[SkillCraft] LLM craft failed:', e);
        return null;
    }
};
