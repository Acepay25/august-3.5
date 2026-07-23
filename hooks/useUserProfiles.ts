import { useState } from 'react';
import * as dbService from '../services/infrastructure/dbService';
import { isValidUserProfile } from '../utils/profileUtils';
import { exportDataAsFile, exportPreferencesData } from '../services/infrastructure/ExportService';

export interface UseUserProfilesParams {
    resetAppState: () => Promise<void>;
    setIsUserModalOpen: (v: boolean) => void;
    setIsSettingsVisible: (v: boolean) => void;
    toast: { success: (t: string, m?: string) => void; error: (t: string, m?: string) => void; info: (t: string, m?: string) => void };
}

/**
 * Custom hook that encapsulates user profile management state and handlers.
 * Extracted from App.tsx to reduce component complexity.
 */
export const useUserProfiles = (params: UseUserProfilesParams) => {
    const { resetAppState, setIsUserModalOpen, setIsSettingsVisible, toast } = params;

    // ─── State ────────────────────────────────────────────────────────────
    const [activeUsername, setActiveUsername] = useState<string | null>(null);
    const [existingUsernames, setExistingUsernames] = useState<string[]>([]);
    const [saveStatus, setSaveStatus] = useState<'SAVED' | 'SAVING' | 'ERROR'>('SAVED');

    // ─── Handlers ─────────────────────────────────────────────────────────
    const handleImportData = async (fileContent: string) => {
        try {
            const data = JSON.parse(fileContent);
            if (isValidUserProfile(data)) {
                await dbService.overwriteUserProfile(data);
                toast.success("Profile Imported", "Please select the user to log in.");
                const users = await dbService.getAllUsernames();
                setExistingUsernames(users);
            } else {
                toast.error("Import Failed", "Invalid profile data format.");
            }
        } catch (e) {
            toast.error("Import Failed", "Failed to parse import file.");
        }
    };

    const handleDeleteUser = async (username: string) => {
        if (confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`)) {
            await dbService.deleteUserProfile(username);
            setExistingUsernames(prev => prev.filter(u => u !== username));
            if (activeUsername === username) {
                setActiveUsername(null);
                resetAppState();
                setIsUserModalOpen(true);
            }
        }
    };

    const handleSwitchUser = () => {
        setIsUserModalOpen(true);
        setIsSettingsVisible(false);
    };

    const handleExportData = async () => {
        if (!activeUsername) return;
        const profile = await dbService.getUserProfile(activeUsername);
        if (profile) {
            // Create comprehensive backup including preferences settings
            const fullBackup = {
                ...profile,
                _exportedAt: new Date().toISOString(),
                _appVersion: '3.5',
                _preferencesBackup: await exportPreferencesData(),
            };

            const filename = `august_backup_${activeUsername}_${new Date().toISOString().split('T')[0]}.json`;
            const result = await exportDataAsFile(fullBackup, filename);

            if (!result.success) {
                toast.error("Export Failed", result.error);
            }
        }
    };

    return {
        activeUsername, setActiveUsername,
        existingUsernames, setExistingUsernames,
        saveStatus, setSaveStatus,
        handleImportData,
        handleDeleteUser,
        handleSwitchUser,
        handleExportData,
    };
};
