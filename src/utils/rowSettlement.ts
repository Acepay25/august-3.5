/**
 * rowSettlement — the ONE rule for what a streaming row becomes when its run
 * ends.
 *
 * A conversation has two homes with different field names (`Message.isStreaming`
 * vs the dock entry's `streaming`), and every owner used to restate the same
 * branch: a stopped row is interrupted, a failed row without prose is a
 * failure, a failed row WITH prose is interrupted so the partial answer keeps
 * its place, and a completed row simply stops streaming. Three owners drifted
 * once already (the 2026-10-27 audit L-4); this module is the rule they all call, with
 * one adapter per shape and nothing else.
 */

export type RowSettleReason = 'completed' | 'stopped' | 'superseded' | 'interrupted' | 'failed';

export interface SettleOptions {
    /** The failure reason, when there is one. */
    error?: string;
    /** Whether the row already carries prose. A failed row with prose is an
     *  interrupted answer (the reason rides inside the stopped card); without
     *  prose it is the failure row. */
    hasText?: boolean;
}

export interface SettledFields {
    interrupted?: true;
    error?: string;
}

export const settleFields = (reason: RowSettleReason, opts: SettleOptions = {}): SettledFields => {
    if (reason === 'completed') return {};
    if (reason === 'failed') {
        if (!opts.error) return { interrupted: true };
        return opts.hasText ? { error: opts.error, interrupted: true } : { error: opts.error };
    }
    return { interrupted: true };
};

/** Adapter for the Agents surface's `Message` shape. */
export const settleMessageRow = <T extends object>(
    row: T,
    reason: RowSettleReason,
    opts?: SettleOptions,
): T & { isStreaming: false } & SettledFields => ({ ...row, isStreaming: false, ...settleFields(reason, opts) });

/** Adapter for the dock's `LiveEntry` shape. */
export const settleDockEntry = <T extends object>(
    row: T,
    reason: RowSettleReason,
    opts?: SettleOptions,
): T & { streaming: false } & SettledFields => ({ ...row, streaming: false, ...settleFields(reason, opts) });
