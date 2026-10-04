/**
 * A backup that left a store out must not read as a success.
 *
 * `exportPreferencesData` skips a chat store that is over the per-store cap even
 * after its images were stripped, and records it in `_backup_notices`. That fact
 * is only worth anything if the person who pressed "Back up now" sees it — this
 * mounts the real Settings → Data panel and asserts the notice is on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
    getBackups: vi.fn(async () => []),
    createBackup: vi.fn(async (): Promise<BackupMetadata> => ({
        id: 'backup-1', username: 'rober', timestamp: new Date().toISOString(),
        version: 1, sizeBytes: 10, conversationCount: 0, tradeCount: 0,
    })),
}));

vi.mock('../services/infrastructure/BackupService', () => ({
    getBackups: h.getBackups,
    createBackup: h.createBackup,
    deleteBackup: vi.fn(async () => {}),
    exportBackupToFile: vi.fn(async () => {}),
    importBackupFromText: vi.fn(async () => {}),
    restoreBackup: vi.fn(async () => true),
}));

import BackupManager from '../components/settings/BackupManager';
import type { BackupMetadata } from '../services/infrastructure/BackupService';

beforeEach(() => {
    h.getBackups.mockClear();
    h.createBackup.mockClear();
});

afterEach(cleanup);

const pressBackUp = async () => {
    render(<BackupManager username="rober" onProfileRestored={vi.fn()} />);
    await screen.findByText('No backups yet');
    fireEvent.click(screen.getByRole('button', { name: /Back up now/ }));
};

describe('the over-cap backup notice is visible', () => {
    it('says what the backup LEFT OUT instead of claiming a clean backup', async () => {
        h.createBackup.mockResolvedValueOnce({
            id: 'backup-2', username: 'rober', timestamp: new Date().toISOString(),
            version: 1, sizeBytes: 10, conversationCount: 0, tradeCount: 0,
            notices: ['trade_chat_sessions_v1_rober: NOT IN THIS BACKUP — 600000 bytes is over the 524288-byte cap even after images were stripped'],
        });
        await pressBackUp();

        await waitFor(() => expect(screen.getByTestId('backup-status')).toBeTruthy());
        const line = screen.getByTestId('backup-status');
        expect(line.textContent).toMatch(/LEFT OUT/i);
        expect(line.textContent).toContain('trade_chat_sessions_v1_rober');
        // Not the clean success line the no-notice branch prints.
        expect(line.textContent).not.toMatch(/Backup created \(/);
    });

    it('keeps the plain success line when nothing was skipped', async () => {
        await pressBackUp();
        await waitFor(() => expect(screen.getByTestId('backup-status')).toBeTruthy());
        expect(screen.getByTestId('backup-status').textContent).toMatch(/Backup created/);
    });
});
