# Chat + Chart AI dock — visual reference and gap list (2026-10-04)

The user's brief: the main Chat surface and the Chart AI dock read as **messy,
not minimal**. This doc pins the live references the fix is measured against
and the concrete gaps, so the cleanup is a diff against evidence rather than a
mood.

## The references (live, captured 2026-10-04)

| Reference | What it is | Where |
|---|---|---|
| `reference/hermes-desktop-live.png` | A **real Hermes Desktop capture** from `NousResearch/hermes-agent` (`apps/desktop/pr-assets/`) — full app, light theme | cloned from the repo at HEAD |
| `reference/dsh-settings-live.png`, `dsh-settings-form-live.png` | **Real DeepSeek-harness captures** from `deepseek-ai/deepseek-harness` (`docs/user/guide/`) — settings, light theme | cloned from the repo at HEAD |
| Source-of-truth prose | `hermes-agent/apps/desktop/DESIGN.md`, `deepseek-harness/packages/client/ui-{layout,conversation,chat,sidebar-right}/README.md` | cloned |

Live *running* UIs were attempted and are honestly marked: DSH's web client
refuses bare Vite (`apps/web/vite.config.ts` — "not a standalone application";
it needs the `dsh` runtime, which needs their packaged host build), and Hermes'
renderer Vite dev server boots but mounts an empty root in a plain browser
(no Electron preload bridge — verified: `#root` has zero children, no
`window.hermes`). The repo captures above are the live visual ground truth; the
package READMEs are the ground truth for the CHAT/dock surfaces, which ship
without screenshots.

### What the references actually say (verified, quoted)

**Hermes — `DESIGN.md`:**
1. "**Flat, not boxed.** No card-in-card, no divider borders inside a panel.
   Group with whitespace and a single hairline, never nested rounded boxes."
2. "Borderless elevation for floating panels" — shadow token + hairline, never
   framed boxes.
3. "**Chat is the home surface.** The transcript and composer stay primary;
   tools, previews, files, review, and terminal complement the conversation."
4. Panel titlebars: "**No dividers between rows** unless the list genuinely
   needs them; prefer spacing."
5. In the live capture: the empty state is a **centered serif wordmark, one
   subtitle line, and ONE floating composer pill** — nothing else above the
   fold. The sidebar is **text-first**: rows are words, not an icon column.
   One hairline status bar runs along the bottom edge, tiny text, ~11px.

**DeepSeek harness — package READMEs:**
- "**The panel has no header row.** Its two controls — the presentation switch
  and the collapse button — ride the kit's chrome seat at the far end of the
  top-right pane's tab strip, so the strip is the panel's whole top edge."
  (`ui-sidebar-right`)
- "**The panel takes the conversation's ground colour and content font sizes
  rather than a raised layer of its own: it is a column of the page, not a
  card over it.**"
- "**A collapsed Sidebar therefore costs the conversation nothing: no rail, no
  width**" — the reopen button lives in the conversation header's corner seat.
- Completed-turn action footer "starts 20px below prose; visible only on the
  latest Turn when its final visible content is a reply; historical Turns
  reveal actions on hover." (`ui-chat`)
- Frame: sidebar 264–420px (default 280), below 1024 auto-collapsed; the right
  panel opens at 45% of the viewport, then retains pixel width capped at 70%.

## August, side by side (captures: `reference/august-*-before.png`)

| # | Gap | Reference rule it breaks | Fix | Status |
|---|---|---|---|---|
| 1 | **Dock paints three colored pills** (1D Bullish / 15m Bullish / Above VWAP) as permanent chrome above the transcript | Hermes #1 (whitespace + one hairline, not chips); DSH StateDot is a 6px dot beside quiet text | `BiasChips` becomes ONE quiet meta line — tone on a small dot, text `text-ui-dense` zinc-400, middot separators | done |
| 2 | **Dock header carries 6 icon buttons** + status dot + brand + session title on one 370px row | DSH "no header row" (controls ride the tab strip); Hermes titlebar carries few controls | keep (functions stay), but brand `shrink-0` + session title truncates; controls sit tight right — already applied earlier today | done |
| 3 | **Symbol named twice, two formats**: composer strip left `BTC/USDT`, right `BTCUSDT · 15m` (pre-packet state) | Hermes "one action, one home"; silence beats duplication | right side shows the **interval alone** until a packet exists (`ctx HH:MM PHT` after) | done |
| 4 | **"Scan → skills" chip wraps to two lines** in the 370px dock — reads as broken | Hermes #1 | `whitespace-nowrap` + `shrink-0` on the composer's text chips | done |
| 5 | **Dock is a raised card over the page** (`bg-zinc-900/40` + border over the page ground) | DSH "a column of the page, not a card over it" | dock background transparent; the single hairline border stays | done |
| 6 | **Identity twice on the Chat surface**: nav rail account row (name + initial + Settings) AND the agents-rail footer (name + initial + status dot) | Hermes "one action, one home" (one account surface) | agents-rail footer becomes a **status line only** — the desk-status dot (tested, load-bearing) + "Ready"/"No provider"; the name is gone | done |
| 7 | Composer card sits on a raised `bg-zinc-800/70` + `shadow-lg` inside the dock, on the page ground | Hermes #2 (borderless elevation for floating panels only; the composer IS the primary surface, not a floating card) | softened: card keeps one hairline, drops the heavy shadow, ground = raised surface token | done |

### Deliberately NOT done

- **The Chat surface's second column** (the agents rail beside the nav rail).
  Two sidebars is the biggest remaining noise, but removing it is an IA
  decision, not a restyle: agents/rooms/conversations need a home. Recorded as
  a Phase-3 candidate, not hidden.
- **The empty-state quick-prompt chip cloud** (5 chips, 3 rows). Hermes shows no
  chips at all; DSH names its emptiness. The chips are August's affordance for
  the desk — keep, cap at the first 3 until a follow-up decides the set.
- **The dock header icon set** (eye/copy/+/history/⋯/×). DSH would move all of
  them into one "⋯" menu; that's function-preserving but a real restructure of
  TradeChatPanel — its own pass.

## The August captures to judge the result against

- Before: `reference/august-chat-before.png`, `reference/august-dock-before.png`
- After this pass: `reference/august-chat-after.png`, `reference/august-dock-after.png`

All four were captured the same way — headless Chromium (the `ui-inspect.cjs`
mechanics), seeded `Probe User`, 1440×900 — so the diff is real and not a
lighting change. After, the dock's pill row is one quiet line, the symbol
appears once, the composer chips sit on one line, the dock shares the page
ground, and the Chat surface shows one identity row instead of two.
