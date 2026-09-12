/**
 * SupervisorCard — the Settings surface for the skill supervisor: the LLM
 * that automatically reviews/verifies/enhances/approves the approval queues
 * (skill drafts, forged tools, memory amendments, ladder proposals). Shows
 * whether automation is on, which model is currently doing the supervising
 * (the active chat session's model — a panel's first seat), and the recent
 * verdicts. Every decision stays overridable from the dock's supervisor
 * panel; this card is the calm, at-a-glance view.
 */

import React, { useSyncExternalStore } from 'react';
import * as supervisorStore from '../../services/learning/supervisorStore';

const VERDICT_PILL: Record<string, string> = {
    approved: 'text-emerald-300',
    enhanced: 'text-cyan-300',
    rejected: 'text-rose-300',
    skipped: 'text-zinc-500',
};

const SupervisorCard: React.FC = () => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    const decisions = snap.events.filter(e => e.decision).slice(-4).reverse();
    return (
        <div className="px-4 pb-4" data-testid="supervisor-card">
            <h3 className="text-[13px] font-bold text-zinc-100">Skill supervisor</h3>
            <p className="mt-0.5 mb-3 text-[11px] text-zinc-500">
                A model reviews the approval queues the way you would — verifying each item against your
                catalog, graveyard and memory, enhancing the salvageable, approving the solid ones as
                candidates. Watch it live (and override any decision) from the Chart AI header.
            </p>
            <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5" data-testid="supervisor-auto-setting">
                <input
                    type="checkbox"
                    checked={snap.autoEnabled}
                    onChange={e => supervisorStore.setAutoEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-cyan-400"
                />
                <span className="text-[11px] text-zinc-300">
                    Supervise automatically
                    <span className="block text-[10px] text-zinc-500">
                        New drafts, tool candidates and memory amendments are judged as they arrive. Pausing
                        leaves everything in the queues for you.
                    </span>
                </span>
            </label>
            <p className="mb-2 font-mono text-[10px] text-zinc-600">
                supervising model: {snap.modelName || 'the active session\'s model (or the memory provider)'}
                {snap.running ? ' · working now' : ''}
            </p>
            {decisions.length > 0 && (
                <ul className="space-y-1.5">
                    {decisions.map(e => (
                        <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                            <span className={`shrink-0 font-bold uppercase tracking-wider ${VERDICT_PILL[e.decision?.verdict ?? 'skipped']}`}>
                                {e.decision?.verdict}
                            </span>
                            <span className="truncate text-zinc-400" title={e.decision?.reason}>
                                {e.itemTitle || e.text}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default SupervisorCard;
