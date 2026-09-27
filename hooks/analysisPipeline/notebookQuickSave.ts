/**
 * Pipeline stage module — Trader Notebook quick-save short-circuit.
 *
 * Extracted verbatim from useAnalysisPipeline's send path: "save this to the
 * notebook" short-circuits the ensemble — no chart analysis, just the
 * notebook write + a confirmation message. The model reads the current
 * notebook index and decides skip / append / create (see
 * writeNotebookNoteFromRequest). Self-contained: it reads the conversation
 * through `messagesRef` and writes through `updateMessages`, both passed in,
 * so it is unit-testable without mounting the hook.
 */

import { Message, MessageRole } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { getActiveUsername } from '../../utils/activeUser';
import { writeModelNote } from '../../services/learning/MemoryFilesService';
import { writeNotebookNoteFromRequest } from '../../services/learning/NotebookWriterService';
import { toolActionStamp } from '../../utils/toolActions';

// ─── Trader Notebook quick-save intent ────────────────────────────────────
// "Save this to the notebook / write it down in my memory / add this to my
// notes" — anchored on a memory noun so plain phrases ("note that…",
// "remember to…") never hijack a normal analysis.
const NOTEBOOK_SAVE_PATTERN = /\b(save|store|write|add|log|remember|record|put)\b[^\n]{0,60}\b(notebook|memory|journal|diary|notes?)\b|\b(notebook|memory|journal|diary|notes?)\b[^\n]{0,60}\b(save|store|write|add|log|remember|record|put)\b/i;

/** Whether the prompt asks for a notebook quick-save (see NOTEBOOK_SAVE_PATTERN). */
export const isNotebookQuickSaveRequest = (input: string): boolean => NOTEBOOK_SAVE_PATTERN.test(input);

export interface NotebookQuickSaveDeps {
    /** Settings → Memory model, else the first enabled provider's config. */
    provider: ProviderConfig | null | undefined;
    setLoadingMessage: (message: string | null) => void;
    messagesRef: { current: Message[] };
    updateMessages: (updater: (prev: Message[]) => Message[], conversationId?: string | null) => void;
    activeConversationId: string | null;
}

/**
 * Run the notebook quick-save and report the outcome in-chat (success,
 * nothing-written, or failure). Resolves once the confirmation message is
 * on the thread — the caller then consumes the send (this was never an
 * analysis run).
 */
export const runNotebookQuickSave = async (effectiveInput: string, deps: NotebookQuickSaveDeps): Promise<void> => {
    const { provider, setLoadingMessage, messagesRef, updateMessages, activeConversationId } = deps;
    try {
        setLoadingMessage('Writing to your notebook…');
        const username = getActiveUsername();
        // Give the model something concrete to write about: the most
        // recent analysis card in this conversation, if any.
        let notebookContext = '';
        for (let i = messagesRef.current.length - 1; i >= 0; i--) {
            const a = messagesRef.current[i].analysis;
            if (a) {
                notebookContext = `${a.coinName ?? '?'} ${a.direction ?? '?'} ${a.confidence ?? ''} — ${(a.strategy ?? '').slice(0, 400)}`;
                break;
            }
        }
        const note = provider ? await writeNotebookNoteFromRequest(effectiveInput, notebookContext, provider) : null;
        const notebookMsgId = `notebook-${Date.now()}`;
        if (note) {
            const file = await writeModelNote(note, username);
            updateMessages(prev => [...prev, {
                id: notebookMsgId,
                role: MessageRole.AI,
                text: `📓 **Saved to your Trader Notebook** — \`${note.folder}/${file.name}\` (${note.decision === 'append' ? 'appended a new section to the existing file' : 'new file'}).\n\nThe model will read this on every future analysis. Manage everything in **Settings → Memory**.`,
                createdAt: new Date().toISOString(),
                isDebating: false,
                // status row for the model-authored write.
                toolActions: [{
                    at: toolActionStamp(), speaker: 'Coach', tool: 'notebook_note', ok: true,
                    verb: note.decision === 'append' ? 'appended' : 'created',
                    label: `${note.folder}/${file.name}`, review: 'Settings → Memory',
                }],
            }], activeConversationId);
        } else {
            updateMessages(prev => [...prev, {
                id: notebookMsgId,
                role: MessageRole.AI,
                text: `📓 **Notebook: nothing written** — the model found this already covered (or nothing concrete to save). You can still add it manually in **Settings → Memory**.`,
                createdAt: new Date().toISOString(),
                isDebating: false,
            }], activeConversationId);
        }
    } catch (quickSaveError) {
        console.error('[TraderNotebook] Quick-save failed:', quickSaveError);
        updateMessages(prev => [...prev, {
            id: `notebook-err-${Date.now()}`,
            role: MessageRole.AI,
            text: `📓 **Notebook write failed** — ${(quickSaveError as Error)?.message ?? 'unknown error'}. The diary keeps recording trades automatically; this manual save did not go through.`,
            createdAt: new Date().toISOString(),
            isDebating: false,
        }], activeConversationId);
    } finally {
        setLoadingMessage(null);
    }
};
