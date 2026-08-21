/**
 * One-time mechanical migration (ROUND-24m): fold legacy IF/THEN learning
 * rules into the skills system as candidate skills.
 *
 * Rationale: two representations of "lesson learned" drifted apart — skills
 * get evidence-counted, refined, and enforced; rules only got advisory
 * prompt space. Lessons belong in the system with lifecycle + enforcement.
 *
 * Mechanical only (no LLM): each non-retired rule becomes a candidate skill
 * seeded with its attribution counts. Idempotent — rules whose ifCondition
 * already matches an existing skill are skipped. The original rule store is
 * left intact for outcome-attribution history.
 */

import { createMemoryFile as createSkillFile, ensureHarnessFolders, getMemoryFiles } from './MemoryFilesService';
import { loadLearningRules } from './LearningRulesService';
import {
    isSkillFile,
    parseSkillMarkdown,
    serializeSkill,
    titleFromMeta,
    type SkillMeta,
} from './SkillMemoryService';
import type { LoggedTrade } from '../../types';

export interface MigrationResult {
    created: number;
    skipped: number;
}

export const migrateIfThenRulesToSkills = async (
    username: string,
    trades: LoggedTrade[] = [],
): Promise<MigrationResult> => {
    await ensureHarnessFolders(username);
    const storage = loadLearningRules();
    const rules = (storage.rules || []).filter(r => r.status !== 'retired');
    if (rules.length === 0) return { created: 0, skipped: 0 };

    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return { created: 0, skipped: 0 };

    let created = 0;
    let skipped = 0;
    for (const rule of rules) {
        // Skip when a skill already owns this trigger (idempotency across runs).
        const exists = getMemoryFiles().files.some(f => {
            if (!isSkillFile(f)) return false;
            const meta = parseSkillMarkdown(f.content);
            return meta?.ifCondition?.toLowerCase() === rule.ifCondition.toLowerCase();
        });
        if (exists) {
            skipped += 1;
            continue;
        }

        const kind = rule.outcome === 'LOSS' ? 'avoid' : 'repeat';
        const sourceTrade = trades.find(t => t.id === rule.sourceTradeId);
        const meta: SkillMeta = {
            status: 'candidate',
            kind,
            coin: rule.coin ?? sourceTrade?.analysis?.coinName,
            direction: rule.direction,
            family: rule.pattern ?? sourceTrade?.analysis?.detectedPatternFamily,
            regime: sourceTrade?.marketRegime,
            wins: rule.wins ?? 0,
            losses: rule.losses ?? 0,
            consecutiveLosses: 0,
            tradeIds: [rule.sourceTradeId],
            ifCondition: rule.ifCondition,
            thenAction: rule.thenAction,
            body: [
                `**When:** ${rule.ifCondition}`,
                `**What I do:** ${rule.thenAction}`,
                `**Stands until:** outcomes say otherwise (migrated from my post-mortem rules).`,
            ].join('\n'),
        };

        const slug = `${[meta.coin, kind, rule.ifCondition.slice(0, 40)].filter(Boolean).join(' ')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'if-then'}.md`;

        await createSkillFile(folder.id, slug, serializeSkill(meta, titleFromMeta(meta)), username);
        created += 1;
    }
    return { created, skipped };
};

