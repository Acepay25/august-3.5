import React, { useState } from 'react';
import { listHarnessLessons, clearHarnessLesson, HarnessLesson } from '../../services/learning/harnessLessons';

/**
 * Harness lessons browser (plan §14-5(c), deferred to the batch-13 UI pass) —
 * the P7 store's human surface: what the harness believes about provider
 * behavior (wire/budget/fabrication/injection), newest first, each clearable.
 * Clearing a wire lesson un-pins the thinking-off fail-closed until the next
 * probe re-learns it, so this list doubles as the escape hatch.
 */
export const HarnessLessonsBrowser: React.FC = () => {
    const [lessons, setLessons] = useState<HarnessLesson[]>(listHarnessLessons);
    const refresh = (): void => setLessons(listHarnessLessons());
    const clearOne = (id: string): void => {
        clearHarnessLesson(id);
        refresh();
    };
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                    Harness lessons ({lessons.length})
                </p>
                <button
                    type="button"
                    onClick={refresh}
                    className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
                >
                    Refresh
                </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                What the harness learned about provider wires (P7). Clearing a wire lesson
                un-pins thinking-off for that class until the next probe re-learns it.
            </p>
            {lessons.length === 0 ? (
                <p className="mt-2 text-[11px] text-zinc-600">No lessons recorded yet.</p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {lessons.map(l => (
                        <li key={l.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                                    {l.kind} · {l.scope}{l.provider ? ` · ${l.provider}` : ''} · {l.at.slice(0, 10)}
                                </p>
                                <p className="mt-0.5 text-[11px] leading-snug text-zinc-300">{l.lesson}</p>
                                <p className="mt-0.5 truncate text-[10px] text-zinc-600" title={l.pattern}>{l.pattern}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => clearOne(l.id)}
                                className="shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase tracking-widest text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                            >
                                Clear
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
