import { LoggedTrade } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { getQuickResponse } from '../providers/GenericProviderService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { getMemoryFiles, buildNotebookMapMarkdown } from './MemoryFilesService';
import { isSkillFile, parseSkillMarkdown, skillMatchesSetup } from './SkillMemoryService';
import { z } from 'zod';

const WorthDecisionSchema = z.object({
    verdict: z.enum(['create', 'merge', 'skip']),
    reason: z.string().min(10).max(400),
    confidence: z.number().min(0).max(1),
    kind: z.enum(['avoid', 'repeat']).optional(),
    ifCondition: z.string().optional(),
    thenAction: z.string().optional(),
    mergeTarget: z.string().optional(),
});

export type SkillWorthDecision = z.infer<typeof WorthDecisionSchema>;

const SKILL_WORTH_FALLBACK = `You judge whether a new trading skill is worth creating.

A skill is a mechanical IF/THEN procedure (price, candle close, level, volume, regime) — not a vague lesson.
Look at:
- the existing skill catalog (name, kind, W/L, trigger)
- the bot's own memory (system + durable notes)
- the evidence cluster (closed trades on the same coin|direction|family)

Decide:
- create — the cluster is real, the trigger is specific and not covered
- merge — an existing skill already covers this, tighten it instead
- skip — too generic, too few samples, or contradicted by history

Rules:
- IF/THEN must be specific and mechanical (min 12 chars each)
- Do not create if an enabled skill already matches this setup (hits>=2)
- "avoid" only when the cluster is losing; "repeat" only when winning

Output ONLY JSON:
{"verdict":"create|merge|skip","reason":"why (20-200 chars)","confidence":0.0-1.0,"kind":"avoid|repeat","ifCondition":"mechanical IF without the word IF","thenAction":"mechanical THEN without the word THEN","mergeTarget":"slug of existing skill if merge"}`;

export const validateCraftedSkill = (candidate: SkillWorthDecision, clusterWins: number, clusterLosses: number): string | null => {
    if (candidate.verdict !== 'create' && candidate.verdict !== 'merge') return null;
    const ic = (candidate.ifCondition || '').trim();
    const ta = (candidate.thenAction || '').trim();
    if (!ic || ic.length < 12) return 'IF too short or missing';
    if (!ta || ta.length < 12) return 'THEN too short or missing';
    const generic = /^(follow trend|use risk management|be careful|manage risk|trade carefully)/i;
    if (generic.test(ic)) return 'IF is generic';
    const sample = clusterWins + clusterLosses;
    if (sample >= 5) {
        const winRate = clusterWins / sample;
        if (candidate.kind === 'avoid' && winRate > 0.6) return 'avoid with winning cluster';
        if (candidate.kind === 'repeat' && winRate < 0.4) return 'repeat with losing cluster';
    }
    return null;
};

export const evaluateSkillWorth = async (
    candidacy: { coin?: string; direction?: string; family?: string; cluster: LoggedTrade[] },
    botContext: string,
    config: ProviderConfig,
): Promise<SkillWorthDecision | null> => {
    const files = getMemoryFiles().files;
    const catalog = files
        .filter(f => f.enabled && isSkillFile(f))
        .map(f => {
            const meta = parseSkillMarkdown(f.content);
            if (!meta) return null;
            const trigger = meta.ifCondition || meta.body.split('\n')[0]?.slice(0, 80) || f.name;
            return `- ${f.name.replace(/\.md$/i, '')} · ${meta.kind} · ${meta.status} · ${meta.wins}W/${meta.losses}L — IF ${trigger.slice(0, 80)}`;
        })
        .filter(Boolean)
        .slice(0, 10)
        .join('\n') || '(no skills yet)';

    const map = buildNotebookMapMarkdown().slice(0, 800);
    const evidence = candidacy.cluster
        .slice(0, 5)
        .map(t => `${t.analysis?.coinName || '?'} ${t.analysis?.direction || '?'} ${t.analysis?.detectedPatternFamily || '?'} ${t.outcome} — ${(t.postMortem || '').slice(0, 200).replace(/\n/g, ' ')}`)
        .join('\n');

    const prompt = `${getPrompt('learning.skill_worth', SKILL_WORTH_FALLBACK)}

CATALOG:
${catalog}

BOT MEMORY:
${botContext.slice(0, 1500)}

MAP:
${map}

EVIDENCE CLUSTER (${candidacy.coin || '?'} ${candidacy.direction || '?'} ${candidacy.family || '?'} — ${candidacy.cluster.length} trades):
${evidence}`;

    try {
        const text = await getQuickResponse(config, prompt, 'You output JSON only. You judge skill worth.');
        const parsed = WorthDecisionSchema.parse(extractAndParseJson(text));
        if (parsed.confidence < 0.55) return { ...parsed, verdict: 'skip' };
        return parsed;
    } catch (e) {
        console.warn('[SkillWorth] evaluation failed:', e);
        return null;
    }
};

export const skillClusterExists = (setup: { coin?: string; direction?: string; family?: string }): boolean => {
    const files = getMemoryFiles().files.filter(f => f.enabled && isSkillFile(f));
    for (const f of files) {
        const meta = parseSkillMarkdown(f.content);
        if (!meta) continue;
        if (skillMatchesSetup(meta, setup)) return true;
    }
    return false;
};
