import React from 'react';

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
    toolChip?: string;
}

interface DebateStageProps {
    actors: DebateStageActor[];
    caption?: string;
    onOpenActor?: (id: string) => void;
    suppressBubbles?: boolean;
    live?: boolean;
}

export const DebateStage: React.FC<DebateStageProps> = () => null;

export default DebateStage;
