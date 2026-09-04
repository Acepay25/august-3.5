/**
 * FloorScene — the "debate UI mode": a full-screen pixel-art trading
 * floor where the trader WATCHES the agents work. The chat pane takes
 * a back seat; the floor is the primary surface.
 *
 * Layout (top → bottom, mirroring the Wall-Street / memecoin-desk
 * references):
 *   ┌─ TOP BAR — brand · LIVE tag · day PnL · counters · clock ──┐
 *   ├─ TICKER STRIP — watched symbols, last + change % ──────────┤
 *   ├─ FLOOR CANVAS — Big Board · desks + bubbles · pipeline ────┤
 *   ├─ RIGHT RAIL — chief card · order flow · tickets ·
 *   │               positions · squawk feed                       │
 *   └─ footer rule ───────────────────────────────────────────────┘
 *
 * Everything on the floor is a projection of state the app already
 * computes: desk-scene actors/phases/convictions for the debate,
 * approvalItems for the risk gate, gaugeStats for the order-flow
 * counters, loggedTrades for positions, message events for the
 * squawk tape. Monochrome zinc per the workspace theme; status
 * colors only where meaning would be lost. All floor color tokens
 * live in floorTheme.ts so a reskin is one file.
 */

import React from 'react';
import { PixelSeat } from '../desk/PixelSeat';
import { SpeechBubble } from '../desk/SpeechBubble';
import { VerdictCard } from '../desk/VerdictCard';
import { layoutFloor, type FloorSeat } from '../desk/floorLayout';
import { avatarRoleForName, roleForName } from '../desk/pixelAvatars';
import {
    applyRoomLayout,
    getRoomLayout,
    subscribeRoomLayout,
} from '../../services/desk/roomLayout';
import type { AgentBot } from '../../services/agents/agentRoster';
import type { DebateStageActor, DebateExchange } from '../analysis/DebateStage';
import type { RunContractStage } from '../../utils/runContract';
import type { ApprovalItem } from '../../utils/approvalInbox';
import type { ProviderConfig } from '../../types/provider';
import { FLOOR_THEME } from './floorTheme';
import { useFloorMarketData } from '../../hooks/useFloorMarketData';
import { seatWireGlyphs, type SeatWireState } from '../../utils/floorSeatWire';

export interface FloorPosition {
    id: string;
    symbol: string;
    /** 'Long' | 'Short' | … */
    direction: string;
    /** Signed PnL in account currency; undefined while pending. */
    pnl?: number;
    outcome?: string;
}

export interface FloorSquawkEvent {
    id: string;
    /** HH:MM wall-clock stamp. */
    time: string;
    text: string;
}

export interface FloorSceneProps {
    open: boolean;
    onClose: () => void;
    /** True while an ensemble debate or post-mortem is streaming. */
    isDebating: boolean;
    /** Live phase string from livePhaseForMessage (e.g. "Round 2 of 3"). */
    phase?: string;
    actors: DebateStageActor[];
    exchanges: DebateExchange[];
    stages?: RunContractStage[];
    convictions: { name: string; value: number }[];
    verdictDetail?: { direction: string; confidence: string; grade?: string | null };
    /** Raw order-flow counters (mirrors CompanyRoom's gaugeStats). */
    gaugeStats: { tasks: number; running: number; shipped: number; approvals: number };
    /** Human approval queue — rendered as the RISK GATE lane. */
    approvalItems: ApprovalItem[];
    /** Settled + pending trades for the positions table. */
    positions: FloorPosition[];
    /** Live event feed (newest first). */
    squawk: FloorSquawkEvent[];
    /** Ticker strip symbols; prices arrive via useFloorMarketData. */
    tickers: { symbol: string; last?: number; changePct?: number }[];
    /** Ready providers — the staff roster for the chief card. */
    staff: { id: string; name: string }[];
    /** Named bots — seated on the floor live, even while the floor is
     *  idle. A new bot appears here the moment it is created. */
    bots?: AgentBot[];
    /** Bot currently streaming a reply (its seat shows "working…"). */
    workingBotId?: string | null;
    /** Signed PnL from today's settled tickets (top bar). */
    dayPnl?: number;
    /** SessionGuard state for the Big Board rotation (plan §10.2): day P&L
     *  vs the daily limit + trades remaining — the ambient risk surface. */
    guardState?: {
        dailyLossLimitUsd: number;
        tradesToday: number;
        maxTradesPerDay: number;
        level: 'clear' | 'notice' | 'warning' | 'standdown';
    };
    /** Per-seat wire observability (plan §10.2): thinking/effort/cooldown/
     *  fitness derived from the P5 audit lines + §9.2 health. Keyed by seat
     *  name; absent = no evidence yet (badge hidden). */
    seatWire?: Record<string, SeatWireState>;
    /** Clicking a seat opens that agent's 1:1 chat thread. */
    onOpenSeatChat?: (seatName: string) => void;
}

/**
 * Guard rotation line on the Big Board (plan §10.2): risk state is the
 * thing most worth ambient awareness. Two faces on a 6s period driven by
 * the floor's existing 1s clock: day P&L vs the daily limit, then trades
 * remaining. Monochrome; the HALT level encodes as a text flag.
 */
const GuardRotation: React.FC<{
    guard: NonNullable<FloorSceneProps['guardState']>;
    dayPnl?: number;
    clockMs: number;
}> = ({ guard, dayPnl, clockMs }) => {
    const face = Math.floor(clockMs / 3000) % 2;
    const remaining = Math.max(0, guard.maxTradesPerDay - guard.tradesToday);
    const pnlText = dayPnl === undefined ? '—' : `Day ${dayPnl >= 0 ? '+' : '−'}$${Math.abs(Math.round(dayPnl)).toLocaleString()}`;
    return (
        <div data-testid="floor-guard-rotation" className="mt-2 border-t border-white/5 pt-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                Guard {guard.level === 'standdown' ? '· STANDDOWN' : guard.level === 'warning' ? '· near limit' : ''}
            </p>
            <p className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
                {face === 0
                    ? <>{pnlText} · limit −${Math.round(guard.dailyLossLimitUsd).toLocaleString()}</>
                    : <>{remaining} of {guard.maxTradesPerDay} tickets left today</>}
            </p>
        </div>
    );
};

/**
 * Sealed-auction dot plot (plan §10.2): one dot per seat on a 0-100 axis,
 * labeled by seat initial — makes the conviction spread (dissent) legible
 * at a glance on the floor. Purely presentational over the same conviction
 * rows the VerdictCard receives.
 */
const AuctionDotPlot: React.FC<{ seats: { name: string; value: number }[] }> = ({ seats }) => {
    if (seats.length < 2) return null;
    const spread = Math.max(...seats.map(s => s.value)) - Math.min(...seats.map(s => s.value));
    return (
        <div data-testid="floor-auction-plot" className="mt-2 border-t border-white/5 pt-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                Sealed auction · spread {spread}
            </p>
            <div className="relative mt-2 h-5">
                <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                {seats.map(s => (
                    <span
                        key={s.name}
                        title={`${s.name}: ${s.value}/100`}
                        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300 bg-zinc-800"
                        style={{ left: `${Math.min(100, Math.max(0, s.value))}%` }}
                    />
                ))}
            </div>
            <div className="flex justify-between font-mono text-[8px] text-zinc-600">
                <span>0</span><span>50</span><span>100</span>
            </div>
        </div>
    );
};

export const FloorScene: React.FC<FloorSceneProps> = ({
    open,
    onClose,
    isDebating,
    phase,
    actors,
    exchanges,
    convictions,
    verdictDetail,
    gaugeStats,
    approvalItems,
    positions,
    squawk,
    tickers,
    staff,
    bots = [],
    workingBotId,
    dayPnl,
    guardState,
    seatWire,
    onOpenSeatChat,
}) => {
    // Esc exits the floor (mirrors DeskScene's overlay contract).
    React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    // Wall-clock for the top bar. 1s tick only while open.
    const [clock, setClock] = React.useState(() => new Date());
    React.useEffect(() => {
        if (!open) return undefined;
        const id = window.setInterval(() => setClock(new Date()), 1000);
        return () => window.clearInterval(id);
    }, [open]);

    // Live prices for the ticker + Big Board. Polls only while the
    // floor is open; rows degrade to dashes when the API is unreachable.
    const symbols = React.useMemo(() => tickers.map(t => t.symbol), [tickers]);
    const quotes = useFloorMarketData(symbols, open);

    // Desks: stage actors on the shared floor layout. The roomLayout
    // store is the same one the office (CompanyRoom) and desk view use,
    // so a drag anywhere moves the desk everywhere. layoutTick makes
    // the memo re-run when the store changes.
    const [layoutTick, setLayoutTick] = React.useState(0);
    React.useEffect(() => subscribeRoomLayout(() => setLayoutTick(t => t + 1)), []);
    const actorNames = React.useMemo(() => actors.map(a => a.name), [actors]);
    // The floor's full cast: stage actors plus the named-bot roster.
    // Bots are seated LIVE even while the floor is idle — creating a
    // bot puts it on the floor immediately. A bot whose name matches a
    // stage actor is absorbed into that seat (the actor's state wins).
    const botNames = React.useMemo(
        () => bots.filter(b => !actorNames.includes(b.name)).map(b => b.name),
        [bots, actorNames],
    );
    const seats = React.useMemo<FloorSeat[]>(
        () => (actorNames.length + botNames.length === 0
            ? []
            : applyRoomLayout(layoutFloor([...actorNames, ...botNames]), getRoomLayout([...actorNames, ...botNames]))),
        [actorNames, botNames, layoutTick],
    );
    const botByName = React.useMemo(() => new Map(bots.map(b => [b.name, b])), [bots]);

    // The one actor the floor is listening to right now: a PINNED seat
    // (plan §10.2 — click a desk mid-debate to pin its live argument in
    // place) wins over the automatic spotlight: whoever is speaking
    // (bubble shows their speech), else whoever is thinking.
    const [pinnedSeatId, setPinnedSeatId] = React.useState<string | null>(null);
    // Leaving the floor drops the pin (the next visit re-derives the
    // automatic spotlight).
    React.useEffect(() => { if (!open) setPinnedSeatId(null); }, [open]);
    const spotlight = React.useMemo(() => {
        const pinned = pinnedSeatId ? actors.find(a => a.id === pinnedSeatId) : null;
        if (pinned && (pinned.speech || pinned.thought)) return pinned;
        return actors.find(a => a.speaking && a.speech)
            ?? actors.find(a => a.thinking && (a.thought || a.speech))
            ?? null;
    }, [actors, pinnedSeatId]);

    if (!open) return null;

    const clockText = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const openApprovals = approvalItems.length;
    const lastPrint = squawk.find(ev => ev.text.startsWith('PRINT')) ?? null;
    // The full cast: model staff + named bots on the floor.
    const castCount = staff.length + bots.length;

    return (
        <div
            data-testid="floor-scene"
            role="dialog"
            aria-label="Trading floor"
            className="fixed inset-0 z-40 flex flex-col bg-zinc-950 text-zinc-100"
        >
            {/* ── Top bar ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-zinc-900/80 px-4 py-2 backdrop-blur">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tracking-tight text-zinc-100">
                        August 3.5
                    </span>
                    {isDebating ? (
                        <span
                            data-testid="floor-live-tag"
                            className="status-surface inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-300"
                        >
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                            Live
                        </span>
                    ) : (
                        <span className="rounded border border-white/10 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                            Idle
                        </span>
                    )}
                    {phase && (
                        <span className="hidden text-[11px] font-medium text-zinc-400 sm:block">
                            {phase}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {dayPnl !== undefined && (
                        <span
                            data-testid="floor-day-pnl"
                            className={`status-surface text-[11px] font-semibold tabular-nums ${dayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                        >
                            Day {dayPnl >= 0 ? '+' : '−'}${Math.abs(dayPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                    )}
                    <span data-testid="floor-stat-staff" className="hidden text-[11px] font-medium text-zinc-400 sm:block">
                        Staff <span className="font-mono tabular-nums text-zinc-200">{castCount}</span>
                    </span>
                    <span data-testid="floor-stat-tasks" className="hidden text-[11px] font-medium text-zinc-400 sm:block">
                        Tickets <span className="font-mono tabular-nums text-zinc-200">{gaugeStats.tasks}</span>
                    </span>
                    <span data-testid="floor-stat-shipped" className="hidden text-[11px] font-medium text-zinc-400 md:block">
                        Printed <span className="font-mono tabular-nums text-zinc-200">{gaugeStats.shipped}</span>
                    </span>
                    <span className="font-mono text-sm tabular-nums text-zinc-300" data-testid="floor-clock">
                        {clockText}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Exit floor"
                        data-testid="floor-close"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                {/* ── Main column: ticker + floor canvas ──────────── */}
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* Ticker strip */}
                    <div
                        data-testid="floor-ticker"
                        className="flex items-center gap-4 overflow-x-auto border-b border-white/5 bg-zinc-900/40 px-4 py-1.5"
                    >
                        {quotes.length === 0 ? (
                            <span className="text-[10px] uppercase tracking-widest text-zinc-600">
                                No watched symbols
                            </span>
                        ) : (
                            quotes.map(q => (
                                <span key={q.symbol} className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
                                    <span className="font-semibold text-zinc-300">{q.symbol}</span>
                                    <span className="font-mono tabular-nums text-zinc-500">
                                        {q.last !== undefined ? q.last.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                                    </span>
                                    {q.changePct !== undefined && (
                                        <span
                                            className={`font-mono tabular-nums ${
                                                q.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                            }`}
                                        >
                                            {q.changePct >= 0 ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
                                        </span>
                                    )}
                                </span>
                            ))
                        )}
                    </div>

                    {/* Floor canvas */}
                    <div className="relative min-h-0 flex-1 overflow-hidden">
                        {/* Big Board — top-left card (watched symbols + guard rotation + auction plot). */}
                        {(quotes.length > 0 || guardState || convictions.length >= 2) && (
                            <div
                                data-testid="floor-big-board"
                                className="absolute left-4 top-4 z-10 w-56 rounded-md border border-white/10 bg-zinc-950/80 p-3 backdrop-blur"
                            >
                                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                                    The Big Board
                                </p>
                                <ul className="mt-2 space-y-1.5">
                                    {quotes.slice(0, 5).map(q => (
                                        <li key={q.symbol} className="flex items-baseline justify-between gap-2 text-[11px]">
                                            <span className="font-mono font-semibold text-zinc-300">{q.symbol}</span>
                                            <span className="flex items-baseline gap-2">
                                                <span className="font-mono tabular-nums text-zinc-400">
                                                    {q.last !== undefined ? q.last.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                                                </span>
                                                <span
                                                    className={`w-14 text-right font-mono tabular-nums ${
                                                        q.changePct === undefined
                                                            ? 'text-zinc-600'
                                                            : q.changePct >= 0
                                                                ? 'text-emerald-400'
                                                                : 'text-rose-400'
                                                    }`}
                                                >
                                                    {q.changePct !== undefined ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : '—'}
                                                </span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                {/* Guard state rotation (plan §10.2): the
                                    floor is the ambient display — day P&L vs
                                    the daily limit and trades remaining
                                    rotate under the quotes on the same 1s
                                    clock tick (5s period, two faces). */}
                                {guardState && (
                                    <GuardRotation guard={guardState} dayPnl={dayPnl} clockMs={clock.getTime()} />
                                )}
                                {/* Sealed-auction dot plot (§10.2): once the
                                    convictions exist, the spread lives on the
                                    Big Board — dissent legible at a glance. */}
                                <AuctionDotPlot seats={convictions} />
                            </div>
                        )}

                        {/* Pipeline lane — right side of the canvas:
                            desk → risk gate → execution → print. */}
                        <div
                            data-testid="floor-pipeline"
                            className="absolute bottom-4 right-4 z-10 flex w-60 flex-col gap-2"
                        >
                            {/* RISK GATE — the human approval queue. */}
                            <div className="rounded-md border border-white/10 bg-zinc-950/80 p-3 backdrop-blur">
                                <div className="flex items-baseline justify-between">
                                    <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                                        Risk gate
                                    </p>
                                    <p className="font-mono text-[10px] tabular-nums text-zinc-400">
                                        {openApprovals} in queue
                                    </p>
                                </div>
                                {openApprovals === 0 ? (
                                    <p className="mt-1.5 text-[10px] text-zinc-600">Queue clear.</p>
                                ) : (
                                    <ul className="mt-1.5 space-y-1">
                                        {approvalItems.slice(0, 3).map(item => (
                                            <li key={item.id} className="flex items-center justify-between gap-2 text-[10px]">
                                                <span className="min-w-0 truncate text-zinc-400">{item.title}</span>
                                                <span className="status-surface shrink-0 rounded border border-amber-500/40 px-1 text-[8px] font-bold uppercase tracking-widest text-amber-300">
                                                    Risk
                                                </span>
                                            </li>
                                        ))}
                                        {openApprovals > 3 && (
                                            <li className="text-[10px] text-zinc-600">+{openApprovals - 3} more</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                            {/* EXECUTION — what's running right now. */}
                            <div className="rounded-md border border-white/10 bg-zinc-950/80 p-3 backdrop-blur">
                                <div className="flex items-baseline justify-between">
                                    <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                                        Execution
                                    </p>
                                    <p className="font-mono text-[10px] tabular-nums text-zinc-400">
                                        routing {gaugeStats.running > 0 ? '1' : '0'}
                                    </p>
                                </div>
                                <p className="mt-1.5 truncate text-[10px] text-zinc-400">
                                    {gaugeStats.running > 0
                                        ? (phase ?? 'Debate in progress')
                                        : exchanges.length > 0
                                            ? `${exchanges.length} replies this session`
                                            : 'Floor idle'}
                                </p>
                            </div>
                            {/* PRINT — the latest settled verdict. */}
                            <div className="rounded-md border border-white/10 bg-zinc-950/80 p-3 backdrop-blur">
                                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                                    Print
                                </p>
                                <p className="mt-1.5 truncate text-[10px] text-zinc-400">
                                    {lastPrint ? lastPrint.text.replace(/^PRINT\s+/, '') : 'Nothing printed yet'}
                                </p>
                            </div>
                        </div>

                        {/* Desks — stage actors + the live bot roster on
                            the shared floor layout. */}
                        <div className="absolute inset-0" style={{ background: FLOOR_THEME.canvasBackdrop }}>
                            {seats.length === 0 ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <p className="max-w-sm text-center text-[11px] uppercase tracking-widest text-zinc-600">
                                        The floor is empty — add a bot or send a setup from chat mode to put the desk to work
                                    </p>
                                </div>
                            ) : (
                                seats.map(seat => {
                                    const actor = actors.find(a => a.name === seat.name || a.id === seat.id);
                                    const bot = botByName.get(seat.name);
                                    if (!actor && !bot) return null;
                                    if (!actor && bot) {
                                        // Named-bot seat: pixel-art identity via the
                                        // bot's own pixel role (or a stable color for
                                        // face-bots), live while the floor is open,
                                        // "working…" while it streams a reply.
                                        const working = workingBotId === bot.id;
                                        const role = bot.avatar.kind === 'pixel'
                                            ? bot.avatar.role
                                            : avatarRoleForName(bot.name);
                                        return (
                                            <div
                                                key={seat.id}
                                                data-testid={`floor-desk-${seat.name}`}
                                                className="absolute -translate-x-1/2 -translate-y-1/2"
                                                style={{ left: `${seat.anchor.x * 100}%`, top: `${seat.anchor.y * 100}%` }}
                                            >
                                                <PixelSeat
                                                    name={bot.name}
                                                    live
                                                    thinking={working}
                                                    statusText={working ? 'working…' : undefined}
                                                    roleOverride={role}
                                                    onClick={onOpenSeatChat ? () => onOpenSeatChat(bot.name) : undefined}
                                                />
                                            </div>
                                        );
                                    }
                                    const role = roleForName(seat.name);
                                    const isSpotlight = spotlight?.id === actor!.id;
                                    const bubbleText = actor!.speech || actor!.thought || '';
                                    const wire = seatWire?.[seat.name];
                                    const roleTag = actor!.seatRole || actor!.seatFocus;
                                    return (
                                        <div
                                            key={seat.id}
                                            data-testid={`floor-desk-${seat.name}`}
                                            className="absolute -translate-x-1/2 -translate-y-1/2"
                                            style={{ left: `${seat.anchor.x * 100}%`, top: `${seat.anchor.y * 100}%` }}
                                        >
                                            <div className="relative">
                                                {isSpotlight && bubbleText && (
                                                    <SpeechBubble
                                                        text={bubbleText}
                                                        speaker={actor!.name}
                                                        side={seat.side}
                                                        toneKey={role}
                                                    />
                                                )}
                                                {isSpotlight && pinnedSeatId === actor!.id && (
                                                    <p className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] uppercase tracking-widest text-zinc-500">
                                                        pinned · click to release
                                                    </p>
                                                )}
                                                <PixelSeat
                                                    name={actor!.name}
                                                    speech={actor!.speech}
                                                    live={actor!.live}
                                                    thinking={actor!.thinking}
                                                    speaking={actor!.speaking}
                                                    statusText={actor!.speaking ? 'speaking…' : actor!.thinking ? 'thinking…' : actor!.toolChip}
                                                    roleOverride={role}
                                                    roleTag={roleTag}
                                                    onClick={() => {
                                                        // Pin-in-place while the seat has a live
                                                        // argument (plan §10.2); otherwise the
                                                        // click keeps its old meaning — open the
                                                        // seat's 1:1 thread.
                                                        const live = actor!.speech || actor!.thought;
                                                        if (live) {
                                                            setPinnedSeatId(prev => prev === actor!.id ? null : actor!.id);
                                                        } else if (onOpenSeatChat) {
                                                            onOpenSeatChat(seat.name);
                                                        }
                                                    }}
                                                />
                                                {/* Wire badge (plan §10.2): what the
                                                    harness actually sent this seat —
                                                    thinking knob, effort tier, pin,
                                                    cooldown, fitness. Monochrome
                                                    glyphs; hover for the raw reason. */}
                                                {wire && (
                                                    <div
                                                        data-testid={`floor-seat-wire-${seat.name}`}
                                                        title={wire.detail ? `${seat.name}: ${wire.detail}` : seat.name}
                                                        className="mt-0.5 truncate text-center font-mono text-[8px] uppercase tracking-wider text-zinc-500"
                                                    >
                                                        {seatWireGlyphs(wire)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}

                            {/* Verdict banner — pinned bottom-center when a
                                settled verdict exists on the projected run. */}
                            {verdictDetail && (
                                <div className="absolute bottom-[6%] left-1/2 -translate-x-1/2">
                                    <VerdictCard
                                        direction={verdictDetail.direction}
                                        confidence={verdictDetail.confidence}
                                        grade={verdictDetail.grade ?? undefined}
                                        seats={convictions.map(c => ({ name: c.name, value: c.value }))}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer rule */}
                    <div className="border-t border-white/5 px-4 py-1.5">
                        <p className="text-[9px] uppercase tracking-widest text-zinc-600">
                            Every ticket walks the floor · desk → risk gate → execution → print
                        </p>
                    </div>
                </div>

                {/* ── Right rail ───────────────────────────────────── */}
                <aside
                    data-testid="floor-rail"
                    className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-zinc-900/60 md:flex"
                >
                    {/* Chief card */}
                    <div className="border-b border-white/5 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            Chief of staff
                        </p>
                        <p className="mt-1 text-sm font-semibold text-zinc-100">August</p>
                        <p className="text-[11px] text-zinc-400">
                            {isDebating ? 'Running the floor — debate in progress' : 'Floor is quiet'}
                        </p>
                        <p className="mt-1 text-[10px] text-zinc-500">
                            {castCount} seated · {openApprovals} awaiting review
                        </p>
                    </div>

                    {/* Order flow counters */}
                    <div className="border-b border-white/5 p-4" data-testid="floor-order-flow">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            Order flow
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            {[
                                { label: 'Risk gate', value: gaugeStats.approvals },
                                { label: 'Execution', value: gaugeStats.running },
                                { label: 'Printed', value: gaugeStats.shipped },
                            ].map(cell => (
                                <div key={cell.label} className="rounded-md border border-white/10 bg-zinc-950/60 px-2 py-2">
                                    <p className="font-mono text-lg tabular-nums text-zinc-100">{cell.value}</p>
                                    <p className="text-[9px] uppercase tracking-widest text-zinc-500">{cell.label}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Live tickets — the approval queue as ticket rows. */}
                    {approvalItems.length > 0 && (
                        <div className="border-b border-white/5 p-4" data-testid="floor-tickets">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                Tickets
                            </p>
                            <ul className="mt-2 space-y-1.5">
                                {approvalItems.slice(0, 5).map(item => (
                                    <li key={item.id} className="flex items-start justify-between gap-2 text-[11px]">
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium text-zinc-300">{item.title}</span>
                                            <span className="block truncate text-[10px] text-zinc-500">{item.detail}</span>
                                        </span>
                                        <span className="status-surface shrink-0 rounded border border-amber-500/40 px-1 text-[8px] font-bold uppercase tracking-widest text-amber-300">
                                            Risk
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Positions */}
                    <div className="border-b border-white/5 p-4" data-testid="floor-positions">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            Positions
                        </p>
                        {positions.length === 0 ? (
                            <p className="mt-2 text-[11px] text-zinc-600">No tickets yet.</p>
                        ) : (
                            <table className="mt-2 w-full text-left">
                                <thead>
                                    <tr className="text-[9px] uppercase tracking-widest text-zinc-600">
                                        <th className="pb-1 font-semibold">Sym</th>
                                        <th className="pb-1 font-semibold">Dir</th>
                                        <th className="pb-1 text-right font-semibold">U/PnL</th>
                                    </tr>
                                </thead>
                                <tbody className="status-surface">
                                    {positions.slice(0, 8).map(p => (
                                        <tr key={p.id} className="border-t border-white/5 text-[11px]">
                                            <td className="py-1 font-mono text-zinc-300">{p.symbol}</td>
                                            <td className="py-1 text-zinc-400">{p.direction}</td>
                                            <td className={`py-1 text-right font-mono tabular-nums ${floorPnlColor(p.pnl)}`}>
                                                {p.pnl !== undefined ? formatPnl(p.pnl) : '· · ·'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Squawk feed */}
                    <div className="min-h-0 flex-1 p-4" data-testid="floor-squawk">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            Squawk
                        </p>
                        {squawk.length === 0 ? (
                            <p className="mt-2 text-[11px] text-zinc-600">Quiet tape.</p>
                        ) : (
                            <ul className="mt-2 space-y-1.5">
                                {squawk.slice(0, 20).map(ev => (
                                    <li key={ev.id} className="flex gap-2 text-[11px] leading-snug">
                                        <span className="shrink-0 font-mono text-zinc-600">{ev.time}</span>
                                        <span className="min-w-0 text-zinc-400">{ev.text}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
};

/** Signed PnL with an explicit sign; emerald/rose reads via status-surface. */
const formatPnl = (pnl: number): string => {
    const sign = pnl >= 0 ? '+' : '−';
    const abs = Math.abs(pnl);
    const digits = abs >= 100 ? 0 : 2;
    return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

const floorPnlColor = (pnl: number | undefined): string => {
    if (pnl === undefined) return 'text-zinc-500';
    return pnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
};

export default FloorScene;
