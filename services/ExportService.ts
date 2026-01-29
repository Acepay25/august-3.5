/**
 * ExportService - Cross-platform data export
 * Uses Capacitor Filesystem + Share API for Android/iOS, blob download for web
 */

import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/**
 * Check if running in Capacitor (native APK/iOS)
 */
const isNativePlatform = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/**
 * Export data as a downloadable/shareable JSON file
 * 
 * On Android/iOS: Writes to cache directory then shares the file
 * On Web: Creates a blob download
 * 
 * @param data - The data object to export
 * @param filename - The filename (without path)
 * @returns Promise resolving to success status
 */
export const exportDataAsFile = async (
    data: any,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    const jsonContent = JSON.stringify(data, null, 2);

    if (isNativePlatform()) {
        return exportNative(jsonContent, filename);
    } else {
        return exportWeb(jsonContent, filename);
    }
};

/**
 * Native export using Capacitor Filesystem + Share API
 * Writes file to cache directory first, then shares via file URI
 * This avoids Android's intent size limit (~1MB) that causes crashes
 */
const exportNative = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        console.log('[ExportService] Writing file to cache directory...');

        // Step 1: Write file to cache directory
        const result = await Filesystem.writeFile({
            path: filename,
            data: content,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });

        console.log('[ExportService] File written:', result.uri);

        // Step 2: Share the file URI instead of raw text
        // This avoids the intent size limit that crashes the app
        try {
            await Share.share({
                title: `August Backup`,
                url: result.uri, // Share file URI, not text
                dialogTitle: 'Save or Share Your Backup',
            });

            console.log('[ExportService] Share dialog opened successfully');
            return { success: true };
        } catch (shareError: any) {
            // Check for share cancellation (not an error)
            if (shareError.message?.includes('cancel') || shareError.message?.includes('abort') || shareError.message?.includes('dismiss')) {
                return { success: true }; // User cancelled, not an error
            }

            // If share fails, try to copy to downloads as fallback
            console.warn('[ExportService] Share failed, trying fallback copy:', shareError);
            return await fallbackCopyToDownloads(content, filename);
        }
    } catch (error: any) {
        console.error('[ExportService] Native export failed:', error);

        // Final fallback: Try text-based share with truncation warning
        return {
            success: false,
            error: `Export failed: ${error.message || 'Unknown error'}. Try reducing trade log size.`,
        };
    }
};

/**
 * Fallback: Copy content to clipboard with instructions
 */
const fallbackCopyToDownloads = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        // Try to write to Documents directory (more accessible)
        await Filesystem.writeFile({
            path: `Download/${filename}`,
            data: content,
            directory: Directory.ExternalStorage, // Public external storage
            encoding: Encoding.UTF8,
            recursive: true,
        });

        return {
            success: true,
            error: `Saved to Downloads folder: ${filename}`
        };
    } catch (downloadError: any) {
        console.error('[ExportService] Fallback also failed:', downloadError);

        // Last resort: Copy to clipboard
        try {
            if (navigator.clipboard && content.length < 1000000) {
                await navigator.clipboard.writeText(content);
                return {
                    success: true,
                    error: 'Backup copied to clipboard. Paste into a text file to save.'
                };
            }
        } catch (clipError) {
            console.error('[ExportService] Clipboard fallback failed:', clipError);
        }

        return {
            success: false,
            error: `Export failed. Data may be too large. Try exporting less data.`,
        };
    }
};

/**
 * Web export using blob download
 */
const exportWeb = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        console.log('[ExportService] Using blob download (Web)');

        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('[ExportService] Web download initiated');
        return { success: true };
    } catch (error: any) {
        console.error('[ExportService] Web export failed:', error);
        return {
            success: false,
            error: `Export failed: ${error.message || 'Unknown error'}`,
        };
    }
};

/**
 * Check if the Share API is available
 */
export const canShare = async (): Promise<boolean> => {
    if (!isNativePlatform()) {
        return true; // Web can always use blob download
    }

    try {
        const result = await Share.canShare();
        return result.value;
    } catch {
        return false;
    }
};


import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from './PreferencesService';

/**
 * Export all preference keys as a supplementary backup
 * This captures settings that aren't in database
 */
export const exportPreferencesData = async (): Promise<Record<string, any>> => {
    const backup: Record<string, any> = {};

    // Get all values from PreferencesService (handles native/web abstraction)
    const keysToBackup = Object.values(PREF_KEYS);

    for (const key of keysToBackup) {
        try {
            const value = await getPreferenceObject(key);
            if (value !== null) {
                backup[key] = value;
            }
        } catch (e) {
            console.warn(`[ExportService] Failed to export key ${key}:`, e);
        }
    }

    return backup;
};

/**
 * Import preference keys from backup
 */
export const importPreferencesData = async (backup: Record<string, any>): Promise<void> => {
    for (const [key, value] of Object.entries(backup)) {
        try {
            // Check if this is a known preference key or legacy key
            // Start simple: just save it
            if (typeof value === 'object') {
                await setPreferenceObject(key, value);
            } else {
                // If it's a string, we might need setPreference, but setPreferenceObject handles objects
                // wrapper might be needed if base is string
                await setPreferenceObject(key, value);
            }
        } catch (error) {
            console.error(`[ExportService] Failed to import key ${key}:`, error);
        }
    }
};
