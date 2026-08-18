/**
 * Pre-verdict floor lean — a live tally of where the seats stand while the
 * debate runs. Derived from each analyst's LATEST turn direction (levels
 * parser), so the meter tracks the debate as positions shift.
 */

import { DebateTurn } from '../types';
import { extractDebateLevels } from './debateLevels';

export interface FloorLean {
    long: number;
    short: number;
    neutral: number;
    /** Dominant side, or 'Split' on a tie with votes on both sides. */
    lean: 'Long' | 'Short' | 'Split' | null;
    /** Seats that have declared a direction so far. */
    declared: number;
}

/** Tally the latest declared direction per analyst seat. */
export const computeFloorLean = (turns: DebateTurn[]): FloorLean => {
    const latestBySpeaker = new Map<string, DebateTurn>();
    for (const turn of turns) {
        if (turn.speaker === 'Moderator' || turn.speaker === 'System') continue;
        if (!turn.text.trim()) continue;
        latestBySpeaker.set(turn.speaker, turn);
    }
    let long = 0;
    let short = 0;
    let neutral = 0;
    for (const turn of latestBySpeaker.values()) {
        const row = extractDebateLevels(turn.speaker, turn.text);
        if (row.direction === 'Long') long += 1;
        else if (row.direction === 'Short') short += 1;
        else neutral += 1;
    }
    const declared = long + short;
    const lean: FloorLean['lean'] = declared === 0
        ? null
        : long > short
            ? 'Long'
            : short > long
                ? 'Short'
                : 'Split';
    return { long, short, neutral, lean, declared };
};
