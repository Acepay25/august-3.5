import React, { useEffect, useState } from 'react';
import { DebateRunEvent } from '../../types';

interface DebateRunLogProps {
    events: DebateRunEvent[];
}

const DebateRunLog: React.FC<DebateRunLogProps> = ({ events }) => {
    const [isReplaying, setIsReplaying] = useState(false);
    const [index, setIndex] = useState(events.length);
    useEffect(() => {
        if (!isReplaying) return;
        if (index >= events.length) {
            setIsReplaying(false);
            return;
        }
        const timer = window.setTimeout(() => setIndex(i => i + 1), 700);
        return () => window.clearTimeout(timer);
    }, [isReplaying, index, events.length]);

    const visible = isReplaying ? events.slice(0, index) : events;

    return (
        <div className="mt-1.5 rounded-lg border border-white/10 bg-zinc-900/60 px-2 py-1.5">
            <div className="mb-1 flex items-center gap-2">
                <button
                    type="button"
                    className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
                    onClick={() => {
                        if (isReplaying) {
                            setIsReplaying(false);
                            setIndex(events.length);
                        } else {
                            setIndex(0);
                            setIsReplaying(true);
                        }
                    }}
                >
                    {isReplaying ? 'Stop replay' : 'Replay log'}
                </button>
                {isReplaying && <span className="text-[10px] text-zinc-600">{index}/{events.length}</span>}
            </div>
            <div className="max-h-40 overflow-y-auto custom-scrollbar">
                {visible.map((event, i) => (
                    <p key={`${event.at}-${i}`} className="text-[10px] leading-5 text-zinc-400">
                        <span className="font-semibold uppercase tracking-widest text-zinc-500">{event.kind}</span>
                        {event.round !== undefined ? ` · r${event.round}` : ''}
                        {event.speaker ? ` · ${event.speaker}` : ''}
                        {' — '}{event.detail}
                    </p>
                ))}
            </div>
        </div>
    );
};

export default React.memo(DebateRunLog);
