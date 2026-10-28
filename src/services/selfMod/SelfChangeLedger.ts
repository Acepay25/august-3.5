/**
 * SelfChangeLedger — the audit trail every self-modification must pass through.
 *
 * One JSON file per change, in the existing notebook's `self-changes/` folder:
 * the previous value verbatim (undo reads it, it does not re-derive it), the
 * new value, who asked, why, and what the evidence said when it settled.
 *
 * This module owns storage and nothing else. The policy — what may change, how
 * far, and whether it needs a shadow window — lives in
 * `SelfModificationService.ts`, so the two can be reviewed apart: this file
 * cannot be tricked into storing a change, but it also cannot grant one.
 *
 * Rows are pruned at MAX_LEDGER_ROWS, terminal states first, because the
 * notebook has a byte budget and an unbounded ledger is how a rail becomes the
 * thing that fills the store it audits.
 */

import {
    createMemoryFile, deleteMemoryFile, getMemoryFiles, updateMemoryFile, createMemoryFolder,
} from '../learning/MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';
import { SelfChangeSchema, type SelfChange, type SelfChangeStatus } from '../../schemas/selfChange';

const LEDGER_FOLDER = 'self-changes';
export const MAX_LEDGER_ROWS = 60;
/** Terminal rows are history, not live state — they are what pruning drops. */
const TERMINAL_STATUSES: SelfChangeStatus[] = ['reverted', 'rejected', 'promoted'];

const fileOf = (id: string): string => `${id}.json`;

const folder = () => getMemoryFiles().folders.find(f => f.name === LEDGER_FOLDER);

const ensureLedgerFolder = async (username: string): Promise<string> => {
    const existing = folder();
    if (existing) return existing.id;
    const created = await createMemoryFolder(LEDGER_FOLDER, username);
    return created.id;
};

const parseRow = (content: string, fileName: string): SelfChange | null => {
    try {
        const parsed: unknown = JSON.parse(content);
        const result = SelfChangeSchema.safeParse(parsed);
        if (!result.success) {
            console.warn(`[SelfMod] skipped ledger row "${fileName}": ${result.error.issues[0]?.message ?? 'invalid JSON'}`);
            return null;
        }
        return result.data;
    } catch (err) {
        console.warn(`[SelfMod] skipped ledger row "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
};

const rowFileOf = (id: string) =>
    getMemoryFiles().files.find(f => f.folderId === folder()?.id && f.name === fileOf(id));

/** Every readable row, newest first. An unreadable file is skipped with a
 *  logged reason and never breaks the list. */
export const listSelfChanges = (): SelfChange[] => {
    const dir = folder();
    if (!dir) return [];
    return getMemoryFiles().files
        .filter(f => f.folderId === dir.id && f.name.toLowerCase().endsWith('.json'))
        .map(f => parseRow(f.content, f.name))
        .filter((r): r is SelfChange => !!r)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const getSelfChange = (id: string): SelfChange | null =>
    listSelfChanges().find(r => r.id === id) ?? null;

/** Rows whose EFFECT is still in force — what the audit chip and the
 *  switch-off undo read. A promoted override is in force forever until the
 *  trader pulls it, so it belongs here even though it is no longer measuring. */
export const liveSelfChanges = (): SelfChange[] =>
    listSelfChanges().filter(r => r.status === 'active' || r.status === 'shadow' || r.status === 'promoted');

const prune = async (username: string): Promise<void> => {
    const rows = listSelfChanges();
    if (rows.length <= MAX_LEDGER_ROWS) return;
    // Oldest terminal rows first, then (only if still over) oldest live ones.
    const terminal = rows.filter(r => TERMINAL_STATUSES.includes(r.status)).reverse();
    const live = rows.filter(r => !TERMINAL_STATUSES.includes(r.status)).reverse();
    const victims = [...terminal, ...live].slice(0, rows.length - MAX_LEDGER_ROWS);
    for (const victim of victims) {
        const file = rowFileOf(victim.id);
        if (!file) continue;
        try {
            await deleteMemoryFile(file.id, username);
        } catch (err) {
            console.warn(`[SelfMod] ledger prune could not drop "${victim.id}":`, err instanceof Error ? err.message : String(err));
        }
    }
};

/** Insert or update one row under the notebook write lock. A missing file on
 *  update is an error, not a silent no-op: the caller believes the change was
 *  audited, and an audit that did not land must say so. */
export const writeSelfChange = async (row: SelfChange, username = getActiveUsername()): Promise<SelfChange> => {
    const next = SelfChangeSchema.parse(row);
    const dirId = await ensureLedgerFolder(username);
    const existing = rowFileOf(next.id);
    const content = JSON.stringify(next, null, 2);
    if (existing) {
        await updateMemoryFile(existing.id, { content }, username);
    } else {
        await createMemoryFile(dirId, fileOf(next.id), content, username, true);
    }
    await prune(username);
    return next;
};

/** Read-modify-write one row. Returns null when it vanished mid-flight, which
 *  the caller must not treat as success. */
export const patchSelfChange = async (
    id: string,
    patch: Partial<Pick<SelfChange, 'status' | 'evidence' | 'expiresAt' | 'before' | 'after' | 'corpusVersion'>>,
    username = getActiveUsername(),
): Promise<SelfChange | null> => {
    const current = getSelfChange(id);
    if (!current) return null;
    const next = SelfChangeSchema.parse({
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
    });
    await writeSelfChange(next, username);
    return next;
};
