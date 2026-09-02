// Floor seat-wire observability (Batch 13, plan §10.2).
//
// The floor should be the ONE surface where you can SEE the harness managing
// itself: per seat, what the wire actually received (thinking on/off, effort
// tier), whether the provider is benched on cooldown, and how fit it looks.
// All of it is DERIVED — from the P5 wire-audit lines already in the run log
// (`wire: <provider> <phase> applied|no-op — <reason>`), the §9.2 health
// telemetry, and the P7 wire-lesson pins. No new state, no new store.
//
// Monochrome doctrine: states encode as glyphs + text, never color.

import type { DebateRunEvent } from '../types/message';
import type { ReasoningEffort } from '../services/providers/reasoningControls';
import type { ProviderHealth } from '../services/infrastructure/ProviderHealthService';

export interface SeatWireState {
    /** Provider display name the seat resolved to (null = no wire evidence). */
    providerName: string | null;
    providerId?: string;
    /** Thinking knob verdict for the seat's most recent audited call. */
    thinking: 'on' | 'off' | 'unknown';
    /** Effort tier the wire actually received, parsed from the audit reason. */
    effort: ReasoningEffort | null;
    /** True when a P7 harness wire lesson pinned this seat's route off. */
    pinnedOff: boolean;
    /** Cooldown remaining from §9.2 health telemetry (0 = not benched). */
    cooldownRemainingMs: number;
    /** Fitness read: benched > degraded (recent errors) > ok. */
    fitness: 'ok' | 'degraded' | 'benched';
    lastLatencyMs?: number;
    /** The raw audit reason line — hover text. */
    detail?: string;
}

/** Minimal shape of the health lookup so callers can pass the service or a stub. */
export interface SeatWireInputs {
    runLog: DebateRunEvent[] | undefined;
    providerNameToId: Record<string, string>;
    healthFor: (providerId: string) => ProviderHealth | undefined;
    cooldownFor: (providerId: string) => number;
    /** Seat names currently on the floor (stage actors). */
    seatNames: string[];
}

/** Parse the effort tier out of an audit reason string. */
const parseEffort = (reason: string): ReasoningEffort | null => {
    const m = reason.match(/effort[= ](low|medium|high|max|xhigh|auto)/i);
    if (!m) return null;
    const v = m[1].toLowerCase();
    return v === 'xhigh' ? 'max' : (v as ReasoningEffort);
};

/**
 * Classify one wire-audit line into a thinking verdict. The audit reasons
 * are fixed strings from buildReasoningPatch — match on their shape:
 *   applied + "disabled"            → off (deliberate fast answer)
 *   applied                         → on
 *   pinned off by a harness lesson  → off + pinnedOff
 *   "no verified reasoning route"   → off (fail-closed: knob never sent)
 *   "effort=auto sends no knob"     → unknown (provider default untouched)
 *   anything else no-op             → unknown
 */
const classifyAudit = (
    applied: boolean,
    reason: string,
): { thinking: SeatWireState['thinking']; pinnedOff: boolean } => {
    if (applied) return { thinking: reason.includes('disabled') ? 'off' : 'on', pinnedOff: false };
    if (reason.includes('pinned off')) return { thinking: 'off', pinnedOff: true };
    if (reason.includes('no verified reasoning route')) return { thinking: 'off', pinnedOff: false };
    return { thinking: 'unknown', pinnedOff: false };
};

/**
 * Derive per-seat wire state from the projected run's audit lines. The LAST
 * `wire:` budget line per provider wins (rounds progress; the newest call is
 * the current truth). Seats with no wire evidence still get a fitness read
 * from §9.2 health when their name resolves to a provider.
 */
export const deriveSeatWireStates = (inputs: SeatWireInputs): Record<string, SeatWireState> => {
    const { runLog, providerNameToId, healthFor, cooldownFor, seatNames } = inputs;
    // Newest audit line per provider name from the run log.
    const lastAudit = new Map<string, { applied: boolean; reason: string }>();
    for (const ev of runLog ?? []) {
        if (ev.kind !== 'budget' || !ev.detail.startsWith('wire: ')) continue;
        // `wire: <provider> <phase> applied|no-op — <reason>` (provider may
        // contain spaces; phase is one token; non-greedy provider stops at
        // the first ` <phase> applied|no-op — ` split, which is the real one).
        const m = ev.detail.match(/^wire: (.+?) (\S+) (applied|no-op) — ([\s\S]*)$/);
        if (!m) continue;
        lastAudit.set(m[1].trim(), { applied: m[3] === 'applied', reason: m[4] });
    }
    const out: Record<string, SeatWireState> = {};
    for (const name of seatNames) {
        const providerId = providerNameToId[name];
        const health = providerId ? healthFor(providerId) : undefined;
        const cooldownMs = providerId ? Math.max(0, cooldownFor(providerId)) : 0;
        const audit = lastAudit.get(name);
        const base: SeatWireState = {
            providerName: providerId ? name : null,
            providerId,
            thinking: 'unknown',
            effort: null,
            pinnedOff: false,
            cooldownRemainingMs: cooldownMs,
            fitness: cooldownMs > 0 ? 'benched'
                : (health?.recentErrorAts?.length ?? 0) >= 2 ? 'degraded'
                : 'ok',
            lastLatencyMs: health?.lastLatencyMs,
        };
        if (audit) {
            const { thinking, pinnedOff } = classifyAudit(audit.applied, audit.reason);
            base.thinking = thinking;
            base.pinnedOff = pinnedOff;
            base.effort = parseEffort(audit.reason);
            base.detail = audit.reason;
        }
        out[name] = base;
    }
    return out;
};

/** Glyph row for the desk badge — monochrome, iconography not color. */
export const seatWireGlyphs = (s: SeatWireState): string => {
    const parts: string[] = [];
    parts.push(s.thinking === 'on' ? '◉think' : s.thinking === 'off' ? '○no-think' : '◌wire?');
    if (s.effort && s.effort !== 'auto') parts.push(s.effort[0].toUpperCase());
    if (s.pinnedOff) parts.push('⊘pinned');
    if (s.cooldownRemainingMs > 0) parts.push(`⏸${Math.ceil(s.cooldownRemainingMs / 60000)}m`);
    else if (s.fitness === 'degraded') parts.push('⚠errors');
    return parts.join(' ');
};
