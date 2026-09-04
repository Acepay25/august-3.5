/**
 * BotFace — Hermes-Bot-Mode-style geometric avatar faces: a colored
 * shape with two eyes that follow a deterministic (shape × color)
 * grid. This is the identity mark for named bots, copied directly
 * from the Hermes reference: 7 shapes × 10 colors, "face follows the
 * name" when Auto, eyes blink while the bot is working.
 */

import React from 'react';

export const FACE_SHAPES = ['circle', 'square', 'blob', 'hex', 'diamond', 'drop', 'shield'] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

export const FACE_HUES = [
    '#8b5cf6', // violet
    '#6366f1', // indigo
    '#3b82f6', // blue
    '#06b6d4', // cyan
    '#10b981', // emerald
    '#84cc16', // lime
    '#f59e0b', // amber
    '#f97316', // orange
    '#f43f5e', // rose
    '#ec4899', // pink
] as const;

export interface BotFaceSpec {
    shape: FaceShape;
    hue: string;
}

const hashName = (name: string): number => {
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
};

/** "Face follows the name" — deterministic Auto face for a bot name. */
export const faceForName = (name: string): BotFaceSpec => {
    const h = hashName(name.trim() || 'bot');
    return {
        shape: FACE_SHAPES[h % FACE_SHAPES.length],
        hue: FACE_HUES[Math.floor(h / FACE_SHAPES.length) % FACE_HUES.length],
    };
};

export const randomFace = (): BotFaceSpec => ({
    shape: FACE_SHAPES[Math.floor(Math.random() * FACE_SHAPES.length)],
    hue: FACE_HUES[Math.floor(Math.random() * FACE_HUES.length)],
});

export const resolveFace = (face: BotFaceSpec | 'auto' | undefined, name: string): BotFaceSpec =>
    (!face || face === 'auto') ? faceForName(name) : face;

/** The 10 built-in faces shown in the New Bot picker (one per hue,
 *  shapes varied — the Hermes "Auto + face grid" row). */
export const BUILTIN_FACES: BotFaceSpec[] = FACE_HUES.map((hue, i) => ({
    shape: FACE_SHAPES[(i * 3) % FACE_SHAPES.length],
    hue,
}));

/** Uploadable container shapes for a custom image avatar (the reference's
 *  Upload tab): the image is clipped into one of these silhouettes. */
export const UPLOADABLE_FACES: BotFaceSpec[] = [
    { shape: 'circle', hue: FACE_HUES[0] },
    { shape: 'square', hue: FACE_HUES[0] },
    { shape: 'blob', hue: FACE_HUES[0] },
] as const;

const SHAPE_PATHS: Record<FaceShape, React.ReactNode> = {
    circle: <circle cx="12" cy="12" r="10" />,
    square: <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />,
    blob: <path d="M12 2.5c5.6 0 9.5 3.2 9.5 8.4 0 6.1-4.3 10.6-9.8 10.6S2.5 16.7 2.5 11 6.4 2.5 12 2.5z" />,
    hex: <path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z" />,
    diamond: <path d="M12 2l8.5 10L12 22 3.5 12 12 2z" />,
    drop: <path d="M12 2s7.5 7.6 7.5 13a7.5 7.5 0 1 1-15 0C4.5 9.6 12 2 12 2z" />,
    shield: <path d="M12 2l8 3v6.5c0 4.8-3.4 8.6-8 10.5-4.6-1.9-8-5.7-8-10.5V5l8-3z" />,
};

export interface BotFaceProps {
    face: BotFaceSpec | 'auto' | undefined;
    name: string;
    /** Pixel size of the square avatar (default 40). */
    size?: number;
    /** Blink the eyes (Hermes: eyes scan while the bot works). */
    working?: boolean;
    /** A custom uploaded image — clipped to the face's shape. When set,
     *  `face.shape` picks the silhouette and the hue is unused. */
    uploadSrc?: string;
    className?: string;
}

export const BotFace: React.FC<BotFaceProps> = ({ face, name, size = 40, working = false, uploadSrc, className }) => {
    const spec = resolveFace(face, name);
    const clipId = React.useId().replace(/[^a-zA-Z0-9]/g, '');
    if (uploadSrc) {
        return (
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                className={className}
                role="img"
                aria-label={`${name} avatar`}
            >
                <defs>
                    <clipPath id={`faceclip-${clipId}`}>{SHAPE_PATHS[spec.shape]}</clipPath>
                </defs>
                <image
                    href={uploadSrc}
                    x="0"
                    y="0"
                    width="24"
                    height="24"
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#faceclip-${clipId})`}
                />
            </svg>
        );
    }
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            role="img"
            aria-label={`${name} avatar`}
        >
            <g fill={spec.hue}>{SHAPE_PATHS[spec.shape]}</g>
            <g
                fill="rgba(0,0,0,0.55)"
                style={working ? { animation: 'botface-blink 1.1s steps(1) infinite', transformOrigin: 'center' } : undefined}
            >
                <rect x="7.6" y="9.6" width="2.6" height="4" rx="1.3" />
                <rect x="13.8" y="9.6" width="2.6" height="4" rx="1.3" />
            </g>
        </svg>
    );
};

export default BotFace;
