/**
 * NewGroupDialog — the Hermes "New Group Chat" dialog: pick two or
 * more bots; the room fans one prompt out to every member with an
 * activity feed (@name to direct, @everyone for all). In edit mode it is
 * Group Settings: membership AND each member's debate role (General
 * analyst is the default) — the role rides the bot itself (the persona
 * follows it into every room turn and the ensemble pipeline).
 */

import React from 'react';
import { BotAvatar } from './BotAvatar';
import { SelectMenu } from '../shared/SelectMenu';
import { AnalystRole } from '../../types/enums';
import { ANALYST_ROLE_DEFINITIONS } from '../../services/ui/AnalystLensService';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';

/** Role options for a member's debate persona (UNASSIGNED = general default). */
const MEMBER_ROLE_OPTIONS: { value: AnalystRole; label: string }[] = [
    { value: AnalystRole.UNASSIGNED, label: 'General analyst (default)' },
    { value: AnalystRole.MACRO_VOLATILITY, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.MACRO_VOLATILITY].shortName },
    { value: AnalystRole.TECHNICAL_ANALYST, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.TECHNICAL_ANALYST].shortName },
    { value: AnalystRole.RISK_EXECUTION, label: ANALYST_ROLE_DEFINITIONS[AnalystRole.RISK_EXECUTION].shortName },
];

/** The role a bot carries, normalized (UNASSIGNED ≡ absent ≡ general). */
export const memberRoleOf = (bot: AgentBot): AnalystRole =>
    bot.role && bot.role !== AnalystRole.UNASSIGNED ? bot.role : AnalystRole.UNASSIGNED;

/** botId → chosen role, filtered to the bots whose stored role differs. */
export const roleChangesFor = (
    bots: AgentBot[],
    selected: Set<string>,
    roles: Record<string, AnalystRole>,
): Record<string, AnalystRole> => {
    const out: Record<string, AnalystRole> = {};
    for (const id of selected) {
        const bot = bots.find(b => b.id === id);
        if (!bot) continue;
        const next = roles[id] ?? AnalystRole.UNASSIGNED;
        if (memberRoleOf(bot) !== next) out[id] = next;
    }
    return out;
};

export interface NewGroupDialogProps {
    open: boolean;
    onClose: () => void;
    /** memberRoles = only the members whose role CHANGED (botId → role). */
    onCreate: (memberIds: string[], memberRoles: Record<string, AnalystRole>) => void;
    /** Edit mode (R4 gear): update this room's membership + member roles
     *  instead of creating. The Create button becomes Save. */
    initialGroup?: AgentGroup | null;
    onUpdate?: (groupId: string, memberIds: string[], memberRoles: Record<string, AnalystRole>) => void;
    bots: AgentBot[];
}

export const NewGroupDialog: React.FC<NewGroupDialogProps> = ({ open, onClose, onCreate, initialGroup, onUpdate, bots }) => {
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [roles, setRoles] = React.useState<Record<string, AnalystRole>>({});
    const editing = Boolean(initialGroup && onUpdate);
    // Read the roster through a ref so a background roster write (which
    // re-creates the `bots` array) never re-seeds — and wipes — an
    // in-progress selection.
    const botsRef = React.useRef(bots);
    botsRef.current = bots;

    React.useEffect(() => {
        if (!open) return;
        const ids = initialGroup?.memberIds ?? [];
        setSelected(new Set(ids));
        const byId: Record<string, AnalystRole> = {};
        for (const id of ids) {
            const bot = botsRef.current.find(b => b.id === id);
            if (bot) byId[id] = memberRoleOf(bot);
        }
        setRoles(byId);
    }, [open, initialGroup]);

    if (!open) return null;

    const toggle = (id: string): void => {
        const next = new Set(selected);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
            const bot = bots.find(b => b.id === id);
            if (bot) setRoles(prev => ({ ...prev, [id]: memberRoleOf(bot) }));
        }
        setSelected(next);
    };

    const setRole = (id: string, role: AnalystRole): void => {
        setRoles(prev => ({ ...prev, [id]: role }));
    };

    const changes = roleChangesFor(bots, selected, roles);
    const membershipChanged = editing
        ? selected.size !== (initialGroup?.memberIds.length ?? 0)
            || ![...selected].every(id => initialGroup?.memberIds.includes(id))
        : false;
    const saveDisabled = selected.size < 2 || (editing && !membershipChanged && Object.keys(changes).length === 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="New Group Chat">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl" data-testid="new-group-dialog">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-100">{editing ? 'Group Settings' : 'New Group Chat'}</h2>
                        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                            {editing
                                ? 'Change who is in this room and what role each member plays. The transcript stays.'
                                : 'One prompt goes to every member, one at a time, with a live activity feed. @name to direct, @everyone for all.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close new group dialog"
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        ✕
                    </button>
                </div>

                <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto">
                    {bots.map(bot => {
                        const checked = selected.has(bot.id);
                        const role = roles[bot.id] ?? memberRoleOf(bot);
                        return (
                            <li key={bot.id}>
                                <div className={`rounded-lg px-3 py-2 transition-colors ${checked ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}>
                                    <button
                                        type="button"
                                        onClick={() => toggle(bot.id)}
                                        data-testid={`group-member-${bot.id}`}
                                        aria-pressed={checked}
                                        className="flex w-full items-center gap-3 text-left"
                                    >
                                        <span
                                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                                checked ? 'border-zinc-200 bg-zinc-200' : 'border-zinc-600'
                                            }`}
                                        >
                                            {checked && <span className="text-[9px] font-bold leading-none text-zinc-900">✓</span>}
                                        </span>
                                        <BotAvatar bot={bot} size={30} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[13px] font-semibold text-zinc-100">{bot.name}</span>
                                            {bot.title && <span className="block truncate text-[11px] text-zinc-500">{bot.title}</span>}
                                        </span>
                                    </button>
                                    {checked && (
                                        <div className="mt-1.5 flex items-center gap-2 pl-7" data-testid={`group-role-row-${bot.id}`}>
                                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Role</span>
                                            <SelectMenu
                                                aria-label={`Role for ${bot.name}`}
                                                data-testid={`group-role-${bot.id}`}
                                                value={role}
                                                onChange={v => setRole(bot.id, v as AnalystRole)}
                                                options={MEMBER_ROLE_OPTIONS.map(r => ({ value: r.value, label: r.label }))}
                                                triggerClassName="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-[12px] hover:bg-zinc-800"
                                            />
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                    {bots.length === 0 && (
                        <li className="px-2 py-3 text-[12px] text-zinc-500">
                            Create a Bot first — groups are made of bots.
                        </li>
                    )}
                </ul>

                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-4 py-2 text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (editing && initialGroup) onUpdate?.(initialGroup.id, [...selected], changes);
                            else onCreate([...selected], changes);
                            onClose();
                        }}
                        disabled={saveDisabled}
                        data-testid="create-group"
                        className="rounded-lg bg-zinc-200 px-4 py-2 text-[13px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {editing ? 'Save' : `Create Group${selected.size >= 2 ? ` (${selected.size})` : ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NewGroupDialog;
