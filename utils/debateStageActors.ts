/**
 * Shared builder for the debate-floor actor list.
 *
 * Both the in-transcript DebateStage (MessageItem) and the opt-in DeskScene
 * overlay project the SAME debate state, so they must derive their actors the
 * exact same way. This module owns that derivation; MessageItem and App both
 * call it rather than each keeping a copy that could drift.
 */

import type { Message, DebateTurn } from '../types';
import type { DebateStageActor } from '../components/analysis/DebateStage';

/** True when a message represents an ensemble (multi-model) run. */
export const isEnsembleMessage = (message: Message): boolean =>
    Boolean(
        message.ensembleProgress ||
        message.isDebating ||
        Object.keys(message.modelsUsed ?? {}).length > 1,
    );

/**
 * Build the per-seat actor list for one message's debate. Mirrors the logic
 * that previously lived inline in MessageItem: one actor per distinct speaker
 * (from turns, then active speakers), with live/speaking/thinking flags, the
 * newest speech lines, the reply-to chip, and the quiet cost/latency meta.
 */
export const stageActorsForMessage = (message: Message): DebateStageActor[] => {
    if (!isEnsembleMessage(message)) return [];
    const debateTurns: DebateTurn[] = message.debateTurns ?? message.postMortemDebateTurns ?? [];
    const active = message.activeDebateSpeakers ?? {};
    const names: string[] = [];
    for (const t of debateTurns) if (!names.includes(t.speaker)) names.push(t.speaker);
    for (const k of Object.keys(active)) if (!names.includes(k)) names.push(k);
    if (names.length === 0 && message.isDebating) names.push('Moderator');
    return names.map(name => {
        const last = debateTurns.slice().reverse().find(t => t.speaker === name);
        const isActive = Boolean(message.isDebating) && (active[name] ?? 0) > 0;
        const addressedTo = (last as { to?: string[] } | undefined)?.to;
        const speechText = (last?.text ?? '').replace(/\s+/g, ' ').trim();
        return {
            id: name,
            name,
            toneKey: name,
            live: Boolean(message.isDebating),
            thinking: isActive && !speechText,
            speaking: isActive && Boolean(speechText),
            speech: speechText ? speechText.slice(-110) : '',
            toolChip: addressedTo?.length
                ? `replying to ${addressedTo.join(', ')}`
                : (message.liveToolEvents ?? {})[name]?.split('\n')[0],
            thought: (last?.reasoning ?? '').replace(/\s+/g, ' ').slice(0, 72),
            meta: (() => {
                const seat = (message.runStats?.analysts ?? []).find(a =>
                    a.displayName === name || name.includes(a.displayName));
                if (!seat) return undefined;
                const secs = seat.durationMs ? `${Math.round(seat.durationMs / 1000)}s` : null;
                const out = seat.charsOut ? `${(seat.charsOut / 1000).toFixed(1)}k out` : null;
                const usd = (() => {
                    const rs = message.runStats;
                    if (!rs?.costUsd || !rs.analysts?.length) return null;
                    const tokOf = (a: { promptTokens?: number; completionTokens?: number }): number =>
                        (a.promptTokens ?? 0) + (a.completionTokens ?? 0);
                    const totalTokens = rs.analysts.reduce((s, a) => s + tokOf(a), 0);
                    const seatTokens = tokOf(seat);
                    if (totalTokens > 0 && seatTokens > 0) return `~$${(rs.costUsd * seatTokens / totalTokens).toFixed(3)}`;
                    const totalChars = rs.analysts.reduce((s, a) => s + (a.charsOut ?? 0), 0);
                    if (totalChars > 0 && seat.charsOut) return `~$${(rs.costUsd * seat.charsOut / totalChars).toFixed(3)}`;
                    return null;
                })();
                return [seat.displayName, seat.modelId, secs, out, usd].filter(Boolean).join(' · ');
            })(),
        };
    });
};
