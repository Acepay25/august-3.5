/**
 * DeskSeatMappingEditor — Settings → General → Desk view section.
 *
 * Lets the trader pin a custom actor name to one of the 8 desk-view role
 * presets (Risk, Macro, Technical, etc.) so a custom roster like
 * "Satoshi" or "Fibonacci" lands on a colored cap instead of the wing
 * fan-out. Persists to localStorage via `services/desk/roleOverrides`.
 */

import React from 'react';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import {
    getRoleOverrides,
    setRoleOverride,
    clearRoleOverride,
    subscribeRoleOverrides,
    getOverridesUser,
} from '../../services/desk/roleOverrides';
import { roleForName, type RolePreset } from '../../components/desk/pixelAvatars';

const ROLES: RolePreset[] = [
    'risk', 'macro', 'technical', 'sentiment', 'moderator',
    'followup', 'postmortem', 'execution', 'unknown',
];

const ROLE_LABEL: Record<RolePreset, string> = {
    risk: 'Risk',
    macro: 'Macro',
    technical: 'Technical',
    sentiment: 'Sentiment',
    moderator: 'Moderator',
    followup: 'Followup',
    postmortem: 'Post-mortem',
    execution: 'Execution',
    unknown: 'Wing (heuristic fallback)',
};

const ROLE_SWATCH: Record<RolePreset, string> = {
    risk: '#7f1d1d',
    macro: '#1e3a8a',
    technical: '#14532d',
    sentiment: '#581c87',
    moderator: '#fbbf24',
    followup: '#155e75',
    postmortem: '#52525b',
    execution: '#78350f',
    unknown: '#27272a',
};

export const DeskSeatMappingEditor: React.FC = () => {
    const [overrides, setOverrides] = React.useState<Record<string, RolePreset>>(() => getRoleOverrides());
    const [activeUser, setActiveUser] = React.useState<string>(() => getOverridesUser());
    const [draftName, setDraftName] = React.useState('');
    const [draftRole, setDraftRole] = React.useState<RolePreset>('risk');

    // Re-render when the store mutates from another surface (e.g. the
    // desk view sets an override programmatically). Also re-read when the
    // user switches — localStorage is a synchronous store, but we need
    // to redraw the list with the new user's entries.
    React.useEffect(() => {
        const refresh = (): void => {
            setOverrides(getRoleOverrides());
            setActiveUser(getOverridesUser());
        };
        return subscribeRoleOverrides(refresh);
    }, []);

    const entries = React.useMemo(() => {
        return Object.entries(overrides).sort((a, b) => a[0].localeCompare(b[0]));
    }, [overrides]);

    const handleAdd = (): void => {
        const name = draftName.trim();
        if (!name) return;
        setRoleOverride(name, draftRole);
        setDraftName('');
    };

    const handleRemove = (name: string): void => {
        clearRoleOverride(name);
    };

    const handleReset = (name: string): void => {
        clearRoleOverride(name);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-2">
                <div>
                    <h4 className="text-sm font-semibold text-zinc-100">Desk seat mapping</h4>
                    <p className="text-xs text-zinc-500 mt-1">
                        Pin a custom actor name to one of the 8 desk-view roles so it lands on a colored cap
                        instead of the wing fan-out. The default 8 names (Macro, Technical, Risk, …) are
                        already mapped by name; only override the names that don't auto-resolve.
                    </p>
                </div>
                <span
                    className="shrink-0 rounded border border-white/10 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    title="The override table is per-user; this is the user it will be saved under."
                >
                    user: {activeUser}
                </span>
            </div>

            <div className="rounded-md border border-white/10 bg-zinc-950/40">
                {entries.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-zinc-500">
                        No overrides — every seat uses the default heuristic.
                    </p>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {entries.map(([name, role]) => {
                            const heuristic = roleForName(name);
                            const overridden = heuristic !== role;
                            return (
                                <li
                                    key={name}
                                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="inline-block h-3 w-3 shrink-0 rounded-sm border border-white/10"
                                        style={{ background: ROLE_SWATCH[role] }}
                                    />
                                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-200" title={name}>
                                        {name}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                                        → {ROLE_LABEL[role]}
                                    </span>
                                    {overridden && (
                                        <span className="text-[9px] uppercase tracking-widest text-amber-400/80">
                                            (heuristic: {ROLE_LABEL[heuristic]})
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleRemove(name)}
                                        title="Remove override"
                                        aria-label={`Remove override for ${name}`}
                                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                    placeholder="Seat name (e.g. Satoshi)"
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-[12px] text-zinc-100 placeholder-zinc-600 focus:border-amber-400/40 focus:outline-none"
                />
                <select
                    value={draftRole}
                    onChange={e => setDraftRole(e.target.value as RolePreset)}
                    aria-label="Role"
                    className="rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100 focus:outline-none"
                >
                    {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!draftName.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1.5 text-[12px] font-semibold text-zinc-200 enabled:hover:bg-zinc-700 disabled:text-zinc-600"
                >
                    <Plus className="h-3.5 w-3.5" /> Add
                </button>
                {entries.length > 0 && (
                    <button
                        type="button"
                        onClick={() => entries.forEach(([n]) => handleReset(n))}
                        title="Remove all overrides"
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-[12px] text-zinc-400 hover:text-rose-300"
                    >
                        <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </button>
                )}
            </div>
        </div>
    );
};

export default DeskSeatMappingEditor;
