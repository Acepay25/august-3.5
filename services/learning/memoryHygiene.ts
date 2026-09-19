/**
 * memoryHygiene — the scheduled health pass (WS-4.2).
 *
 * Weekly, at boot, through the same due-check discipline
 * `weeklyReview` established (per-user Preferences key, last run stamped in
 * the payload, missing-or-unparsable ⇒ due). It does the two maintenance jobs
 * that nothing else was doing on a schedule, and writes a one-line entry each
 * so the Learn surface's Health tab can say what memory looks like without
 * the user having to go looking.
 *
 * Deliberately absent, with the reason:
 *  - consolidation — `pruneOutdatedInsights` + `aggregateSimilarInsights`
 *    already run live on every global-memory write
 *    (`AlgorithmicMemoryService.ts:149-150`). `consolidateMemory` is a pure
 *    wrapper over exactly those two, so calling it here would do the same
 *    work twice. See docs/learning-loop-map.md.
 *  - the contradiction sweep — already fires in the weekly block beside this
 *    (`weeklyReview.ts:159`).
 *  - a graveyard sweep — revival needs a FRESH evidence cluster to justify
 *    re-creating a retired skill, and that test already runs at draft time via
 *    `findArchiveTwin`. A scheduled pass over frozen retirement records has
 *    nothing new to compare against.
 *
 * Nothing here deletes a belief. The destructive moves go through the
 * proposal queue, where the supervisor (or the human) judges them — and every
 * proposal carries a fingerprint, so a weekly pass cannot stack five copies
 * of the same complaint.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { loadProviderConfigs } from '../infrastructure/ProviderConfigService';
import { getFirstReadyProvider } from '../../utils/providerUtils';
import type { ProviderConfig } from '../../types/provider';
import { listSkills, EVIDENCE_STALE_DAYS } from './SkillMemoryService';
import { runNotebookReview } from './MemoryReviewService';
import { queueLearningProposal } from '../../utils/learningQueue';
import { listTombstones } from './skillGraveyard';

const KEY_PREFIX = 'memory_hygiene_v1_';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A confirmed skill silent this long has earned nothing and is costing
 *  prompt budget on every matching setup. */
const SILENCE_QUARTERS = 2;
const LOG_CAP = 20;

export interface HygieneLine {
    atMs: number;
    text: string;
}

export interface HygieneResult {
    atMs: number;
    demotionsQueued: number;
    reviewWritten: boolean;
    lines: string[];
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

/** True when no pass has ever run or the last is >=7 days old. */
export const isHygieneDue = async (username: string, now = Date.now()): Promise<boolean> => {
    try {
        const prev = await getPreferenceObject<{ lines?: HygieneLine[] }>(keyFor(username));
        const last = prev?.lines?.[0]?.atMs;
        if (typeof last !== 'number' || !Number.isFinite(last)) return true;
        return now - last >= WEEK_MS;
    } catch {
        return true;
    }
};

export const loadHygieneLog = async (username: string): Promise<HygieneLine[]> => {
    try {
        const prev = await getPreferenceObject<{ lines?: HygieneLine[] }>(keyFor(username));
        return Array.isArray(prev?.lines) ? prev!.lines!.slice(0, LOG_CAP) : [];
    } catch {
        return [];
    }
};

const appendLog = async (username: string, atMs: number, lines: string[]): Promise<void> => {
    try {
        const prev = await loadHygieneLog(username);
        const next = [...lines.map(text => ({ atMs, text })), ...prev].slice(0, LOG_CAP);
        await setPreferenceObject(keyFor(username), { lines: next });
    } catch { /* a hygiene log must never break boot */ }
};

/**
 * Run the pass. Idempotent per week by fingerprint, so re-running after a
 * reload cannot pile up duplicate proposals. Never throws.
 */
export const runMemoryHygiene = async (
    username: string,
    opts: { providerConfigs?: ProviderConfig[]; now?: number } = {},
): Promise<HygieneResult> => {
    const now = opts.now ?? Date.now();
    const lines: string[] = [];
    const result: HygieneResult = { atMs: now, demotionsQueued: 0, reviewWritten: false, lines };
    try {
        // 1. Confirmed skills that have gone quiet: propose demotion. The
        //    supervisor's verdict decides — "hurts ⇒ demote" is its call, not
        //    a timer's — and a confirmed skill whose trigger moved has to
        //    re-prove itself anyway.
        const cutoff = now - EVIDENCE_STALE_DAYS * SILENCE_QUARTERS * 86_400_000;
        const stale: string[] = [];
        for (const { file, meta } of listSkills()) {
            if (meta.status !== 'confirmed') continue;
            const evid = meta.lastEvidenceAt ? Date.parse(meta.lastEvidenceAt) : NaN;
            if (Number.isFinite(evid) && evid >= cutoff) continue;
            if (meta.evalVerdict === 'hurts') continue; // already on a demotion path
            const slug = file.name.replace(/\.md$/i, '');
            const queued = queueLearningProposal({
                kind: 'demote',
                skillSlug: slug,
                text: `"${slug}" is confirmed but has no counted evidence since ${
                    Number.isFinite(evid) ? new Date(evid).toISOString().slice(0, 10) : 'before records began'
                } — demote it to candidate until it earns a fresh sample?`,
                fingerprint: `stale-demote|${slug}`,
            }, username);
            if (queued) stale.push(slug);
        }
        result.demotionsQueued = stale.length;
        lines.push(stale.length > 0
            ? `Queued ${stale.length} stale-skill demotion proposal${stale.length === 1 ? '' : 's'}.`
            : 'No skill has gone quiet — every confirmed rule is still earning evidence.');

        // 2. The notebook review (LLM): merges into profile/suggestions.md,
        //    which the Health tab links to. Skipped offline rather than
        //    written as a failure.
        const configs = opts.providerConfigs ?? await loadProviderConfigs();
        const provider = getFirstReadyProvider(configs);
        if (provider) {
            result.reviewWritten = await runNotebookReview(username, provider);
            lines.push(result.reviewWritten
                ? 'Ran the notebook review — suggestions written.'
                : 'Notebook review had nothing to say (empty or unchanged notebook).');
        } else {
            lines.push('Skipped the notebook review — no ready provider.');
        }

        // 3. Bookkeeping the user can see but that takes no action.
        const tombstones = await listTombstones(username);
        if (tombstones.length > 0) {
            lines.push(`${tombstones.length} retired skill${tombstones.length === 1 ? '' : 's'} in the graveyard — a revival needs new evidence, not a timer.`);
        }
        await appendLog(username, now, lines);
        return result;
    } catch (e) {
        console.warn('[MemoryHygiene] pass failed (non-fatal):', e instanceof Error ? e.message : e);
        return result;
    }
};

/** Boot hook, beside `runWeeklyReviewIfDue`. Fire-and-forget, own due-check. */
export const runMemoryHygieneIfDue = async (
    username: string,
    providerConfigs?: ProviderConfig[],
): Promise<HygieneResult | null> => {
    try {
        if (!(await isHygieneDue(username))) return null;
        return await runMemoryHygiene(username, { providerConfigs });
    } catch {
        return null;
    }
};
