import React, { useEffect, useState } from 'react';
import { HermesBot } from '../../types/bot';
import { BotRegistry } from '../../services/bots/BotRegistry';
import { AnalystRole } from '../../types/enums';
import { DESK_TOOL_DEFINITIONS } from '../../services/analysis/DeskToolsService';

const ROLES: Array<{ value: AnalystRole; label: string }> = [
    { value: AnalystRole.MACRO_VOLATILITY, label: 'Macro' },
    { value: AnalystRole.TECHNICAL_ANALYST, label: 'Technical' },
    { value: AnalystRole.RISK_EXECUTION, label: 'Risk' },
    { value: AnalystRole.UNASSIGNED, label: 'General' },
];

const ALL_TOOLS = DESK_TOOL_DEFINITIONS.map(d => d.function.name);

export const BotManagerDrawer: React.FC<{ open: boolean; onClose: () => void; onChanged?: () => void; onSyncFromTeam?: () => Promise<void> }> = ({ open, onClose, onChanged, onSyncFromTeam }) => {
    const [bots, setBots] = useState<HermesBot[]>([]);
    const [name, setName] = useState('');
    const [providerId, setProviderId] = useState('');
    const [model, setModel] = useState('');
    const [role, setRole] = useState<AnalystRole>(AnalystRole.UNASSIGNED);
    const [job, setJob] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editJob, setEditJob] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editAvatar, setEditAvatar] = useState('');
    const [editTools, setEditTools] = useState<string[]>([]);
    const [editPrompt, setEditPrompt] = useState('');
    const [editPersonality, setEditPersonality] = useState('');

    const refresh = async (): Promise<void> => setBots(await BotRegistry.list());
    useEffect(() => { if (open) void refresh(); }, [open]);

    if (!open) return null;

    const create = async (): Promise<void> => {
        if (!name.trim() || !providerId.trim() || !model.trim()) return;
        await BotRegistry.create({ name: name.trim(), providerId: providerId.trim(), model: model.trim(), role, job: job.trim() || undefined });
        setName(''); setProviderId(''); setModel(''); setJob('');
        await refresh();
        onChanged?.();
    };

    const startEdit = (b: HermesBot): void => {
        setEditingId(b.id);
        setEditName(b.name);
        setEditJob(b.job || '');
        setEditDesc(b.description || '');
        setEditAvatar(b.avatarUrl || '');
        setEditTools(b.enabledTools || []);
        setEditPrompt(b.systemPromptOverride || '');
        setEditPersonality(b.personality || '');
    };

    const saveEdit = async (): Promise<void> => {
        if (!editingId) return;
        const found = bots.find(x => x.id === editingId);
        if (!found) return;
        await BotRegistry.upsert({
            ...found,
            name: editName.trim() || found.name,
            job: editJob.trim() || undefined,
            description: editDesc.trim() || undefined,
            avatarUrl: editAvatar.trim() || undefined,
            enabledTools: editTools.length > 0 ? editTools : found.enabledTools,
            systemPromptOverride: editPrompt.trim() || undefined,
            personality: editPersonality.trim() || undefined,
            updatedAt: Date.now(),
        });
        setEditingId(null);
        await refresh();
        onChanged?.();
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
            <div className="w-[380px] max-w-[92vw] overflow-y-auto bg-zinc-950 p-4" onClick={e => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-zinc-200">Bots</h3>
                    <div className="flex items-center gap-2">
                        {onSyncFromTeam && <button type="button" onClick={async () => { await onSyncFromTeam(); await refresh(); }} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200">Sync from Team</button>}
                        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
                    </div>
                </div>
                <div className="mb-4 space-y-2 rounded-lg border border-white/10 p-3">
                    <p className="text-xs font-medium text-zinc-400">New Bot</p>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                    <div className="flex gap-2">
                        <input value={providerId} onChange={e => setProviderId(e.target.value)} placeholder="provider id" className="w-1/2 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                        <input value={model} onChange={e => setModel(e.target.value)} placeholder="model" className="w-1/2 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                    </div>
                    <div className="flex gap-2">
                        <select value={role} onChange={e => setRole(e.target.value as AnalystRole)} className="rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <input value={job} onChange={e => setJob(e.target.value)} placeholder="Job (optional)" className="flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                    </div>
                    <button type="button" onClick={create} className="w-full rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700">Create</button>
                </div>
                <div className="space-y-2">
                    {bots.map(b => (
                        <div key={b.id} className="rounded border border-white/10 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300">{b.name.trim()[0]?.toUpperCase() || '?'}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs text-zinc-200">{b.name}{b.hidden ? ' · hidden' : ''}</p>
                                    <p className="truncate text-[10px] text-zinc-500">{b.role} · {b.providerId}:{b.model}{b.job ? ` · ${b.job}` : ''} · {b.enabledTools.length} tools</p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <button type="button" onClick={() => startEdit(b)} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">Edit</button>
                                    <button type="button" onClick={async () => { await BotRegistry.duplicate(b.id); await refresh(); onChanged?.(); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">Dup</button>
                                    <button type="button" onClick={async () => { await BotRegistry.setHidden(b.id, !b.hidden); await refresh(); onChanged?.(); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">{b.hidden ? 'Show' : 'Hide'}</button>
                                    <button type="button" onClick={async () => { await BotRegistry.remove(b.id); await refresh(); onChanged?.(); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-rose-400 hover:text-rose-300">Del</button>
                                </div>
                            </div>
                            {editingId === b.id && (
                                <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                                    <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                    <div className="flex gap-2">
                                        <input value={editJob} onChange={e => setEditJob(e.target.value)} placeholder="Job" className="w-1/2 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                        <input value={editAvatar} onChange={e => setEditAvatar(e.target.value)} placeholder="Avatar URL" className="w-1/2 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                    </div>
                                    <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" rows={2} className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] uppercase tracking-widest text-zinc-500">Tools</p>
                                        <div className="flex flex-wrap gap-1">
                                            {ALL_TOOLS.map(t => {
                                                const on = editTools.includes(t);
                                                return (
                                                    <button key={t} type="button" onClick={() => setEditTools(prev => on ? prev.filter(x => x !== t) : [...prev, t])} className={`rounded px-1.5 py-0.5 text-[10px] ${on ? 'bg-zinc-700 text-zinc-100' : 'border border-white/10 text-zinc-500'}`}>{t}</button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} placeholder="System prompt override" rows={2} className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                    <textarea value={editPersonality} onChange={e => setEditPersonality(e.target.value)} placeholder="Personality" rows={2} className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
                                    <div className="flex gap-2">
                                        <button type="button" onClick={saveEdit} className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700">Save</button>
                                        <button type="button" onClick={() => setEditingId(null)} className="rounded border border-white/10 px-2 py-1 text-xs text-zinc-400">Cancel</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {bots.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">No bots yet.</p>}
                </div>
            </div>
        </div>
    );
};

export default BotManagerDrawer;
