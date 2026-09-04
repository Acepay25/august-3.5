import React from 'react';
import { Wrench } from 'lucide-react';
import { DebateBotAvatar } from './DebateBotAvatar';
import type { RunContractStage } from '../../utils/runContract';

export interface DebateStageActor {
    id: string;
    name: string;
    toneKey?: string;
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    thought?: string;
    /** Newest lines of the seat's live turn — the floor shows the debate,
     *  not just "thinking…" animations. */
    speech?: string;
    replyTo?: string;
    replies?: Array<{ id: string; target: string; text: string }>;
    toolChip?: string;
    /** Team seat role short name ("Macro"/"Technical"/"Risk") from the
     *  run's analyst ledger — rendered as the seat's role tag. */
    seatRole?: string;
    /** Focus dimension tag for unroled team seats ("structure", "risk"…)
     *  — the u1 rotation that keeps N general seats distinguishable. */
    seatFocus?: string;
    /** Quiet cost/latency line for the hover tooltip —
     *  "Macro · gemini-2.5-pro · 41s · 1.2k out · ~$0.01". */
    meta?: string;
}

/** One directed addressing edge on the floor (who replied to whom). */
export interface DebateExchange {
    from: string;
    to: string;
    count: number;
}

interface DebateStageProps {
    actors: DebateStageActor[];
    caption?: string;
    /** Live phase line under the caption — "Round 2 of 3 · Devil's advocate: Risk". */
    phase?: string;
    /** Run-contract stage ladder rendered as a compact progress strip. */
    stages?: RunContractStage[];
    /** Addressing edges — the debate's structure at a glance. */
    exchanges?: DebateExchange[];
    onOpenActor?: (id: string) => void;
    suppressBubbles?: boolean;
    live?: boolean;
    /** Hover a live actor to steer/stop it. */
    onSteerSeat?: (seatName: string, note: string) => void;
    onStopSeat?: (seatName: string) => void;
}

/**
 * Debate floor: one bubble per debater — the analysts and the
 * moderator. While live, a bubble shows the seat's newest lines as they
 * stream (group-chat style); the full transcript streams in the
 * side panel opened via onOpenActor.
 */
export const DebateStage: React.FC<DebateStageProps> = ({ actors, caption, phase, stages, exchanges, onOpenActor, live = false, onSteerSeat, onStopSeat }) => {
    // Steering uses an inline input row instead of
    // window.prompt — the note is typed in place and queued on Enter.
    const [steerTarget, setSteerTarget] = React.useState<string | null>(null);
    const [steerDraft, setSteerDraft] = React.useState('');
    const submitSteer = (): void => {
        if (steerTarget && steerDraft.trim()) onSteerSeat?.(steerTarget, steerDraft.trim());
        setSteerTarget(null);
        setSteerDraft('');
    };
    if (actors.length === 0) return null;
    return (
        <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
            {(caption || phase) && (
                <div className="flex flex-wrap items-baseline gap-x-2 pb-2">
                    {caption && (
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{caption}</p>
                    )}
                    {phase && (
                        <p className="text-[10px] font-medium text-zinc-400">{phase}</p>
                    )}
                </div>
            )}
            {/* Live stage ladder — the run contract as a progress strip, so
                the watcher always knows WHERE the debate is (gate → openings
                → rebuttals → clarification → verdict). */}
            {stages && stages.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {actors.map(actor => (
                    <div key={actor.id} className="group/actor relative">
                        <button
                            key={actor.id}
                            type="button"
                            onClick={() => onOpenActor?.(actor.id)}
                            title={actor.meta ? `${actor.name} — ${actor.meta}` : `Open ${actor.name}'s transcript`}
                            className="flex w-full items-center gap-2.5 rounded-lg border border-white/5 bg-zinc-900 px-2.5 py-2 text-left transition-colors hover:border-zinc-700"
                        >
                        <DebateBotAvatar
                            name={actor.name}
                            toneKey={actor.toneKey}
                            size={30}
                            live={actor.live ?? live}
                            thinking={actor.thinking}
                            speaking={actor.speaking}
                        />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-1.5">
                                <span className="block truncate text-xs font-semibold text-zinc-200">{actor.name}</span>
                                {(actor.seatRole || actor.seatFocus) && (
                                    <span
                                        title={actor.seatRole
                                            ? `${actor.seatRole} seat — the team role this run`
                                            : `Focus: ${actor.seatFocus} — the dimension this unroled seat owns`}
                                        data-testid={`actor-role-${actor.id}`}
                                        className="shrink-0 rounded-sm border border-white/10 bg-zinc-950/60 px-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500"
                                    >
                                        {actor.seatRole || actor.seatFocus}
                                    </span>
                                )}
                            </span>
                            {actor.thinking ? (
                                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                                    thinking
                                    <span className="streaming-dots" aria-hidden="true"><span /><span /><span /></span>
                                </span>
                            ) : actor.toolChip ? (
                                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-zinc-500">
                                    <Wrench className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{actor.toolChip}</span>
                                </span>
                            ) : actor.speaking && actor.speech ? (
                                <span className="mt-0.5 block truncate text-[10px] italic text-zinc-400">
                                    “{actor.speech}”
                                </span>
                            ) : actor.speaking ? (
                                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
                                    drafting
                                    <span className="streaming-dots" aria-hidden="true"><span /><span /><span /></span>
                                </span>
                            ) : (
                                <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
                                    {actor.thought || (live ? 'waiting' : 'idle')}
                                </span>
                            )}
                        </span>
                        </button>
                        {/* Hover controls: steer (paper plane) / stop (square). */}
                        {live && (onSteerSeat || onStopSeat) && (
                            <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/actor:opacity-100">
                                {onSteerSeat && (
                                    <button
                                        type="button"
                                        title={`Steer ${actor.name}: a note only they see`}
                                        onClick={e => {
                                            e.stopPropagation();
                                            setSteerTarget(actor.name);
                                            setSteerDraft('');
                                        }}
                                        className="rounded-md bg-zinc-950/80 p-1 text-zinc-500 hover:text-zinc-200"
                                    >
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9 2zm0 0v-8" /></svg>
                                    </button>
                                )}
                                {onStopSeat && actor.live && (
                                    <button
                                        type="button"
                                        title={`Stop ${actor.name}: they leave at the next round`}
                                        onClick={e => {
                                            e.stopPropagation();
                                            onStopSeat(actor.name);
                                        }}
                                        className="rounded-md bg-zinc-950/80 p-1 text-zinc-500 hover:text-rose-400"
                                    >
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            {/* Exchange map: who addressed whom, and how often — the shape
                of the debate (real back-and-forth vs parallel monologues)
                readable at a glance. */}
            {exchanges && exchanges.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
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
            {/* Inline steer row: type the note, Enter queues it for
                that seat only. Esc cancels. */}
            {steerTarget && onSteerSeat && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5">
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        → {steerTarget}
                    </span>
                    <input
                        autoFocus
                        value={steerDraft}
                        onChange={e => setSteerDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') submitSteer();
                            if (e.key === 'Escape') { setSteerTarget(null); setSteerDraft(''); }
                        }}
                        placeholder={`Note for ${steerTarget} — only they see it`}
                        className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
                    />
                    <button
                        type="button"
                        onClick={submitSteer}
                        disabled={!steerDraft.trim()}
                        className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-zinc-300 enabled:bg-zinc-800 enabled:hover:bg-zinc-700 disabled:text-zinc-600"
                    >
                        Queue
                    </button>
                </div>
            )}
        </div>
    );
};

export default DebateStage;
