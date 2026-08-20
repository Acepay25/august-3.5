import React, { useEffect, useState } from 'react';
import { HermesBot } from '../../types/bot';
import { BotRegistry } from '../../services/bots/BotRegistry';
import { AnalystRole } from '../../types/enums';

const ROLES: Array<{ value: AnalystRole; label: string }> = [
    { value: AnalystRole.MACRO_VOLATILITY, label: 'Macro' },
    { value: AnalystRole.TECHNICAL_ANALYST, label: 'Technical' },
    { value: AnalystRole.RISK_EXECUTION, label: 'Risk' },
    { value: AnalystRole.UNASSIGNED, label: 'General' },
];

export const BotManagerDrawer: React.FC<{ open: boolean; onClose: () => void; onChanged?: () => void }> = ({ open, onClose, onChanged }) => {
    const [bots, setBots] = useState<HermesBot[]>([]);
    const [name, setName] = useState('');
    const [providerId, setProviderId] = useState('');
    const [model, setModel] = useState('');
    const [role, setRole] = useState<AnalystRole>(AnalystRole.UNASSIGNED);
    const [job, setJob] = useState('');

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

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
            <div className="w-[360px] max-w-[90vw] overflow-y-auto bg-zinc-950 p-4" onClick={e => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-zinc-200">Bots</h3>
                    <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
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
                        <div key={b.id} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300">{b.name.trim()[0]?.toUpperCase() || '?'}</span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-zinc-200">{b.name}</p>
                                <p className="truncate text-[10px] text-zinc-500">{b.role} · {b.providerId}:{b.model}{b.job ? ` · ${b.job}` : ''}</p>
                            </div>
                            <button type="button" onClick={async () => { await BotRegistry.remove(b.id); await refresh(); onChanged?.(); }} className="text-[11px] text-zinc-500 hover:text-zinc-200">Delete</button>
                        </div>
                    ))}
                    {bots.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">No bots yet.</p>}
                </div>
            </div>
        </div>
    );
};

export default BotManagerDrawer;
