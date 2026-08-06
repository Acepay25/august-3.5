
/**
 * StorageService.ts
 * 
 * Unified Storage Facade for August 3.5.
 * 
 * Purpose:
 * - Abstracts underlying storage mechanisms (IndexedDB, SQLite, LocalStorage).
 * - Provides a single API for persistent data access.
 * - Delegate large data (Trades, Profiles) to dbService (IndexedDB/SQLite).
 * - Delegate settings/preferences to LocalStorage (or Capacitor Preferences).
 */

import * as dbService from './dbService';
import { UserProfile, LoggedTrade, SavedAnalysis, LearningRule } from '../../types';

export enum StorageKey {
    LEARNING_RULES = 'learning_rules_v2',
    INSIGHT_KNOWLEDGE_BASE = 'insight_knowledge_base',
    APP_SETTINGS = 'august_app_settings',
    LAST_USER = 'last_active_user'
}

class UnifiedStorageService {

    // ========================================================================
    // PREFERENCES & SETTINGS (Small Data) -> LocalStorage
    // ========================================================================

    /**
     * Save a simple value or object to local storage
     */
    saveSetting<T>(key: string, value: T): void {
        try {
            const serialized = JSON.stringify(value);
            localStorage.setItem(key, serialized);
        } catch (e) {
            console.error(`[StorageService] Failed to save setting ${key}:`, e);
        }
    }

    /**
     * Load a simple value or object from local storage
     */
    loadSetting<T>(key: string, defaultValue: T): T {
        try {
            const item = localStorage.getItem(key);
            if (!item) return defaultValue;
            return JSON.parse(item) as T;
        } catch (e) {
            console.warn(`[StorageService] Failed to load setting ${key}, using default.`);
            return defaultValue;
        }
    }

    /**
     * Remove a setting
     */
    removeSetting(key: string): void {
        localStorage.removeItem(key);
    }

    // ========================================================================
    // DOMAIN DATA (Large Data) -> dbService (IndexedDB/SQLite)
    // ========================================================================

    /**
     * Save the entire user profile (delegates to dbService)
     */
    async saveUserProfile(username: string, data: Partial<Omit<UserProfile, 'username'>>): Promise<void> {
        return dbService.saveUserProfile(username, data);
    }

    /**
     * Get user profile (delegates to dbService)
     */
    async getUserProfile(username: string): Promise<UserProfile | undefined> {
        return dbService.getUserProfile(username);
    }

    /**
     * Get all usernames
     */
    async getAllUsernames(): Promise<string[]> {
        return dbService.getAllUsernames();
    }

    // ========================================================================
    // SPECIALIZED ADAPTERS (Helpers for specific features)
    // ========================================================================

    /**
     * User-scoped storage key. Learning state is per-profile (GlobalLearningService
     * keys calibration the same way) — a global key let user A's loss-rules
     * inject into user B's analyses.
     */
    private scopedKey(key: string): string {
        const username = localStorage.getItem('last_active_user') || 'default';
        return `${key}_${username}`;
    }

    /**
     * Load Learning Rules (per active user)
     */
    loadLearningRules(): { rules: LearningRule[]; lastUpdated: string; version: number } {
        const scoped = this.scopedKey(StorageKey.LEARNING_RULES);
        const stored = this.loadSetting<{ rules: LearningRule[]; lastUpdated: string; version?: number } | null>(scoped, null);
        if (stored) {
            return { version: stored.version ?? 2, rules: stored.rules ?? [], lastUpdated: stored.lastUpdated };
        }

        // Legacy (pre-multi-user) key — migrate ONCE: the legacy value is
        // removed after the copy so a later-created user can't inherit a
        // stale snapshot of the first user's pre-upgrade rules.
        const legacy = this.loadSetting<{ rules?: LearningRule[]; lastUpdated?: string } | null>(StorageKey.LEARNING_RULES, null);
        if (legacy && (legacy.rules?.length || legacy.lastUpdated)) {
            const migrated = {
                version: 2,
                rules: legacy.rules ?? [],
                lastUpdated: legacy.lastUpdated ?? new Date().toISOString(),
            };
            this.saveSetting(scoped, migrated);
            try {
                localStorage.removeItem(StorageKey.LEARNING_RULES);
            } catch (e) {
                console.warn('[StorageService] Failed to remove legacy learning rules:', e);
            }
            return migrated;
        }
        return { version: 2, rules: [], lastUpdated: new Date().toISOString() };
    }

    /**
     * Save Learning Rules (per active user)
     */
    saveLearningRules(data: { rules: LearningRule[]; lastUpdated: string; version: number }): void {
        this.saveSetting(this.scopedKey(StorageKey.LEARNING_RULES), data);
    }

    /**
     * Helper: Get Trade Logs for current user (for dashboard stats)
     */
    async getTradeLogs(): Promise<LoggedTrade[]> {
        // read via getItem — the value is a RAW string (App writes it with
        // setItem); loadSetting's JSON.parse threw and fell back to the
        // default user, so dashboards always showed the default user's trades.
        const username = localStorage.getItem('last_active_user') || 'default';
        const profile = await this.getUserProfile(username);
        return profile?.tradeLog || [];
    }
}

export const storageService = new UnifiedStorageService();
