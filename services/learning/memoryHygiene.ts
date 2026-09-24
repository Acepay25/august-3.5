/**
 * memoryHygiene — the scheduled health pass (WS-4.2).
 *
 * Weekly, at boot, through the same due-check discipline
 * `weeklyReview` established (per-user Preferences key, last run stamped in
 * the payload, missing-or-unparsable ⇒ due). It runs the maintenance jobs that
 * nothing else was doing on a schedule, and writes a one-line entry for each
 * so the Learn surface's Health tab can say what memory looks like without
 * the user having to go looking.
 *
 * Deliberately absent, with the reason:
 *  - consolidation — the insight store needs no scheduled pass here because
 *    its ONLY writer already consolidates on every write:
 *    `AlgorithmicMemoryService.updateGlobalMemoryAlgorithmically` pushes the
 *    batch's new insights and then calls `pruneOutdatedInsights` +
 *    `aggregateSimilarInsights` in the same block
 *    (`AlgorithmicMemoryService.ts:146-149`; the `if (newInsights.length > 0)`
 *    guard at :135 is the only code in the repo that mutates
 *    `GlobalMemory.insightKnowledgeBase.insights`). A store that cannot grow
 *    without being pruned would just be walked twice. See
 *    docs/learning-loop-map.md.
 *
 * What this pass DOES run, and reports one line each:
 *  - stale-skill demotion proposals (below);
 *  - the contradiction sweep (`utils/contradictionSweep.runContradictionSweep`)
 *    — it used to fire unreported from the weekly review block;
 *  - the graveyard retention sweep
 *    (`skillGraveyard.runGraveyardSweep`) — it enforces the store's declared
 *    newest-`MAX_TOMBSTONES` boundary and clears rows no reader can use. It
 *    revives nothing on a timer: revival needs a FRESH evidence cluster, and
 *    that test already runs at draft time via `findArchiveTwin`.
 *  - the idle skill lifecycle (`skillIdleLifecycle.runSkillIdleSweep`), the
 *    only stage here that ACTS without a verdict — and the reason it is
 *    allowed to is that it never touches a belief: it changes which skills are
 *    injected, reversibly, on a clock, and files the leftovers into the
 *    archive folder that retirement already uses. Nothing is deleted, and a
 *    trigger that fires again returns the skill with no human involved.
 *  - veto retraction and negative-lift demotion (both below) — the two
 *    measured signals that had a verdict and a dashboard card but no
 *    actuation path: everything they produced used to stop at being read.
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
import { listSkills, reviewSkillEffectiveness, consolidateSkills, EVIDENCE_STALE_DAYS } from './SkillMemoryService';
import { computeAllSkillLifts } from './MemoryProvenanceService';
import { getRecentMemoryInjections } from './MemoryInjectionService';
import { VetoLedgerService } from '../ui/VetoLedgerService';
import { runNotebookReview } from './MemoryReviewService';
import { queueLearningProposal } from '../../utils/learningQueue';
import { runContradictionSweep } from '../../utils/contradictionSweep';
import { runGraveyardSweep, MAX_TOMBSTONES } from './skillGraveyard';
import { runSkillIdleSweep, listSuspendedSkills } from './skillIdleLifecycle';
import { notebookWantsCleanup } from './MemoryFilesService';
import { cleanupIsDue } from '../../utils/memoryBudget';
import type { LoggedTrade } from '../../types';

const KEY_PREFIX = 'memory_hygiene_v1_';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A confirmed skill silent this long has earned nothing and is costing
 *  prompt budget on every matching setup. */
const SILENCE_QUARTERS = 2;
/** Settled vetoes a skill needs before its accuracy is a claim worth acting
 *  on — below this, the ratio is noise from two or three setups. */
const VETO_MIN_SETTLED = 5;
/** Share of settled vetoes that BLOCKED A WINNER (WOULD_TP) above which the
 *  veto is presumed to cost more than it saves. Deliberately a majority bar,
 *  not a coin flip: every proposal it queues hands a live veto back to the
 *  market for the supervisor (or the human) to judge. */
const VETO_COST_RATIO = 0.6;
const LOG_CAP = 20;

export interface HygieneLine {
    atMs: number;
    text: string;
}

export interface HygieneResult {
    atMs: number;
    demotionsQueued: number;
    /** Avoid skills whose settled vetoes keep costing winners (step 6). */
    vetoDemotionsQueued: number;
    /** Skills whose own lift went below baseline (step 7). */
    liftDemotionsQueued: number;
    /** New merge/priority proposals from the contradiction sweep. */
    contradictionsQueued: number;
    /** Graveyard records the retention sweep collected (0 = nothing to do). */
    graveyardCollected: number;
    /** Idle lifecycle actions taken this pass. */
    skillsSuspended: number;
    skillsRevived: number;
    skillsArchived: number;
    reviewWritten: boolean;
    lines: string[];
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

/** True when no pass has ever run, the last one is >=7 days old, or the
 *  NOTEBOOK HAS ASKED FOR ONE.
 *
 *  The weekly clock alone made the byte budget a reporting feature: reaching the
 *  trigger tier logged a warning and refused new notes, but the pass that
 *  actually shrinks the blob could still be six days away. Under pressure the
 *  pass now runs on the budget's own dedup window instead, so a blob at the
 *  trigger tier is relieved within hours — and `cleanupIsDue` is what keeps a
 *  post-mortem that re-persists the blob ten times from launching ten passes.
 *  Pressure can only SHORTEN the wait, never lengthen it. */
export const isHygieneDue = async (username: string, now = Date.now()): Promise<boolean> => {
    try {
        const prev = await getPreferenceObject<{ lines?: HygieneLine[] }>(keyFor(username));
        const last = prev?.lines?.[0]?.atMs;
        if (typeof last !== 'number' || !Number.isFinite(last)) return true;
        if (notebookWantsCleanup() && cleanupIsDue(last, now)) return true;
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
    opts: { providerConfigs?: ProviderConfig[]; now?: number; trades?: LoggedTrade[] } = {},
): Promise<HygieneResult> => {
    const now = opts.now ?? Date.now();
    const lines: string[] = [];
    const result: HygieneResult = {
        atMs: now, demotionsQueued: 0, vetoDemotionsQueued: 0, liftDemotionsQueued: 0,
        contradictionsQueued: 0,
        graveyardCollected: 0, skillsSuspended: 0, skillsRevived: 0, skillsArchived: 0,
        reviewWritten: false, lines,
    };
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

        // 2. Contradiction sweep — two LIVE skills whose overlapping conditions
        //    demand opposite actions, queued as a merge/priority proposal. It
        //    used to run from `weeklyReview`'s block and reach nothing but a
        //    console.log, so a queue it filled stayed invisible here; the
        //    counts now ride the log like every other pass.
        const sweep = runContradictionSweep(username);
        result.contradictionsQueued = sweep.queued;
        lines.push(
            `Contradiction sweep: examined ${sweep.pairsExamined} live-skill pair${sweep.pairsExamined === 1 ? '' : 's'}`
            + ` — ${sweep.conflicts} contradicting, ${sweep.queued} proposal${sweep.queued === 1 ? '' : 's'} queued,`
            + ` ${sweep.dismissed} already pending.`,
        );

        // 3. The notebook review (LLM): merges into profile/suggestions.md,
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

        // 3b. Under byte pressure, consolidate BEFORE anything else asks the
        //     model to stop minting. createMemoryFileUnlocked refuses a new
        //     skill once the notebook reaches the trigger tier, so the growth
        //     the budget stops has to be made room for here: exact-claim
        //     duplicates merge and the losers archive. This REDIRECTS the
        //     model into compressing its library rather than blocking it.
        //
        //     It bounds the ACTIVE library, not the blob — consolidation
        //     archives files with their content intact, because nothing in
        //     this store is proven safe to delete (utils/memoryBudget.ts).
        if (notebookWantsCleanup()) {
            const before = listSkills().length;
            await consolidateSkills(username);
            const after = listSkills().length;
            const merged = before - after;
            if (merged > 0) {
                lines.push(`Consolidated ${merged} duplicate skill${merged === 1 ? '' : 's'}`
                    + ` to make room under notebook size pressure`
                    + ` (${before} → ${after} active). Archived copies keep their content.`);
            }
        }

        // 4. Graveyard retention: enforce the newest-MAX_TOMBSTONES boundary the
        //    store itself declares over what is already persisted, and collect
        //    the rows every reader ignores. It revives nothing — that needs a
        //    fresh evidence cluster and is tested at draft time.
        const graveyard = await runGraveyardSweep(username);
        result.graveyardCollected = graveyard.collected;
        lines.push(graveyard.collected > 0
            ? `Graveyard: collected ${graveyard.collected} record${graveyard.collected === 1 ? '' : 's'}`
                + ` (${graveyard.expired} past the ${MAX_TOMBSTONES}-record retention, ${graveyard.duplicates} duplicate,`
                + ` ${graveyard.malformed} unreadable) — ${graveyard.retained} kept.`
            : `Graveyard: ${graveyard.retained} tombstone${graveyard.retained === 1 ? '' : 's'}, inside its retention`
                + ` (${MAX_TOMBSTONES} newest). Revival needs new evidence, not a timer.`);
        // 5. The idle lifecycle: a skill that has stopped matching anything
        //    stops being injected, and one that stays out of prompts leaves the
        //    active library. Step 1 only ever ASKED about that; asking was the
        //    half that never actuated, because a demoted-to-candidate skill is
        //    still ranked and still billed against the fixed injection budget.
        //    Always logged — a pass that switches content off has to be
        //    auditable in the Health tab even when the answer was "nothing".
        const idle = await runSkillIdleSweep(username, { now });
        result.skillsSuspended = idle.suspended.length;
        result.skillsRevived = idle.revived.length;
        result.skillsArchived = idle.archived.length;
        if (idle.configError) {
            lines.push(`Idle skill sweep did not run: ${idle.configError}`);
        } else if (idle.lines.length) {
            lines.push(...idle.lines);
        } else {
            const extra = idle.exempt > 0
                ? `, ${idle.exempt} exempt as already under a verdict`
                : '';
            const suspended = listSuspendedSkills().length;
            lines.push(`Idle skill sweep: ${idle.examined} skill${idle.examined === 1 ? '' : 's'} inspected`
                + `${extra} — none newly idle${suspended ? `, ${suspended} still suspended from prompts` : ''}.`);
        }

        // 6. Veto retraction. An AVOID skill is the one belief no trade
        //    outcome can ever refute — nothing trades while it blocks — so the
        //    settled vetoes in the ledger are its entire falsification record.
        //    The rollup was READ by a dashboard card and written back
        //    nowhere: a confirmed avoid skill whose blocks keep costing
        //    winners (WOULD_TP) kept vetoing forever. Both thresholds are
        //    deliberately high because a wrong demotion hands a live veto
        //    back to the market; and, like every destructive move here, it
        //    only queues — `applyDemoteProposal` runs when a judge says so.
        const accuracy = await VetoLedgerService.getAccuracyBySkill(username);
        const costly: string[] = [];
        let vetoExamined = 0;
        for (const { file, meta } of listSkills()) {
            const slot = accuracy[file.name];
            if (!slot) continue;
            vetoExamined += 1;
            const settled = slot.hits + slot.runs;
            if (settled < VETO_MIN_SETTLED) continue;
            if (slot.runs / settled <= VETO_COST_RATIO) continue;
            if (meta.status !== 'confirmed') continue;
            if (meta.evalVerdict === 'hurts') continue; // already on a demotion path
            const slug = file.name.replace(/\.md$/i, '');
            const queued = queueLearningProposal({
                kind: 'demote',
                skillSlug: slug,
                text: `"${slug}" has settled ${settled} veto${settled === 1 ? '' : 's'} and ${slot.runs} of them`
                    + ` (${Math.round((slot.runs / settled) * 100)}%) blocked a setup that would have hit take-profit —`
                    + ' the veto now costs more than it saves. Demote to candidate until its rule is rescoped?',
                fingerprint: `veto-costly|${slug}`,
            }, username);
            if (queued) costly.push(slug);
        }
        result.vetoDemotionsQueued = costly.length;
        lines.push(costly.length > 0
            ? `Veto ledger: queued ${costly.length} demotion proposal${costly.length === 1 ? '' : 's'}`
                + ` for avoid skills whose blocks keep costing winners (${costly.join(', ')}).`
            : vetoExamined === 0
                ? 'Veto ledger: no settled veto matches a live skill — nothing here can be falsified yet.'
                : `Veto ledger: ${vetoExamined} skill${vetoExamined === 1 ? '' : 's'} with settled vetoes,`
                    + ` none past the ${Math.round(VETO_COST_RATIO * 100)}%-costly bar.`);

        // 7. Negative lift. `computeSkillLift` has always known when a skill
        //    made things WORSE — post-influence win rate below the skill's own
        //    pre-skill baseline — and the only consumer of that verdict was a
        //    manual button on the dashboard. The verdict now reaches the same
        //    proposal queue every other destructive move uses, through the
        //    same canonical review (`reviewSkillEffectiveness` applies the
        //    sample floor and writes the rationale), so the numbers cannot
        //    drift from what the dashboard shows. Trades arrive the way the
        //    sibling passes take them — from the caller — because this module
        //    has never touched the journal store. With none in scope the step
        //    reports itself skipped rather than pretending the loop ran.
        const trades = opts.trades;
        if (!trades || trades.length === 0) {
            lines.push('Lift review skipped — no trade log in scope for this pass.');
        } else {
            try {
                const injections = await getRecentMemoryInjections(username);
                const liftByFileId = Object.fromEntries(
                    computeAllSkillLifts(trades, injections).map(l => [l.fileId, l]),
                );
                const negative = reviewSkillEffectiveness({ liftByFileId }).filter(r =>
                    r.recommendation === 'demote'
                    && r.liftVerdict === 'negative'
                    && r.evalVerdict !== 'hurts'); // the eval's own path speaks for it
                const nameById = new Map(listSkills().map(s => [s.file.id, s.file.name]));
                let liftQueued = 0;
                for (const review of negative) {
                    const fileName = nameById.get(review.fileId);
                    if (!fileName) continue;
                    const slug = fileName.replace(/\.md$/i, '');
                    const queued = queueLearningProposal({
                        kind: 'demote',
                        skillSlug: slug,
                        text: review.rationale,
                        fingerprint: `neg-lift|${slug}`,
                    }, username);
                    if (queued) liftQueued += 1;
                }
                result.liftDemotionsQueued = liftQueued;
                lines.push(liftQueued > 0
                    ? `Lift review: queued ${liftQueued} demotion proposal${liftQueued === 1 ? '' : 's'}`
                        + ' for skills whose setups got worse once they were injecting.'
                    : negative.length > 0
                        ? `Lift review: ${negative.length} below-baseline proposal${negative.length === 1 ? '' : 's'} already pending.`
                        : 'Lift review: no enabled skill is below its own pre-influence baseline.');
            } catch (e) {
                lines.push(`Lift review skipped — ${e instanceof Error ? e.message : String(e)}.`);
            }
        }
        await appendLog(username, now, lines);
        return result;
    } catch (e) {
        console.warn('[MemoryHygiene] pass failed (non-fatal):', e instanceof Error ? e.message : e);
        // Log the aborted attempt rather than nothing. This preference IS the
        // due-stamp — `isHygieneDue` reads the newest line's atMs — so a pass
        // that died after doing real work (the idle sweep and the review queue
        // both write notebook files, and `persist` rethrows on a full quota)
        // used to re-fire on every boot forever, re-spending the LLM review
        // while the Health tab showed no passes at all. Pressure can still
        // SHORTEN the wait; it just can't be reset by a crash.
        lines.push(`Idle sweep ABORTED: ${e instanceof Error ? e.message : String(e)}. `
            + 'Whatever it switched before failing is already applied; this pass will not re-run until it is next due.');
        try {
            await appendLog(username, now, lines);
        } catch {
            // The log write itself can fail on the same quota. Nothing to do
            // but let the next boot try again — never swallow a NOTEBOOK write
            // silently, but this one is the audit trail, not the trader's data.
        }
        return result;
    }
};

/** Boot hook, beside `runWeeklyReviewIfDue`. Fire-and-forget, own due-check.
 *  `trades` (like the sibling passes' second argument) is what the lift
 *  review measures over — pass it or step 7 reports itself skipped. */
export const runMemoryHygieneIfDue = async (
    username: string,
    providerConfigs?: ProviderConfig[],
    trades?: LoggedTrade[],
): Promise<HygieneResult | null> => {
    try {
        if (!(await isHygieneDue(username))) return null;
        return await runMemoryHygiene(username, { providerConfigs, trades });
    } catch {
        return null;
    }
};
