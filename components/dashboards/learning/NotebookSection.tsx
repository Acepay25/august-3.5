
import React from 'react';
import { BookOpen } from 'lucide-react';
import StatusPill from '../../ui/StatusPill';
import type { Notebook } from './shared';

/** The markdown memory files the harness writes and the model reads. */
export const NotebookSection: React.FC<{ notebook: Notebook }> = ({ notebook }) => (
    <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
        <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-cyan-400" /> Trader Notebook — what the model reads
        </h4>
        {notebook.files.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">
                No notebook files yet — the harness writes diary entries after every logged trade.
            </p>
        ) : (
            <div className="space-y-2">
                {notebook.folders.map(folder => {
                    const files = notebook.files.filter(f => f.folderId === folder.id);
                    if (files.length === 0) return null;
                    return (
                        <div key={folder.id}>
                            <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">{folder.name}/</p>
                            <div className="mt-1 space-y-1">
                                {files.map(f => {
                                    const entries = folder.name === 'trader-diary' ? f.content.split('\n## ').length - 1 : 0;
                                    return (
                                        <div key={f.id} className="flex items-center justify-between rounded-lg bg-zinc-950/60 border border-white/5 px-2.5 py-1.5 text-[11px]">
                                            <span className="text-zinc-300 truncate pr-2 flex items-center gap-1.5">
                                                {f.name}
                                                {f.autoManaged && (
                                                    <StatusPill tone="info" kicker>auto</StatusPill>
                                                )}
                                            </span>
                                            <span className="text-[10px] font-mono tabular-nums text-zinc-500 shrink-0">
                                                {entries > 0 ? `${entries} entries` : `${f.content.length.toLocaleString()} chars`}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
);

export default NotebookSection;
