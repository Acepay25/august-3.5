import { useRef, useCallback } from 'react';

/**
 * Dirty-tracking hook for selective persistence.
 *
 * Instead of saving the entire profile on every state change,
 * track which slices have been modified and only persist those.
 *
 * Usage:
 *   const { markDirty, isDirty, consumeDirty, isAnyDirty } = useDirtyTracker();
 *
 *   // When a slice changes:
 *   markDirty('conversations');
 *
 *   // In the save effect:
 *   if (isDirty('conversations')) {
 *     await saveConversations(conversationHistory);
 *     consumeDirty('conversations');
 *   }
 */

export type DirtySlice =
  | 'conversations'
  | 'tradeLog'
  | 'savedAnalyses'
  | 'tradeSummaries'
  | 'settings'
  | 'globalMemory'
  | 'insightKnowledgeBase'
  | 'finalTradeSummary';

const ALL_SLICES: DirtySlice[] = [
  'conversations',
  'tradeLog',
  'savedAnalyses',
  'tradeSummaries',
  'settings',
  'globalMemory',
  'insightKnowledgeBase',
  'finalTradeSummary',
];

export function useDirtyTracker() {
  const dirtyRef = useRef<Set<DirtySlice>>(new Set());

  /** Mark a slice as needing persistence */
  const markDirty = useCallback((slice: DirtySlice) => {
    dirtyRef.current.add(slice);
  }, []);

  /** Mark multiple slices as dirty */
  const markDirtyMany = useCallback((slices: DirtySlice[]) => {
    for (const s of slices) {
      dirtyRef.current.add(s);
    }
  }, []);

  /** Check if a specific slice is dirty */
  const isDirty = useCallback((slice: DirtySlice): boolean => {
    return dirtyRef.current.has(slice);
  }, []);

  /** Check if any slice is dirty */
  const isAnyDirty = useCallback((): boolean => {
    return dirtyRef.current.size > 0;
  }, []);

  /** Get all dirty slices */
  const getDirtySlices = useCallback((): DirtySlice[] => {
    return Array.from(dirtyRef.current);
  }, []);

  /** Mark a slice as saved (remove from dirty set) */
  const consumeDirty = useCallback((slice: DirtySlice) => {
    dirtyRef.current.delete(slice);
  }, []);

  /** Clear all dirty flags (e.g., after a full save) */
  const clearAll = useCallback(() => {
    dirtyRef.current.clear();
  }, []);

  /** Mark all slices as dirty (e.g., on initial load or user switch) */
  const markAllDirty = useCallback(() => {
    for (const s of ALL_SLICES) {
      dirtyRef.current.add(s);
    }
  }, []);

  return {
    markDirty,
    markDirtyMany,
    isDirty,
    isAnyDirty,
    getDirtySlices,
    consumeDirty,
    clearAll,
    markAllDirty,
  };
}
