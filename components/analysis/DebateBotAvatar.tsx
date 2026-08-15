import React from 'react';

export interface DebateBotAvatarProps {
    name: string;
    /** Stable key for body color — prefer model id so the same model stays the same hue. */
    toneKey?: string;
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    /** -1 look left, 0 default (up-right), 1 look right */
    look?: number;
    size?: number;
}

const hashName = (name: string): number => {
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
};

/** Dark fills so the white pill eyes stay high-contrast, one tint per model. */
const BOT_FILLS = [
    '#111111',
    '#1e3a5f',
    '#3d2b1f',
    '#1d3d2f',
    '#3b2048',
    '#3d3a12',
    '#4a2020',
    '#1a3344',
] as const;

export const botFillForKey = (key: string): string => {
    if (!key || /^moderator$/i.test(key.trim())) return BOT_FILLS[0];
    return BOT_FILLS[hashName(key) % BOT_FILLS.length];
};

/**
 * Grok-style circular bot: solid disc, two white pill eyes tilted up-right.
 * Idle bobs and glances; thinking scans; speaking steps forward with a ring.
 */
export const DebateBotAvatar: React.FC<DebateBotAvatarProps> = ({
    name,
    toneKey,
    live = false,
    thinking = false,
    speaking = false,
    look = 0,
    size = 56,
}) => {
    const seed = hashName(toneKey || name || '?');
    const style = {
        '--bot-size': `${size}px`,
        '--bot-fill': botFillForKey(toneKey || name || '?'),
        '--look': String(look),
        '--bob-delay': `${seed % 1100}ms`,
        '--gaze-delay': `${(seed * 7) % 1600}ms`,
    } as React.CSSProperties;

    return (
        <span
            className={[
                'debate-bot',
                live ? 'is-live' : '',
                thinking ? 'is-thinking' : '',
                speaking ? 'is-speaking' : '',
            ].filter(Boolean).join(' ')}
            style={style}
            aria-hidden="true"
            title={name}
        >
            <span className="debate-bot-shadow" />
            <span className="debate-bot-body">
                <span className="debate-bot-eyes">
                    <span className="debate-bot-eye" />
                    <span className="debate-bot-eye" />
                </span>
            </span>
            {thinking && (
                <span className="debate-bot-orbs">
                    <span />
                    <span />
                    <span />
                </span>
            )}
        </span>
    );
};

export default DebateBotAvatar;
