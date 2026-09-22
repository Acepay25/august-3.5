/**
 * An exported backup has to be importable (2026-09-21).
 *
 * `exportBackupToFile` wrote a profile-shaped envelope with a comment promising
 * compatibility with "the existing import flow" — and there was no import flow.
 * The validator and the preview builder existed, were unreferenced, and so the
 * one artifact a trader could carry off a machine was unreadable by this app:
 * reinstall, and the journal was gone even though he had the file.
 *
 * These pin the round-trip and, just as importantly, the safety property:
 * importing stores a row and touches nothing live.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
    buildBackupRecordFromExport,
    validateImportData,
    getImportPreview,
} from '../../services/infrastructure/BackupService';

const importMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/infrastructure/BackupService', async () => {
    const real = await import('../../services/infrastructure/BackupService');
    return { ...real, importBackupFromText: (...a: unknown[]) => importMock(...a) };
});

import BackupManager from '../../components/settings/BackupManager';

/** Exactly the envelope `exportBackupToFile` writes: the profile spread, plus
 *  its bookkeeping keys. */
const exportedFile = (over: Record<string, unknown> = {}) => JSON.stringify({
    username: '_rober_',
    conversations: [
        { id: 'c1', title: 'BTC reclaim', messages: [{ id: 'm1' }, { id: 'm2' }] },
        { id: 'c2', title: 'ETH fade', messages: [{ id: 'm3' }] },
    ],
    tradeLog: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    savedAnalyses: [],
    settings: { activeFrameworks: [] },
    _backupExportedAt: '2026-09-19T10:00:00.000Z',
    _preferencesBackup: { provider_configs_v1: [{ id: 'mock' }] },
    ...over,
});

describe('the exported file round-trips into a storable backup', () => {
    it('is accepted, and the preview matches the file', () => {
        const outcome = buildBackupRecordFromExport(exportedFile());
        expect(outcome.ok).toBe(true);
        expect(outcome.preview).toEqual(getImportPreview(JSON.parse(exportedFile())));
        expect(outcome.preview?.tradeCount).toBe(3);
        expect(outcome.preview?.conversationCount).toBe(2);
        expect(outcome.preview?.messageCount).toBe(3);
    });

    it('carries the export timestamp and the username through to metadata', () => {
        const { metadata } = buildBackupRecordFromExport(exportedFile());
        expect(metadata?.timestamp).toBe('2026-09-19T10:00:00.000Z');
        expect(metadata?.username).toBe('_rober_');
        expect(metadata?.conversationCount).toBe(2);
    });

    it('names the profile without the envelope keys the restore path must not see', () => {
        const { record } = buildBackupRecordFromExport(exportedFile());
        const profile = JSON.parse(record!.profile);
        expect(profile._backupExportedAt).toBeUndefined();
        expect(profile._preferencesBackup).toBeUndefined();
        expect(profile.username).toBe('_rober_');
        // The sidecar is kept, in its own column, exactly as createBackup writes it.
        expect(JSON.parse(record!.preferences)).toEqual({ provider_configs_v1: [{ id: 'mock' }] });
    });

    it('marks the row as imported so it cannot evict the machine’s own backups', () => {
        const { record, metadata } = buildBackupRecordFromExport(exportedFile());
        expect(record!.id.startsWith('imported-_rober_-')).toBe(true);
        expect(metadata!.id).toBe(record!.id);
    });

    it('says what the file cannot bring back instead of implying a full restore', () => {
        const outcome = buildBackupRecordFromExport(exportedFile());
        expect(outcome.limitations?.join(' ')).toMatch(/[Tt]hinking/);
        expect(outcome.record!.thinking).toBe('[]');
    });

    it('warns separately when an older file has no preferences sidecar', () => {
        const text = exportedFile();
        const withoutSidecar = JSON.stringify(
            (() => { const o = JSON.parse(text); delete o._preferencesBackup; return o; })(),
        );
        const outcome = buildBackupRecordFromExport(withoutSidecar);
        expect(outcome.ok).toBe(true);
        expect(outcome.limitations?.join(' ')).toMatch(/predates sidecar/);
    });

    it('rejects a non-JSON file with one readable sentence', () => {
        const outcome = buildBackupRecordFromExport('not json at all {');
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toBe('That file is not valid JSON.');
    });

    it('rejects a structurally invalid profile with the validator’s own reasons', () => {
        const bad = JSON.stringify({ conversations: [{ messages: 'nope' }] });
        const outcome = buildBackupRecordFromExport(bad);
        expect(outcome.ok).toBe(false);
        expect(outcome.errors).toEqual(expect.arrayContaining([
            expect.stringMatching(/username/i),
            expect.stringMatching(/messages array/i),
        ]));
        // Same verdict the standalone validator reaches — one rule, not two.
        expect(outcome.errors).toEqual(validateImportData(JSON.parse(bad)).errors);
    });

    it('refuses a file with no username rather than importing into a blank profile', () => {
        const text = exportedFile();
        const o = JSON.parse(text); delete o.username;
        expect(buildBackupRecordFromExport(JSON.stringify(o)).ok).toBe(false);
    });
});

describe('the Backup manager can choose a file', () => {
    it('reports the import without restoring anything', async () => {
        importMock.mockReset();
        importMock.mockResolvedValue({
            ok: true,
            preview: { username: 'rober', conversationCount: 2, messageCount: 3, tradeCount: 3, savedAnalysesCount: 0 },
            limitations: ['Reasoning records (the thinking corpus) are not carried by an exported file.'],
        });
        render(
            <BackupManager
                username="rober"
                onProfileRestored={vi.fn()}
            />,
        );
        expect(screen.getByTestId('backup-import-button')).toBeInTheDocument();
        const file = { name: 'august_backup_rober_2026-09-19.json', text: async () => exportedFile() };
        fireEvent.change(screen.getByTestId('backup-import-input'), { target: { files: [file] } });

        const status = await waitFor(() => screen.getByText(/Imported 3 trades/));
        expect(status.textContent).toContain('Nothing was overwritten yet');
        expect(status.textContent).toMatch(/thinking/i);
        // The destructive path was never entered.
        expect(screen.queryByText(/Restore Backup/)).not.toBeInTheDocument();
    });

    it('surfaces why a file was refused, instead of a bare "failed"', async () => {
        importMock.mockReset();
        importMock.mockResolvedValue({ ok: false, errors: ['Missing or invalid username'] });
        render(<BackupManager username="rober" onProfileRestored={vi.fn()} />);
        const file = { name: 'x.json', text: async () => '{}' };
        fireEvent.change(screen.getByTestId('backup-import-input'), { target: { files: [file] } });
        expect(await screen.findByText(/Missing or invalid username/)).toBeInTheDocument();
    });
});
