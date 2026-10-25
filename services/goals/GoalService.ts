/**
 * GoalService — the goal environment store.
 *
 * No new database: a goal is one JSON file in the notebook's `goals/` folder.
 * That means backup/export, the notebook write lock, the memory budget and the
 * file browser already apply. The service owns only the schema, focus and the
 * revision history the undo rail reads.
 *
 * A goal's policy can NARROW the seat's tools; it can never add one. The
 * intersection is applied at the turn transport, not here, so this module has
 * no authority to widen anything.
 */

import {
    createMemoryFile, createMemoryFolder, deleteMemoryFile, getMemoryFiles, updateMemoryFile,
} from '../learning/MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';
import {
    GoalSchema, GoalSnapshotSchema, GoalCreateSchema, GoalPatchSchema,
    type Goal, type GoalCreate, type GoalPatch, type GoalSnapshot,
} from '../../schemas/goal';

const GOALS_FOLDER = 'goals';
const MAX_HISTORY = 20;

const goalFile = (slug: string): string => `${slug}.json`;

const slugifyGoal = (title: string): string =>
    title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'goal';

const folder = () => getMemoryFiles().folders.find(f => f.name === GOALS_FOLDER);

const ensureGoalsFolder = async (username: string): Promise<string> => {
    const existing = folder();
    if (existing) return existing.id;
    const created = await createMemoryFolder(GOALS_FOLDER, username);
    return created.id;
};

const parseGoal = (content: string, fileName: string): Goal | null => {
    try {
        const parsed: unknown = JSON.parse(content);
        const result = GoalSchema.safeParse(parsed);
        if (!result.success) {
            console.warn(`[Goals] skipped "${fileName}": ${result.error.issues[0]?.message ?? 'invalid goal JSON'}`);
            return null;
        }
        return result.data;
    } catch (err) {
        console.warn(`[Goals] skipped "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
};

const goalFileOf = (slug: string) =>
    getMemoryFiles().files.find(f => f.folderId === folder()?.id && f.name === goalFile(slug));

/** Valid goals, focused first, newest first within each group. */
export const listGoals = (): Goal[] => {
    const dir = folder();
    if (!dir) return [];
    return getMemoryFiles().files
        .filter(f => f.folderId === dir.id && f.name.toLowerCase().endsWith('.json'))
        .map(f => parseGoal(f.content, f.name))
        .filter((g): g is Goal => !!g)
        .sort((a, b) => (Number(b.focused) - Number(a.focused)) || (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
};

export const getGoal = (slug: string): Goal | null =>
    listGoals().find(g => g.slug === slug) ?? null;

export const focusedGoal = (): Goal | null =>
    listGoals().find(g => g.focused && g.status !== 'done') ?? null;

const snapshotOf = (goal: Goal): GoalSnapshot => GoalSnapshotSchema.parse(goal);

const uniqueSlug = (base: string): string => {
    const taken = new Set(listGoals().map(g => g.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i += 1) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
};

const clearOtherFocus = async (except: string, username: string): Promise<void> => {
    for (const goal of listGoals()) {
        if (goal.slug === except || !goal.focused) continue;
        const file = goalFileOf(goal.slug);
        if (!file) continue;
        const next: Goal = {
            ...goal,
            focused: false,
            version: goal.version + 1,
            updatedAt: new Date().toISOString(),
        };
        try {
            await updateMemoryFile(file.id, { content: JSON.stringify(next, null, 2) }, username);
        } catch (err) {
            console.warn(`[Goals] could not clear focus on "${goal.slug}":`, err instanceof Error ? err.message : String(err));
        }
    }
};

const writeGoal = async (goal: Goal, username: string): Promise<void> => {
    const dirId = await ensureGoalsFolder(username);
    const existing = goalFileOf(goal.slug);
    const content = JSON.stringify(GoalSchema.parse(goal), null, 2);
    if (existing) {
        await updateMemoryFile(existing.id, { content }, username);
        return;
    }
    await createMemoryFile(dirId, goalFile(goal.slug), content, username, false);
};

export interface GoalWriteOptions {
    username?: string;
    source?: 'human' | 'model';
    by?: 'model' | 'human' | 'system';
    summary?: string;
    ifVersion?: number;
}

export type GoalUpdateResult =
    | { ok: true; goal: Goal }
    | { conflict: true; current: Goal };

/** Create a goal environment. An explicit slug may be supplied for re-imports;
 *  collisions get -2, -3… instead of overwriting a live goal. */
export const createGoal = async (input: GoalCreate, opts: GoalWriteOptions = {}): Promise<Goal> => {
    const username = opts.username || getActiveUsername();
    const parsed = GoalCreateSchema.parse(input);
    const now = new Date().toISOString();
    const slug = uniqueSlug(slugifyGoal(parsed.title));
    const goal: Goal = {
        schemaVersion: 1,
        slug,
        title: parsed.title,
        status: parsed.status,
        focused: parsed.focused,
        objective: parsed.objective,
        ...(parsed.next ? { next: parsed.next } : {}),
        inputs: parsed.inputs,
        outputs: parsed.outputs,
        triggers: parsed.triggers,
        policy: parsed.policy,
        ...(parsed.botId ? { botId: parsed.botId } : {}),
        ...(parsed.strategy ? { strategy: parsed.strategy } : {}),
        source: opts.source || 'model',
        version: 1,
        createdAt: now,
        updatedAt: now,
        history: [],
    };
    await writeGoal(goal, username);
    if (goal.focused) await clearOtherFocus(goal.slug, username);
    return goal;
};

/** Patch a goal, append the previous snapshot to history, and bump the
 *  optimistic-lock version. A stale if_version returns the current goal so the
 *  caller merges and retries in the same turn. */
export const updateGoal = async (slug: string, patch: GoalPatch, opts: GoalWriteOptions = {}): Promise<GoalUpdateResult> => {
    const current = getGoal(slug);
    if (!current) throw new Error(`no goal "${slug}"`);
    if (typeof opts.ifVersion === 'number' && current.version !== opts.ifVersion) {
        return { conflict: true, current };
    }
    const parsedPatch = GoalPatchSchema.parse(patch);
    const now = new Date().toISOString();
    const nextStatus = parsedPatch.status ?? current.status;
    const next: Goal = {
        ...current,
        ...parsedPatch,
        status: nextStatus,
        // A paused/done goal is not the active environment; focusing one makes
        // it active again. This is the one place focus and status reconcile.
        focused: parsedPatch.focused ?? (nextStatus === 'active' ? current.focused : false),
        ...(parsedPatch.focused ? { status: 'active' as const } : {}),
        version: current.version + 1,
        updatedAt: now,
        history: [
            ...current.history,
            {
                at: now,
                by: opts.by || 'model',
                summary: opts.summary || Object.keys(parsedPatch).join(', ') || 'updated',
                version: current.version,
                previous: snapshotOf(current),
            },
        ].slice(-MAX_HISTORY),
    };
    await writeGoal(next, usernameOf(opts),);
    if (next.focused) await clearOtherFocus(next.slug, usernameOf(opts));
    return { ok: true, goal: next };
};

const usernameOf = (opts: GoalWriteOptions): string => opts.username || getActiveUsername();

/** Restore a previous snapshot as a NEW revision (the history itself is kept). */
export const restoreGoal = async (slug: string, version: number, opts: GoalWriteOptions = {}): Promise<GoalUpdateResult> => {
    const current = getGoal(slug);
    if (!current) throw new Error(`no goal "${slug}"`);
    const entry = current.history.find(h => h.version === version);
    if (!entry) throw new Error(`goal "${slug}" has no saved version ${version}`);
    const snapshot = entry.previous;
    const now = new Date().toISOString();
    const restored: Goal = {
        ...snapshot,
        slug: current.slug,
        version: current.version + 1,
        updatedAt: now,
        history: [
            ...current.history,
            {
                at: now,
                by: opts.by || 'human',
                summary: `restored version ${version}`,
                version: current.version,
                previous: snapshotOf(current),
            },
        ].slice(-MAX_HISTORY),
    };
    await writeGoal(restored, usernameOf(opts));
    if (restored.focused) await clearOtherFocus(restored.slug, usernameOf(opts));
    return { ok: true, goal: restored };
};

export const focusGoal = async (slug: string, focused: boolean, opts: GoalWriteOptions = {}): Promise<GoalUpdateResult> =>
    updateGoal(slug, focused ? { focused: true } : { focused: false }, opts);

export const deleteGoal = async (slug: string, username = getActiveUsername()): Promise<boolean> => {
    const file = goalFileOf(slug);
    if (!file) return false;
    await deleteMemoryFile(file.id, username);
    return true;
};

/** The compact prompt block. One line per goal; the focused goal first, with
 *  its objective, next step, triggers and declared tool policy. The body is
 *  read on demand by open_goal, so this stays inside the shared index budget. */
export const buildGoalsIndex = (max = 6): string => {
    const active = listGoals().filter(g => g.status !== 'done');
    if (active.length === 0) return '';
    const focused = active.find(g => g.focused);
    const ordered = focused ? [focused, ...active.filter(g => g !== focused)] : active;
    const shown = ordered.slice(0, Math.max(1, max));
    const clip = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
    const triggerLabel = (g: Goal): string => g.triggers
        .map(t => t.kind === 'message' ? t.match.join('/') : t.kind === 'price' ? `watch ${t.watchId}` : 'session start')
        .join(', ');
    const lines = shown.map(g => {
        const bits = [
            `${g.focused ? '▶ ' : ''}${g.slug} [${g.status}] — ${clip(g.title, 80)}: ${clip(g.objective, 160)}`,
            g.next ? `next: ${clip(g.next, 100)}` : '',
            triggerLabel(g) ? `triggers: ${triggerLabel(g)}` : '',
        ].filter(Boolean);
        return `- ${bits.join(' · ')}`;
    });
    const head = focused
        ? `## Goals — ${active.length} active. You are inside "${focused.title}" (${focused.slug}). A goal is a durable work environment: adapt its objective, next step, inputs, outputs, triggers or tool policy with update_goal when the work changes; open_goal reads the full environment.`
        : `## Goals — ${active.length} active. A goal is a durable work environment; open_goal reads one, update_goal adapts it mid-task, and update_goal {focused:true} (or the trader) makes one the seat's environment.`;
    const policy = focused?.policy.allowedTools?.length
        ? `Focused goal policy narrows tools to: ${focused.policy.allowedTools.join(', ')}.`
        : '';
    return [
        head,
        ...(policy ? [policy] : []),
        ...lines,
        active.length > shown.length ? `…${active.length - shown.length} more — list_goals names every goal.` : '',
    ].filter(Boolean).join('\n');
};

/** A message trigger matches case-insensitively by substring. Session-start
 *  goals are surfaced by the index; price triggers ride the existing watch
 *  signal, not a new scheduler. */
export const goalMatchesMessage = (goal: Goal, message: string): boolean => {
    const text = message.toLowerCase();
    return goal.triggers.some(t => t.kind === 'message' && t.match.some(m => text.includes(m.toLowerCase())));
};
