import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DebateBotAvatar } from './DebateBotAvatar';
import { formatStageSnippet, stageTickerText } from '../../utils/runGantt';

export interface DebateStageActor {
    id: string;
    name: string;
    toneKey?: string;
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    thought?: string;
    speech?: string;
    replyTo?: string;
    replies?: Array<{ id: string; target: string; text: string }>;
}

interface DebateStageProps {
    actors: DebateStageActor[];
    caption?: string;
    onOpenActor?: (id: string) => void;
    suppressBubbles?: boolean;
    /** Live debate in progress — shows a pulse dot on the caption. */
    live?: boolean;
}

interface Flight {
    id: string;
    speakerId: string;
    text: string;
    fromX: number;
    fromY: number;
    dx: number;
    dy: number;
    angle: number;
    receiverId: string;
}

const matchesActor = (actor: DebateStageActor, target: string): boolean => {
    const needle = target.trim().toLowerCase();
    if (!needle) return false;
    return [actor.name, actor.id].some(value => {
        const hay = value.trim().toLowerCase();
        return hay === needle || needle.startsWith(hay) || hay.startsWith(needle);
    });
};

interface StageTickerProps {
    text?: string;
    fallback?: string;
    max?: number;
}

/**
 * Reveal the current bounded sentence progressively. When a new sentence is
 * completed the target changes and the bubble types that sentence in; while
 * the current sentence grows, the existing prefix is retained so the bubble
 * flows instead of restarting on every streamed token.
 */
const StageTicker: React.FC<StageTickerProps> = ({ text, fallback = '', max = 72 }) => {
    const target = stageTickerText(text || fallback, max);
    const shownRef = useRef(target);
    const [shown, setShown] = useState(target);

    useEffect(() => {
        let current = target.startsWith(shownRef.current) ? shownRef.current : '';
        shownRef.current = current;
        setShown(current);
        if (!target || current === target) return undefined;

        const timer = window.setInterval(() => {
            const remaining = target.length - current.length;
            const step = Math.max(1, Math.ceil(remaining / 4));
            current = target.slice(0, current.length + step);
            shownRef.current = current;
            setShown(current);
            if (current === target) window.clearInterval(timer);
        }, 28);
        return () => window.clearInterval(timer);
    }, [target]);

    // Render the sanitized text as real content. The old CSS-only attr()
    // approach made the bubble difficult to animate and invisible to normal
    // text measurement/accessibility APIs.
    return <span className="debate-stage-ticker" data-ticker-text={shown} aria-label={shown}>{shown}</span>;
};

/**
 * The whole Floor is this table: Grok disc bots on a lit stage, thought
 * snippets, replies that fly sender → receiver. Click a seat to open its
 * chat modal.
 */
export const DebateStage: React.FC<DebateStageProps> = ({ actors, caption, onOpenActor, suppressBubbles = false, live = false }) => {
    const sceneRef = useRef<HTMLDivElement>(null);
    const actorRefs = useRef<Map<string, HTMLElement>>(new Map());
    const flownRef = useRef<Set<string>>(new Set());
    const queueRef = useRef<Flight[]>([]);
    const [flight, setFlight] = useState<Flight | null>(null);
    const [sentId, setSentId] = useState<string | null>(null);
    const focusIndex = actors.findIndex(actor => actor.speaking || actor.thinking || actor.live);

    const startNextFlight = (): void => {
        const next = queueRef.current.shift();
        if (next) setFlight(next);
    };

    useLayoutEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        const box = scene.getBoundingClientRect();
        actors.forEach(actor => {
            if (!actor.speaking) return;
            const deliveries = actor.replies?.length
                ? actor.replies
                : actor.replyTo && actor.speech?.trim()
                    ? [{ id: actor.replyTo, target: actor.replyTo, text: actor.speech }]
                    : [];
            deliveries.forEach(delivery => {
                if (!delivery.target || !delivery.text.trim()) return;
                const receiver = actors.find(candidate => matchesActor(candidate, delivery.target));
                if (!receiver || receiver.id === actor.id) return;
                const key = `${actor.id}→${receiver.id}::${delivery.id}`;
                if (flownRef.current.has(key)) return;
                const fromEl = actorRefs.current.get(actor.id);
                const toEl = actorRefs.current.get(receiver.id);
                if (!fromEl || !toEl) return;
                const from = fromEl.getBoundingClientRect();
                const to = toEl.getBoundingClientRect();
                flownRef.current.add(key);
                const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
                const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
                queueRef.current.push({
                    id: key,
                    speakerId: actor.id,
                    text: stageTickerText(delivery.text, 36),
                    fromX: from.left + from.width / 2 - box.left,
                    fromY: from.top + from.height / 2 - box.top,
                    dx,
                    dy,
                    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
                    receiverId: receiver.id,
                });
            });
        });
        if (!flight && queueRef.current.length > 0) startNextFlight();
    }, [actors, flight]);

    // Flight + badge timings match the CSS keyframes (0.5s / 0.7s) — snappy
    // hand-offs read faster than the old 850/1100ms choreography.
    useEffect(() => {
        if (!flight) return;
        const timer = window.setTimeout(() => {
            setSentId(flight.receiverId);
            setFlight(null);
        }, 500);
        return () => window.clearTimeout(timer);
    }, [flight]);

    useEffect(() => {
        if (!sentId) return;
        const timer = window.setTimeout(() => setSentId(null), 700);
        return () => window.clearTimeout(timer);
    }, [sentId]);

    return (
        <div className="debate-stage">
            <div className="debate-stage-scene" ref={sceneRef}>
                <div className="debate-stage-backdrop" aria-hidden="true">
                    <span className="debate-stage-grid" />
                    <span className="debate-stage-horizon" />
                </div>
                <div className="debate-stage-floor" aria-hidden="true" />
                <div className="debate-stage-cast">
                    {actors.map((actor, index) => {
                        const focused = actor.speaking || actor.thinking || actor.live;
                        const look = focusIndex < 0 || focused ? 0 : Math.sign(focusIndex - index);
                        // One actor gets one floating bubble. When a model has
                        // both a live reasoning trace and public text, public
                        // speech wins; the old implementation rendered both
                        // bubbles at once (most visible on the moderator).
                        const bubbleText = actor.speaking
                            ? (actor.speech || actor.thought || '')
                            : actor.thinking
                                ? (actor.thought || 'Thinking')
                                : '';
                        const bubble = stageTickerText(bubbleText, actor.speaking ? 42 : 72);
                        return (
                            <button
                                key={actor.id}
                                type="button"
                                className={[
                                    'debate-stage-actor',
                                    actor.live ? 'is-live' : '',
                                    actor.thinking ? 'is-thinking' : '',
                                    actor.speaking ? 'is-speaking' : '',
                                ].filter(Boolean).join(' ')}
                                aria-label={`Open ${actor.name} analysis`}
                                onClick={() => onOpenActor?.(actor.id)}
                                ref={node => {
                                    if (node) actorRefs.current.set(actor.id, node);
                                    else actorRefs.current.delete(actor.id);
                                }}
                            >
                                {actor.speaking && <span className="debate-stage-beam" aria-hidden="true" />}
                                {!suppressBubbles && bubble && (
                                    <span
                                        className={`debate-stage-bubble ${actor.speaking ? 'debate-stage-balloon' : 'debate-stage-thought'}`}
                                        data-thought={actor.thought ? stageTickerText(actor.thought, 72) : undefined}
                                        data-speech={actor.speaking ? bubble : undefined}
                                    >
                                        <StageTicker text={bubbleText} fallback={actor.speaking ? '' : 'Thinking'} max={actor.speaking ? 42 : 72} />
                                    </span>
                                )}
                                {actor.speaking && <span className="debate-stage-spot" />}
                                <DebateBotAvatar
                                    name={actor.name}
                                    toneKey={actor.toneKey || actor.name}
                                    live={actor.live}
                                    thinking={actor.thinking}
                                    speaking={actor.speaking}
                                    look={look}
                                    size={52}
                                />
                                {sentId === actor.id && (
                                    <span className="debate-stage-sent">sent!</span>
                                )}
                                <span className="debate-stage-name">{actor.name}</span>
                            </button>
                        );
                    })}
                </div>
                {!suppressBubbles && flight && (
                    <span
                        className="debate-stage-packet"
                        aria-hidden="true"
                        data-packet={formatStageSnippet(flight.text, 36)}
                        onClick={() => onOpenActor?.(flight.speakerId)}
                        style={{
                            left: flight.fromX,
                            top: flight.fromY,
                            ['--dx' as string]: `${flight.dx}px`,
                            ['--dy' as string]: `${flight.dy}px`,
                            ['--angle' as string]: `${flight.angle}deg`,
                        }}
                    >
                        {formatStageSnippet(flight.text, 36)}
                    </span>
                )}
            </div>
            {caption ? (
                <p className="debate-stage-caption" aria-live="polite">
                    {live && <span className="debate-stage-caption-dot" aria-hidden="true" />}
                    {caption}
                </p>
            ) : null}
        </div>
    );
};

export default DebateStage;
