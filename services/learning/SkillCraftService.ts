import { LoggedTrade } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { getQuickResponse } from '../providers/GenericProviderService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { CraftedSkill, parseCraftedSkill } from '../../schemas/learning';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { parseIfThenClauses } from '../../utils/ifThenSkill';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';
import { PREDICATE_GRAMMAR_HINT } from '../analysis/skillPredicate';

export const SKILL_CRAFT_FALLBACK = `You turn a closed-trade post-mortem into ONE reusable trading skill.

A skill is a PROCEDURE another agent will follow, not a diary sentence. It has
to carry these parts:

1. when to use it — the concrete trigger
2. when NOT to use it — the situations that LOOK like this one and are not
3. required inputs
4. the sequence of work (steps), each with the exact check or tool call
5. the pitfalls you have actually seen: "X happens -> do Y instead"
6. how to verify the procedure worked, not just that it was followed
7. how to validate the trigger still holds
8. what to return (the ticket action)
9. what requires human approval

A one-line rule is a SEED, not a finished skill. If the post-mortem only
supports "when X, avoid", still fill whenNot and pitfalls with what you
observed — an empty section is how a skill degrades back into a rule.

KIND:
- avoid — the trade lost or the lesson is "do not take this"
- repeat — the trade won and the lesson is "take this only when the IF holds"

IF/THEN must be mechanical (price, candle close, level, volume, regime). No vibes.

A skill may carry a full STRATEGY beside the rule. When the post-mortem supports a complete trade plan, state it in the
"strategy" object so the app can build a ticket from it — entry, stop, target,
sizing, and the conditions that must hold. Use plain price/level/condition
language, not numbers you invented. Omit "strategy" entirely when the lesson
is only "do not take this" — but the whenNot / pitfalls / verification sections
are still expected, because that is where the lesson actually lives.

Output ONLY JSON:
{
  "name": "short kebab-or-title (max 8 words)",
  "kind": "avoid" | "repeat",
  "when": "trigger in one sentence",
  "whenNot": ["looks like this but is not this — why"],
  "inputs": ["coin", "direction", "timeframe or family"],
  "steps": ["step 1 with the exact check", "step 2", "step 3"],
  "pitfalls": ["observed failure -> what to do instead"],
  "verification": "how the agent confirms the procedure worked",
  "relatedSkills": ["slug of a skill this one overlaps or contradicts"],
  "validate": "how to know the IF still holds",
  "output": "what the next ticket should do",
  "approval": "when a human must confirm (size, new coin, conflicting skill)",
  "ifCondition": "IF clause without the word IF",
  "thenAction": "THEN clause without the word THEN",
  "strategy": {
    "entry": "price / zone / condition to enter",
    "invalidation": "what voids the setup",
    "stop": "protective level",
    "target": "first objective",
    "sizing": "risk budget or size rule",
    "conditions": ["must be true to trade this now"]
  },
  "predicate": ${JSON.stringify(PREDICATE_GRAMMAR_HINT)}
}`;

export const formatCraftedSkillBody = (skill: CraftedSkill): string => {
    // The bold core is kept EXACTLY as it was, because it is a vocabulary and
    // not a style: `utils/ifThenSkill.ts:formatSkillProcedure` writes the same
    // `**What I do:**` line, `syncSkillRuleLine` rewrites the `**My rule:**`
    // line and a test pins that the two are byte-identical, and a dozen
    // fixtures seed bodies in this shape. Replacing it would have broken the
    // convention rather than improved it.
    //
    // What the core could not express is appended as sections — when NOT to
    // reach for this, the failure that was actually seen, and how to confirm
    // the procedure worked. Those three are the difference between a skill and
    // a rule, and a model will not write them unless the prompt asks (see
    // SKILL_CRAFT_FALLBACK) and the file has somewhere to put them.
    // `services/learning/skillDocument.ts` reads both shapes back.
    const bullets = (items: (string | undefined)[]): string[] =>
        items.filter((x): x is string => !!x && x.trim().length > 0).map(x => `- ${x.trim()}`);
    const section = (title: string, lines: string[]): string[] =>
        [`## ${title}`, '', ...(lines.length ? lines : ['- none recorded — the next craft should say'])];

    return [
        `**When:** ${skill.when}`,
        `**What I look at:** ${skill.inputs.join(', ') || 'matching setup'}`,
        '**What I do:**',
        ...skill.steps.map((st, i) => `${i + 1}. ${st}`),
        `**How I know it still holds:** ${skill.validate}`,
        ...(skill.strategy ? [
            '**My plan:**',
            ...(skill.strategy.entry ? [`- Entry: ${skill.strategy.entry}`] : []),
            ...(skill.strategy.invalidation ? [`- Invalidation: ${skill.strategy.invalidation}`] : []),
            ...(skill.strategy.stop ? [`- Stop: ${skill.strategy.stop}`] : []),
            ...(skill.strategy.target ? [`- Target: ${skill.strategy.target}`] : []),
            ...(skill.strategy.sizing ? [`- Size: ${skill.strategy.sizing}`] : []),
            ...(skill.strategy.conditions?.length
                ? [`- Requires: ${skill.strategy.conditions.join('; ')}`]
                : []),
        ] : []),
        `**What I hand back:** ${skill.output}`,
        `**When I ask a human:** ${skill.approval}`,
        `**My rule:** when ${skill.ifCondition}, I ${skill.thenAction}`,
        '',
        ...section('When NOT to use', bullets(skill.whenNot ?? [])),
        '',
        ...section('Pitfalls', bullets(skill.pitfalls ?? [])),
        '',
        ...section('Verification', bullets([skill.verification])),
        ...(skill.relatedSkills?.length ? ['', ...section('Related skills', bullets(skill.relatedSkills))] : []),
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

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

export const SKILL_REFINE_FALLBACK = `A CONFIRMED trading skill just took consecutive losses. Refine it — tighten the trigger, add the missing guard, or narrow the regime. Do NOT retire it and do NOT invent a new skill.

Rules:
- Keep the same KIND (avoid/repeat) unless the losses prove it backwards.
- The IF must become MORE specific (add a filter the losing trades violated).
- The THEN must stay mechanical (price, candle close, level, volume, regime).
- Preserve what still works; change only what the losses falsified.
- If the current skill carries a "strategy" plan (entry/stop/target/sizing),
  keep it and tighten it against the losses — a refinement must not silently
  drop the plan.

Output ONLY JSON with the same shape:
{
  "name": "short kebab-or-title (max 8 words)",
  "kind": "avoid" | "repeat",
  "when": "tightened trigger in one sentence",
  "inputs": ["coin", "direction", "timeframe or family"],
  "steps": ["step 1", "step 2", "step 3"],
  "validate": "how to know the IF still holds",
  "output": "what the next ticket should do",
  "approval": "when a human must confirm",
  "ifCondition": "tightened IF clause without the word IF",
  "thenAction": "corrected THEN clause without the word THEN",
  "strategy": {
    "entry": "price / zone / condition to enter",
    "invalidation": "what voids the setup",
    "stop": "protective level",
    "target": "first objective",
    "sizing": "risk budget or size rule",
    "conditions": ["must be true to trade this now"]
  },
  "predicate": ${JSON.stringify(PREDICATE_GRAMMAR_HINT)}
}`;

/**
 * Self-improving skills: a confirmed skill that takes consecutive losses is
 * handed back to the model with the losing post-mortems so the trigger /
 * procedure is tightened instead of silently bleeding. Returns the refined
 * skill, or null when the model cannot improve it (the caller keeps the
 * existing skill untouched).
 */
export const refineSkillFromLosses = async (
    skill: { title: string; kind: 'avoid' | 'repeat'; ifCondition?: string; thenAction?: string; body: string; wins: number; losses: number },
    losingTrades: LoggedTrade[],
    config: ProviderConfig,
): Promise<CraftedSkill | null> => {
    const evidence = losingTrades
        .map((t, i) => [
            `--- Losing trade ${i + 1} ---`,
            `Coin: ${t.analysis?.coinName || '?'} · Direction: ${t.analysis?.direction || '?'} · Family: ${t.analysis?.detectedPatternFamily || '?'}`,
            `Post-mortem: ${(t.postMortem || '(no post-mortem)').slice(0, 1500)}`,
        ].join('\n'))
        .join('\n\n');
    const prompt = `${getPrompt('learning.skill_refine', SKILL_REFINE_FALLBACK)}

CURRENT SKILL (${skill.title}, ${skill.kind}, record ${skill.wins}W/${skill.losses}L):
IF ${skill.ifCondition || '(unwritten)'}
THEN ${skill.thenAction || '(unwritten)'}

${skill.body.slice(0, 2000)}

LOSING TRADES THAT FALSIFIED IT:
${evidence.slice(0, 6000)}`;
    try {
        const text = await getQuickResponse(config, prompt, 'You output JSON only. You refine trading skills.');
        return parseCraftedSkill(extractAndParseJson(text));
    } catch (e) {
        console.warn('[SkillCraft] LLM refinement failed:', e);
        return null;
    }
};
