/**
 * memoryAmendments — the memory self-correction loop.
 *
 * writeModelNote can only CREATE/APPEND, so a wrong model-authored note
 * accumulates forever. This module gives models a second, gated path:
 * PROPOSE an amendment (edit or supersede an existing notebook file),
 * stored as a pending diff. A human approves or rejects it in
 * Settings → Memory; nothing in the notebook changes on proposal.
 *
 * Provenance is mandatory: who proposed, when, why, and exactly what
 * changes. Rejected proposals are kept ( tombstoned ) so a model cannot
 * re-propose the same correction forever.
 */

import { MemoryFile } from '../../types/learning';

export interface MemoryAmendment {
    id: string;
    /** The notebook file this amendment targets. */
    fileId: string;
    fileName: string;
    kind: 'edit' | 'supersede';
    /** The full replacement content (edit) or appended section (supersede). */
    proposedContent: string;
    /** Why the model believes the current content is wrong/outdated. */
    reason: string;
    /** Which provider/model proposed it (provenance). */
    proposedBy: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    /** Resolution metadata. */
    resolvedAt?: string;
    resolvedBy?: 'user';
}

const KEY = 'memory_amendments_v1';

const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = (): string => new Date().toISOString();

/** Proposals can arrive mid-session — App listens and toasts. */
export const AMENDMENT_EVENT = 'august:memory-amendment';

const load = (): MemoryAmendment[] => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
        const raw = window.localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as MemoryAmendment[]) : [];
    } catch { return []; }
};

const save = (items: MemoryAmendment[]): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota — ignore */ }
};

/** Cap the inbox — the oldest resolved entries fall off. */
const MAX_AMENDMENTS = 60;

export interface AmendValidation { ok: boolean; errors: string[] }

/** Validate a proposed amendment before it may be stored. */
export const validateAmendment = (input: {
    proposedContent: string;
    reason: string;
    targetFile?: MemoryFile | null;
}): AmendValidation => {
    const errors: string[] = [];
    if (!(input.proposedContent ?? '').trim()) errors.push('proposedContent is required');
    if (input.proposedContent.length > 8000) errors.push('proposedContent exceeds 8000 chars');
    if (!(input.reason ?? '').trim()) errors.push('reason is required');
    if (!input.targetFile) errors.push('target file not found');
    else if (input.targetFile.autoManaged) errors.push('auto-managed files (diary/profile/rules) cannot be amended — they are harness-owned');
    else if (input.proposedContent === input.targetFile.content) errors.push('proposed content is identical to the current content');
    return { ok: errors.length === 0, errors };
};

/**
 * Propose an amendment. Validates hard (no autoManaged targets, no
 * identical content) and stores as PENDING. Throws with the reason on
 * invalid input — callers surface it to the model as tool feedback.
 */
export const proposeAmendment = (
    fileId: string,
    kind: 'edit' | 'supersede',
    proposedContent: string,
    reason: string,
    proposedBy: string,
    getFileById: (id: string) => MemoryFile | null,
): MemoryAmendment => {
    const target = getFileById(fileId);
    const v = validateAmendment({ proposedContent, reason, targetFile: target });
    if (!v.ok) throw new Error(`Amendment rejected: ${v.errors.join('; ')}`);
    const items = load();
    const amendment: MemoryAmendment = {
        id: uid(),
        fileId,
        fileName: target!.name,
        kind,
        proposedContent: proposedContent.trim(),
        reason: reason.trim(),
        proposedBy,
        status: 'pending',
        createdAt: nowIso(),
    };
    save([amendment, ...items].slice(0, MAX_AMENDMENTS));
    try {
        window.dispatchEvent(new CustomEvent(AMENDMENT_EVENT, { detail: { id: amendment.id, fileName: amendment.fileName } }));
    } catch { /* non-DOM envs — ignore */ }
    return amendment;
};

export const listAmendments = (status?: MemoryAmendment['status']): MemoryAmendment[] => {
    const items = load();
    return status ? items.filter(a => a.status === status) : items;
};

/** APPROVE: the caller applies the content change itself (write-lock path). */
export const approveAmendment = (id: string): MemoryAmendment | undefined => {
    const items = load();
    const a = items.find(x => x.id === id);
    if (!a || a.status !== 'pending') return undefined;
    a.status = 'approved';
    a.resolvedAt = nowIso();
    a.resolvedBy = 'user';
    save(items);
    return a;
};

/** REJECT: tombstoned so repeat proposals of the same change are visible. */
export const rejectAmendment = (id: string): MemoryAmendment | undefined => {
    const items = load();
    const a = items.find(x => x.id === id);
    if (!a || a.status !== 'pending') return undefined;
    a.status = 'rejected';
    a.resolvedAt = nowIso();
    a.resolvedBy = 'user';
    save(items);
    return a;
};
