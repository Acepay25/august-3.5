/**
 * ProfileMemoryCard — the human surface for Chart AI's collaboration memory
 * (the entries the model saves with `remember`). Settings → Memory.
 *
 * This is the counterpart to this environment's memory DIRECTORY: the model
 * maintains it, but the human can see exactly what it remembers about them and
 * delete anything wrong. Trading NOTES live in the notebook manager above;
 * this card is only the small typed user/feedback/project/reference store.
 */

import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
    listProfileMemories, forgetProfileMemory,
    type ProfileMemoryEntry, type ProfileMemoryKind,
} from '../../services/learning/profileMemory';
import {
    isTraderLearningEnabled, setTraderLearningEnabled,
} from '../../services/learning/traderLearner';

const KIND_STYLE: Record<ProfileMemoryKind, string> = {
    user: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    feedback: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    project: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    reference: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
};

const ProfileMemoryCard: React.FC = () => {
    const [entries, setEntries] = useState<ProfileMemoryEntry[]>([]);
    const [learning, setLearning] = useState(true);

    const refresh = (): void => {
        setEntries([...listProfileMemories()].reverse());
        setLearning(isTraderLearningEnabled());
    };

    useEffect(() => {
        refresh();
        window.addEventListener('august-profile-memory', refresh);
        return () => window.removeEventListener('august-profile-memory', refresh);
    }, []);

    return (
        <div className="px-4 pb-4" data-testid="profile-memory-card">
            <h3 className="text-[13px] font-bold text-zinc-100">Assistant memory</h3>
            <p className="mt-0.5 mb-3 text-[11px] text-zinc-500">
                What Chart AI remembers about <em>you</em> — preferences, corrections, ongoing context. The
                model saves these with <span className="font-mono text-zinc-400">remember</span> and they
                ride every prompt as a one-line index. Delete anything that's wrong or stale.
            </p>
            <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5" data-testid="trader-learning-toggle">
                <input type="checkbox" checked={learning} onChange={e => { setTraderLearningEnabled(e.target.checked); setLearning(e.target.checked); }}
                    className="h-3.5 w-3.5 accent-cyan-400" />
                <span className="text-[11px] text-zinc-300">
                    Learn my trading habits automatically
                    <span className="block text-[10px] text-zinc-500">
                        Every couple of sessions, Chart AI distills durable facts — preferred symbols, risk habits,
                        recurring mistakes — so the next session starts where the last one ended.
                    </span>
                </span>
            </label>
            {entries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
                    No memories yet — the assistant saves one when it learns something durable about you.
                </p>
            ) : (
                <ul className="space-y-2">
                    {entries.map(e => (
                        <li key={e.slug} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                            <div className="flex items-start gap-2">
                                <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${KIND_STYLE[e.kind]}`}>
                                    {e.kind}
                                </span>
                                {e.source === 'auto' && (
                                    <span className="mt-0.5 shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300" title="Learned automatically from your sessions">
                                        auto
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold leading-snug text-zinc-200">{e.description}</p>
                                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{e.body}</p>
                                    <p className="mt-1 font-mono text-[9px] text-zinc-600">{e.slug} · {new Date(e.updatedAt).toLocaleDateString()}</p>
                                </div>
                                <button type="button" onClick={() => { forgetProfileMemory(e.slug); refresh(); }}
                                    aria-label={`Forget memory ${e.slug}`} title="Forget"
                                    className="shrink-0 rounded-md border border-zinc-800 p-1.5 text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default ProfileMemoryCard;
