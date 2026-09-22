import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getBackups, createBackup, deleteBackup, exportBackupToFile, importBackupFromText, restoreBackup, BackupMetadata } from '../../services/infrastructure/BackupService';
import { ExportIcon, TrashIcon, RefreshIcon, LoadingIcon, PlusIcon } from '../shared/Icons';
import { useConfirmDialog } from '../shared/ConfirmDialog';

interface BackupManagerProps {
  /** Active user whose backups are listed. */
  username: string;
  /** Called after a successful restore so the app reloads the restored profile. */
  onProfileRestored: (username: string) => void;
}

/**
 * Backup management: list the auto-backups that BackupService silently
 * creates every 30 minutes, with create-now / export / restore / delete.
 * (The service was fully built but had no UI — backups were invisible.)
 */
export const BackupManager: React.FC<BackupManagerProps> = ({ username, onProfileRestored }) => {
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setBackups(await getBackups(username));
    } catch (err) {
      console.warn('[BackupManager] Failed to load backups:', err);
      setStatus({ kind: 'error', text: 'Failed to load backups.' });
    } finally {
      setIsLoading(false);
    }
  }, [username]);

  useEffect(() => {
    setStatus(null);
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    setIsCreating(true);
    setStatus(null);
    try {
      const meta = await createBackup(username);
      if (meta) {
        setStatus({ kind: 'success', text: `Backup created (${new Date(meta.timestamp).toLocaleString()}).` });
        void refresh();
      } else {
        setStatus({ kind: 'error', text: 'Backup failed — nothing was written.' });
      }
    } catch (err) {
      console.error('[BackupManager] Create failed:', err);
      setStatus({ kind: 'error', text: 'Backup failed.' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleExport = async (id: string) => {
    setBusyId(id);
    setStatus(null);
    try {
      await exportBackupToFile(id);
      setStatus({ kind: 'success', text: 'Backup exported as a JSON file.' });
    } catch (err) {
      console.error('[BackupManager] Export failed:', err);
      setStatus({ kind: 'error', text: 'Export failed.' });
    } finally {
      setBusyId(null);
    }
  };

  /** Choose an exported .json and add it to the list. Import is deliberately
   *  NOT restore: nothing live is touched here, so picking the wrong file costs
   *  one row in the list rather than a journal. The overwrite stays behind
   *  handleRestore's destructive confirm. */
  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setStatus(null);
    try {
      const result = await importBackupFromText(await file.text());
      if (!result.ok) {
        setStatus({
          kind: 'error',
          text: result.error
            || `That file is not a backup this app can read: ${(result.errors || []).slice(0, 2).join('; ')}`,
        });
        return;
      }
      const p = result.preview;
      setStatus({
        kind: 'success',
        text: `Imported ${p?.tradeCount ?? 0} trades · ${p?.conversationCount ?? 0} chats from "${p?.username}". Nothing was overwritten yet — press Restore on it. ${result.limitations?.[0] || ''}`,
      });
      void refresh();
    } catch (err) {
      console.error('[BackupManager] Import failed:', err);
      setStatus({ kind: 'error', text: 'Import failed.' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRestore = async (id: string, backupUsername: string) => {
    if (!await confirm({
      title: 'Restore Backup',
      message: `Restore the backup from ${new Date(backups.find(b => b.id === id)?.timestamp || '').toLocaleString()}?\n\nThis REPLACES the profile of "${backupUsername}" with the backed-up snapshot. This cannot be undone.`,
      confirmLabel: 'Restore',
      destructive: true,
    })) return;
    setBusyId(id);
    setStatus(null);
    try {
      const result = await restoreBackup(id);
      if (result.success) {
        // Restore reports skipped allow-list misses — surface them (audit
        // R1 #12: a partial restore that reads as fully clean is its own bug).
        setStatus({
          kind: result.skippedPreferenceKeys && result.skippedPreferenceKeys.length > 0 ? 'error' : 'success',
          text: result.skippedPreferenceKeys && result.skippedPreferenceKeys.length > 0
            ? result.message || `Profile "${result.username}" restored with skipped keys.`
            : `Profile "${result.username}" restored. Reloading…`,
        });
        onProfileRestored(result.username!);
      } else {
        setStatus({ kind: 'error', text: result.error || 'Restore failed.' });
      }
    } catch (err) {
      console.error('[BackupManager] Restore failed:', err);
      setStatus({ kind: 'error', text: 'Restore failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: 'Delete Backup', message: 'Delete this backup permanently?', destructive: true })) return;
    setBusyId(id);
    setStatus(null);
    try {
      const ok = await deleteBackup(id);
      setStatus(ok
        ? { kind: 'success', text: 'Backup deleted.' }
        : { kind: 'error', text: 'Delete failed.' });
      void refresh();
    } catch (err) {
      console.error('[BackupManager] Delete failed:', err);
      setStatus({ kind: 'error', text: 'Delete failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white">Backups</h4>
          <p className="text-xs text-zinc-500 mt-0.5">
            Auto-backups run every 30 minutes — stored per profile, newest 5 kept.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            data-testid="backup-import-button"
            className="px-3 py-2 rounded-xl border border-white/10 text-zinc-200 hover:bg-zinc-800 text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Reading…' : 'Import from file'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="backup-import-input"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? <LoadingIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
            {isCreating ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>

      {status && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${status.kind === 'success'
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
          {status.text}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-zinc-500 text-xs">
          <LoadingIcon className="w-4 h-4" />
          Loading backups…
        </div>
      ) : backups.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-zinc-500">No backups yet</p>
          <p className="text-xs text-zinc-600 mt-1">The next auto-backup (or "Back up now") will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
          {backups.map(backup => (
            <div key={backup.id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-200">
                  {new Date(backup.timestamp).toLocaleString()}
                </p>
                <p className="text-ui-xs text-zinc-500 mt-0.5">
                  {backup.tradeCount} trades · {backup.conversationCount} chats · {formatSize(backup.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleExport(backup.id)}
                  disabled={busyId === backup.id}
                  className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-cyan-400 transition-colors"
                  aria-label="Export backup as JSON"
                  title="Export"
                >
                  <ExportIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleRestore(backup.id, backup.username)}
                  disabled={busyId === backup.id}
                  className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
                  aria-label="Restore this backup"
                  title="Restore"
                >
                  <RefreshIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(backup.id)}
                  disabled={busyId === backup.id}
                  className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition-colors"
                  aria-label="Delete this backup"
                  title="Delete"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    {ConfirmDialogComponent}
    </>
  );
};

export default BackupManager;
