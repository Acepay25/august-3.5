/**
 * GoalRailPanel — the Goals tab of the Chat rail.
 *
 * Two things the agent has been shaping mid-task, in the one column that
 * already lists its threads: the goal environments it works inside, and the
 * change ledger it writes when the trader allows self-modification. Both are
 * read from the notebook's sync cache, so the tab costs no fetch, and both are
 * refreshed by the notebook's own change listener — a goal the desk created on
 * the last turn is here without a reload.
 *
 * Every control here does something. A row that could not be focused, paused,
 * restored or deleted would be a screenshot of the trader's work state, and the
 * surface's whole claim is that the trader can overrule the desk.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createGoal, deleteGoal, focusGoal, listGoals, restoreGoal, updateGoal,
} from '../../services/goals/GoalService';
import { subscribeMemoryFilesChanged } from '../../services/learning/MemoryFilesService';
import { liveSelfChanges } from '../../services/selfMod/SelfChangeLedger';
import { getSelfModMode, revertSelfChange } from '../../services/selfMod/SelfModificationService';
import type { Goal } from '../../schemas/goal';
import type { SelfChange } from '../../schemas/selfChange';
import { CheckIcon, CloseIcon, TargetIcon, Trash2 } from '../shared/Icons';
import StatusPill from '../ui/StatusPill';

interface GoalRailPanelProps {
    username: string;
}

const STATUS_TONE = { active: 'info', paused: 'warn', done: 'up' } as const;

const GoalRow: React.FC<{
    goal: Goal;
    busy: boolean;
    onToggleFocus: () => void;
    onToggleStatus: () => void;
    onRestore: (version: number) => void;
    onDelete: () => void;
}> = ({ goal, busy, onToggleFocus, onToggleStatus, onRestore, onDelete }) => {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const recent = goal.history.slice(-3).reverse();
    return (
        <div className={`rounded-control px-2 py-1.5 ${goal.focused ? 'bg-zinc-800/70' : 'bg-zinc-800/20'}`}>
            <div className="flex items-start gap-2">
                <button
                    type="button"
                    disabled={busy}
                    onClick={onToggleFocus}
                    data-testid={`goal-focus-${goal.slug}`}
                    aria-pressed={goal.focused}
                    title={goal.focused ? 'Release this goal — the desk stops working inside it' : 'Work inside this goal'}
                    className={`mt-0.5 shrink-0 rounded-control p-1 transition-colors disabled:opacity-40 ${
                        goal.focused ? 'text-cyan-300 hover:text-cyan-200' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                >
                    {goal.focused
                        ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        : <TargetIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-ui-sm text-zinc-200" title={goal.title}>{goal.title}</span>
                        <StatusPill tone={STATUS_TONE[goal.status]} className="shrink-0 px-1 text-ui-2xs">{goal.status}</StatusPill>
                    </span>
                    <span className="mt-0.5 block truncate text-ui-dense text-zinc-500" title={goal.objective}>{goal.objective}</span>
                    {goal.next && (
                        <span className="mt-0.5 block truncate text-ui-dense text-zinc-600" title={`Next: ${goal.next}`}>next: {goal.next}</span>
                    )}
                    {goal.policy.allowedTools && goal.policy.allowedTools.length > 0 && (
                        <span className="mt-0.5 block truncate text-ui-2xs text-zinc-700" title={goal.policy.allowedTools.join(', ')}>
                            narrowed to {goal.policy.allowedTools.length} tool{goal.policy.allowedTools.length === 1 ? '' : 's'}
                        </span>
                    )}
                </span>
            </div>
            <div className="mt-1 flex items-center gap-1 pl-6">
                <button
                    type="button" disabled={busy} onClick={onToggleStatus}
                    data-testid={`goal-status-${goal.slug}`}
                    className="hit-target rounded-control px-1.5 py-0.5 text-ui-dense text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40"
                >
                    {goal.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                {recent.length > 0 && (
                    <details className="relative">
                        <summary className="hit-target list-none cursor-pointer rounded-control px-1.5 py-0.5 text-ui-dense text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                            history
                        </summary>
                        <div className="mt-1 space-y-1 rounded-control border border-zinc-800 bg-zinc-900 p-1.5">
                            {recent.map(h => (
                                <button
                                    key={h.version} type="button" disabled={busy}
                                    onClick={() => onRestore(h.version)}
                                    data-testid={`goal-restore-${goal.slug}-${h.version}`}
                                    className="block w-full truncate rounded-control px-1 py-0.5 text-left text-ui-dense text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40"
                                    title={`${h.summary} · v${h.version} · ${h.at}`}
                                >
                                    restore v{h.version} — {h.summary}
                                </button>
                            ))}
                        </div>
                    </details>
                )}
                {confirmDelete ? (
                    <span className="ml-auto flex items-center gap-1">
                        <button
                            type="button" disabled={busy} onClick={onDelete}
                            data-testid={`goal-delete-confirm-${goal.slug}`}
                            className="hit-target rounded-control bg-rose-500/15 px-1.5 py-0.5 text-ui-dense text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-40"
                        >
                            Delete
                        </button>
                        <button
                            type="button" onClick={() => setConfirmDelete(false)}
                            aria-label={`Keep ${goal.title}`}
                            className="hit-target rounded-control p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                        >
                            <CloseIcon className="h-3 w-3" aria-hidden="true" />
                        </button>
                    </span>
                ) : (
                    <button
                        type="button" disabled={busy} onClick={() => setConfirmDelete(true)}
                        aria-label={`Delete ${goal.title}`} data-testid={`goal-delete-${goal.slug}`}
                        className="ml-auto hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-rose-300 disabled:opacity-40"
                    >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
};

const ChangeRow: React.FC<{ row: SelfChange; busy: boolean; onRevert: () => void }> = ({ row, busy, onRevert }) => (
    <div className="rounded-control bg-zinc-800/20 px-2 py-1.5" data-testid={`self-change-${row.id}`}>
        <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-ui-sm text-zinc-200" title={row.target}>{row.target}</span>
                    <StatusPill
                        tone={row.status === 'promoted' ? 'up' : row.status === 'shadow' ? 'warn' : 'info'}
                        className="shrink-0 px-1 text-ui-2xs"
                    >
                        {row.status}
                    </StatusPill>
                </span>
                <span className="mt-0.5 block truncate text-ui-dense text-zinc-500" title={row.reason}>{row.reason}</span>
                <span className="mt-0.5 block truncate text-ui-2xs text-zinc-600" title={`was ${row.before}`}>
                    now {row.after.slice(0, 48)}{row.after.length > 48 ? '…' : ''}
                </span>
            </span>
            <button
                type="button" disabled={busy} onClick={onRevert}
                data-testid={`self-change-revert-${row.id}`}
                title={`Restore the value this replaced (${row.before.slice(0, 40) || 'none'})`}
                className="hit-target shrink-0 rounded-control border border-zinc-800 px-1.5 py-0.5 text-ui-dense text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
            >
                Undo
            </button>
        </div>
    </div>
);

const GoalRailPanel: React.FC<GoalRailPanelProps> = ({ username }) => {
    const [goals, setGoals] = useState<Goal[]>(() => listGoals());
    const [changes, setChanges] = useState<SelfChange[]>(() => liveSelfChanges());
    const [mode, setMode] = useState(() => getSelfModMode());
    const [draftOpen, setDraftOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [objective, setObjective] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(() => {
        setGoals(listGoals());
        setChanges(liveSelfChanges());
        setMode(getSelfModMode());
    }, []);

    // One listener, one source: every write here lands in the notebook, and the
    // notebook announces it, so a goal the desk created mid-turn shows up without
    // this component owning a copy of the store.
    useEffect(() => subscribeMemoryFilesChanged(refresh), [refresh]);

    const run = useCallback(async (label: string, fn: () => Promise<unknown>): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            // Named, not swallowed: the trader pressed a control and needs to know
            // the write did not land, or they will act on a goal that did not change.
            setError(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusy(false);
            refresh();
        }
    }, [refresh]);

    const canCreate = title.trim().length > 0 && objective.trim().length > 0;
    const orderedGoals = useMemo(
        () => [...goals].sort((a, b) => Number(!!b.focused) - Number(!!a.focused) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        [goals],
    );

    return (
        <div className="space-y-2" data-testid="rail-goals">
            <section data-testid="rail-goals-section">
                <div className="flex items-center gap-1 px-1 pb-1">
                    <h4 className="text-ui-dense text-zinc-500">Goals</h4>
                    <button
                        type="button" disabled={busy} data-testid="goal-new-toggle"
                        onClick={() => setDraftOpen(v => !v)}
                        aria-expanded={draftOpen}
                        aria-label="New goal" title="New goal"
                        className="ml-auto hit-target rounded-control p-1.5 text-zinc-600 transition-colors hover:text-zinc-200 disabled:opacity-40"
                    >
                        <span className="block text-ui-base leading-none" aria-hidden="true">+</span>
                    </button>
                </div>
                {draftOpen && (
                    <div className="mb-1 space-y-1 rounded-control border border-zinc-800 bg-zinc-900 p-2">
                        <label className="block">
                            <span className="text-ui-2xs uppercase tracking-widest text-zinc-600">Title</span>
                            <input
                                value={title} onChange={e => setTitle(e.target.value)}
                                data-testid="goal-title-input" aria-label="Goal title"
                                placeholder="Q4 journal review"
                                className="mt-0.5 w-full rounded-control border border-zinc-700 bg-zinc-950 px-2 py-1 text-ui-sm text-zinc-100"
                            />
                        </label>
                        <label className="block">
                            <span className="text-ui-2xs uppercase tracking-widest text-zinc-600">Objective</span>
                            <textarea
                                value={objective} onChange={e => setObjective(e.target.value)}
                                data-testid="goal-objective-input" aria-label="Goal objective"
                                rows={2} placeholder="What done looks like"
                                className="mt-0.5 w-full resize-none rounded-control border border-zinc-700 bg-zinc-950 px-2 py-1 text-ui-sm text-zinc-100"
                            />
                        </label>
                        <button
                            type="button" disabled={busy || !canCreate} data-testid="goal-create"
                            onClick={() => void run('Creating the goal', async () => {
                                await createGoal(
                                    { title: title.trim(), objective: objective.trim(), focused: false },
                                    { username, source: 'human', by: 'human', summary: 'created in the rail' },
                                );
                                setTitle(''); setObjective(''); setDraftOpen(false);
                            })}
                            className="w-full rounded-control bg-zinc-800 px-2 py-1 text-ui-sm text-zinc-100 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                        >
                            Create goal
                        </button>
                    </div>
                )}
                {orderedGoals.length === 0 && !draftOpen && (
                    <p className="px-1 py-2 text-ui-dense leading-5 text-zinc-600">
                        No goals yet. A goal is the work the desk is inside — ask it in Chat to open one, or press +.
                    </p>
                )}
                <div className="space-y-1">
                    {orderedGoals.map(goal => (
                        <GoalRow
                            key={goal.slug}
                            goal={goal}
                            busy={busy}
                            onToggleFocus={() => void run(goal.focused ? 'Releasing the goal' : 'Focusing the goal',
                                () => focusGoal(goal.slug, !goal.focused, { by: 'human' }))}
                            onToggleStatus={() => void run('Changing the goal',
                                () => updateGoal(goal.slug, { status: goal.status === 'active' ? 'paused' : 'active' }, { by: 'human' }))}
                            onRestore={version => void run('Restoring the goal',
                                () => restoreGoal(goal.slug, version, { by: 'human' }))}
                            onDelete={() => void run('Deleting the goal', async () => {
                                const gone = await deleteGoal(goal.slug, username);
                                if (!gone) throw new Error(`"${goal.slug}" is still in the notebook`);
                            })}
                        />
                    ))}
                </div>
            </section>

            {mode !== 'off' && (
                <section data-testid="rail-self-changes">
                    <h4 className="px-1 pb-1 text-ui-dense text-zinc-500">
                        Harness changes
                        <span className="ml-1 text-ui-2xs text-zinc-600">({mode})</span>
                    </h4>
                    {changes.length === 0 ? (
                        <p className="px-1 py-2 text-ui-dense leading-5 text-zinc-600">
                            Nothing the desk has changed about itself is in force.
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {changes.map(row => (
                                <ChangeRow
                                    key={row.id}
                                    row={row}
                                    busy={busy}
                                    onRevert={() => void run('Undoing the change', async () => {
                                        const res = await revertSelfChange(row.id, 'owner');
                                        if (!res.ok) throw new Error(res.error);
                                    })}
                                />
                            ))}
                        </div>
                    )}
                </section>
            )}

            {error && (
                <p role="status" data-testid="rail-goals-error"
                    className="rounded-control border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-ui-dense text-rose-300">
                    {error}
                </p>
            )}
        </div>
    );
};

/** A human-created goal carries its own source stamp: the desk does not get
 *  credit — or blame — for a goal the trader wrote, which is why `createGoal`
 *  is called with `source: 'human'` above rather than the model default. */
export default GoalRailPanel;
