import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, X } from '../shared/Icons';
import AnswerBody from '../shared/AnswerBody';
import { useToastActions } from '../shared/Toast';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { deleteMemoryFile, getMemoryFiles, subscribeMemoryFilesChanged } from '../../services/learning/MemoryFilesService';
import { relativeElapsed, topicParts } from '../../services/learning/memoryTopics';
import { proposeTopicEdit } from '../../services/learning/memoryTopicEdits';
import { phtDayYear } from '../../utils/timezone';
import type { MemoryFile } from '../../types';
import type { ProviderConfig } from '../../types/provider';

/**
 * MemoryTopicPanel — one notebook entry read as a document (gap 2 + gap 3 of
 * docs/plan/open-items.md).
 *
 * The reference's detail view leads with Last updated, then Summary, then the
 * bulleted Details, then Delete at the foot — and the "Tell Claude what to
 * change" box under it. This is that shape over a notebook file:
 *
 *   - READ the entry as content, not as raw markdown (the file manager below
 *     keeps the raw view for the people who want it);
 *   - DELETE the belief in one press, on the belief itself — not one press on
 *     a file row in a different surface;
 *   - ASK for a change in plain words: the instruction goes to the memory
 *     model, the rewrite it returns lands PENDING in the amendment queue, and
 *     a human approves it in Learn → Queue. Nothing here writes the notebook
 *     on its own — that is the governance the reference matches and this app
 *     already has.
 *
 * The SHAPE is the reference's: a "← Memory" back link at the top, the title
 * in the interface sans with the Delete action on a raised chip beside it,
 * and then labelled fields — "Last updated", "Summary", "Details" — each
 * label small and muted, each value in the reading face.
 *
 * THE READING FACE, decided: the Summary and the Details are the model's own
 * prose about the trader's market, read rather than operated, so they wear
 * the SERIF the app gives the model's answer (`AnswerBody` — the one home for
 * that voice). Everything around them is chrome: the back link, the title,
 * the field labels, the date, the buttons and the composer all stay in the
 * interface sans.
 */

interface MemoryTopicPanelProps {
    fileId: string;
    username: string;
    /** The configured memory model — what turns an instruction into a rewrite. */
    memoryConfig: ProviderConfig | null | undefined;
    onClose: () => void;
}

const MemoryTopicPanel: React.FC<MemoryTopicPanelProps> = ({ fileId, username, memoryConfig, onClose }) => {
    const [version, setVersion] = useState(0);
    useEffect(() => subscribeMemoryFilesChanged(() => setVersion(v => v + 1)), []);

    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();

    const [instruction, setInstruction] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);

    const file = useMemo<MemoryFile | null>(() => {
        void version;
        return getMemoryFiles().files.find(f => f.id === fileId) ?? null;
    }, [fileId, version]);

    const parts = useMemo(() => (file ? topicParts(file.content.trim()) : { summary: '', details: '' }), [file]);

    if (!file) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6" data-testid="memory-topic-panel">
                <p className="text-ui-dense text-zinc-500">This entry no longer exists in the notebook.</p>
                <button type="button" onClick={onClose}
                    className="rounded-control px-3 py-1.5 text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                    Close
                </button>
            </div>
        );
    }

    const entryName = file.name.replace(/\.md$/i, '');
    const updated = file.updatedAt ? phtDayYear(file.updatedAt) : 'Unknown';

    const onDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: `Delete "${entryName}"?`,
            message: 'This entry will be permanently removed from the notebook. Delete it from here rather than hunting for the file.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMemoryFile(file.id, username);
            toast.success('Entry deleted', `"${file.name}" is no longer in the notebook.`);
            onClose();
        } catch (err) {
            toast.error('Could not delete', err instanceof Error ? err.message : String(err));
        }
    };

    const onPropose = async (): Promise<void> => {
        setBusy(true);
        setFeedback(null);
        const outcome = await proposeTopicEdit(file, instruction, memoryConfig);
        setBusy(false);
        if (outcome.ok && outcome.amendment) {
            setInstruction('');
            setFeedback('Queued for approval — review it in Learn → Queue. Nothing changed in the notebook yet.');
            toast.success('Edit proposed', 'Waiting for your approval in the Queue tab.');
            return;
        }
        setFeedback(outcome.reason ?? 'The edit could not be proposed.');
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="memory-topic-panel">
            {/* The back link returns to the list this entry came from — the
                reference's "← Memory". */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
                <button type="button"
                    onClick={onClose}
                    aria-label="Back to memory topics"
                    title="Back to memory topics"
                    className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-ui-base text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                    <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
                    Memory
                </button>
                <button type="button"
                    onClick={onClose}
                    aria-label="Close the memory entry"
                    title="Close"
                    className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 flex-1 text-ui-xl font-semibold tracking-tight text-zinc-100" title={file.name}>
                        {entryName}
                    </h2>
                    {/* The reference's Delete is a RAISED chip on the right of
                        the title. It stays a destructive action here, so the
                        word carries the app's own rose rather than pretending
                        to be ordinary chrome. */}
                    <button type="button"
                        onClick={() => { void onDelete(); }}
                        aria-label={`Delete ${entryName}`}
                        title="Delete this entry"
                        className="shrink-0 rounded-control bg-zinc-800 px-3 py-1.5 text-ui-dense font-medium text-rose-300 transition-colors hover:bg-zinc-700 hover:text-rose-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                        Delete
                    </button>
                </div>

                <div className="mt-5 space-y-4">
                    <div>
                        <p className="text-ui-dense text-zinc-500">Last updated</p>
                        <p
                            className="mt-0.5 text-ui-base text-zinc-100"
                            data-testid="memory-topic-updated"
                            title={file.updatedAt ? `Updated ${relativeElapsed(file.updatedAt)}` : 'Last updated unknown'}
                        >
                            {updated}
                        </p>
                    </div>

                    <div>
                        <p className="text-ui-dense text-zinc-500">Summary</p>
                        <div className="mt-0.5" data-testid="memory-topic-summary">
                            <AnswerBody text={parts.summary} />
                        </div>
                    </div>

                    {parts.details && (
                        <div>
                            <p className="text-ui-dense text-zinc-500">Details</p>
                            <div
                                className="mt-0.5 [&_ul]:space-y-2 [&_ol]:space-y-2"
                                data-testid="memory-topic-details"
                            >
                                <AnswerBody text={parts.details} />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* The NL edit box. It ASKS; it does not write — the rewrite lands in
                the amendment queue, where a human approves it. */}
            <div className="shrink-0 border-t border-zinc-800/80 p-3">
                <label htmlFor="memory-topic-instruction" className="block text-ui-dense text-zinc-500">
                    Ask for a change
                </label>
                <div className="mt-1.5 flex items-end gap-2">
                    <textarea
                        id="memory-topic-instruction"
                        value={instruction}
                        onChange={e => setInstruction(e.target.value)}
                        rows={2}
                        placeholder="e.g. drop the 4h rule — it stopped working after the fee change"
                        className="min-h-12 w-full resize-none rounded-control border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-ui-dense text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
                    />
                    <button type="button"
                        onClick={onPropose}
                        disabled={busy || !instruction.trim()}
                        aria-label="Propose this change"
                        title="Propose this change for approval"
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-3 text-ui-dense font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-100 disabled:opacity-40">
                        {busy ? 'Asking…' : 'Propose'}
                    </button>
                </div>
                {feedback && (
                    <p className="mt-1.5 text-ui-2xs text-zinc-500" data-testid="memory-topic-feedback">{feedback}</p>
                )}
                <p className="mt-1.5 text-ui-2xs text-zinc-600">
                    The memory model drafts the rewrite; you approve it in the Queue tab before the notebook changes.
                </p>
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

export default React.memo(MemoryTopicPanel);
