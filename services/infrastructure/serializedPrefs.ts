/**
 * serializedPrefs — per-key promise queue for Preferences read-modify-writes.
 *
 * Several learning-loop services append to shared Preferences arrays/objects
 * (injection records per stage/seat, meta-calibration counters per skill
 * event) from concurrent fire-and-forget callers. An unserialized
 * read→mutate→write lets the second reader observe the state BEFORE the
 * first writer landed, so its write silently drops the first writer's
 * records — lost injection records misroute followed trades into CONTROL and
 * starve skills of credit. Routing every RMW for a key through this queue
 * makes the read and its write atomic with respect to other callers in the
 * same tab.
 *
 * Same shape as MemoryFilesService's notebook write lock (the chain never
 * breaks on a task rejection; later tasks still run), plus idle cleanup so
 * per-user keys don't accumulate dead entries in the map.
 */

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `task` with exclusive, in-order access to Preferences `key`. Tasks
 * queued for the same key run one at a time, FIFO; different keys never
 * block each other. `task`'s rejection propagates to its caller but does
 * NOT poison the queue.
 */
export const withSerializedPref = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const settled = run.then(
        () => undefined,
        () => undefined
    );
    chains.set(key, settled);
    // Drop the map entry once this task is the tail of the chain, so the
    // (per-user keyed) map doesn't grow without bound.
    void settled.then(() => {
        if (chains.get(key) === settled) chains.delete(key);
    });
    return run;
};

/** Test helper / diagnostics: whether a queue currently exists for a key. */
export const hasSerializedPrefQueue = (key: string): boolean => chains.has(key);
