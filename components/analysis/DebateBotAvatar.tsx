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

/* Parametric thinking orbit (Hermes-style): each model gets its own math
   curve — rose / lemniscate / lissajous — sampled once into an SVG path. A
   short particle trail traces it while the bot thinks. Motion follows state:
   the orbit only exists in the thinking state. */
const ORBIT_SIZE = 64;
const ORBIT_C = ORBIT_SIZE / 2;
const ORBIT_AMP = 26;
const ORBIT_DUR = 4.8;

type CurveFn = (t: number) => { x: number; y: number };

const CURVES: Record<string, CurveFn> = {
    rose: t => {
        const r = Math.cos(3 * t);
        return { x: r * Math.cos(t), y: r * Math.sin(t) };
    },
    lemniscate: t => {
        const d = 1 + Math.sin(t) * Math.sin(t);
        return { x: Math.cos(t) / d, y: (1.8 * Math.sin(t) * Math.cos(t)) / d };
    },
    lissajous: t => ({ x: Math.sin(2 * t), y: Math.sin(3 * t) }),
};

const sampleCurvePath = (fn: CurveFn): string => {
    const parts: string[] = [];
    const steps = 72;
    for (let i = 0; i <= steps; i += 1) {
        const t = (i / steps) * Math.PI * 2;
        const { x, y } = fn(t);
        const px = (ORBIT_C + x * ORBIT_AMP).toFixed(2);
        const py = (ORBIT_C + y * ORBIT_AMP).toFixed(2);
        parts.push(`${i === 0 ? 'M' : 'L'}${px},${py}`);
    }
    return `${parts.join(' ')} Z`;
};

const ORBIT_NAMES = Object.keys(CURVES);
const ORBIT_PATHS: Record<string, string> = {};
for (const name of ORBIT_NAMES) ORBIT_PATHS[name] = sampleCurvePath(CURVES[name]);

const orbitPathForSeed = (seed: number): string => ORBIT_PATHS[ORBIT_NAMES[seed % ORBIT_NAMES.length]];

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
 * Grok-style circular bot: solid disc, two white pill eyes, a small mouth.
 * Idle bobs, blinks and glances; thinking tilts and scans with rising orbs;
 * speaking pulses sonar rings and flaps the mouth.
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
    const orbitPath = orbitPathForSeed(seed);
    const style = {
        '--bot-size': `${size}px`,
        '--bot-fill': botFillForKey(toneKey || name || '?'),
        '--look': String(look),
        '--bob-delay': `${seed % 1100}ms`,
        '--gaze-delay': `${(seed * 7) % 1600}ms`,
        '--blink-delay': `${(seed * 13) % 2600}ms`,
        '--flap-delay': `${(seed * 5) % 180}ms`,
        '--ring-delay': `${seed % 350}ms`,
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
            {speaking && (
                <span className="debate-bot-rings">
                    <span className="debate-bot-ring" />
                </span>
            )}
            <span className="debate-bot-body">
                <span className="debate-bot-face">
                    <span className="debate-bot-eyes">
                        <span className="debate-bot-eye" />
                        <span className="debate-bot-eye" />
                    </span>
                    <span className="debate-bot-mouth" />
                </span>
            </span>
            {thinking && (
                <span className="debate-bot-orbit" aria-hidden="true">
                    {[0, 1, 2].map(i => (
                        <span
                            key={i}
                            className="debate-bot-orbit-dot"
                            style={{
                                offsetPath: `path("${orbitPath}")`,
                                animationDelay: `${((-i * ORBIT_DUR) / 3).toFixed(2)}s`,
                                width: `${6 - i}px`,
                                height: `${6 - i}px`,
                                opacity: 1 - i * 0.28,
                            }}
                        />
                    ))}
                </span>
            )}
        </span>
    );
};

export default DebateBotAvatar;
