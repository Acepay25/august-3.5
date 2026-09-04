/**
 * AmendmentsInbox — Settings → Memory review surface for model-proposed
 * notebook corrections. Approve applies the change through the notebook
 * write lock (provenance preserved); reject tombstones the proposal so
 * repeat suggestions of the same correction stay visible.
 */

import React from 'react';
import { Check, X } from 'lucide-react';
import {
    MemoryAmendment,
    listAmendments,
    approveAmendment,
    rejectAmendment,
} from '../../services/learning/memoryAmendments';
import { getMemoryFiles, updateMemoryFile } from '../../services/learning/MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';

const StatusBadge: React.FC<{ a: MemoryAmendment }> = ({ a }) => {
    const map: Record<MemoryAmendment['status'], string> = {
        pending: 'bg-amber-950/60 text-amber-400',
        approved: 'bg-emerald-950/60 text-emerald-400',
        rejected: 'bg-zinc-900 text-zinc-600 line-through',
    };
    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[a.status]}`}>
            {a.status}
        </span>
    );
};

export const AmendmentsInbox: React.FC = () => {
    const [amendments, setAmendments] = React.useState<MemoryAmendment[]>([]);
    const [busyId, setBusyId] = React.useState<string | null>(null);

    const refresh = React.useCallback(() => setAmendments(listAmendments()), []);
    React.useEffect(() => { refresh(); }, [refresh]);

    const resolve = async (a: MemoryAmendment, apply: boolean): Promise<void> => {
        setBusyId(a.id);
        try {
            if (apply) {
                const resolved = approveAmendment(a.id);
                if (resolved) {
                    const file = getMemoryFiles().files.find(f => f.id === a.fileId);
                    if (file) {
                        // Edits replace the whole body; supersede corrections
                        // ride the file tail with a provenance header.
                        const next = a.kind === 'supersede'
                            ? `${file.content}\n\n## Correction (${resolved.resolvedAt})\n\n${a.proposedContent}`
                            : a.proposedContent;
                        await updateMemoryFile(a.fileId, { content: next }, getActiveUsername());
                    }
                }
            } else {
                rejectAmendment(a.id);
            }
            refresh();
        } finally {
            setBusyId(null);
        }
    };

    const pending = amendments.filter(a => a.status === 'pending');
    const resolved = amendments.filter(a => a.status !== 'pending');

    return (
        <div className="space-y-2" data-testid="amendments-inbox">
            {amendments.length === 0 && (
                <p className="rounded-lg border border-white/5 bg-zinc-900/50 px-3 py-4 text-center text-[12px] text-zinc-600">
                    No amendment proposals. Models can propose corrections to your notebook via <code className="text-zinc-400">amend_memory</code>.
                </p>
            )}
            {pending.map(a => (
                <div key={a.id} className="rounded-lg border border-amber-900/40 bg-zinc-900/40 p-3" data-testid={`amendment-${a.id}`}>
                    <div className="flex items-center gap-2">
                        <code className="text-[12px] font-semibold text-zinc-200">{a.fileName}</code>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">{a.kind}</span>
                        <StatusBadge a={a} />
                        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{a.proposedBy} · {new Date(a.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-zinc-400"><span className="text-zinc-600">Reason:</span> {a.reason}</p>
                    <pre className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-950/60 p-2 text-[10px] leading-4 text-zinc-300 custom-scrollbar">{a.proposedContent}</pre>
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={busyId === a.id}
                            onClick={() => { void resolve(a, true); }}
                            data-testid={`approve-amendment-${a.id}`}
                            className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                        >
                            <Check className="h-3 w-3" /> {a.kind === 'supersede' ? 'Append correction' : 'Apply replacement'}
                        </button>
                        <button
                            type="button"
                            disabled={busyId === a.id}
                            onClick={() => { void resolve(a, false); }}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                        >
                            <X className="h-3 w-3" /> Reject
                        </button>
                    </div>
                </div>
            ))}
            {resolved.length > 0 && (
                <details className="rounded-lg border border-white/5 bg-zinc-900/30 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] text-zinc-500">{resolved.length} resolved</summary>
                    <div className="mt-2 space-y-1.5">
                        {resolved.map(a => (
                            <div key={a.id} className="flex items-center gap-2 text-[11px] text-zinc-500">
                                <StatusBadge a={a} />
                                <code className="text-zinc-400">{a.fileName}</code>
                                <span className="truncate text-zinc-600">{a.reason}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
};

export default AmendmentsInbox;
