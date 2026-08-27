/**
 * Cross-coin skill generalization (compounding memory).
 *
 * The harness learns one skill per coin. When the SAME family + kind + regime
 * produces confirmed skills on 2+ different coins, that is no longer a coin
 * quirk — it is a market behavior. Generalization folds the cluster into ONE
 * coin-less skill that applies everywhere, and retires the coin-scoped sources
 * (tagged `supersededBy`) so they become the control group instead of
 * double-counting evidence.
 *
 * The new skill is born a `candidate`: it still has to earn `confirmed`
 * through the normal evidence/eval path. Generalization proposes; evidence
 * disposes.
 */

import {
    getMemoryFiles,
    createMemoryFileUnlocked,
    updateMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    withNotebookWriteLock,
    slugifyName,
} from './MemoryFilesService';
import {
    listSkills,
    parseSkillMarkdown,
    serializeSkill,
    stampStatusTransition,
    MIN_SAMPLE_CONFIRMED,
    type SkillMeta,
    type SkillKind,
} from './SkillMemoryService';
import type { MemoryFile } from '../../types';

export interface GeneralizationScope {
    family: string;
    kind: SkillKind;
    regime: string;
}

export interface GeneralizationCandidate {
    scope: GeneralizationScope;
    /** Confirmed, coin-scoped skills sharing the scope across 2+ coins. */
    rows: Array<{ file: MemoryFile; meta: SkillMeta }>;
    coins: string[];
}

const normCoin = (coin?: string): string =>
    (coin || '').toUpperCase().replace(/USDT?$/, '').trim();

/**
 * Scan the notebook for clusters worth generalizing. Only CONFIRMED,
 * coin-scoped, not-yet-superseded skills participate — a candidate skill has
 * not earned the right to be generalized, and a coin-less skill already is.
 */
export const findGeneralizationCandidates = (): GeneralizationCandidate[] => {
    const groups = new Map<string, Array<{ file: MemoryFile; meta: SkillMeta }>>();
    for (const row of listSkills()) {
        const { file, meta } = row;
        if (meta.status !== 'confirmed') continue;
        if (meta.supersededBy) continue;
        if (!meta.coin || !meta.family || !meta.regime) continue;
        if (meta.wins + meta.losses < MIN_SAMPLE_CONFIRMED) continue;
        const key = `${meta.family.toLowerCase()}|${meta.kind}|${meta.regime.toLowerCase()}`;
        const arr = groups.get(key) ?? [];
        arr.push({ file, meta });
        groups.set(key, arr);
    }

    const out: GeneralizationCandidate[] = [];
    for (const [, rows] of groups) {
        const coins = Array.from(new Set(rows.map(r => normCoin(r.meta.coin)))).filter(Boolean);
        if (coins.length < 2) continue; // need 2+ distinct coins to generalize
        const first = rows[0].meta;
        out.push({
            scope: { family: first.family!, kind: first.kind, regime: first.regime! },
            rows,
            coins,
        });
    }
    return out;
};

const dedup = (ids: string[]): string[] => Array.from(new Set(ids.filter(Boolean)));

/**
 * Fold a cluster into one coin-less skill and supersede the sources.
 * Returns the new skill's meta, or null when the cluster is too small or the
 * target file already exists (idempotent — a second run is a no-op).
 * Caller-facing wrapper holds the notebook write lock.
 */
export const generalizeSkillClusterUnlocked = async (
    candidate: GeneralizationCandidate,
    username: string,
): Promise<SkillMeta | null> => {
    const { rows, scope } = candidate;
    if (rows.length < 2) return null;
    await ensureHarnessFoldersUnlocked(username);

    const { folders, files } = getMemoryFiles();
    const skillsFolder = folders.find(f => f.name === 'skills');
    if (!skillsFolder) return null;

    // Direction survives only if every source agrees; otherwise the
    // generalized skill is direction-agnostic.
    const directions = Array.from(new Set(rows.map(r => r.meta.direction).filter(Boolean)));
    const direction = directions.length === 1 ? directions[0] : undefined;

    const wins = rows.reduce((s, r) => s + r.meta.wins, 0);
    const losses = rows.reduce((s, r) => s + r.meta.losses, 0);
    const tradeIds = dedup(rows.flatMap(r => r.meta.tradeIds)).slice(-20);
    const controlIds = dedup(rows.flatMap(r => r.meta.controlIds ?? []));
    const evidenceCount = rows.reduce(
        (s, r) => s + Math.max(r.meta.evidenceCount ?? 0, r.meta.tradeIds.length), 0,
    );

    const slug = slugifyName(`${scope.family} ${scope.regime} ${scope.kind} all coins`) || 'generalized-skill';
    const fileName = `${slug}.md`;
    if (files.some(f => f.folderId === skillsFolder.id && f.name === fileName)) {
        return null; // already generalized — idempotent no-op
    }

    // Use the richest source's prose as the seed body; the evidence/eval path
    // will refine it later.
    const richest = rows.reduce((a, b) =>
        (b.meta.wins + b.meta.losses) > (a.meta.wins + a.meta.losses) ? b : a);

    const now = new Date().toISOString();
    const meta: SkillMeta = {
        status: 'candidate',
        kind: scope.kind,
        coin: undefined, // coin-less: applies to all coins
        direction,
        family: scope.family,
        regime: scope.regime,
        wins,
        losses,
        consecutiveLosses: 0,
        tradeIds,
        controlIds: controlIds.length > 0 ? controlIds.slice(-20) : undefined,
        evidenceCount,
        ifCondition: richest.meta.ifCondition,
        thenAction: richest.meta.thenAction,
        description: `Generalized across ${candidate.coins.join(', ')}: ${richest.meta.description ?? richest.meta.thenAction ?? scope.family}`,
        body: richest.meta.body,
        lastEvidenceAt: richest.meta.lastEvidenceAt,
        modifiedAt: now,
        audience: 'all',
        lensScope: 'all',
        history: [{ status: 'candidate', validFrom: now, reason: `generalized from ${rows.length} coin skills` }],
    };

    const title = `${scope.kind === 'avoid' ? 'Avoid' : 'Repeat'} ${scope.family} (${scope.regime}) — all coins`;
    await createMemoryFileUnlocked(skillsFolder.id, fileName, serializeSkill(meta, title), username, true);

    // Supersede the sources: retire them from matching but keep them (and
    // their evidence) as the control group, tagged with the successor.
    for (const { file, meta: srcMeta } of rows) {
        const updated = parseSkillMarkdown(file.content) ?? srcMeta;
        updated.supersededBy = slug;
        stampStatusTransition(updated, 'retired', `superseded by ${slug}`);
        updated.status = 'retired';
        await updateMemoryFileUnlocked(file.id, {
            content: serializeSkill(updated, file.name.replace(/\.md$/i, '')),
            enabled: false,
        }, username);
    }

    return meta;
};

export const generalizeSkillCluster = (
    candidate: GeneralizationCandidate,
    username: string,
): Promise<SkillMeta | null> =>
    withNotebookWriteLock(() => generalizeSkillClusterUnlocked(candidate, username));

/**
 * Convenience: find every due cluster and generalize them all. Returns the
 * number of new coin-less skills created. Best-effort per cluster — one bad
 * cluster never blocks the rest.
 */
export const runGeneralizationPass = async (username: string): Promise<number> => {
    let created = 0;
    for (const candidate of findGeneralizationCandidates()) {
        try {
            const made = await generalizeSkillCluster(candidate, username);
            if (made) created += 1;
        } catch (e) {
            console.warn('[SkillGeneralization] cluster failed:', e instanceof Error ? e.message : e);
        }
    }
    return created;
};
