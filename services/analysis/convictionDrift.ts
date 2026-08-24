import type { DebateTurn } from '../../types/message';

/**
 * ConvictionDrift (ROUND-36 / D2.2): measure whether debate rounds actually
 * MOVE a seat's sealed conviction. Seats emit one sealed `CONVICTION: <0-100>`
 * line per rebuttal round; the trajectory across rounds is the seat's drift.
 *
 * Consumers:
 *  - buildSeatTrustBlock → adds "moved −18 across rounds" to the trust record
 *    so the Moderator knows which seats are persuadable vs rigid.
 *  - LearningDashboard → per-seat drift sparkline data.
 *
 * Pure functions over stored transcripts — no schema change needed.
 */

export interface ConvictionPoint {
    round: number;
    value: number;
}

export interface SeatConvictionTrajectory {
    seat: string;
    points: ConvictionPoint[];
    /** Last minus first; positive = hardened, negative = moved toward doubt. */
    delta: number;
}

const CONVICTION_RE = /CONVICTION:\s*(\d{1,3})/gi;

/** Extract every sealed conviction from one turn (last mention wins — prose
 *  quoting another seat's number must not create phantom points). */
export const extractConvictions = (turn: DebateTurn): number[] => {
    let v: number | null = null;
    for (const m of turn.text.matchAll(CONVICTION_RE)) {
        const n = Math.min(100, Math.max(0, parseInt(m[1], 10)));
        if (Number.isFinite(n)) v = n;
    }
    return v === null ? [] : [v];
};

/** Per-seat ordered trajectory across a single debate's transcript. */
export const seatConvictionTrajectory = (
    turns: DebateTurn[],
    seat: string,
): SeatConvictionTrajectory | null => {
    const points: ConvictionPoint[] = [];
    for (const t of turns) {
        if (t.speaker === 'Moderator' || t.speaker === 'System') continue;
        if (t.speaker !== seat) continue;
        for (const value of extractConvictions(t)) {
            points.push({ round: t.round ?? points.length + 1, value });
        }
    }
    if (points.length < 2) return null; // drift needs at least two data points
    return {
        seat,
        points,
        delta: points[points.length - 1].value - points[0].value,
    };
};

/**
 * Cross-debate persuasion profile: how often does this seat move at all, and
 * in which direction? `movable` seats update their stance when challenged;
 * `rigid` seats never do. The moderator should weight a movable seat's FINAL
 * conviction more than its first.
 */
export interface PersuasionProfile {
    debates: number;
    movedDebates: number;
    avgDelta: number;
    /** 'movable' when it changes stance in ≥40% of debates with ≥5 mean |delta|. */
    disposition: 'movable' | 'rigid' | 'sparse';
}

export const persuasionProfile = (
    trades: Array<{ debateTurns?: DebateTurn[] }>,
    seat: string,
): PersuasionProfile => {
    let debates = 0;
    let moved = 0;
    let deltaSum = 0;
    for (const trade of trades) {
        const traj = seatConvictionTrajectory(trade.debateTurns ?? [], seat);
        if (!traj) continue;
        debates += 1;
        if (traj.delta !== 0) moved += 1;
        deltaSum += traj.delta;
    }
    if (debates === 0) return { debates: 0, movedDebates: 0, avgDelta: 0, disposition: 'sparse' };
    const avgDelta = deltaSum / debates;
    const moveRate = moved / debates;
    return {
        debates,
        movedDebates: moved,
        avgDelta,
        disposition: moveRate >= 0.4 && Math.abs(avgDelta) >= 5 ? 'movable' : 'rigid',
    };
};
