
import React, { useMemo, useState } from 'react';
import { Brain } from 'lucide-react';
import { LoggedTrade, MemoryFile } from '../../../types';
import type { SkillMeta } from '../../../services/learning/SkillMemoryService';
import { buildMemoryGraph } from '../../../services/learning/MemoryGraph';
import type { Notebook } from './shared';

interface MemoryGraphSectionProps {
    /** Only its identity matters — the graph rebuilds when the notebook refreshes. */
    notebook: Notebook;
    closedWindowed: LoggedTrade[];
    notebookSkills: Array<{ file: MemoryFile; meta: SkillMeta }>;
    /** Skill file names retrieval actually put into a prompt. */
    injectedSkillFiles: Set<string>;
}

const KIND_LABELS: Record<string, string> = {
    identity: 'Profile', skill: 'Skill', rule: 'Rule', note: 'Note',
    trade: 'Trade', rootCause: 'Root cause', setup: 'Setup dim',
};

/** Memory Graph — the typed graph, with All / Used / Learned views. */
export const MemoryGraphSection: React.FC<MemoryGraphSectionProps> = ({
    notebook, closedWindowed, notebookSkills, injectedSkillFiles,
}) => {
    const [graphTab, setGraphTab] = useState<'all' | 'used' | 'learned'>('all');
    const memoryGraph = useMemo(() => buildMemoryGraph(undefined, closedWindowed), [closedWindowed, notebook]);
    const graphKinds = useMemo(() => {
        const m = new Map<string, number>();
        for (const n of memoryGraph.nodes.values()) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
        return m;
    }, [memoryGraph]);
    // Injection-driven (truthful): a skill shows as "learned" only once
    // retrieval actually put it into a prompt — matching a setup is not use.
    const learnedSkills = useMemo(
        () => notebookSkills.filter(s => injectedSkillFiles.has(s.file.name)),
        [notebookSkills, injectedSkillFiles],
    );

    return (
        <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <h4 className="text-ui-xs sm:text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5 text-cyan-400" /> Memory Graph
                </h4>
                <div className="flex items-center gap-1">
                    {(['all', 'used', 'learned'] as const).map(t => (
                        <button key={t} onClick={() => setGraphTab(t)}
                            className={`px-2 py-0.5 rounded text-ui-2xs font-bold uppercase tracking-wider border transition-colors ${graphTab === t ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}>
                            {t}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-ui-xs text-zinc-600 mb-2 font-mono tabular-nums">
                {memoryGraph.nodes.size} nodes · {memoryGraph.edges.length} edges
                {' · '}{[...graphKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
            {graphTab === 'all' && (
                <div className="space-y-1.5">
                    {[...graphKinds.entries()].map(([kind, count]) => {
                        const samples = [...memoryGraph.nodes.values()].filter(n => n.kind === kind).slice(0, 4);
                        return (
                            <div key={kind} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 flex items-center justify-between gap-2">
                                <span className="text-ui-xs uppercase tracking-wider text-zinc-500 font-bold shrink-0">{KIND_LABELS[kind] ?? kind}</span>
                                <span className="text-ui-xs text-zinc-600 truncate min-w-0">{samples.map(s => s.label).join(' · ')}</span>
                                <span className="text-ui-xs font-mono tabular-nums text-zinc-400 shrink-0">{count}</span>
                            </div>
                        );
                    })}
                </div>
            )}
            {graphTab === 'used' && (
                learnedSkills.length === 0
                    ? <p className="text-xs text-zinc-600 italic">Nothing used yet — skills appear here once injected into an analysis.</p>
                    : <div className="space-y-1.5">
                        {learnedSkills.slice(0, 8).map(s => (
                            <div key={s.file.id} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 text-ui-dense">
                                <span className="text-zinc-500 font-mono">{s.meta.kind}</span> <span className="text-zinc-300">{s.file.name.replace(/\.md$/i, '')}</span>
                                <span className="text-zinc-500"> · {Math.round(s.meta.wins)}/{Math.round(s.meta.losses)}</span>
                            </div>
                        ))}
                    </div>
            )}
            {graphTab === 'learned' && (
                notebookSkills.length === 0
                    ? <p className="text-xs text-zinc-600 italic">Nothing learned yet — close trades with post-mortems to grow skill memory.</p>
                    : <div className="space-y-1.5">
                        {notebookSkills.slice(0, 10).map(s => (
                            <div key={s.file.id} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 text-ui-dense">
                                <span className="text-zinc-500 font-mono">{s.meta.kind}</span> <span className="text-zinc-300">{s.meta.ifCondition || s.file.name.replace(/\.md$/i, '')}</span>
                                <span className="text-zinc-500"> · {Math.round(s.meta.wins)}/{Math.round(s.meta.losses)} · {s.meta.status}</span>
                            </div>
                        ))}
                    </div>
            )}
        </div>
    );
};

export default MemoryGraphSection;
