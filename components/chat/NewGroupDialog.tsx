/**
 * NewGroupDialog — the Hermes "New Group Chat" dialog: pick two or
 * more bots; the room fans one prompt out to every member with an
 * activity feed (@name to direct, @everyone for all).
 */

import React from 'react';
import { BotAvatar } from './BotAvatar';
import type { AgentBot } from '../../services/agents/agentRoster';

export interface NewGroupDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (memberIds: string[]) => void;
    bots: AgentBot[];
}

export const NewGroupDialog: React.FC<NewGroupDialogProps> = ({ open, onClose, onCreate, bots }) => {
    const [selected, setSelected] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        if (open) setSelected(new Set());
    }, [open]);

    if (!open) return null;

    const toggle = (id: string): void => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="New Group Chat">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl" data-testid="new-group-dialog">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-100">New Group Chat</h2>
                        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                            One prompt goes to every member, one at a time, with a live activity feed. @name to direct, @everyone for all.
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
                        return (
                            <li key={bot.id}>
                                <button
                                    type="button"
                                    onClick={() => toggle(bot.id)}
                                    data-testid={`group-member-${bot.id}`}
                                    aria-pressed={checked}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                                        checked ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                                    }`}
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
                        onClick={() => { onCreate([...selected]); onClose(); }}
                        disabled={selected.size < 2}
                        data-testid="create-group"
                        className="rounded-lg bg-zinc-200 px-4 py-2 text-[13px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Create Group{selected.size >= 2 ? ` (${selected.size})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NewGroupDialog;
