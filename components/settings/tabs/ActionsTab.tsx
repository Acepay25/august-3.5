// TAB: Data — session usage and the profile's automatic backups (SettingsMenu
// "TAB 6").
//
// Moved verbatim from the inline body in SettingsMenu.tsx.
import React from 'react';
import { BackupManager } from '../BackupManager';
import { StorageLocationCard } from '../StorageLocationCard';
import { SettingsPageHeader } from './shared';
import type { SettingsTabProps } from './types';

export interface ActionsTabProps extends SettingsTabProps {
    /** Called after a backup restore replaces the profile (App reloads it). */
    onProfileRestored?: (username: string) => void;
}

const ActionsTab: React.FC<{ tab: ActionsTabProps }> = ({ tab: props }) => {
    const { username, onProfileRestored } = props;

    return (
        <div className="space-y-5 animate-fade-in">
            <SettingsPageHeader
                title="Data"
                description="Session usage and the profile's automatic backups."
            />

            <StorageLocationCard />


            {/* Backups — list/export/restore/delete the 30-min auto-backups */}
            {username && onProfileRestored && (
                <BackupManager username={username} onProfileRestored={onProfileRestored} />
            )}
        </div>
    );
};

export default ActionsTab;
