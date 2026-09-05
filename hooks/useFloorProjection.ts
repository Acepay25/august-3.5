import { useCallback, useMemo } from 'react';
import { Message } from '../types/message';
import { LoggedTrade } from '../types';
import type { ApprovalItem } from '../utils/approvalInbox';
import { FloorPosition, FloorSquawkEvent } from '../components/floor/FloorScene';
import { DebateStageActor } from '../components/analysis/DebateStage';
import { listHarnessLessons } from '../services/learning/harnessLessons';
import { deriveSeatWireStates } from '../utils/floorSeatWire';
import { getProviderHealth, providerCooldownRemainingMs } from '../services/infrastructure/ProviderHealthService';

export interface UseFloorProjectionArgs {
    /** Conversation history — drives the squawk tape, tickers, and gauge stats. */
    messages: Message[];
    /** Newest-first list of trades for the floor's positions rail. */
    loggedTrades: LoggedTrade[];
    /** Approval cards queued for the trader (used by the gauge). */
    approvalItems: ApprovalItem[];
    /** Whether a debate or post-mortem is in flight (gauge "running"). */
    isAnalysisInProgress: boolean;
    isPostMortemInProgress: boolean;
    /** The message the desk view is currently projecting (drives squawk + wire). */
    deskSceneMessage: Message | null;
    /** The actors of that projected message (for the per-seat wire derivation). */
    deskSceneActors: DebateStageActor[];
    /** Provider-name → id map for the wire derivation's id lookup. */
    providerNameToId: Record<string, string>;
    /**
     * Stable bot roster — openSeatChat looks up a seat name against this list
     * to find a matching named bot before falling back to the Coach inbox.
     */
    bots: ReadonlyArray<{ id: string; name: string }>;
    /** Stable callbacks the seat-click handler needs. */
    selectBotThread: (botId: string) => void;
    setActiveThread: (t: { kind: 'coach' }) => void;
    setIsEnsembleEnabled: (v: boolean) => void;
    setUiMode: (m: 'chat') => void;
}

export interface FloorProjection {
    gaugeStats: { tasks: number; running: number; shipped: number; approvals: number };
    floorPositions: FloorPosition[];
    floorSquawk: FloorSquawkEvent[];
    floorDayPnl: number;
    floorSeatWire: ReturnType<typeof deriveSeatWireStates>;
    floorTickers: { symbol: string; last?: number; changePct?: number }[];
    openSeatChat: (seatName: string) => void;
}

/**
 * Project everything the floor mode needs from the running conversation,
 * trade log, and projected desk message. The block is pure derivation
 * (every value is a useMemo from primitives already in App) plus the
 * seat-click handler, which forwards to whatever navigation/thread
 * setters App has wired up. App's body shrinks by ~140 LOC and the floor
 * view gains a single, dependency-typed surface to consume.
 */
export const useFloorProjection = (args: UseFloorProjectionArgs): FloorProjection => {
    const {
        messages, loggedTrades, approvalItems, isAnalysisInProgress, isPostMortemInProgress,
        deskSceneMessage, deskSceneActors, providerNameToId, bots,
        selectBotThread, setActiveThread, setIsEnsembleEnabled, setUiMode,
    } = args;

    const gaugeStats = useMemo(() => ({
        tasks: messages.length,
        running: isAnalysisInProgress || isPostMortemInProgress ? 1 : 0,
        shipped: messages.filter(m => m.analysis).length,
        approvals: approvalItems.length,
    }), [messages, isAnalysisInProgress, isPostMortemInProgress, approvalItems]);

    const floorPositions = useMemo<FloorPosition[]>(
        () => loggedTrades.slice(0, 20).map(t => ({
            id: t.id,
            symbol: t.analysis.coinName || '—',
            direction: t.analysis.direction,
            pnl: t.pnlAmount,
            outcome: t.outcome,
        })),
        [loggedTrades],
    );

    // Newest-first tape derived from the conversation — printed analyses
    // and filed post-mortems, top-up with the harness-lesson lines, the
    // projected run log, and per-turn status. Capped so the memo stays
    // cheap on long threads.
    const floorSquawk = useMemo<FloorSquawkEvent[]>(() => {
        const events: FloorSquawkEvent[] = [];
        for (let i = messages.length - 1; i >= 0 && events.length < 30; i -= 1) {
            const m = messages[i];
            const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            if (m.analysis) {
                events.push({
                    id: `print-${m.id}`,
                    time,
                    text: `PRINT ${m.analysis.coinName} · ${m.analysis.direction} · ${m.analysis.confidence} confidence`,
                });
            } else if (m.postMortem) {
                events.push({ id: `review-${m.id}`, time, text: 'REVIEW post-mortem filed' });
            }
        }
        // Harness-lesson system lines: what the harness learned about the
        // wires prints on the tape — the floor is where you SEE it managing
        // itself. Newest few, merged into time order.
        for (const l of listHarnessLessons().slice(0, 5)) {
            const at = Date.parse(l.at);
            if (!Number.isFinite(at)) continue;
            events.push({
                id: `lesson-${l.id}`,
                time: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                text: `LESSON ${l.kind} · ${l.scope}${l.provider ? ` · ${l.provider}` : ''}: ${l.lesson}`,
            });
        }
        // Per-run-log lines (rounds, drops, tool calls) and per-turn status
        // — projected onto the tape so the floor reads like a trading desk.
        const debateLogSource = deskSceneMessage?.debateRunLog ?? [];
        for (const ev of debateLogSource.slice(-8)) {
            const at = Date.parse(ev.at);
            const time = Number.isFinite(at)
                ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
            const who = ev.speaker ? `${ev.speaker} · ` : '';
            events.push({ id: `runlog-${ev.at}-${ev.kind}-${ev.detail.slice(0, 12)}`, time, text: `${who}${ev.detail}` });
        }
        for (const t of (deskSceneMessage?.debateTurns ?? []).slice(-6)) {
            const at = t.createdAt ? Date.parse(t.createdAt) : NaN;
            const time = Number.isFinite(at)
                ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
            const text = t.text.trim();
            const verb = !text || text === '(pass)'
                ? 'passed'
                : t.to?.length
                    ? `replied to ${t.to.join(', ')}`
                    : 'submitted an argument';
            events.push({ id: `turn-${t.speaker}-${t.createdAt ?? t.text.slice(0, 12)}`, time, text: `${t.speaker} ${verb}` });
        }
        events.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
        return events;
    }, [messages, deskSceneMessage]);

    const floorDayPnl = useMemo(() => {
        const today = new Date().toDateString();
        return loggedTrades
            .filter(t => new Date(t.timestamp).toDateString() === today)
            .reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0);
    }, [loggedTrades]);

    const floorSeatWire = useMemo(
        () => deriveSeatWireStates({
            runLog: deskSceneMessage?.debateRunLog,
            providerNameToId,
            healthFor: getProviderHealth,
            cooldownFor: providerCooldownRemainingMs,
            seatNames: deskSceneActors.map(a => a.name),
        }),
        [deskSceneMessage, deskSceneActors, providerNameToId],
    );

    // Recent analyses topped up with the majors. Prices arrive via the floor
    // market hook (floor phase), not here.
    const floorTickers = useMemo<{ symbol: string; last?: number; changePct?: number }[]>(() => {
        const syms: string[] = [];
        const push = (s?: string | null): void => {
            if (s && !syms.includes(s)) syms.push(s);
        };
        for (let i = messages.length - 1; i >= 0 && syms.length < 6; i -= 1) {
            push(messages[i].analysis?.coinName);
        }
        for (const major of ['BTC', 'ETH', 'SOL']) push(major);
        return syms.slice(0, 8).map(symbol => ({ symbol }));
    }, [messages]);

    // Floor seat click → open that agent's 1:1 thread in chat mode. Seat
    // names match a named bot first; without one, land on the Coach inbox
    // (ensemble stays armed for the next group analysis).
    const openSeatChat = useCallback((seatName: string) => {
        const name = seatName.trim().toLowerCase();
        const botMatch = bots.find(b => b.name.toLowerCase() === name);
        if (botMatch) {
            selectBotThread(botMatch.id);
        } else {
            setActiveThread({ kind: 'coach' });
            setIsEnsembleEnabled(true);
        }
        setUiMode('chat');
    }, [bots, selectBotThread, setIsEnsembleEnabled, setUiMode]);

    return {
        gaugeStats,
        floorPositions,
        floorSquawk,
        floorDayPnl,
        floorSeatWire,
        floorTickers,
        openSeatChat,
    };
};
