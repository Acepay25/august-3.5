/**
 * OfflineQueueService - Queues failed requests when offline and syncs when back online
 * Uses IndexedDB for persistence across sessions
 *
 * PROFILE ISOLATION: every item is stamped with the username that enqueued
 * it, and processQueue only replays items belonging to the CURRENT active
 * user (setActiveUser is wired into the profile-switch path). Without that
 * gate, one profile's queued analyses would run inside another profile's
 * session — the audit §2.5 unscoped-service finding for this file.
 */

import { getActiveUsername } from '../../utils/activeUser';

const DB_NAME = 'august_offline_queue';
const DB_VERSION = 2; // Bumped for lastAttempt field
const STORE_NAME = 'queued_requests';

// Exponential backoff configuration
const BASE_DELAY_MS = 5000; // 5 seconds base delay
const MAX_RETRIES = 5;
const MAX_DELAY_MS = 300000; // 5 minutes max

export interface QueuedRequest {
    id: string;
    type: 'analysis' | 'postMortem' | 'summary' | 'strategySearch';
    payload: any;
    /** Profile that enqueued the item. Populated at enqueue time (callers
     *  may omit it); items written before user-scoping have no field and
     *  are treated as belonging to whoever is active on first processing. */
    username?: string;
    createdAt: string;
    retryCount: number;
    lastAttempt?: string; // ISO timestamp of last retry attempt
}

let db: IDBDatabase | null = null;

/** The profile whose items processQueue may replay. */
let activeUser: string = getActiveUsername();

/**
 * Wire the profile-switch path: from now on, only this user's items are
 * processed (another profile's queued work stays parked until they return).
 */
export const setActiveUser = (username: string): void => {
    activeUser = username;
};

export const getActiveUser = (): string => activeUser;

/**
 * Initialize the IndexedDB database
 */
const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[OfflineQueue] Failed to open database');
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

/**
 * Add a request to the offline queue. The `username` is stamped here (from
 * the argument when the caller knows it, otherwise from the module's
 * ACTIVE-USER marker — the same value processQueue gates on, so an item
 * enqueued by this session is always replayable by this session). Callers
 * that never pass it still get correct attribution.
 */
export const addToQueue = async (
    request: Omit<QueuedRequest, 'id' | 'createdAt' | 'retryCount' | 'username'> & { username?: string },
): Promise<string> => {
    const database = await initDB();
    const id = `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const queuedRequest: QueuedRequest = {
        ...request,
        id,
        username: request.username ?? activeUser,
        createdAt: new Date().toISOString(),
        retryCount: 0
    };

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const addRequest = store.add(queuedRequest);

        addRequest.onsuccess = () => {
            console.log(`[OfflineQueue] Added request ${id} to queue`);
            resolve(id);
        };
        addRequest.onerror = () => reject(addRequest.error);
    });
};

/**
 * Get all queued requests
 */
export const getAllQueued = async (): Promise<QueuedRequest[]> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

/**
 * Get count of queued requests. Pass a username to count only that profile's
 * items (the badge should reflect what THIS session can actually replay).
 */
export const getQueueCount = async (username?: string): Promise<number> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const items = request.result as QueuedRequest[];
            resolve(username ? items.filter(i => i.username === username).length : items.length);
        };
        request.onerror = () => reject(request.error);
    });
};

/**
 * Remove a request from the queue
 */
export const removeFromQueue = async (id: string): Promise<void> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log(`[OfflineQueue] Removed request ${id} from queue`);
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
};

/**
 * Update retry count for a queued request
 */
export const updateRetryCount = async (id: string): Promise<void> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const item = getRequest.result as QueuedRequest;
            if (item) {
                item.retryCount++;
                item.lastAttempt = new Date().toISOString(); // Track when we last tried
                store.put(item);
            }
            resolve();
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
};

/**
 * Clear all queued requests
 */
export const clearQueue = async (): Promise<void> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('[OfflineQueue] Queue cleared');
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
};

/**
 * Clear only one profile's queued requests — the delete-profile path needs
 * this: `clearQueue()` would destroy every other user's pending work too.
 * (Items enqueued before user-scoping carry no username and are left alone;
 * they can't be attributed to the deleted profile.)
 */
export const clearQueueForUser = async (username: string): Promise<number> => {
    const items = await getAllQueued();
    let removed = 0;
    for (const item of items) {
        if (item.username === username) {
            await removeFromQueue(item.id);
            removed++;
        }
    }
    console.log(`[OfflineQueue] Cleared ${removed} queued item(s) for ${username}`);
    return removed;
};

export interface QueueProcessingHandlers {
    onAnalysis?: (payload: any) => Promise<void>;
    onPostMortem?: (payload: any) => Promise<void>;
    onSummary?: (payload: any) => Promise<void>;
    onStrategySearch?: (payload: any) => Promise<void>;
    onItemProcessed?: (id: string, success: boolean) => void;
    onQueueEmpty?: () => void;
}

/** In-flight marker for processQueue. Two `online` transitions during one
 *  long replay used to snapshot the SAME items twice and run every callback
 *  concurrently (double-submit of a queued analysis). A reentrant call
 *  returns an all-zero result immediately instead of queueing behind — the
 *  in-flight pass already covers every currently-stored item, and anything
 *  enqueued mid-flight is picked up by the next trigger/backoff tick. */
let processingInFlight = false;

/**
 * Process all queued requests
 * Removes successfully processed items from the queue
 */
/**
 * Calculate exponential backoff delay for a given retry count
 * Formula: BASE_DELAY * 2^retryCount (capped at MAX_DELAY)
 */
const calculateBackoffDelay = (retryCount: number): number => {
    const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
    return Math.min(delay, MAX_DELAY_MS);
};

/**
 * Check if enough time has passed since the last attempt (respects backoff)
 */
const isReadyForRetry = (item: QueuedRequest): boolean => {
    if (!item.lastAttempt || item.retryCount === 0) return true;

    const lastAttemptTime = new Date(item.lastAttempt).getTime();
    const requiredDelay = calculateBackoffDelay(item.retryCount - 1);
    const elapsed = Date.now() - lastAttemptTime;

    return elapsed >= requiredDelay;
};

export const processQueue = async (handlers: QueueProcessingHandlers): Promise<{ processed: number; failed: number; skipped: number }> => {
    if (processingInFlight) {
        console.log('[OfflineQueue] processQueue already running — reentrant call skipped');
        return { processed: 0, failed: 0, skipped: 0 };
    }
    processingInFlight = true;
    try {
        const items = await getAllQueued();
        let processed = 0;
        let failed = 0;
        let skipped = 0;

        console.log(`[OfflineQueue] Processing ${items.length} queued items...`);

        for (const item of items) {
            // PROFILE GATE: another user's queued item must never execute inside
            // this session (wrong provider prefs, wrong trade log, wrong chat).
            // Items predating the username field stay attributable to nobody —
            // they run for whoever processes first (legacy, one-time window).
            if (item.username && item.username !== activeUser) {
                console.log(`[OfflineQueue] Skipping ${item.id} - belongs to another profile`);
                skipped++;
                continue;
            }
            // Check if item is ready for retry (exponential backoff)
            if (!isReadyForRetry(item)) {
                const nextRetryIn = calculateBackoffDelay(item.retryCount - 1) - (Date.now() - new Date(item.lastAttempt!).getTime());
                console.log(`[OfflineQueue] Skipping ${item.id} - retry in ${Math.ceil(nextRetryIn / 1000)}s (attempt ${item.retryCount})`);
                skipped++;
                continue;
            }

            try {
                switch (item.type) {
                    case 'analysis':
                        await handlers.onAnalysis?.(item.payload);
                        break;
                    case 'postMortem':
                        await handlers.onPostMortem?.(item.payload);
                        break;
                    case 'summary':
                        await handlers.onSummary?.(item.payload);
                        break;
                    case 'strategySearch':
                        await handlers.onStrategySearch?.(item.payload);
                        break;
                }

                await removeFromQueue(item.id);
                processed++;
                handlers.onItemProcessed?.(item.id, true);
            } catch (error) {
                console.error(`[OfflineQueue] Failed to process ${item.id}:`, error);
                await updateRetryCount(item.id);
                failed++;
                handlers.onItemProcessed?.(item.id, false);

                // Remove if too many retries (with exponential backoff, use higher limit)
                if (item.retryCount >= MAX_RETRIES) {
                    await removeFromQueue(item.id);
                    console.log(`[OfflineQueue] Removed ${item.id} after ${MAX_RETRIES} retries`);
                } else {
                    const nextDelay = calculateBackoffDelay(item.retryCount);
                    console.log(`[OfflineQueue] Will retry ${item.id} in ${nextDelay / 1000}s`);
                }
            }
        }

        if (processed > 0 || (failed === 0 && skipped === 0)) {
            handlers.onQueueEmpty?.();
        }

        console.log(`[OfflineQueue] Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`);
        return { processed, failed, skipped };
    } finally {
        processingInFlight = false;
    }
};

// Export as a namespace for convenience
export const offlineQueue = {
    add: addToQueue,
    getAll: getAllQueued,
    getCount: getQueueCount,
    remove: removeFromQueue,
    clear: clearQueue,
    clearForUser: clearQueueForUser,
    setActiveUser,
    getActiveUser,
    process: processQueue
};

export default offlineQueue;
