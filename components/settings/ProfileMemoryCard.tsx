/**
 * ProfileMemoryCard — the human surface for Chart AI's collaboration memory
 * (the entries the model saves with `remember`). Settings → Memory.
 *
 * This is the counterpart to this environment's memory DIRECTORY: the model
 * maintains it, but the human can see exactly what it remembers about them and
 * delete anything wrong. Trading NOTES live in the notebook manager above;
 * this card is only the small typed user/feedback/project/reference store.
 *
 * The ROWS wear the reference's row grammar — the label (what the memory is
 * called), the description (what it says) and the updated date, separated by
 * hairlines rather than boxed as cards. The kind stays as a quiet MONOCHROME
 * mark: it is a category, not a verdict, and a hue here would spend the app's
 * semantic colours on something that does not mean good or bad. The one
 * accent in this view is the 'auto' status pill, which does mean something.
 */

import React, { useEffect, useState } from 'react';
import { Trash2 } from '../shared/Icons';
import {
    listProfileMemories, forgetProfileMemory,
    type ProfileMemoryEntry,
} from '../../services/learning/profileMemory';
import {
    isTraderLearningEnabled, setTraderLearningEnabled,
} from '../../services/learning/traderLearner';
import StatusPill from '../ui/StatusPill';
import { memoryUpdatedLabel } from '../../services/learning/memoryTopics';

/** The kind chip: four categorical labels that only say WHICH kind of memory
 *  an entry is. Monochrome on purpose — the hue carried no verdict, and the
 *  reference's frame has almost no colour in it. */
const KIND_CHIP = 'border-zinc-700 bg-zinc-800/60 text-zinc-400';

/** The entry's date column. `updatedAt` is an ISO string; a row without one
 *  says so rather than printing a date it never had. */
const updatedLabelOf = (entry: ProfileMemoryEntry): string => {
    const at = Date.parse(entry.updatedAt);
    return Number.isFinite(at) ? memoryUpdatedLabel(at) : 'Updated unknown';
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
        <div data-testid="profile-memory-card">
            <h3 className="text-ui-caption font-bold text-zinc-100">Assistant memory</h3>
            <p className="mt-0.5 mb-3 text-ui-dense text-zinc-500">
                What Chart AI remembers about <em>you</em> — preferences, corrections, ongoing context. The
                model saves these with <span className="font-mono text-zinc-400">remember</span> and they
                ride every prompt as a one-line index. Delete anything that's wrong or stale.
            </p>
            <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-control border border-zinc-800 bg-zinc-950/40 p-2.5" data-testid="trader-learning-toggle">
                <input type="checkbox" checked={learning} onChange={e => { setTraderLearningEnabled(e.target.checked); setLearning(e.target.checked); }}
                    className="h-3.5 w-3.5 accent-cyan-400" />
                <span className="text-ui-dense text-zinc-300">
                    Learn my trading habits automatically
                    <span className="block text-ui-xs text-zinc-500">
                        Every couple of sessions, Chart AI distills durable facts — preferred symbols, risk habits,
                        recurring mistakes — so the next session starts where the last one ended.
                    </span>
                </span>
            </label>
            {entries.length === 0 ? (
                <p className="rounded-control border border-dashed border-zinc-800 px-3 py-4 text-center text-ui-dense text-zinc-600">
                    No memories yet — the assistant saves one when it learns something durable about you.
                </p>
            ) : (
                /* The reference's list: hairline-separated rows, no cards. */
                <ul className="border-t border-zinc-800/80" data-testid="profile-memory-list">
                    {entries.map(e => (
                        <li key={e.slug} className="border-b border-zinc-800/80 last:border-b-0 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wider ${KIND_CHIP}`}>
                                    {e.kind}
                                </span>
                                {e.source === 'auto' && (
                                    <StatusPill
                                        tone="info"
                                        kicker
                                        title="Learned automatically from your sessions"
                                    >
                                        auto
                                    </StatusPill>
                                )}
                                {/* The spec's tiny provenance marker: stated (the
                                    trader said it) vs observed/inferred (a system
                                    path). Absent = legacy = stated. */}
                                {e.tag === 'observed' && (
                                    <StatusPill tone="neutral" kicker title="Recorded by a system path from watched behaviour — not something you said">
                                        observed
                                    </StatusPill>
                                )}
                                {e.tag === 'inferred' && (
                                    <StatusPill tone="neutral" kicker title="Inferred by a system path — not something you said">
                                        inferred
                                    </StatusPill>
                                )}
                                {e.sensitive && (
                                    <StatusPill tone="warn" kicker title="A sensitive-category fact — excluded from pre-reads and unattended contexts">
                                        sensitive
                                    </StatusPill>
                                )}
                                {/* The label — what the memory is called. */}
                                <span className="min-w-0 flex-1 truncate text-ui-dense font-medium text-zinc-100" title={e.description}>
                                    {e.description}
                                </span>
                                {/* The updated date, on the right. */}
                                <span className="shrink-0 text-ui-dense text-zinc-500">{updatedLabelOf(e)}</span>
                                <button type="button" onClick={() => { forgetProfileMemory(e.slug); refresh(); }}
                                    aria-label={`Forget memory ${e.slug}`} title="Forget"
                                    className="shrink-0 rounded-control border border-zinc-800 p-1.5 text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300">
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>
                            {/* The description — what it says. */}
                            <p className="mt-1 whitespace-pre-wrap text-ui-dense leading-relaxed text-zinc-400">{e.body}</p>
                            <p className="mt-1 font-mono text-ui-2xs text-zinc-600">{e.slug}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default ProfileMemoryCard;
