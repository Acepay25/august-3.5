# Desk view — floor layout

The 2D floor uses a 960×540 reference canvas inside the dialog. The dialog
itself stays responsive (CSS `aspect-ratio` + `max-width: 95vw`). Coordinates
are normalized 0..1 over the reference canvas; the renderer multiplies by the
measured container size on mount/resize.

## Stage (always rendered)

- **Backdrop band** (y: 0.00–0.18): coin name, phase strip, run-contract
  ladder, exchange map, FPS/perf micro-readout.
- **Floor canvas** (y: 0.18–0.86): the room. `position: relative`; seats
  are `position: absolute` with `left: x%`, `top: y%`.
- **Foreground rail** (y: 0.86–1.00): inline steer input, verdict card,
  close/zoom controls.

## Seat positions (role -> anchor)

| Role preset    | Anchor (x, y) | Why                                              |
|----------------|---------------|--------------------------------------------------|
| `risk`         | (0.10, 0.55)  | Left wing — Risk owns the veto, deserves a flank. |
| `macro`        | (0.18, 0.32)  | Upper-left — macro frames the room.              |
| `technical`    | (0.32, 0.30)  | Upper-center-left — eyes on the candles.         |
| `sentiment`    | (0.18, 0.78)  | Lower-left — the floor pulse.                    |
| `moderator`    | (0.50, 0.55)  | Center — referee; speaks last.                   |
| `followup`     | (0.78, 0.32)  | Upper-right — post-mortem / re-entry lens.       |
| `postmortem`   | (0.86, 0.55)  | Right wing — the autopsist.                      |
| `execution`    | (0.78, 0.78)  | Lower-right — fills the order when the verdict lands. |

Roles fall through to a 5-seat arc when fewer actors are present (the layout
prefers the anchors defined above; missing anchors are simply empty). For
an over-staffed 6+ actor debate, the remaining actors fan out to the
remaining anchors in the order the shared builder emits them.

## Pixel-art avatar (procedural, 16×20 grid)

Each role preset is a fixed tuple of `[skin, hat, accent]`. The renderer
draws:

1. A 16-wide × 20-tall pixel grid scaled by `--avatar-px` (default 6 → 96×120).
2. A backdrop desk tile (88×40, dark zinc) drawn at the seat anchor.
3. A monitor tile (28×18) drawn on the desk — flickers while `live`.
4. The avatar body — head, shoulders, optional cap/visor, a name plate.
5. A status pip (top-right of the desk) — pulsing for `live`, still for `speaking`.

Pixel CSS uses `image-rendering: pixelated` + `shape-rendering: crispEdges`.
We use a hand-built pixel grid (not a sprite sheet) so there is no licensing
risk and the avatars are runtime-tunable.

## Speech bubbles

A `SpeechBubble` mounts above the seat whenever the seat has fresh speech.
The bubble fades after 4 s or whenever any OTHER seat emits speech. The
bubble tail points at the seat anchor. A `CONVICTION: NN` line in the
speech renders as a small chip pinned to the bubble corner.

## Inline steer + verdict card

- Steer input rides in the foreground rail when at least one seat is
  `live`. Enter queues the note for the currently-selected seat.
- Verdict card slides up under the moderator anchor when the message
  settles and has a `direction/confidence/grade` on `analysis`.
