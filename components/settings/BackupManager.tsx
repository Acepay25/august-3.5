import React, { useState, useCallback, useEffect } from 'react';
import { getBackups, createBackup, deleteBackup, exportBackupToFile, restoreBackup, BackupMetadata } from '../../services/infrastructure/BackupService';
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
        setStatus({ kind: 'success', text: `Profile "${result.username}" restored. Reloading…` });
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
        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? <LoadingIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
          {isCreating ? 'Backing up…' : 'Back up now'}
        </button>
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
                <p className="text-[10px] text-zinc-500 mt-0.5">
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
