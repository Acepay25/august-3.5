/**
 * skillIdleLifecycle — a skill that stops describing the market leaves the
 * prompt, and if it stays silent it leaves the library.
 *
 * Why this exists: the confirmed-skill set is capped but the injection budget
 * is fixed, so every idle skill that stays live silently taxes every other
 * skill's chance of being seen (see `checkLibraryCapAtGate`). Before this, the
 * only ways out were evidence-driven: `deriveStatus` retiring a skill whose
 * win-rate fell, and `memoryHygiene` queuing a demotion PROPOSAL after 60 days
 * of silence — which needs a supervisor or a human to actuate. A skill that
 * simply stopped matching anything was addressed by neither: it cannot fall in
 * win-rate if it never fires, and a skill demoted to candidate is still ranked
 * and still injected.
 *
 * Two stages, and the second only ever follows the first:
 *
 *   idle ≥ SUSPEND   →  suspended: `enabled = false`, so every read gate in the
 *                      retrieval path drops it from prompts. The file stays in
 *                      `skills/`, its status is untouched, and it is still
 *                      matched against closed trades (see the `suspendedAt`
 *                      carve-out in `applySkillEvidence`), so it can earn its
 *                      way back without a human noticing it was ever gone.
 *   suspended ≥ ARCHIVE →  archived: moved to the existing skills-archive
 *                      folder and given a graveyard tombstone, which is what
 *                      makes a future re-draft of the same lesson raise a
 *                      REVIVAL review card instead of landing as a fresh skill.
 *
 * Archive keys off WHEN IT WAS SUSPENDED, not off a second idle computation —
 * for two reasons. It means a first-ever sweep can only ever suspend, so
 * upgrading cannot empty a long-quiet library in one pass; and it keeps the
 * stage machine away from any clock this module itself writes.
 *
 * What this deliberately is NOT:
 *   - Not a status change. `SkillStatus` stays candidate/confirmed/retired.
 *     ~35 read sites ask `status !== 'retired'`, so a fourth value would read
 *     as live at every one of them; and the ladder in `deriveStatus` plus the
 *     temporal ledger have no meaning for "idle". Suspension rides `enabled`,
 *     which is already the single gate every injector checks — so there is no
 *     second source of truth to keep in sync.
 *   - Not a judgment. It reads a clock; it never edits a win/loss record and
 *     never decides whether the rule is right. Skills already on a verdict
 *     path (an `hurts` eval, an open shadow window, a pending inbox decision)
 *     are exempt, because a timer must not race a verdict.
 *   - Not destructive. Nothing is deleted at either stage, every byte stays in
 *     the notebook, and the graveyard can propose a revival.
 */

import {
    getMemoryFiles,
    updateMemoryFileUnlocked,
    ensureSkillsArchiveFolderUnlocked,
    withNotebookWriteLock,
    ARCHIVE_FOLDER_NAME,
} from './MemoryFilesService';
import {
    listSkills,
    serializeSkill,
    skillEnabledFlag,
    titleFromMeta,
    type SkillMeta,
} from './SkillMemoryService';
import { recordTombstone } from './skillGraveyard';
import { listLearningProposals } from '../../utils/learningQueue';

const DAY_MS = 86_400_000;

/** Idle this long, a skill stops being injected. Three evidence windows: long
 *  enough that a seasonal setup — a regime that returns once a quarter — is
 *  not switched off between visits, and far behind the 60-day point where the
 *  hygiene pass starts ASKING about demotion without anyone having to answer. */
export const SKILL_IDLE_SUSPEND_DAYS = 90;

/** Days spent suspended before leaving the active library for the archive
 *  folder. Two suspend windows: a rule gets one full chance to come back on
 *  its own before it is filed away. */
export const SKILL_IDLE_ARCHIVE_DAYS = 180;

/** The invariant that keeps the stages ordered. Returns a message when the
 *  configuration is impossible, null when sane — half a lifecycle is worse
 *  than none, so the sweep refuses to run rather than archive before it can
 *  suspend. */
export const idleWindowsInvalid = (
    suspendDays = SKILL_IDLE_SUSPEND_DAYS,
    archiveDays = SKILL_IDLE_ARCHIVE_DAYS,
): string | null =>
    (Number.isFinite(suspendDays) && Number.isFinite(archiveDays)
        && suspendDays > 0 && archiveDays > suspendDays)
        ? null
        : `idle lifecycle windows must satisfy 0 < suspend (${suspendDays}) < archive (${archiveDays})`;

export type IdleStage = 'live' | 'suspended' | 'archived';

const isoMs = (raw: string | undefined): number => {
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? ms : 0;
};

/**
 * The only clock this module trusts for "is the market still like this rule".
 *
 * `lastEvidenceAt` alone cannot work: it advances only when a skill is
 * injected AND a matching trade closes, so the instant a skill is suspended
 * its clock freezes and suspension becomes a one-way door. `lastMatchedAt`
 * advances on a trigger match whether or not the skill was in the prompt.
 *
 * `file.updatedAt` is consulted ONLY for a legacy row that has neither field,
 * and never as a max with them: every notebook write bumps `updatedAt`
 * (`MemoryFilesService.updateMemoryFileUnlocked`), so folding it in would let
 * this sweep's own suspension write reset the clock it is judged on — a skill
 * would revive the moment it was suspended and pend forever between the two.
 */
export const idleClockMs = (
    meta: Pick<SkillMeta, 'lastEvidenceAt' | 'lastMatchedAt'>,
    file: { createdAt: number; updatedAt: number },
): number => {
    const earned = Math.max(isoMs(meta.lastEvidenceAt), isoMs(meta.lastMatchedAt));
    if (earned) return earned;
    return Math.max(Number.isFinite(file.updatedAt) ? file.updatedAt : 0,
        Number.isFinite(file.createdAt) ? file.createdAt : 0);
};

/** Whole days since that clock. `0` when it is unreadable, which is the safe
 *  direction: no clock, no action. */
export const idleDaysFor = (
    meta: Pick<SkillMeta, 'lastEvidenceAt' | 'lastMatchedAt'>,
    file: { createdAt: number; updatedAt: number },
    now: number,
): number => {
    const last = idleClockMs(meta, file);
    if (!last) return 0;
    return Math.max(0, Math.floor((now - last) / DAY_MS));
};

/** Inbox kinds that mean a human or supervisor is ALREADY deciding this skill.
 *  `demote` is pointedly absent: that proposal is the never-actuated path this
 *  lifecycle exists to finish, so honouring it as a veto would exempt every
 *  skill the sweep was written for. */
const BLOCKING_PROPOSAL_KINDS = new Set(['displacement', 'rescope', 'revival', 'contradiction']);

/** Why a skill is exempt from the sweep, or null when it is fair game. */
export const idleExemptionFor = (
    meta: SkillMeta,
    slug: string,
    blockedSlugs: ReadonlySet<string>,
): string | null => {
    // A book seed is a curated prior that never accrues a record of its own
    // unless it proves out. The zero-evidence injection ban already exempts
    // it; a recency timer would switch off the starter playbooks for good.
    if (meta.prior === 'book') return 'book seed';
    // Already retired: the graveyard and archive sweep own it.
    if (meta.status === 'retired') return 'retired';
    if (meta.supersededBy) return 'superseded';
    // An `hurts` eval is a demotion judged on evidence, not on silence.
    if (meta.evalVerdict === 'hurts') return 'eval verdict';
    // A refinement shadow is an experiment mid-flight; switching the host off
    // underneath it destroys the comparison window it exists to measure.
    if (meta.shadow) return 'shadow window open';
    if (blockedSlugs.has(slug.toLowerCase())) return 'decision pending';
    return null;
};

export interface SkillIdleSweepResult {
    examined: number;
    exempt: number;
    suspended: string[];
    revived: string[];
    archived: string[];
    /** One line per action taken, for the hygiene log and the Health tab. */
    lines: string[];
    /** Set when the configured windows are impossible; the sweep then did
     *  nothing at all. */
    configError: string | null;
}

const slugsWithPendingDecisions = (username: string): Set<string> => {
    const out = new Set<string>();
    try {
        for (const p of listLearningProposals(username)) {
            if (!BLOCKING_PROPOSAL_KINDS.has(p.kind)) continue;
            const slug = (p.skillSlug || '').replace(/\.md$/i, '').toLowerCase();
            if (slug) out.add(slug);
        }
    } catch { /* an unreadable inbox reads as empty: the sweep stays conservative */ }
    return out;
};

export interface SkillIdleSweepOptions {
    now?: number;
    /** Overridable so the ordering invariant is testable and a future setting
     *  has somewhere to land; both default to the exported windows. */
    suspendDays?: number;
    archiveDays?: number;
}

/**
 * Run the sweep. Serialized against the notebook like every other writer, and
 * it never throws — a hygiene pass that breaks boot is worse than one that
 * skips a week.
 */
export const runSkillIdleSweep = (
    username: string,
    opts: SkillIdleSweepOptions = {},
): Promise<SkillIdleSweepResult> => withNotebookWriteLock(async () => {
    const now = opts.now ?? Date.now();
    const suspendDays = opts.suspendDays ?? SKILL_IDLE_SUSPEND_DAYS;
    const archiveDays = opts.archiveDays ?? SKILL_IDLE_ARCHIVE_DAYS;
    const result: SkillIdleSweepResult = {
        examined: 0, exempt: 0, suspended: [], revived: [], archived: [], lines: [], configError: null,
    };
    const bad = idleWindowsInvalid(suspendDays, archiveDays);
    if (bad) {
        result.configError = bad;
        console.warn('[SkillIdle] sweep skipped:', bad);
        return result;
    }

    const blocked = slugsWithPendingDecisions(username);
    // The archive folder is created lazily: a sweep that archives nothing must
    // not leave an empty folder behind in every user's notebook.
    let archive = getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME) ?? null;

    for (const { file, meta } of listSkills()) {
        result.examined += 1;
        const slug = file.name.replace(/\.md$/i, '');
        if (idleExemptionFor(meta, slug, blocked)) { result.exempt += 1; continue; }

        const suspendedAt = isoMs(meta.suspendedAt);
        const clock = idleClockMs(meta, file);

        // 1. Revival. Something happened AFTER the suspension — the trigger
        //    matched a trade that has since closed — so the rule is still
        //    describing this market and there is nothing to decide. Only the
        //    two earned clocks can prove this: they are the ones this module
        //    never writes.
        if (suspendedAt && clock > suspendedAt) {
            meta.suspendedAt = undefined;
            await updateMemoryFileUnlocked(file.id, {
                content: serializeSkill(meta, titleFromMeta(meta)),
                enabled: skillEnabledFlag(meta),
            }, username);
            result.revived.push(slug);
            continue;
        }

        // 2. Archive: it stayed suspended past the long window. Keyed on the
        //    suspension, so a first-ever sweep can never reach this branch.
        if (suspendedAt && now - suspendedAt >= archiveDays * DAY_MS) {
            if (!archive) archive = await ensureSkillsArchiveFolderUnlocked(username);
            await updateMemoryFileUnlocked(file.id, {
                content: serializeSkill(meta, titleFromMeta(meta)),
                ...(archive ? { folderId: archive.id } : {}),
                enabled: false,
            }, username);
            result.archived.push(slug);
            void recordTombstone(username, {
                slug,
                reason: 'idle',
                sampleN: (meta.wins || 0) + (meta.losses || 0),
                liftPts: null,
            });
            continue;
        }

        // 3. Suspend: idle past the short window and not already suspended.
        if (!suspendedAt && idleDaysFor(meta, file, now) >= suspendDays) {
            meta.suspendedAt = new Date(now).toISOString();
            await updateMemoryFileUnlocked(file.id, {
                content: serializeSkill(meta, titleFromMeta(meta)),
                enabled: false,
            }, username);
            result.suspended.push(slug);
        }
    }

    if (result.suspended.length) {
        result.lines.push(
            `Suspended ${result.suspended.length} skill${result.suspended.length === 1 ? '' : 's'}`
            + ` idle for ${suspendDays}+ days — still in the library, no longer in prompts.`,
        );
    }
    if (result.revived.length) {
        result.lines.push(
            `Revived ${result.revived.length} suspended skill${result.revived.length === 1 ? '' : 's'}`
            + ` whose trigger matched a trade since.`,
        );
    }
    if (result.archived.length) {
        result.lines.push(
            `Archived ${result.archived.length} skill${result.archived.length === 1 ? '' : 's'} that stayed`
            + ` idle past ${archiveDays} more days — moved to ${ARCHIVE_FOLDER_NAME}/, each with a`
            + ` graveyard tombstone so a re-draft raises a revival card.`,
        );
    }
    return result;
});

/**
 * Slugs currently suspended: in the skills folder, carrying a suspension stamp,
 * and out of prompts. Exported so the Health report and the hygiene log count
 * from one walk instead of two implementations that can drift apart. `enabled`
 * alone is not the test — a user-retired file is also disabled.
 */
export const listSuspendedSkills = (): string[] => listSkills()
    .filter(({ file, meta }) => !file.enabled && Boolean(meta.suspendedAt))
    .map(({ file }) => file.name.replace(/\.md$/i, ''));

/**
 * The stage a skill is in right now, for a reader that wants to say so. A
 * renderer must not re-derive this from `enabled` — a user-retired skill is
 * also disabled, and would be mislabelled idle.
 */
export const idleStageOf = (
    meta: Pick<SkillMeta, 'suspendedAt'>,
    file: { folderId: string },
    archiveFolderId: string | undefined,
): IdleStage => {
    if (archiveFolderId && file.folderId === archiveFolderId) return 'archived';
    return meta.suspendedAt ? 'suspended' : 'live';
};
