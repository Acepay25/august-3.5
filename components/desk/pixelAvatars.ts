/**
 * pixelAvatars — procedural pixel-art avatars for the desk view.
 *
 * The reference imagery (poker-visor analysts at stylized terminals) is
 * licensed. We don't ship sprites; we draw the avatars at runtime from a
 * 16×20 character grid. Each cell becomes one CSS pixel; `pixelArt` CSS
 * gives it `image-rendering: pixelated` and `shape-rendering: crispEdges`
 * so the result looks like sprite art, not a blurry SVG.
 *
 * Why a char grid and not a true bitmap? Two reasons:
 *   1. The grid is JSON-serializable — easy to read, test, and tweak.
 *   2. Tokens (`H`, `S`, `C`, `M`, `T`, `V`, `E`, `P`, `W`, `1`–`4`) map
 *      to a small palette table that the React renderer resolves to actual
 *      CSS colors, so a role swap is a one-line change.
 *
 * Tokens:
 *   `.`  transparent
 *   `H`  head / face (role-tinted)
 *   `S`  skin (neutral)
 *   `M`  mouth / visor shadow
 *   `C`  cap / visor
 *   `V`  vest / jacket
 *   `T`  tie / collar accent
 *   `E`  eyes (white)
 *   `P`  pupil (black)
 *   `W`  badge / name plate
 *   `1`–`4`  role accent stripes (chair, lamp, monitor, etc.)
 */

export const PIXEL_GRID_W = 16;
export const PIXEL_GRID_H = 20;

export type PixelToken =
    | '.' | 'H' | 'S' | 'M' | 'C' | 'V' | 'T' | 'E' | 'P' | 'W'
    | '1' | '2' | '3' | '4';

/** A row-major grid; each row is `PIXEL_GRID_W` chars long. */
export type PixelGrid = ReadonlyArray<string>;

export type RolePreset =
    | 'risk'
    | 'macro'
    | 'technical'
    | 'sentiment'
    | 'moderator'
    | 'followup'
    | 'postmortem'
    | 'execution'
    | 'unknown';

const isPixelToken = (c: string): c is PixelToken => /[.HSMCTVEPW1234]/.test(c);

/**
 * The palette. We deliberately keep accents muted (zinc scale + a couple of
 * semantic colors) so the room stays inside the AGENTS.md "intentionally
 * black/gray" rule. Status colors are reserved for WIN/LOSS overlays in the
 * `status-surface` scope, not for the avatar.
 */
export const PIXEL_PALETTE: Record<PixelToken, string> = {
    '.': 'transparent',
    H: '#27272a',     // zinc-800 — head silhouette
    S: '#a1a1aa',     // zinc-400 — skin
    M: '#18181b',     // zinc-900 — mouth/visor shadow
    C: '#3f3f46',     // zinc-700 — cap/visor top (overridden per role)
    V: '#52525b',     // zinc-600 — vest
    T: '#e4e4e7',     // zinc-200 — tie/collar (overridden per role)
    E: '#fafafa',     // zinc-50  — eyes
    P: '#09090b',     // zinc-950 — pupils
    W: '#fbbf24',     // amber-400 (overridden per role)
    '1': '#0c4a6e',   // sky-900 — monitor bezel
    '2': '#0e7490',   // cyan-700 — monitor screen
    '3': '#1e293b',   // slate-800 — desk
    '4': '#334155',   // slate-700 — desk highlight
};

/** Per-role color overrides for the cap/visor (`C`), tie (`T`), and
 *  name plate (`W`). Status colors stay muted — see AGENTS.md "intentionally
 *  black/gray". */
const ROLE_ACCENTS: Record<RolePreset, { C: string; T: string; W: string }> = {
    risk:       { C: '#7f1d1d', T: '#fecaca', W: '#f87171' }, // rose
    macro:      { C: '#1e3a8a', T: '#bfdbfe', W: '#60a5fa' }, // blue
    technical:  { C: '#14532d', T: '#bbf7d0', W: '#4ade80' }, // green
    sentiment:  { C: '#581c87', T: '#e9d5ff', W: '#c084fc' }, // purple
    moderator:  { C: '#27272a', T: '#fbbf24', W: '#fbbf24' }, // zinc + gold sash
    followup:   { C: '#155e75', T: '#a5f3fc', W: '#22d3ee' }, // cyan
    postmortem: { C: '#3f3f46', T: '#d4d4d8', W: '#a1a1aa' }, // grayscale
    execution:  { C: '#78350f', T: '#fed7aa', W: '#fb923c' }, // orange
    unknown:    { C: '#3f3f46', T: '#d4d4d8', W: '#a1a1aa' },
};

/** Normalize an actor name to a role preset. */
export const roleForName = (name: string): RolePreset => {
    const n = name.trim().toLowerCase();
    if (!n || /^moderator$/i.test(n)) return 'moderator';
    if (/risk|veto/.test(n)) return 'risk';
    if (/macro|fundamental/.test(n)) return 'macro';
    if (/technic|chart|candle|structur/.test(n)) return 'technical';
    if (/sentiment|flow|order.?book|tape/.test(n)) return 'sentiment';
    if (/follow.?up|replay|re-?entry|2nd.?look/.test(n)) return 'followup';
    if (/post.?mort|review|retrospect|grade/.test(n)) return 'postmortem';
    if (/execut|order|tca|fill/.test(n)) return 'execution';
    return 'unknown';
};

/** Build a 16×20 grid for a role, with an optional frame variant.
 *  Each role has up to four frames:
 *    - idle:        the default pose.
 *    - speaking:    mouth open + body lean right (rebuttal / talking).
 *    - thinking:    mouth slightly open + body lean left (reading data).
 *    - lean_back:   body lean right (post-rebuttal, sitting back).
 *  Unknown role or missing frame falls back to idle. The frame swap is
 *  driven by JS at ~2 Hz from PixelSeat; the body bob is CSS. */
export type Frame = 'idle' | 'speaking' | 'thinking' | 'lean_back';

const pickFrame = (role: RolePreset, frame: Frame): PixelGrid => {
    if (frame === 'speaking' && SPEAKING_GRIDS[role]) return SPEAKING_GRIDS[role];
    if (frame === 'thinking' && THINKING_GRIDS[role]) return THINKING_GRIDS[role];
    if (frame === 'lean_back' && LEAN_BACK_GRIDS[role]) return LEAN_BACK_GRIDS[role];
    return GRIDS[role];
};

export const buildGridForRole = (role: RolePreset, frame: Frame = 'idle'): PixelGrid =>
    pickFrame(role, frame);

/** Resolve a token to its final CSS color for a given role. */
export const colorForToken = (token: PixelToken, role: RolePreset): string => {
    const accent = ROLE_ACCENTS[role];
    if (token === 'C') return accent.C;
    if (token === 'T') return accent.T;
    if (token === 'W') return accent.W;
    return PIXEL_PALETTE[token];
};

/** Validate a grid is 16 columns wide and 20 rows tall with valid tokens. */
export const isValidGrid = (grid: PixelGrid): boolean => {
    if (grid.length !== PIXEL_GRID_H) return false;
    return grid.every(row => {
        if (row.length !== PIXEL_GRID_W) return false;
        for (const c of row) if (!isPixelToken(c)) return false;
        return true;
    });
};

// ─── Grids (16 wide × 20 tall) ──────────────────────────────────────────────
// Each row is exactly 16 chars. Tokens from the table above.
//
// Layout (rows 0-19):
//   0-1   empty (clear above the head)
//   2-5   cap / hat
//   6-9   face + eyes
//   10    mouth / shadow
//   11-13 shoulders / collar
//   14-16 vest + tie
//   17-19 desk surface
//
// The grids are intentionally distinct per role so the room reads at a glance
// (a green-cap analyst vs a gold-sashed referee is the point). Tests pin the
// per-role row shapes so a careless edit shows up immediately.

const GRIDS: Record<RolePreset, PixelGrid> = {
    // Risk: red visor, red tie, name plate glows red
    risk: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSPPPSSC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Macro: blue cap, blue-tinted glasses, blue tie
    macro: [
        '................',
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHEEEEEC......',
        '..CHPPPPPPC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Technical: green cap, no glasses, slim green tie (a thin column of T).
    technical: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVVTTVVV......',
        '..VVTTTTVV......',
        '..VVVTTVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Sentiment: purple cap, head tilted slightly
    sentiment: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTTTTTTV.....',
        '..VTTWWWTTV.....',
        '..VVVVVVVVV.....',
        '...VVVVVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Moderator: gold sash across the chest (a wide T block), plain cap.
    moderator: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTVV......',
        '..VTTTTTTV......',
        '..VTTWWWTTV.....',
        '..VTTTTTTV......',
        '..VVTTTTVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Followup: cyan cap, antenna
    followup: [
        '....C...........',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTTTTTTV.....',
        '..VTTWWWTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Postmortem: grayscale, "reviewer" cap, a tiny W "chart pin" on the
    // chest pocket (single W token in row 13).
    postmortem: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVVWWVVV......',
        '..VVVWWVVV......',
        '..VVVVVVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Execution: orange cap, hands on keyboard
    execution: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSSC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVWWWWWVV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Unknown: a generic analyst — used when we can't classify the seat.
    unknown: [
        '................',
        '................',
        '....HHHHHH......',
        '...HSSSSSSH.....',
        '...HSSSSSSH.....',
        '...HHHHMMHH.....',
        '...HSEPSESH.....',
        '...HSPPPSH......',
        '...HSSMMSH......',
        '...HSSSSSH......',
        '...HHMMHHH......',
        '....VVVVV.......',
        '...VVTTTTV......',
        '...VTTWTTV......',
        '...VTTTTTV......',
        '...VVVVVVV......',
        '....VVVVV.......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
};

/**
 * Speaking frames — one per role. The mouth row (index 10) opens to
 * suggest speech; rows 14-16 (vest) shift one column to suggest a body
 * lean. Used by PixelSeat when `speaking=true` and swapped on a tick
 * at ~2 Hz so the head visibly "talks".
 *
 * The grids stay 16 wide; we just rearrange tokens in those rows. The
 * validator still runs, so a typo would fail at the desk render.
 */
const SPEAKING_GRIDS: Record<RolePreset, PixelGrid> = {
    risk: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSPPPSSC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....', // mouth open (center gap)
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '.VVTTWWWTTV.....', // body lean right
        '.VTTTTTTTV......',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    macro: [
        '................',
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHEEEEEC......',
        '..CHPPPPPPC.....',
        '..CHSSMMSMC.....', // open mouth
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '.VVTTWWWTV......',
        '.VTTTTTTTVV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    technical: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....', // open mouth
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVTTTTVV......',
        '.VVTTTTTVV......', // lean right
        '..VVTTTTVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    sentiment: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '.VVTTWWWTV......',
        '.VTTTTTTTVV.....',
        '..VVVVVVVVV.....',
        '...VVVVVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    moderator: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTVV......',
        '.VVTTTTTTVV.....',
        '.VTTWWWTTVV.....',
        '.VTTTTTTVV......',
        '..VVTTTTVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    followup: [
        '....C...........',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '.VVTTWWWTV......',
        '.VTTTTTTTVV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    postmortem: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '.VVVWWVVVV......',
        '..VVVWWVVV......',
        '..VVVVVVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    execution: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '.VVWWWWWVV......',
        '.VTTTTTTTVV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    // Unknown stays the same — we have no character to animate.
    unknown: [
        '................',
        '................',
        '....HHHHHH......',
        '...HSSSSSSH.....',
        '...HSSSSSSH.....',
        '...HHHHMMHH.....',
        '...HSEPSESH.....',
        '...HSPPPSH......',
        '...HSSMMSH......',
        '...HSSSSSH......',
        '...HHMMHHH......',
        '....VVVVV.......',
        '...VVTTTTV......',
        '...VTTWTTV......',
        '...VTTTTTV......',
        '...VVVVVVV......',
        '....VVVVV.......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
};

/**
 * Thinking frames — one per role. The mouth row (10) shows a small
 * "hmm" open (M M with a small S gap in the middle), and the body
 * rows stay roughly centered with the vest asymmetric (one side V,
 * other side T) to suggest leaning toward the monitor. Used by
 * PixelSeat when `thinking=true` (and not speaking) and swapped on
 * the same 2 Hz tick that drives the speaking swap, so the seat
 * visibly "reads" data.
 */
const THINKING_GRIDS: Record<RolePreset, PixelGrid> = {
    risk: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSPPPSSC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    macro: [
        '................',
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHEEEEEC......',
        '..CHPPPPPPC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    technical: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVTTTTVV......',
        '..VVTTTTVV......',
        '..VVTTTTVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    sentiment: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVVVVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    moderator: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTVV......',
        '..VTTTTTTV......',
        '..VTTWWWTTV.....',
        '..VTTTTTVV......',
        '..VVTTTTVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    followup: [
        '....C...........',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VTTWWWTTV.....',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    postmortem: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVVWWVVV......',
        '..VVVWWVVV......',
        '..VVVVVVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    execution: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVWWWWVV......',
        '..VTTTTTTTV.....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    unknown: [
        '................',
        '................',
        '....HHHHHH......',
        '...HSSSSSSH.....',
        '...HSSSSSSH.....',
        '...HHHHMMHH.....',
        '...HSEPSESH.....',
        '...HSPPPSH......',
        '...HSSMMSH......',
        '...HSSSSSH......',
        '...HHMMHHH......',
        '....VVVVV.......',
        '...VVTTTTV......',
        '...VTTWTTV......',
        '...VTTTTTV......',
        '...VVVVVVV......',
        '....VVVVV.......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
};

/**
 * Lean-back frames — symmetric to the speaking lean. The body rows
 * shift one column LEFT instead of right, suggesting the analyst
 * sitting back in their chair after delivering a rebuttal. Used by
 * PixelSeat during a brief "post-speaking settle" window: the seat
 * is live (still on the floor) and was just speaking, so the body
 * visibly "settles" before the seat's next turn.
 */
const LEAN_BACK_GRIDS: Record<RolePreset, PixelGrid> = {
    risk: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSPPPSSC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVTTWWWTTV....',
        '..VVTTTTTTTV....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    macro: [
        '................',
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHEEEEEC......',
        '..CHPPPPPPC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVTTWWWTTV....',
        '..VVTTTTTTTV....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    technical: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVVTTVVV......',
        '..VVVTTTTVV.....',
        '..VVVTTVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    sentiment: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVTTWWWTTV....',
        '..VVTTTTTTTV....',
        '..VVVVVVVVV.....',
        '...VVVVVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    moderator: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTVV......',
        '..VVTTTTTTV.....',
        '..VVTTWWWTTV....',
        '..VVTTTTTVV.....',
        '..VVTTTTVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    followup: [
        '....C...........',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVTTWWWTTV....',
        '..VVTTTTTTTV....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    postmortem: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVVVVVVV......',
        '..VVVVWWVVV.....',
        '..VVVWWVVV......',
        '..VVVVVVVV......',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    execution: [
        '................',
        '...CCCCCC.......',
        '..CHHHHHHHC.....',
        '..CHSSSSSSHC....',
        '..CHSSSSSSHC....',
        '..CHHHMMHHHC....',
        '..CHSEPSESC.....',
        '..CHSPPPSSC.....',
        '..CHSSMMSMC.....',
        '..CHSSSSSSC.....',
        '..CHHMMHHHC.....',
        '...VVVVVVV......',
        '..VVTTTTTVV.....',
        '..VVVWWWWVV.....',
        '..VVTTTTTTTV....',
        '..VVVVVVVVV.....',
        '...VVWWVVV......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
    unknown: [
        '................',
        '................',
        '....HHHHHH......',
        '...HSSSSSSH.....',
        '...HSSSSSSH.....',
        '...HHHHMMHH.....',
        '...HSEPSESH.....',
        '...HSPPPSH......',
        '...HSSMMSH......',
        '...HSSSSSH......',
        '...HHMMHHH......',
        '....VVVVV.......',
        '...VVTTTTV......',
        '...VVTTWTTV.....',
        '...VVTTTTTV.....',
        '...VVVVVVV......',
        '....VVVVV.......',
        '..3333333333....',
        '.3332222223334..',
        '..33333333334...',
    ],
};
