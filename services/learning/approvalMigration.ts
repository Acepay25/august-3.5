/**
 * The approval gate's one-time migration, and the only place that mutates the
 * trader's existing data for it.
 *
 * Order matters and is the whole design:
 *   1. BACK UP FIRST — profile + preferences sidecar (the sidecar sweep carries
 *      `memory_files_v1_<user>`, i.e. the notebook itself). If the backup does not
 *      land, NOTHING IS STAMPED: a data migration with no recovery point is not a
 *      migration, it is a risk.
 *   2. STAMP the approval fact on rows that predate the gate, so the library keeps
 *      working on day one instead of going silent (`grandfatherExistingApprovals`).
 *      It inserts two front-matter lines and is idempotent by construction — it only
 *      touches rows carrying no approval fact at all.
 *   3. RECORD that it ran, so a restart does not re-scan the notebook.
 *
 * Restore if you need to undo it: Settings → Data → the backup taken moments before
 * (its id and timestamp are in the returned report and in the console line), then
 * import that file. See docs/plans/workstream1-status.md for the exact steps.
 */

import { grandfatherExistingApprovals } from './SkillMemoryService';
import { createBackup } from '../infrastructure/BackupService';

/** Raw-localStorage owner (this module reads and writes it directly, never through
 *  Preferences), so the key is registered in `RAW_LOCAL_STORAGE_PREFIXES`. */
export const APPROVAL_MIGRATION_KEY_PREFIX = 'approvals_grandfathered_v1_';

const markerKey = (user: string): string => `${APPROVAL_MIGRATION_KEY_PREFIX}${user}`;

export interface ApprovalMigrationReport {
    ran: boolean;
    backedUp: boolean;
    backupId?: string | null;
    stamped?: number;
    alreadyMarked?: number;
    skipped?: number;
    failed?: number;
    reason?: 'already-ran' | 'backup-failed' | 'storage-unavailable';
}

export const approvalMigrationRan = (username: string): boolean => {
    try {
        return localStorage.getItem(markerKey(username || 'default')) === '1';
    } catch {
        return false;
    }
};

/**
 * Run the migration once. Safe to call from every boot path: a second call is a
 * read of one key. `force` exists for tests and for an operator who wants the pass
 * re-checked after a restore (the stamping itself is idempotent either way).
 */
export const runApprovalMigration = async (
    username: string,
    options: { force?: boolean } = {},
): Promise<ApprovalMigrationReport> => {
    const user = username || 'default';
    if (!options.force && approvalMigrationRan(user)) return { ran: false, backedUp: false, reason: 'already-ran' };

    if (typeof localStorage === 'undefined') {
        return { ran: false, backedUp: false, reason: 'storage-unavailable' };
    }

    // 1. A recovery point BEFORE touching anything. `createBackup` returns null when
    //    it could not write one — that is the refusal, not a warning.
    const backup = await createBackup(user);
    if (!backup) {
        console.warn('[ApprovalMigration] No backup could be written — the approval stamping did NOT run. The library stays unapproved until a recovery point exists.');
        return { ran: false, backedUp: false, backupId: null, reason: 'backup-failed' };
    }

    // 2. Stamp.
    const report = await grandfatherExistingApprovals(user);
    console.log(`[ApprovalMigration] Grandfathered ${report.stamped} skill(s) behind backup ${backup.id} (${report.alreadyMarked} already marked, ${report.skipped} left to the starter shelf, ${report.failed} failed).`);

    // 3. Record. If the marker cannot be written the pass simply re-runs next boot
    //    onto an already-stamped library — no double stamp is possible.
    try {
        localStorage.setItem(markerKey(user), '1');
    } catch { /* best effort; see above */ }

    return { ran: true, backedUp: true, backupId: backup.id, ...report };
};
