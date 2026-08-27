/**
 * Weekly rollup (compounding memory).
 *
 * Once a week, at boot, the harness consolidates what the notebook has
 * learned — deterministically, no LLM:
 *
 *   1. Confirmed skills with enough evidence (sample >= MIN_SAMPLE_RETIRE)
 *      are distilled into the settled-beliefs registry. These are the
 *      permanent convictions the doctrine rewriter cannot silently drop.
 *   2. Cross-coin clusters are generalized into coin-less skills
 *      (skillGeneralization).
 *   3. Everything else durable (emerging confirmed skills below the settled
 *      bar) is written to profile/rollup-notes.md, which the NEXT doctrine
 *      rewrite reads as input. The rollup NEVER edits doctrine.md directly —
 *      it only feeds the rewriter.
 *
 * The last-run timestamp lives in Preferences (weekly_rollup_v1_<user>), so
 * the rollup is due again after 7 days. Best-effort: any failure leaves the
 * notebook unchanged and retries next boot.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import {
    getMemoryFiles,
    createMemoryFile,
    updateMemoryFile,
    ensureHarnessFolders,
} from './MemoryFilesService';
import { listSkills, MIN_SAMPLE_RETIRE, type SkillMeta } from './SkillMemoryService';
import { upsertSettledBelief } from './settledBeliefs';
import { runGeneralizationPass } from './skillGeneralization';
import { ROLLUP_NOTES_FILE_NAME } from './DoctrineConsolidationService';

const KEY_PREFIX = 'weekly_rollup_v1_';
const ROLLUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the settled-belief intake each pass so the registry stays tight. */
const MAX_BELIEFS_PER_ROLLUP = 15;

export interface WeeklyRollupResult {
    beliefsUpserted: number;
    generalized: number;
    notesWritten: boolean;
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

/** True when the rollup has never run or last ran >= 7 days ago. */
export const isWeeklyRollupDue = async (username: string, now = Date.now()): Promise<boolean> => {
    try {
        const prev = await getPreferenceObject<{ lastRunAt?: string }>(keyFor(username));
        const ts = prev?.lastRunAt ? Date.parse(prev.lastRunAt) : NaN;
        if (!Number.isFinite(ts)) return true;
        return now - ts >= ROLLUP_INTERVAL_MS;
    } catch {
        return true;
    }
};

const stampRollup = async (username: string): Promise<void> => {
    try {
        await setPreferenceObject(keyFor(username), { lastRunAt: new Date().toISOString() });
    } catch { /* stamping is best-effort */ }
};

const sample = (meta: SkillMeta): number => meta.wins + meta.losses;

/** First-person distillation of a skill into a belief body. */
const beliefBodyFromSkill = (meta: SkillMeta): string => {
    const action = (meta.thenAction || meta.description || '').replace(/\s+/g, ' ').trim();
    if (action) return action;
    const title = [meta.kind === 'avoid' ? 'Avoid' : 'Repeat', meta.coin, meta.direction, meta.family]
        .filter(Boolean).join(' ');
    return title ? `I ${meta.kind === 'avoid' ? 'avoid' : 'repeat'}: ${title}.` : '';
};

/**
 * Run the rollup. Idempotent within a window (callers gate on
 * isWeeklyRollupDue), and each sub-step is independently safe.
 */
export const runWeeklyRollup = async (username: string): Promise<WeeklyRollupResult> => {
    const result: WeeklyRollupResult = { beliefsUpserted: 0, generalized: 0, notesWritten: false };
    try {
        await ensureHarnessFolders(username);

        const skills = listSkills().filter(r => !r.meta.supersededBy && r.meta.status !== 'retired');
        const confirmed = skills.filter(r => r.meta.status === 'confirmed');

        // 1. Distill the strongest confirmed skills into settled beliefs.
        const settled = confirmed
            .filter(r => sample(r.meta) >= MIN_SAMPLE_RETIRE)
            .sort((a, b) => sample(b.meta) - sample(a.meta))
            .slice(0, MAX_BELIEFS_PER_ROLLUP);
        for (const { file, meta } of settled) {
            const body = beliefBodyFromSkill(meta);
            if (!body) continue;
            try {
                await upsertSettledBelief({
                    slug: file.name.replace(/\.md$/i, ''),
                    body,
                    evidenceCount: sample(meta),
                    regime: meta.regime,
                }, username);
                result.beliefsUpserted += 1;
            } catch (e) {
                console.warn('[WeeklyRollup] belief upsert failed:', e instanceof Error ? e.message : e);
            }
        }

        // 2. Generalize cross-coin clusters.
        try {
            result.generalized = await runGeneralizationPass(username);
        } catch (e) {
            console.warn('[WeeklyRollup] generalization failed:', e instanceof Error ? e.message : e);
        }

        // 3. Feed the doctrine rewriter: emerging patterns below the settled bar.
        const emerging = confirmed
            .filter(r => sample(r.meta) < MIN_SAMPLE_RETIRE)
            .sort((a, b) => sample(b.meta) - sample(a.meta))
            .slice(0, 10);
        const lines: string[] = [
            `# Weekly rollup — ${new Date().toISOString().slice(0, 10)}`,
            '',
        ];
        if (emerging.length > 0) {
            lines.push('Emerging patterns (confirmed, not yet enough evidence to settle):');
            for (const { file, meta } of emerging) {
                const label = [meta.coin, meta.direction, meta.family].filter(Boolean).join(' ');
                lines.push(`- ${label || file.name}: ${meta.wins}W/${meta.losses}L — ${beliefBodyFromSkill(meta)}`);
            }
        }
        if (result.generalized > 0) {
            lines.push('', `Generalized ${result.generalized} cross-coin cluster(s) into coin-less skills.`);
        }
        if (lines.length > 2) {
            try {
                await writeRollupNotes(lines.join('\n'), username);
                result.notesWritten = true;
            } catch (e) {
                console.warn('[WeeklyRollup] notes write failed:', e instanceof Error ? e.message : e);
            }
        }

        await stampRollup(username);
    } catch (e) {
        console.warn('[WeeklyRollup] pass failed (will retry next boot):', e instanceof Error ? e.message : e);
    }
    return result;
};

const writeRollupNotes = async (content: string, username: string): Promise<void> => {
    const { files, folders } = getMemoryFiles();
    const profile = folders.find(f => f.name === 'profile');
    if (!profile) return;
    const existing = files.find(f => f.folderId === profile.id && f.name === ROLLUP_NOTES_FILE_NAME);
    if (existing) {
        await updateMemoryFile(existing.id, { content }, username);
    } else {
        await createMemoryFile(profile.id, ROLLUP_NOTES_FILE_NAME, content, username, true);
    }
};

/**
 * Boot hook: run the rollup if it is due. Fire-and-forget from the caller —
 * it must never block app startup. Returns the result (or null when not due).
 */
export const runWeeklyRollupIfDue = async (username: string): Promise<WeeklyRollupResult | null> => {
    try {
        if (!(await isWeeklyRollupDue(username))) return null;
        return await runWeeklyRollup(username);
    } catch {
        return null;
    }
};
