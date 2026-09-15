/**
 * Skill graveyard + retirement taxonomy (plan.4a/b).
 *
 * Retired skills must stay barely visible: nothing stopped the worth gate
 * from re-creating the same skill from the next loss cluster. This module
 * keeps a one-line-per-retired-skill tombstone index ("tried X, retired:
 * <reason> after N=<sampleN>, lift was <±pts>"), records WHY a skill retired
 * (taxonomy: insufficient-evidence | regime-shifted | superseded | eval-hurts
 * | user-veto), feathers a re-entry rule per reason, and dedupes creation
 * against the ARCHIVE so a retired twin raises a REVIVAL review card instead
 * of a fresh skill. The graveyard is injected into the worth gate's context
 * (capped), never into a debate.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { getMemoryFiles, ARCHIVE_FOLDER_NAME } from './MemoryFilesService';
import * as SkillMemoryService from './SkillMemoryService';
import type { SkillMeta } from './SkillMemoryService';
import { queueLearningProposal } from '../../utils/learningQueue';

/**
 * CYCLE HYGIENE (v1.0.20 TDZ class): SkillMemoryService statically imports
 * this module (recordTombstone/findArchiveTwin/queueRevivalProposal/
 * retirementReasonFromHistory) while we import its `parseSkillMarkdown` —
 * a module-global cycle, and the target is a `const` arrow export, i.e.
 * hoisted-but-uninitialized (TDZ) for part of the cyclic evaluation. This
 * file keeps every reference to the other side behind a HOISTED `function`
 * and resolves the binding through the module namespace AT CALL TIME, so no
 * evaluation-order flip (dev vs Rollup chunking) can dereference the const
 * before its declaration runs.
 */
function parseArchivedSkill(content: string): SkillMeta | null {
    return SkillMemoryService.parseSkillMarkdown(content);
}

const KEY_PREFIX = 'skill_graveyard_v1_';
const MAX_TOMBSTONES = 40;

export type RetirementReason =
    | 'insufficient-evidence'
    | 'regime-shifted'
    | 'superseded'
    | 'eval-hurts'
    | 'user-veto';

export interface SkillTombstone {
    slug: string;
    reason: RetirementReason;
    sampleN: number;
    /** Measured lift in percentage points, or null when unknown. */
    liftPts: number | null;
    retiredAt: string;
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const read = async (username: string): Promise<SkillTombstone[]> => {
    try {
        const raw = await getPreferenceObject<SkillTombstone[]>(keyFor(username));
        return Array.isArray(raw) ? raw.filter(t => t && typeof t.slug === 'string') : [];
    } catch {
        return [];
    }
};

const write = async (username: string, list: SkillTombstone[]): Promise<void> => {
    try {
        // List is newest-first — keep the NEWEST MAX_TOMBSTONES entries.
        await setPreferenceObject(keyFor(username), list.slice(0, MAX_TOMBSTONES));
    } catch { /* graveyard must never break the retirement path */ }
};

export async function listTombstones(username: string): Promise<SkillTombstone[]> {
    return read(username);
}

/** Record (or refresh) one retired skill's tombstone line. */
export async function recordTombstone(
    username: string,
    entry: Omit<SkillTombstone, 'retiredAt'> & { retiredAt?: string },
): Promise<void> {
    try {
        const list = await read(username);
        const next: SkillTombstone = {
            ...entry,
            slug: entry.slug.replace(/\.md$/i, ''),
            retiredAt: entry.retiredAt ?? new Date().toISOString(),
        };
        const rest = list.filter(t => t.slug !== next.slug);
        await write(username, [{ ...next }, ...rest]);
    } catch { /* ignore */ }
}

/** One-line graveyard entries, newest first — the worth-gate context block. */
export async function graveyardBlock(username: string, max = MAX_TOMBSTONES): Promise<string> {
    const list = await read(username);
    if (list.length === 0) return '';
    return list
        .slice(0, max)
        .map(t => `- ${t.slug}: tried, retired: ${t.reason} after N=${t.sampleN}, lift ${t.liftPts !== null ? `${t.liftPts >= 0 ? '+' : ''}${t.liftPts}pt` : 'unknown'}`)
        .join('\n');
}

/** Re-entry rules per reason (table). */
export function reEntryRuleForReason(reason: RetirementReason): string {
    switch (reason) {
        case 'regime-shifted':
            return 'MAY auto-revive (user-confirmed) when the regime ledger shows its regime returning with ≥3 fresh episodes.';
        case 'insufficient-evidence':
            return 're-eligible when a NEW cluster arrives with more evidence than the failed window had.';
        case 'superseded':
            return 'stays retired while its successor lives; revives as a suggestion if the successor itself retires.';
        case 'eval-hurts':
        case 'user-veto':
            return 'explicit human action required — no auto path.';
    }
}

/**
 * Map a ledger transition reason (the string stamped when the skill left
 * 'confirmed'/'candidate' for 'retired') to the retirement taxonomy.
 */
export function retirementReasonFromHistory(
    lastTransitionReason: string | undefined,
): RetirementReason {
    const r = (lastTransitionReason || '').toLowerCase();
    if (r.includes('superseded') || r.includes('worth-gate merge')) return 'superseded';
    if (r.includes('eval hurts') || r.includes('eval')) return 'eval-hurts';
    if (r.includes('user-veto') || r.includes('manual')) return 'user-veto';
    if (r.includes('regime')) return 'regime-shifted';
    return 'insufficient-evidence';
}

/** Normalized trigger identity for twin matching: lowercase, ids/paths/numbers
 *  stripped, collapsible spaces. */
const normTrigger = (s: string | undefined): string =>
    (s || '')
        .toLowerCase()
        .replace(/[a-z0-9_-]{8,}\//g, '')            // paths
        .replace(/\b[a-z0-9]{6,}\b/g, ' ')            // ids/hash-like tokens
        .replace(/\b\d+(\.\d+)?\b/g, ' ')             // prices/numbers
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const tokenSet = (s: string | undefined): string[] =>
    normTrigger(s).split(' ').filter(Boolean).sort();

export interface ArchiveTwinMatch {
    slug: string;
    /** Normalized trigger of the archived twin (for the card text). */
    ifCondition: string;
    reason: RetirementReason;
    sampleN: number;
    /** Exact (norm) or token-set match. */
    how: 'exact' | 'tokens';
}

/**
 * Is there an ARCHIVED skill whose trigger matches this candidate (exact or
 * token-shuffled)? Retired/archive files only — live dedup is already handled
 * by the creation path.
 */
export function findArchiveTwin(
    username: string,
    ifCondition: string | undefined,
): ArchiveTwinMatch | null {
    const norm = normTrigger(ifCondition);
    if (!norm) return null;
    const tokens = tokenSet(ifCondition);
    const archive = getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME);
    // No archive folder ⇒ there is no retired twin to find. (isSkillFile is
    // folder-based — archive files are NOT skill files — so the folder IS the
    // filter and parseArchivedSkill discriminates the content.)
    if (!archive) return null;
    for (const file of getMemoryFiles().files) {
        if (file.folderId !== archive.id) continue;
        if (!file.name.endsWith('.md')) continue;
        const meta = parseArchivedSkill(file.content);
        if (!meta) continue;
        const metaNorm = normTrigger(meta.ifCondition);
        if (metaNorm === norm) {
            return twinMatch(file.name, meta, 'exact');
        }
        if (tokens.length >= 2) {
            const metaTokens = tokenSet(meta.ifCondition);
            if (metaTokens.length >= 2 && metaTokens.join(' ') === tokens.join(' ')) {
                return twinMatch(file.name, meta, 'tokens');
            }
        }
    }
    return null;
}

function twinMatch(
    slug: string,
    meta: SkillMeta,
    how: 'exact' | 'tokens',
): ArchiveTwinMatch {
    const last = meta.history?.[meta.history.length - 1];
    return {
        slug: slug.replace(/\.md$/i, ''),
        ifCondition: meta.ifCondition ?? '',
        reason: retirementReasonFromHistory(last?.reason),
        sampleN: (meta.wins || 0) + (meta.losses || 0),
        how,
    };
}

/** Draft a REVIVAL review card instead of a fresh skill. Returns the queued
 *  proposal (null when a matching proposal is already pending). */
export function queueRevivalProposal(
    username: string,
    twin: ArchiveTwinMatch,
): ReturnType<typeof queueLearningProposal> {
    const rule = reEntryRuleForReason(twin.reason);
    return queueLearningProposal({
        kind: 'revival',
        skillSlug: twin.slug,
        text: `"${twin.slug}" was tried and retired: ${twin.reason} after N=${twin.sampleN} — ${rule} Re-create it anyway?`,
        fingerprint: `revival|${twin.slug}|${twin.ifCondition}`,
        payload: { slug: twin.slug, reason: twin.reason, sampleN: twin.sampleN },
    }, username);
}
