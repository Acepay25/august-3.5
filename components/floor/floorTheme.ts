/**
 * floorTheme — every color the trading floor uses, in one map.
 *
 * The floor stays inside the workspace's monochrome zinc theme
 * (AGENTS.md): grays for structure, emerald/rose only where the
 * meaning would otherwise be lost (PnL, live/risks status), and
 * always inside `.status-surface` scopes in the components.
 *
 * Centralizing the tokens means a reskin (e.g. the warm "Wall
 * Street paper" look) is a one-file change — components never
 * hardcode floor colors.
 */

export const FLOOR_THEME = {
    /** Floor backdrop: slightly warmer than pure black so the room
     *  feels inhabited (matches CompanyRoom's vignette language). */
    canvasBackdrop:
        'radial-gradient(ellipse at 50% 85%, rgba(63,63,70,0.25) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, rgba(9,9,11,0.6) 0%, rgba(24,24,27,0.9) 100%)',
} as const;
