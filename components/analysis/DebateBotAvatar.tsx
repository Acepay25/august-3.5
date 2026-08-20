import React from 'react';

export interface DebateBotAvatarProps {
    name: string;
    toneKey?: string;
    live?: boolean;
    thinking?: boolean;
    speaking?: boolean;
    look?: number;
    size?: number;
    avatarUrl?: string;
}

const hashName = (name: string): number => {
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
};

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

export const DebateBotAvatar: React.FC<DebateBotAvatarProps> = ({
    name,
    toneKey,
    live = false,
    thinking = false,
    speaking = false,
    size = 36,
    avatarUrl,
}) => {
    const fill = botFillForKey(toneKey || name || '?');
    const initial = (name.trim()[0] || '?').toUpperCase();
    const stateClass = speaking ? 'is-speaking' : thinking ? 'is-thinking' : live ? 'is-live' : '';
    const style = {
        width: size,
        height: size,
        background: fill,
        borderColor: speaking ? 'rgba(255,255,255,0.28)' : live || thinking ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
    } as React.CSSProperties;

    if (avatarUrl) {
        return (
            <span className={`bot-avatar ${stateClass}`} style={style} aria-hidden="true">
                <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                    onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                />
                <span className="bot-avatar-fallback">{initial}</span>
            </span>
        );
    }

    return (
        <span className={`bot-avatar ${stateClass}`} style={style} aria-hidden="true" title={name}>
            {initial}
        </span>
    );
};

export default DebateBotAvatar;
