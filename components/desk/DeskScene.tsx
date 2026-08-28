/**
 * DeskScene — opt-in overlay that renders the current debate as a 2D
 * "room of seat cards". Hidden by default. The toggle lives in the header
 * `⋯` menu (SettingsMenu) and the command palette.
 *
 * The scene is a *projection* of the same DebateState that drives the
 * transcript — no separate state. Actor names + speech lines come from the
 * shared `stageActorsForMessage` builder; exchanges + sealed convictions
 * come from the same `exchangesForTurns` / `convictionsFromTurns` helpers
 * MessageItem uses, so the room and the transcript never disagree.
 *
 * Layout (top to bottom):
 *   - Backdrop band: caption, run-contract stage strip, exchange map.
 *   - Floor canvas: absolutely-positioned pixel-art seats, each with a
 *     speech bubble that fades after 4s or whenever a new seat speaks.
 *   - Foreground rail: inline steer input, verdict card, close button.
 *
 * Phase 7 deliverable (visual refresh). No business logic, no storage,
 * no LLM calls. Pure presentational projection of the same DebateState.
 */

import React from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import type {
    DebateStageActor,
    DebateExchange,
} from '../analysis/DebateStage';
import { PixelSeat } from './PixelSeat';
import { SpeechBubble, SPEECH_BUBBLE_FADE_MS } from './SpeechBubble';
import { VerdictCard, extractConvictions, type VerdictSeat } from './VerdictCard';
import { DeskSteerInput } from './DeskSteerInput';
import { layoutFloor, FLOOR_REFERENCE_W, FLOOR_REFERENCE_H } from './floorLayout';
import { convictionsFromTurns, exchangesForTurns, livePhaseForMessage } from '../../utils/debateStageActors';
import { roleForName } from './pixelAvatars';
import { subscribeRoleOverrides } from '../../services/desk/roleOverrides';
import {
    getRoomLayout,
    setSeatPosition,
    clearSeatPosition,
    subscribeRoomLayout,
    resetRoomLayout,
    snapSeatPosition,
    pushUndo,
    popUndo,
    undoDepth,
    clearUndoStack,
    subscribeUndo,
    type RoomLayout,
    type UndoEntry,
} from '../../services/desk/roomLayout';

export interface DeskSceneProps {
    actors: DebateStageActor[];
    caption?: string;
    phase?: string;
    verdict?: string;
    onOpenActor?: (id: string) => void;
    onClose: () => void;
    /** Optional: hand the floor the same exchanges the transcript uses. */
    exchanges?: DebateExchange[];
    /** Optional: hand the floor the sealed convictions. */
    convictions?: Array<{ name: string; value: number }>;
    /** Optional: callback so the steer input can route into the live debate. */
    onSteerSeat?: (seatName: string, note: string) => void;
    /** Run-contract stage ladder — the same one the in-transcript stage shows. */
    stages?: Array<{ id: string; label: string; state: string; note?: string }>;
    /** Direction + grade for the verdict card. When omitted, the floor
     *  just shows the caption and skips the verdict panel. */
    verdictDetail?: { direction: string; confidence: string; grade?: string | null };
}

export const DeskScene: React.FC<DeskSceneProps> = ({
    actors,
    caption,
    phase,
    verdict,
    onOpenActor,
    onClose,
    exchanges,
    convictions,
    onSteerSeat,
    stages,
    verdictDetail,
}) => {
    const [zoom, setZoom] = React.useState(false);
    const [now, setNow] = React.useState(() => Date.now());
    const [bubbleVisibleUntil, setBubbleVisibleUntil] = React.useState<Record<string, number>>({});
    // Re-render when the user edits role overrides (Settings → Roles).
    // We bump a counter and pass nothing to the consumer — the
    // `layoutFloor` call below reads overrides fresh on each render.
    // Also re-render when the active user switches so a different
    // profile's override table is honored.
    const [overridesTick, setOverridesTick] = React.useState(0);
    React.useEffect(() => subscribeRoleOverrides(() => setOverridesTick(t => t + 1)), []);
    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onStorage = (e: StorageEvent): void => {
            if (e.key === 'last_active_user') setOverridesTick(t => t + 1);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    // Per-room layout (per-user, per-roster). When the trader drags a
    // seat in "Edit room" mode, the new x/y is saved here. The floor
    // re-derives the seat list on every tick.
    const [roomLayoutTick, setRoomLayoutTick] = React.useState(0);
    React.useEffect(() => subscribeRoomLayout(() => setRoomLayoutTick(t => t + 1)), []);
    const [editRoom, setEditRoom] = React.useState(false);
    const roomLayout: RoomLayout = React.useMemo(
        () => getRoomLayout(actors.map(a => a.id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [actors, roomLayoutTick, overridesTick],
    );
    // While a seat is being dragged we hold a transient override here
    // so the seat visibly follows the cursor without writing to
    // localStorage on every pointermove (one write on pointerup).
    const [dragPositions, setDragPositions] = React.useState<Record<string, { x: number; y: number }>>({});
    const floorRef = React.useRef<HTMLDivElement | null>(null);
    const draggingSeatRef = React.useRef<string | null>(null);
    const handleSeatPointerDown = (seatName: string) => (e: React.PointerEvent<HTMLDivElement>): void => {
        if (!editRoom) return;
        e.preventDefault();
        e.stopPropagation();
        draggingSeatRef.current = seatName;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const handleFloorPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const seatName = draggingSeatRef.current;
        if (!seatName || !floorRef.current) return;
        const rect = floorRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setDragPositions(prev => ({ ...prev, [seatName]: { x, y } }));
    };
    const handleFloorPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
        const seatName = draggingSeatRef.current;
        draggingSeatRef.current = null;
        if (!seatName) return;
        const final = dragPositions[seatName];
        if (final) {
            const names = actors.map(a => a.id);
            // Snap to the 5% grid for tactile landings. Read the
            // previous position BEFORE writing the new one so the
            // undo stack can restore it.
            const snapped = snapSeatPosition(final, 0.05);
            const prevLayout = getRoomLayout(names);
            const previous = prevLayout[seatName] ?? null;
            setSeatPosition(names, seatName, snapped);
            if (!previous || previous.x !== snapped.x || previous.y !== snapped.y) {
                pushUndo({ seatName, previous, next: snapped });
            }
            // The seat should land on the snapped cell, not the raw
            // cursor pixel; replace the transient drag position with
            // the snapped value so the next render uses it.
            setDragPositions(prev => ({ ...prev, [seatName]: snapped }));
        }
        // Release the pointer capture; the floor div had it from
        // pointerdown on the seat.
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    // Track the latest actors in a ref so the keydown handler always
    // sees the current roster (no stale closure).
    const actorsRef = React.useRef(actors);
    React.useEffect(() => { actorsRef.current = actors; }, [actors]);
    const handleUndo = React.useCallback((): void => {
        const entry = popUndo();
        if (!entry) return;
        const names = actorsRef.current.map(a => a.id);
        if (entry.previous) {
            setSeatPosition(names, entry.seatName, entry.previous);
        } else {
            clearSeatPosition(names, entry.seatName);
        }
    }, []);

    // Esc closes; the floor's own buttons (steer, etc.) handle their own keys.
    // Ctrl/Cmd+Z undoes the last drag while the desk is open.
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                if (undoDepth() > 0) {
                    e.preventDefault();
                    handleUndo();
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, handleUndo]);

    // Reset the undo stack when the desk closes — the next open should
    // start clean. We clear on unmount.
    React.useEffect(() => () => { clearUndoStack(); }, []);

    // Undo button enable state — bump on every push / pop / clear.
    const [undoTick, setUndoTick] = React.useState(0);
    React.useEffect(() => subscribeUndo(() => setUndoTick(t => t + 1)), []);
    // Touch the tick so the linter doesn't drop it; the consumer is
    // `undoDepth()` which reads the same store.
    void undoTick;
    const canUndo = undoDepth() > 0;

    // Speech-bubble lifecycle: when any seat starts speaking, mark its
    // bubble as visible for SPEECH_BUBBLE_FADE_MS. We re-render every second
    // so the bubble actually disappears when the timer expires.
    React.useEffect(() => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const a of actors) {
            if (a.speaking && a.speech && a.speech.trim().length > 0) {
                next[a.id] = Date.now() + SPEECH_BUBBLE_FADE_MS;
                changed = true;
            } else if (a.thinking) {
                // Keep the previous bubble up while the seat is thinking
                // (it just finished speaking).
                const prev = bubbleVisibleUntil[a.id];
                if (prev) next[a.id] = prev;
            } else {
                const prev = bubbleVisibleUntil[a.id];
                if (prev && prev > Date.now()) next[a.id] = prev;
            }
        }
        if (changed) setBubbleVisibleUntil(next);
    }, [actors, bubbleVisibleUntil]);

    React.useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    const seats = React.useMemo(
        () => layoutFloor(actors.map(a => a.id), roomLayout),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [actors, overridesTick, roomLayoutTick],
    );

    const liveSeatNames = React.useMemo(
        () => actors.filter(a => a.live).map(a => a.name),
        [actors],
    );

    const isBubbleVisible = (id: string): boolean => {
        const until = bubbleVisibleUntil[id];
        return until !== undefined && until > now;
    };

    const seatContainerClass = zoom
        ? 'h-[min(900px,95vh)] w-[min(1400px,98vw)]'
        : 'h-[min(720px,90vh)] w-[min(1100px,95vw)]';

    return (
        <div
            role="dialog"
            aria-label="Desk view of the current debate"
            className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className={`relative flex flex-col gap-2 rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-2xl ${seatContainerClass}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header — caption + run-contract + zoom/close. */}
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Desk view</span>
                            {caption && (
                                <span className="truncate text-[11px] font-medium text-zinc-200">{caption}</span>
                            )}
                            {phase && (
                                <span className="truncate text-[10px] text-zinc-500">· {phase}</span>
                            )}
                            {verdict && (
                                <span className="truncate text-[10px] text-zinc-500">· {verdict}</span>
                            )}
                        </div>
                        {stages && stages.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                {stages.map((stage, i) => (
                                    <React.Fragment key={stage.id}>
                                        {i > 0 && <span className="text-[9px] text-zinc-700">›</span>}
                                        <span
                                            title={stage.note || stage.label}
                                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                                stage.state === 'done'
                                                    ? 'bg-zinc-800 text-zinc-300'
                                                    : stage.state === 'running'
                                                        ? 'bg-zinc-700/60 text-zinc-100'
                                                        : stage.state === 'skipped'
                                                            ? 'bg-transparent text-zinc-600 line-through decoration-zinc-700'
                                                            : stage.state === 'failed'
                                                                ? 'bg-rose-500/10 text-rose-300'
                                                                : 'bg-transparent text-zinc-600'
                                            }`}
                                        >
                                            {stage.state === 'running' && (
                                                <span className="streaming-dots" aria-hidden="true"><span /><span /><span /></span>
                                            )}
                                            {stage.label}
                                        </span>
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                        {exchanges && exchanges.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                                <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Exchanges</span>
                                {exchanges.map(ex => (
                                    <span
                                        key={`${ex.from}->${ex.to}`}
                                        className="inline-flex items-center gap-1 rounded border border-white/5 bg-zinc-950/60 px-1.5 py-0.5 text-[9px] text-zinc-500"
                                        title={`${ex.from} addressed ${ex.to} ${ex.count}×`}
                                    >
                                        <span className="font-medium text-zinc-400">{ex.from}</span>
                                        <span aria-hidden="true">→</span>
                                        <span className="font-medium text-zinc-400">{ex.to}</span>
                                        {ex.count > 1 && <span className="tabular-nums">×{ex.count}</span>}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setEditRoom(v => !v)}
                            aria-label={editRoom ? 'Done editing room' : 'Edit room layout'}
                            aria-pressed={editRoom}
                            title={editRoom ? 'Done editing' : 'Edit room (drag seats)'}
                            data-testid="desk-edit-room"
                            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                                editRoom
                                    ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/50'
                                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                            }`}
                        >
                            {editRoom ? 'Done' : 'Edit room'}
                        </button>
                        {editRoom && (
                            <button
                                type="button"
                                onClick={handleUndo}
                                disabled={!canUndo}
                                title={canUndo ? 'Undo last drag (Ctrl/Cmd+Z)' : 'Nothing to undo'}
                                aria-label="Undo last drag"
                                data-testid="desk-undo-drag"
                                className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-300 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-100 disabled:text-zinc-600"
                            >
                                Undo
                            </button>
                        )}
                        {editRoom && (
                            <button
                                type="button"
                                onClick={() => {
                                    resetRoomLayout(actors.map(a => a.id));
                                    setDragPositions({});
                                    clearUndoStack();
                                }}
                                title="Reset to default positions"
                                data-testid="desk-reset-layout"
                                className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-400 hover:text-rose-300"
                            >
                                Reset
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setZoom(z => !z)}
                            aria-label={zoom ? 'Restore desk view' : 'Expand desk view'}
                            title={zoom ? 'Restore' : 'Expand'}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                            {zoom ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close desk view"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Floor canvas — relative so absolute seat anchors map to it. */}
                <div
                    ref={floorRef}
                    className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-gradient-to-b from-zinc-900/40 to-zinc-950/60 ${
                        editRoom ? 'border-amber-400/40' : 'border-white/5'
                    }`}
                    data-testid="desk-floor"
                    onPointerMove={handleFloorPointerMove}
                    onPointerUp={handleFloorPointerUp}
                    onPointerCancel={handleFloorPointerUp}
                    style={{
                        // The reference canvas is 960×540; we preserve aspect
                        // ratio and let it scale inside the dialog.
                        aspectRatio: `${FLOOR_REFERENCE_W} / ${FLOOR_REFERENCE_H}`,
                        touchAction: editRoom ? 'none' : 'auto',
                    }}
                >
                    {/* Subtle stage floor lines (no character art). */}
                    <svg
                        className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity ${
                            editRoom ? 'opacity-50' : 'opacity-30'
                        }`}
                        viewBox="0 0 960 540"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        <defs>
                            <linearGradient id="floor-vignette" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="rgba(63,63,70,0.0)" />
                                <stop offset="100%" stopColor="rgba(63,63,70,0.35)" />
                            </linearGradient>
                            <pattern id="floor-grid" x="0" y="0" width="48" height="27" patternUnits="userSpaceOnUse">
                                <path d="M 48 0 L 0 0 0 27" fill="none" stroke="rgba(251,191,36,0.18)" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect x="0" y="0" width="960" height="540" fill="url(#floor-vignette)" />
                        {/* 5%-grid overlay — only visible while the trader is
                            editing the room. Helps the seat land on a clean
                            cell when snap-to-grid is engaged. */}
                        {editRoom ? (
                            <rect x="0" y="0" width="960" height="540" fill="url(#floor-grid)" />
                        ) : null}
                        {/* Faint horizon line behind the moderator. */}
                        <line x1="120" y1="297" x2="840" y2="297" stroke="#27272a" strokeWidth="1" strokeDasharray="4 4" />
                    </svg>

                    {seats.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-zinc-500">
                                No analyst seats yet.
                            </div>
                        </div>
                    ) : (
                        seats.map(seat => {
                            const actor = actors.find(a => a.id === seat.id);
                            if (!actor) return null;
                            const role = roleForName(seat.name);
                            // Active drag position wins over the saved layout
                            // and the role anchor — the seat visibly follows
                            // the cursor while the trader drags it.
                            const dragPos = dragPositions[seat.name];
                            const anchor = dragPos ?? seat.anchor;
                            const leftPct = `${anchor.x * 100}%`;
                            const topPct = `${anchor.y * 100}%`;
                            const isDragging = draggingSeatRef.current === seat.name;
                            return (
                                <div
                                    key={seat.id}
                                    className={`absolute -translate-x-1/2 -translate-y-1/2 transition-transform ${
                                        editRoom ? 'cursor-grab' : ''
                                    } ${isDragging ? 'cursor-grabbing z-30 scale-110' : ''} ${
                                        isDragging ? 'rounded-md ring-2 ring-amber-400/60 shadow-lg shadow-amber-400/20' : ''
                                    }`}
                                    style={{ left: leftPct, top: topPct }}
                                    onPointerDown={handleSeatPointerDown(seat.name)}
                                    data-testid={`seat-${seat.name}`}
                                    data-edit-room={editRoom ? '1' : '0'}
                                >
                                    <div className="relative">
                                        {isBubbleVisible(seat.id) && actor.speech && (
                                            <SpeechBubble
                                                text={actor.speech}
                                                speaker={actor.name}
                                                side={seat.side}
                                                toneKey={role}
                                            />
                                        )}
                                        <PixelSeat
                                            name={actor.name}
                                            speech={actor.speech}
                                            live={actor.live}
                                            thinking={actor.thinking}
                                            speaking={actor.speaking}
                                            onClick={editRoom ? undefined : () => onOpenActor?.(actor.id)}
                                            statusText={
                                                actor.speaking
                                                    ? 'speaking…'
                                                    : actor.thinking
                                                        ? 'thinking…'
                                                        : actor.toolChip
                                            }
                                            roleOverride={role}
                                        />
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Verdict card pinned under the moderator when present. */}
                    {verdictDetail && (
                        <div
                            className="absolute left-1/2 top-[78%] -translate-x-1/2"
                            data-testid="desk-verdict"
                        >
                            <VerdictCard
                                direction={verdictDetail.direction}
                                confidence={verdictDetail.confidence}
                                grade={verdictDetail.grade}
                                seats={(convictions ?? []).map(c => ({ name: c.name, value: c.value }))}
                            />
                        </div>
                    )}
                </div>

                {/* Foreground rail — steer input + close hint. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {onSteerSeat ? (
                        <DeskSteerInput liveSeats={liveSeatNames} onSubmit={onSteerSeat} />
                    ) : (
                        <div className="text-[10px] text-zinc-500">
                            Click a seat to open its full transcript. Esc closes.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Re-export the verdict-seat extraction so consumers don't have to import
 *  the inner module. */
export type { VerdictSeat };
export { extractConvictions };

/** Re-export the live-phase + exchanges helpers for any caller that
 *  composes the DeskScene from raw data. */
export { livePhaseForMessage, exchangesForTurns, convictionsFromTurns };

export default DeskScene;
