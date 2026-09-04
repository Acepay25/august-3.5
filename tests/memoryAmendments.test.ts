import { describe, it, expect, beforeEach } from 'vitest';

import { MemoryFile } from '../types/learning';
import {
    proposeAmendment,
    listAmendments,
    approveAmendment,
    rejectAmendment,
    validateAmendment,
} from '../services/learning/memoryAmendments';

const file = (over: Partial<MemoryFile> = {}): MemoryFile => ({
    id: over.id ?? 'f1',
    folderId: 'lessons',
    name: over.name ?? 'my-edge.md',
    content: over.content ?? '# My edge\n\nold claim',
    enabled: over.enabled ?? true,
    autoManaged: over.autoManaged,
    createdAt: 1,
    updatedAt: 1,
    ...over,
});

const files: MemoryFile[] = [];
const finder = (id: string): MemoryFile | null => files.find(f => f.id === id) ?? null;

beforeEach(() => {
    window.localStorage.clear();
    files.length = 0;
    files.push(file());
});

describe('memoryAmendments — the model self-correction gate', () => {
    it('validates: content and reason required, no autoManaged targets, no no-op edits', () => {
        expect(validateAmendment({ proposedContent: 'x', reason: 'r', targetFile: files[0] }).ok).toBe(true);
        expect(validateAmendment({ proposedContent: '  ', reason: 'r', targetFile: files[0] }).ok).toBe(false);
        expect(validateAmendment({ proposedContent: 'x', reason: '', targetFile: files[0] }).ok).toBe(false);
        expect(validateAmendment({ proposedContent: 'x', reason: 'r', targetFile: null }).ok).toBe(false);
        expect(validateAmendment({ proposedContent: 'x', reason: 'r', targetFile: file({ autoManaged: true }) }).ok).toBe(false);
        expect(validateAmendment({ proposedContent: files[0].content, reason: 'r', targetFile: files[0] }).ok).toBe(false);
    });

    it('propose stores a PENDING amendment; the notebook is untouched', () => {
        const a = proposeAmendment('f1', 'edit', '# My edge\n\ncorrected claim', 'the old claim predates the regime shift', 'model:test', finder);
        expect(a.status).toBe('pending');
        expect(listAmendments('pending')).toHaveLength(1);
        // The target file is NOT changed by proposing.
        expect(files[0].content).toContain('old claim');
    });

    it('approval marks it approved — the caller applies the content', () => {
        const a = proposeAmendment('f1', 'edit', 'corrected', 'evidence', 'model:test', finder);
        const resolved = approveAmendment(a.id);
        expect(resolved?.status).toBe('approved');
        expect(resolved?.resolvedBy).toBe('user');
        expect(listAmendments('pending')).toHaveLength(0);
    });

    it('rejections are tombstoned so repeat proposals stay visible', () => {
        const a = proposeAmendment('f1', 'edit', 'other content', 'reason v1', 'model:test', finder);
        rejectAmendment(a.id);
        // A model re-proposing the same correction is not blocked — but the
        // tombstone keeps the history auditable.
        const b = proposeAmendment('f1', 'edit', 'other content', 'reason v2', 'model:test', finder);
        expect(b.status).toBe('pending');
        const all = listAmendments();
        expect(all.filter(x => x.status === 'rejected')).toHaveLength(1);
    });

    it('invalid proposals throw with the reason (nothing stored)', () => {
        expect(() => proposeAmendment('f1', 'edit', '   ', 'reason', 'model:test', finder)).toThrow(/proposedContent/);
        expect(() => proposeAmendment('missing-id', 'edit', 'x', 'reason', 'model:test', finder)).toThrow(/target file/);
        expect(listAmendments()).toHaveLength(0);
    });
});
