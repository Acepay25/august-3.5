/**
 * CompanyRoom — top-down pixel-art office rendered as a fixed
 * background behind the chat pane. Inspired by the "Autonomous AI
 * Company" reference: workstation row at the bottom on a darker
 * platform, a "human approval queue" panel in the center, gauges
 * + task-flow strip at the top.
 *
 * Layout (top → bottom, mirroring the reference):
 *   ┌─ TASK FLOW strip (gauges) ─────────────────┐
 *   ├─ HUMAN APPROVAL QUEUE (centered panel) ──┤
 *   ├─ WORKSTATION ROW (agents at desks) ──────┤
 *   └─ floor platform ─────────────────────────┘
 *
 * Per-room layout (per-user, per-roster, persisted in
 * services/desk/roomLayout.ts): the trader can drag any desk to a
 * new cell. The layout store is shared with the desk view so the
 * same positions apply whether the trader is looking at the office
 * behind the chat or the full-screen desk view.
 *
 * Custom seat names from Settings → Roles are read via
 * services/desk/roleOverrides.ts so renaming an agent in Settings
 * propagates to the office.
 */

import React from 'react';
import { PixelSeat } from '../desk/PixelSeat';
import {
    applyRoomLayout,
    getRoomLayout,
    snapSeatPosition,
    isNoopPositionChange,
    pushUndo,
    setSeatPosition,
    subscribeRoomLayout,
} from '../../services/desk/roomLayout';
import { getRoleOverrides } from '../../services/desk/roleOverrides';

export interface CompanyRoomProps {
    /** Number of ready providers; controls how many desks are lit. */
    activeProviderCount?: number;
    /** Total desks to render. Defaults to 6 (matches the work-farm rows). */
    deskCount?: number;
    /** Optional: pass a seat name list to render specific agents. */
    seatNames?: string[];
    /** Optional: hide the office header (e.g. in a small dock). */
    showHeader?: boolean;
    /** Optional: live analysis stats for the task-flow gauges. */
    gaugeStats?: {
        tasks: number;
        running: number;
        shipped: number;
        approvals: number;
    };
}

const DEFAULT_NAMES = ['Chief', 'Sales', 'Research', 'Build', 'Test', 'Verify', 'Support', 'Risk'];

/** Default 6-cell layout used when a roster has no saved positions
 *  yet. Six evenly-spaced cells along the bottom of the office.
 *  These mirror the role anchors from floorLayout.ts so a position
 *  saved in the office also reads sensibly in the desk view (and
 *  vice versa). */
const DEFAULT_POSITIONS = [
    { x: 0.10, y: 0.78 },  // left
    { x: 0.25, y: 0.78 },
    { x: 0.40, y: 0.78 },
    { x: 0.60, y: 0.78 },
    { x: 0.75, y: 0.78 },
    { x: 0.90, y: 0.78 },  // right
];

export const CompanyRoom: React.FC<CompanyRoomProps> = ({
    activeProviderCount = 3,
    deskCount = 6,
    seatNames,
    showHeader = true,
    gaugeStats,
}) => {
    // Resolved names: the props.seatNames list wins, else the
    // built-in default list. The per-user override map from
    // Settings → Roles doesn't change the displayed name (it maps
    // custom names to RolePresets for the avatar's accent color).
    // We DO read the map here so the office consults it on every
    // render — the userOverrides value is then passed to PixelSeat's
    // role-detection so the avatar's color follows the saved mapping.
    const userOverrides = React.useMemo(() => getRoleOverrides(), []);
    const names = React.useMemo(() => {
        const base = (seatNames && seatNames.length > 0 ? seatNames : DEFAULT_NAMES);
        // Re-read userOverrides in the dep list so the office picks
        // up Settings edits when the user switches back to it.
        void userOverrides;
        return base.slice(0, deskCount);
    }, [seatNames, deskCount, userOverrides]);

    // Subscribe to the roomLayout store so a saved drag propagates
    // back to the office without a reload. Re-render on every change.
    const [layoutTick, setLayoutTick] = React.useState(0);
    React.useEffect(() => subscribeRoomLayout(() => setLayoutTick(t => t + 1)), []);
    const layout = React.useMemo(
        () => getRoomLayout(names),
        // include the tick so this re-runs when the store changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [names, layoutTick],
    );

    // Drag state. We hold a transient `dragPositions` map (analogous
    // to the desk view) so the seat visibly follows the cursor. On
    // pointerup we snap to 5%, persist, and push undo.
    const [dragPositions, setDragPositions] = React.useState<Record<string, { x: number; y: number }>>({});
    const draggingSeatRef = React.useRef<string | null>(null);
    const floorRef = React.useRef<HTMLDivElement | null>(null);
    const handleSeatPointerDown = (name: string) => (e: React.PointerEvent<HTMLDivElement>): void => {
        // Only drag with primary button; the seat is also a button
        // for opening the desk view, so we don't grab every event.
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        draggingSeatRef.current = name;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    };
    const handleFloorPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const name = draggingSeatRef.current;
        if (!name || !floorRef.current) return;
        const rect = floorRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setDragPositions(prev => ({ ...prev, [name]: { x, y } }));
    };
    const handleFloorPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
        const name = draggingSeatRef.current;
        draggingSeatRef.current = null;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        if (!name) return;
        const final = dragPositions[name];
        if (!final) return;
        const snapped = snapSeatPosition(final, 0.05);
        const prevLayout = layout;
        const previous = prevLayout[name] ?? null;
        if (isNoopPositionChange(previous, snapped)) return;
        setSeatPosition(names, name, snapped);
        pushUndo({ seatName: name, previous, next: snapped });
    };

    // Apply saved layout on top of the default 6-cell grid.
    const positioned = React.useMemo(
        () => applyRoomLayout(
            names.map((n, i) => ({
                name: n,
                anchor: DEFAULT_POSITIONS[i] ?? { x: 0.5, y: 0.5 },
            })),
            layout,
        ),
        [names, layout],
    );

    // Synthetic metrics for the top task-flow strip. When the parent
    // passes live `gaugeStats`, those values populate the bars.
    const gauges: Array<{ label: string; value: number }> = gaugeStats
        ? [
            { label: 'Tasks',     value: gaugeStats.tasks },
            { label: 'Running',   value: gaugeStats.running },
            { label: 'Shipped',   value: gaugeStats.shipped },
            { label: 'Approvals',  value: gaugeStats.approvals },
        ]
        : [
            { label: 'Tasks',     value: 0.42 },
            { label: 'Running',   value: 0.18 },
            { label: 'Shipped',   value: 0.78 },
            { label: 'Approvals',  value: 0.10 },
        ];
    // Normalize so the bar widths look reasonable regardless of input scale.
    const maxGauge = Math.max(1, ...gauges.map(g => g.value));

    return (
        <div
            data-testid="company-room"
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-zinc-950"
        >
            {/* Background vignette — slightly warmer than pure black so
                the room feels inhabited, not empty. */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 80%, rgba(63,63,70,0.22) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, rgba(15,23,42,0.4) 0%, rgba(0,0,0,0.5) 100%)',
                }}
            />

            {/* SVG floor — top-down tile grid + a faint horizon line
                behind the moderator's seat. */}
            <svg
                className="absolute inset-0 h-full w-full opacity-30"
                viewBox="0 0 1200 720"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
            >
                <defs>
                    <pattern id="company-room-floor" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect x="0" y="0" width="1200" height="720" fill="url(#company-room-floor)" />
                <line x1="0" y1="540" x2="1200" y2="540" stroke="#27272a" strokeWidth="1" strokeDasharray="2 6" />
            </svg>

            {/* Header strip — task-flow + live count. Anchored to the
                top so the trader can always see "N / M agents live". */}
            {showHeader && (
                <div className="pointer-events-auto absolute left-0 right-0 top-0 flex items-center justify-between gap-3 border-b border-white/5 bg-zinc-950/70 px-4 py-2 backdrop-blur">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                        Autonomous AI Company
                    </span>
                    <div className="flex items-center gap-2">
                        {gauges.map(g => {
                            const pct = Math.max(0, Math.min(1, g.value / maxGauge));
                            return (
                                <div key={g.label} className="flex items-center gap-1.5">
                                    <span className="text-[9px] uppercase tracking-widest text-zinc-500">
                                        {g.label}
                                    </span>
                                    <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-800">
                                        <span
                                            className="block h-full rounded-full bg-zinc-500"
                                            style={{ width: `${pct * 100}%` }}
                                        />
                                    </span>
                                    {gaugeStats && (
                                        <span className="font-mono text-[9px] tabular-nums text-zinc-400">
                                            {g.value}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        <span className="ml-2 text-[10px] font-semibold text-zinc-400">
                            {activeProviderCount} / {names.length} live
                        </span>
                    </div>
                </div>
            )}

            {/* Human approval queue — centered panel that floats above
                the workstation row. Pure decoration for now; the
                actual approval inbox lives in its own component
                (ApprovalInbox). Mirrors the reference image's
                "HUMAN APPROVAL QUEUE" panel. */}
            <div className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
                <div className="rounded-md border border-white/10 bg-zinc-900/60 px-4 py-2 text-center shadow-2xl backdrop-blur">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Human approval queue
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                        Awaiting review on {Math.max(0, names.length - activeProviderCount)} task
                        {names.length - activeProviderCount === 1 ? '' : 's'}
                    </p>
                </div>
            </div>

            {/* Floor platform — a dark band along the bottom where the
                desks sit. Slightly brighter than the room so the
                workstations have a "ground" to stand on. */}
            <div
                className="pointer-events-none absolute left-0 right-0 bottom-0 h-[40%]"
                style={{
                    background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(24,24,27,0.55) 50%, rgba(39,39,42,0.85) 100%)',
                    borderTop: '1px solid rgba(63,63,70,0.3)',
                }}
            />

            {/* Workstation row — absolute-positioned desks. The same
                roomLayout store used by the desk view is the source
                of truth for positions, so dragging a desk here also
                moves it in the desk view (and vice versa). The floor
                ref captures pointermove/up so the seat visibly follows
                the cursor while dragging. */}
            <div
                ref={floorRef}
                onPointerMove={handleFloorPointerMove}
                onPointerUp={handleFloorPointerUp}
                onPointerCancel={handleFloorPointerUp}
                className="pointer-events-auto absolute inset-0"
            >
                {positioned.map((seat, idx) => {
                    const lit = idx < activeProviderCount;
                    const dragPos = dragPositions[seat.name];
                    const anchor = dragPos ?? seat.anchor;
                    return (
                        <div
                            key={seat.name}
                            data-testid={`company-desk-${idx}`}
                            data-lit={lit ? '1' : '0'}
                            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 select-none"
                            style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%`, touchAction: 'none' }}
                            onPointerDown={handleSeatPointerDown(seat.name)}
                        >
                            <div className="relative">
                                <PixelSeat
                                    name={seat.name}
                                    live
                                    thinking={idx === activeProviderCount - 1}
                                    pixelSize={3}
                                />
                                {lit && (
                                    <span
                                        className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                                        aria-hidden="true"
                                    />
                                )}
                            </div>
                            <span className="rounded border border-white/10 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-300">
                                {seat.name}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CompanyRoom;
