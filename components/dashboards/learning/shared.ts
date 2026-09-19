/** Display constants shared by more than one learning card. */
import type { MemoryFile, MemoryFolder } from '../../../types';

/** The Trader Notebook snapshot the dashboard loads once and refreshes on. */
export interface Notebook {
    folders: MemoryFolder[];
    files: MemoryFile[];
}

export const REGIMES = ['trending', 'ranging', 'volatile', 'compression'] as const;

export const getWinRateColor = (rate: number): string => {
    if (rate >= 65) return 'text-emerald-400';
    if (rate >= 50) return 'text-yellow-400';
    return 'text-red-400';
};
