/**
 * BotAvatar — renders a bot's stored avatar: one of the 10 built-in
 * geometric faces, our existing pixel avatar (role-based), or Auto
 * ("face follows the name"). The single identity mark used by the
 * roster, thread headers, group rows, and message bylines.
 */

import React from 'react';
import { BotFace } from './BotFace';
import type { AgentBot } from '../../services/agents/agentRoster';
import {
    buildGridForRole,
    colorForToken,
    PIXEL_GRID_H,
    PIXEL_GRID_W,
    ROLE_ACCENTS,
    type RolePreset,
} from '../desk/pixelAvatars';

/** Our existing pixel avatar, drawn disc-style (accent-tinted). */
export const PixelAvatarFigure: React.FC<{ role: RolePreset; size: number }> = ({ role, size }) => {
    const grid = React.useMemo(() => buildGridForRole(role, 'idle'), [role]);
    const cell = size / 26;
    return (
        <span
            className="relative flex shrink-0 items-center justify-center rounded-full"
            style={{ width: size, height: size, backgroundColor: ROLE_ACCENTS[role].T }}
            aria-hidden="true"
        >
            <span className="relative block" style={{ width: PIXEL_GRID_W * cell, height: PIXEL_GRID_H * cell }}>
                {grid.map((row, r) =>
                    row.split('').map((c, ci) => {
                        if (c === '.') return null;
                        return (
                            <span
                                key={`${r}-${ci}`}
                                style={{
                                    position: 'absolute',
                                    left: ci * cell,
                                    top: r * cell,
                                    width: cell,
                                    height: cell,
                                    background: colorForToken(c as Parameters<typeof colorForToken>[0], role),
                                }}
                            />
                        );
                    }),
                )}
            </span>
        </span>
    );
};

export interface BotAvatarProps {
    bot: Pick<AgentBot, 'name' | 'avatar'>;
    size?: number;
    working?: boolean;
}

export const BotAvatar: React.FC<BotAvatarProps> = ({ bot, size = 40, working = false }) => {
    if (bot.avatar.kind === 'pixel') {
        return <PixelAvatarFigure role={bot.avatar.role} size={size} />;
    }
    if (bot.avatar.kind === 'upload') {
        return (
            <BotFace
                face={{ shape: bot.avatar.shape, hue: '#000000' }}
                name={bot.name}
                size={size}
                working={working}
                uploadSrc={bot.avatar.src}
            />
        );
    }
    return (
        <BotFace
            face={bot.avatar.kind === 'face' ? bot.avatar.spec : 'auto'}
            name={bot.name}
            size={size}
            working={working}
        />
    );
};

export default BotAvatar;
