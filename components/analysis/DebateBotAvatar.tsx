import React from 'react';

interface DebateBotAvatarProps {
    name: string;
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    size?: number;
}

const hashName = (name: string): number => {
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
};

/**
 * Grok-like desk bot: rounded zinc face, two eyes, a small mouth.
 * Thinking looks up; speaking opens the mouth; live gets a pulse ring.
 */
export const DebateBotAvatar: React.FC<DebateBotAvatarProps> = ({
    name,
    live = false,
    thinking = false,
    speaking = false,
    size = 40,
}) => {
    const seed = hashName(name || '?');
    const eyeY = thinking ? 16.2 : 18;
    const eyeGap = 4 + (seed % 3);
    const smile = speaking ? 3.4 : thinking ? 0.4 : 1.2;
    const rx = 11 + (seed % 2);
    return (
        <span
            className={`debate-bot ${live ? 'debate-bot-live' : ''} ${thinking ? 'debate-bot-thinking' : ''} ${speaking ? 'debate-bot-speaking' : ''}`}
            style={{ width: size, height: size }}
            aria-hidden="true"
            title={name}
        >
            <svg viewBox="0 0 40 40" width={size} height={size} fill="none">
                <rect x="3" y="3" width="34" height="34" rx={rx} className="debate-bot-shell" />
                <rect x="6" y="6" width="28" height="10" rx="6" className="debate-bot-shine" />
                <circle cx={20 - eyeGap} cy={eyeY} r="2.2" className="debate-bot-eye" />
                <circle cx={20 + eyeGap} cy={eyeY} r="2.2" className="debate-bot-eye" />
                <path
                    d={`M16 26.2 Q20 ${26.2 + smile} 24 26.2`}
                    className="debate-bot-mouth"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
};

export default DebateBotAvatar;
