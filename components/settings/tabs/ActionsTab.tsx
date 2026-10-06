// TAB: Data — session usage and the profile's automatic backups (SettingsMenu
// "TAB 6").
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import { BackupManager } from '../BackupManager';
import { StorageLocationCard } from '../StorageLocationCard';
import { SettingsPageHeader } from './shared';
import { exportTrainingDataJSONL } from '../../../utils/reportExport';
import type { SettingsTabProps } from './types';

export interface ActionsTabProps extends SettingsTabProps {
    /** Called after a backup restore replaces the profile (App reloads it). */
    onProfileRestored?: (username: string) => void;
}

const ActionsTab: React.FC<{ tab: ActionsTabProps }> = ({ tab: props }) => {
    const { username, onProfileRestored } = props;
    const trades = props.loggedTrades ?? [];

    return (
        <div className="space-y-5 animate-fade-in">
            <SettingsPageHeader
                title="Data"
                description="Session usage and the profile's automatic backups."
            />

            <StorageLocationCard />

            {/* Training data — the journal as one model-ready JSON record per
                trade. A local download of the trader's own rows; nothing here
                leaves the machine. */}
            <section className="rounded-xl border border-white/[0.06] bg-zinc-800/40 p-4" data-testid="training-export-card">
                <h3 className="text-ui-dense font-semibold text-zinc-200">Training data</h3>
                <p className="mt-1 max-w-prose text-ui-xs leading-4 text-zinc-500">
                    One JSON record per trade on its own line: the plan it came from, the verdict,
                    the outcome and when it was learned, PnL in whichever unit was captured, R,
                    excursions, discipline tags and the post-mortem. Saves a local
                    {' '}.jsonl file — nothing is uploaded.
                </p>
                <button
                    type="button"
                    data-testid="export-training-jsonl"
                    disabled={trades.length === 0}
                    onClick={() => exportTrainingDataJSONL(trades)}
                    className="mt-2.5 rounded-control border border-white/10 bg-zinc-900 px-3 py-1.5 text-ui-xs font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {trades.length === 0
                        ? 'No trades logged yet'
                        : `Export ${trades.length} ${trades.length === 1 ? 'trade' : 'trades'} (JSONL)`}
                </button>
            </section>

            {/* Backups — list/export/restore/delete the 30-min auto-backups */}
            {username && onProfileRestored && (
                <BackupManager username={username} onProfileRestored={onProfileRestored} />
            )}
        </div>
    );
};

export default ActionsTab;
