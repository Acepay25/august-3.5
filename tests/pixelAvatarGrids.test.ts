import { describe, it, expect } from 'vitest';

/**
 * The pixel grids are hand-edited strings, and a renderer that gets a short
 * row or a stray token draws a silently wrong face — nothing throws. These
 * checks own the shape, which is all a sprite table can be checked for.
 *
 * They replaced the desk-view tests, which each pinned one frame of one role;
 * the frames went with the 2D desk view, so this pins the one pose that is
 * still rendered (BotAvatar) across every role instead.
 */

import {
    buildGridForRole,
    colorForToken,
    PIXEL_GRID_H,
    PIXEL_GRID_W,
    type PixelToken,
    type RolePreset,
} from '../components/chat/pixelAvatars';

const ROLES: RolePreset[] = [
    'risk', 'macro', 'technical', 'sentiment', 'moderator',
    'followup', 'postmortem', 'execution', 'unknown',
];

describe('pixel avatar grids', () => {
    it.each(ROLES)('%s is a %i-row grid of %i valid tokens', (role) => {
        const grid = buildGridForRole(role);
        expect(grid).toHaveLength(PIXEL_GRID_H);
        for (const row of grid) {
            expect(row).toHaveLength(PIXEL_GRID_W);
            expect(row).toMatch(/^[.HSMCTVEPW1234]+$/);
        }
    });

    it('keeps every role on a distinct face', () => {
        const shapes = new Set(ROLES.map(r => buildGridForRole(r).join('\n')));
        expect(shapes.size).toBe(ROLES.length);
    });

    // A token the palette does not know resolves to `undefined`, which the
    // renderer drops silently — the face just loses those pixels.
    it('colors every non-transparent token in every grid', () => {
        for (const role of ROLES) {
            for (const row of buildGridForRole(role)) {
                for (const token of row.split('') as PixelToken[]) {
                    if (token === '.') continue;
                    expect(colorForToken(token, role), `${token} in ${role}`).toBeTruthy();
                }
            }
        }
    });
});
