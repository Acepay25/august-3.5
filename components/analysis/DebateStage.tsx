import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DebateBotAvatar } from './DebateBotAvatar';
import { lastThoughtSnippet } from '../../utils/runGantt';

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
}

interface Flight {
    id: string;
    speakerId: string;
    text: string;
    fromX: number;
    fromY: number;
    dx: number;
    dy: number;
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

/**
 * The whole Floor is this table: Grok discs, thought snippets, replies that
 * fly sender → receiver. Click a seat to open its chat modal.
 */
export const DebateStage: React.FC<DebateStageProps> = ({ actors, caption, onOpenActor }) => {
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
                queueRef.current.push({
                    id: key,
                    speakerId: actor.id,
                    text: lastThoughtSnippet(delivery.text, 36),
                    fromX: from.left + from.width / 2 - box.left,
                    fromY: from.top + from.height / 2 - box.top,
                    dx: (to.left + to.width / 2) - (from.left + from.width / 2),
                    dy: (to.top + to.height / 2) - (from.top + from.height / 2),
                    receiverId: receiver.id,
                });
            });
        });
        if (!flight && queueRef.current.length > 0) startNextFlight();
    }, [actors, flight]);

    useEffect(() => {
        if (!flight) return;
        const timer = window.setTimeout(() => {
            setSentId(flight.receiverId);
            setFlight(null);
        }, 850);
        return () => window.clearTimeout(timer);
    }, [flight]);

    useEffect(() => {
        if (!sentId) return;
        const timer = window.setTimeout(() => setSentId(null), 1100);
        return () => window.clearTimeout(timer);
    }, [sentId]);

    return (
        <div className="debate-stage">
            <div className="debate-stage-scene" ref={sceneRef}>
                <div className="debate-stage-desk" />
                <div className="debate-stage-cast">
                    {actors.map((actor, index) => {
                        const focused = actor.speaking || actor.thinking || actor.live;
                        const look = focusIndex < 0 || focused ? 0 : Math.sign(focusIndex - index);
                        const thought = lastThoughtSnippet(actor.thought, 72);
                        const speech = actor.speaking ? lastThoughtSnippet(actor.speech, 42) : '';
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
                                {actor.thinking && thought && (
                                    <span className="debate-stage-thought" data-thought={thought} />
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
                                {speech && <span className="debate-stage-balloon" data-speech={speech} />}
                                {sentId === actor.id && (
                                    <span className="debate-stage-sent">sent!</span>
                                )}
                                <span className="debate-stage-name">{actor.name}</span>
                            </button>
                        );
                    })}
                </div>
                {flight && (
                    <span
                        className="debate-stage-packet"
                        aria-hidden="true"
                        data-packet={flight.text}
                        onClick={() => onOpenActor?.(flight.speakerId)}
                        style={{
                            left: flight.fromX,
                            top: flight.fromY,
                            ['--dx' as string]: `${flight.dx}px`,
                            ['--dy' as string]: `${flight.dy}px`,
                        }}
                    />
                )}
            </div>
            {caption ? (
                <p className="debate-stage-caption" aria-live="polite">{caption}</p>
            ) : null}
        </div>
    );
};

export default DebateStage;
