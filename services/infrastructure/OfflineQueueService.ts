/**
 * OfflineQueueService - Queues failed requests when offline and syncs when back online
 * Uses IndexedDB for persistence across sessions
 */

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
    createdAt: string;
    retryCount: number;
    lastAttempt?: string; // ISO timestamp of last retry attempt
}

let db: IDBDatabase | null = null;

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
 * Add a request to the offline queue
 */
export const addToQueue = async (request: Omit<QueuedRequest, 'id' | 'createdAt' | 'retryCount'>): Promise<string> => {
    const database = await initDB();
    const id = `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const queuedRequest: QueuedRequest = {
        id,
        ...request,
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
 * Get count of queued requests
 */
export const getQueueCount = async (): Promise<number> => {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
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

export interface QueueProcessingHandlers {
    onAnalysis?: (payload: any) => Promise<void>;
    onPostMortem?: (payload: any) => Promise<void>;
    onSummary?: (payload: any) => Promise<void>;
    onStrategySearch?: (payload: any) => Promise<void>;
    onItemProcessed?: (id: string, success: boolean) => void;
    onQueueEmpty?: () => void;
}

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
    const items = await getAllQueued();
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    console.log(`[OfflineQueue] Processing ${items.length} queued items...`);

    for (const item of items) {
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
};

// Export as a namespace for convenience
export const offlineQueue = {
    add: addToQueue,
    getAll: getAllQueued,
    getCount: getQueueCount,
    remove: removeFromQueue,
    clear: clearQueue,
    process: processQueue
};

export default offlineQueue;
