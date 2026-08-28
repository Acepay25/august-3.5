/**
 * Shared builder for the debate-floor actor list.
 *
 * Both the in-transcript DebateStage (MessageItem) and the opt-in DeskScene
 * overlay project the SAME debate state, so they must derive their actors the
 * exact same way. This module owns that derivation; MessageItem and App both
 * call it rather than each keeping a copy that could drift.
 *
 * The shared module also exposes the small `exchanges` and `convictions`
 * derivations the in-transcript DebateStage and the DeskScene both need,
 * so the room and the transcript never disagree about who replied to whom
 * or what each seat's sealed conviction was.
 */

import type { Message, DebateTurn } from '../types';
import type { DebateStageActor, DebateExchange } from '../components/analysis/DebateStage';

const CONVICTION_LINE_RE = /^\s*CONVICTION:\s*(\d{1,3})\b[^\n]*$/im;

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

/**
 * Each seat's LAST sealed CONVICTION line across the transcript — the
 * auction the Moderator alone sees at verdict time, made visible.
 * Mirrors the helper DebateSummary uses, lifted here so DeskScene can
 * show the same auction in the floor's verdict card.
 */
export const convictionsFromTurns = (
    debateTurns: DebateTurn[],
): Array<{ name: string; value: number }> => {
    const bySeat = new Map<string, number>();
    for (const t of debateTurns) {
        if (t.speaker === 'Moderator' || t.speaker === 'System') continue;
        const m = (t.text || '').match(CONVICTION_LINE_RE);
        if (!m) continue;
        bySeat.set(t.speaker, Math.min(100, Math.max(0, parseInt(m[1], 10))));
    }
    return [...bySeat.entries()].map(([name, value]) => ({ name, value }));
};

/**
 * Build the directed addressing map (who replied to whom, and how many
 * times) for a debate. Mirrors the helper MessageItem uses; the DeskScene
 * reads it from the same source so the room and the transcript never
 * disagree about the shape of the conversation.
 */
export const exchangesForTurns = (debateTurns: DebateTurn[]): DebateExchange[] => {
    const counts = new Map<string, number>();
    for (const t of debateTurns) {
        const from = t.speaker;
        if (!from) continue;
        const targets = (t as { to?: string[] }).to ?? [];
        if (!targets || targets.length === 0) continue;
        for (const to of targets) {
            if (!to || to === from) continue;
            const key = `${from}→${to}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return [...counts.entries()].map(([key, count]) => {
        const [from, to] = key.split('→');
        return { from, to, count };
    });
};

/** Live "round N · stage" caption the floor renders above the canvas. */
export const livePhaseForMessage = (message: Message): string | undefined => {
    if (!message.isDebating) return undefined;
    const debateTurns: DebateTurn[] = message.debateTurns ?? message.postMortemDebateTurns ?? [];
    const maxRound = debateTurns.reduce((m, t) => Math.max(m, t.round ?? 0), 0);
    const running = (message.runContract ?? []).find(s => s.state === 'running');
    const bits: string[] = [];
    if (maxRound > 0) bits.push(`Round ${maxRound}`);
    if (running) bits.push(running.label);
    return bits.length > 0 ? bits.join(' · ') : undefined;
};
