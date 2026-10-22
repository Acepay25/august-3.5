# hermes-agent :: hermes-skills-optional

**Files in shard:** 857 (read: see status TSV, skipped with reason: see status TSV)
**What this shard covers:** the `optional-skills/` tree of the Hermes Agent repository — 22 skill
categories (autonomous-ai-agents, blockchain, communication, creative, data-science, devops,
dogfood, email, finance, gaming, health, mcp, migration, mlops, payments, productivity, research,
security, smart-home, social-media, software-development, web-development, yuanbao) that ship with
the repo but are NOT copied into `~/.hermes/skills/` at setup; a user opts in per skill
(`hermes skills browse` / `hermes skills install`). Each skill is a folder with a `SKILL.md` carrying
YAML frontmatter (`name`, `description`, `version`, `platforms`, `required_commands`,
`metadata.hermes.tags`), optional `references/`, and optional `scripts/`. The overwhelming majority
of the shard is documentation-as-behaviour: the SKILL.md files encode procedures, verification
steps and pitfalls as executable prose for an LLM. The load-bearing code in this shard is the
set of stdlib-only Python/Node helper scripts that the SKILL.md files call (market-data clients,
post-trade review, watchers, evidence store, ledger/storage tiers, video pipeline tooling, AST
helper, migration script).

**How to read this shard:** the shard is 11.6 MB across 857 files. It was read in batches: every
`SKILL.md`, every reference and every script was opened. `source` files were read in full or, where
the file exceeded ~30 KB, read via a full symbol/def index plus targeted reads of the load-bearing
regions (the exact regions are named in the entry). Very large single-purpose reference dumps
(>120 KB, e.g. model-card tables, LaTeX style files, generated paper templates) were catalogued by
name, size and head, not read line by line — each such file is marked `skipped` in the status TSV
with that reason. There are no `assets`/binary files other than the four paper-template PDFs and one
PNG.

---


## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `optional-skills/blockchain/solana/scripts/solana_client.py` (source, 698 lines, 26 KB)
- **Purpose:** stdlib-only Solana JSON-RPC + CoinGecko CLI; 8 subcommands (`stats`, `wallet`, `tx`,
  `token`, `activity`, `nft`, `whales`, `price`) that turn raw RPC into priced, labelled, filtered
  JSON for an LLM to read.
- **Key abstractions:** `rpc()` / `rpc_batch()` (JSON-RPC transport with 429 retry),
  `KNOWN_TOKENS` + `_SYMBOL_TO_MINT` (static symbol registry so 25 common tokens need no network
  call), `fetch_prices(mints, max_lookups=20)` (per-mint CoinGecko lookups, capped, 1 s apart),
  `cmd_*` functions that each `print_json(...)` and return `None`.
- **Data flow:** CLI arg → `rpc()` → raw JSON → normalise into a flat dict → optional CoinGecko
  price enrichment → dust filter → sort → limit → `print_json`.
- **Non-obvious design decisions:**
  - `KNOWN_TOKENS` is a **hardcoded symbol table** (`solana_client.py:40-66`): the common path
    (label a token) never touches the network; only unknown mints cost a CoinGecko call.
  - **Price lookup is capped and paced** (`fetch_prices`, `solana_client.py:175-197`): CoinGecko
    free tier has no batch endpoint for Solana, so it is `max_lookups` individual requests with a
    1-second sleep between them, and unknown tokens are sampled (first 15) rather than all.
    The wallet command prioritises known mints before unknown ones so the cap lands on the
    tokens that matter.
  - **Dust is filtered but still counted** (`solana_client.py:329-337`): filtered dust is not
    discarded silently — it is summed into `dust_filtered.total_value_usd` and folded back into
    `portfolio_total_usd`. The total is therefore honest even though the list is short.
  - **"Hidden" is reported, not hidden** (`tokens_hidden` field): truncation is surfaced as a
    number in the output, so the model cannot claim the portfolio is complete.
  - **The NFT heuristic is stated in the output** (`cmd_nft`, `solana_client.py:543`): the JSON
    carries `"note": "Heuristic only. Compressed NFTs (cNFTs) are not detected."` — the tool
    declares its own limits to the reader.
- **Edge cases & failure handling:** 429 is retried with linear backoff (1.5 s × attempt) on both
  HTTP and RPC-error paths; other HTTP errors and `URLError` exit with a message; `sys.exit` is
  used for RPC-level failures (a hard stop, not a silent None). `getTransaction` for an old
  signature exits with "may be too old for public RPC history". Price lookup failure leaves
  `price_usd: None` rather than zero, so "unknown" is distinguishable from "free".
- **Surprising:** the whale detector reconstructs sender/receiver by *scanning* the account list
  for the first account whose balance fell by the threshold (`cmd_whales`, `solana_client.py:571-577`)
  — it is a heuristic pairing, not an instruction-level decode; the `note` says "latest block only".
  `rpc = _rpc_call` is a back-compat alias kept at module level.

#### `optional-skills/blockchain/hyperliquid/scripts/hyperliquid_client.py` (source, 1659 lines, 60 KB)
- **Purpose:** read-only Hyperliquid `/info` client: 12 commands, including **`review`** — an
  automated post-trade review — and **`export`**, a versioned normalised dataset for backtesting.
- **Key abstractions:** `_post_info()` (transport, 2 retries), `_normalize_*()` family (one per
  payload type: candles, fills, orders, positions, funding, book levels), `run_*` functions
  returning a **dict payload** and `render_*` functions returning a **string** — the CLI has two
  parallel renderers and `--json` prints the same payload.
- **Data flow:** `run_review` → `userFillsByTime` → normalise → group by coin →
  `_build_coin_review` per coin (which itself calls `_market_context_for_coin` → candles +
  funding) → `_review_findings(summary, coin_reviews)` → a capped list of human-readable findings.
- **Non-obvious design decisions:**
  - **`_review_findings` is a fixed heuristic ledger, not a model call**
    (`hyperliquid_client.py:706-762`). It encodes six specific trading failure modes:
    (a) `outcome_fill_count == 0` → "most fills look like opens or adjustments, so
    realized-outcome review is limited until positions close"; (b) net PnL after fees negative;
    (c) **fee drag** — `total_fees / |realized_pnl| >= 0.25` → "fees consumed X% of absolute
    realized PnL, so execution efficiency is materially affecting results"; (d) fees non-trivial
    with flat PnL → "churn without enough edge"; (e) **`fill_count >= 20 and net_after_fees < 0
    and win_rate < 45` → "activity was high relative to results, which suggests overtrading"**;
    (f) **counter-trend detection** — losses while leaning short into a rising window (> +2%) or
    long into a falling window (< −2%) → "losses came while leaning short into a rising market
    window". This is a *behavioural* diagnosis separated from the *outcome* number.
  - **The findings list is capped at 6 and de-duplicated** (`return deduped[:6]`) — the review
    cannot grow into a wall of text, and the same finding never appears twice.
  - **`_safe_info_query` swallows `SystemExit`** (`hyperliquid_client.py:613-618`) so a missing
    market context degrades the review to "no context" rather than killing the whole review.
  - **`export` writes a versioned, reproducible dataset**: `schema_version:
    "hyperliquid-market-export-v1"`, an explicit `window` with `start_time_ms`/`end_time_ms`, and
    `--end-time-ms` so the same window can be regenerated byte-for-byte
    (`hyperliquid_client.py:1044-1100`). The SKILL.md adds the caveat that the export "is a
    normalized dataset, not a backtest engine. You still need your own slippage/fill model."
  - **A "heuristic" label on the review itself**: the SKILL.md warns "The `review` command is
    heuristic. It cannot reconstruct intent, order placement quality, or true slippage from fills
    alone" (`hyperliquid/SKILL.md`, Pitfalls) — and it says to judge **decision quality separately
    from outcome quality**.
- **Edge cases & failure handling:** `_safe_float` converts any bad value to `None`; win rate is
  `None` (not 0) when there are no outcome fills; `_average` ignores `None`s; `_limit_items` caps
  every list. Perps vs spot is decided by `_is_spot_coin` (contains `/` or starts `@`), and funding
  history is only fetched for perps.
- **Surprising:** the review computes market context by calling the candles/funding endpoints
  **per coin** inside `_build_coin_review` — N extra network round trips for N coins, with no
  batching. It is the price of per-coin context.

#### `optional-skills/blockchain/evm/scripts/evm_client.py` (source, 1508 lines, 56 KB)
- **Purpose:** read-only EVM client across 8 chains — 14 commands, stdlib only, including a
  hand-rolled keccak256 so ERC-20 reads work with no dependencies.
- **Key abstractions:** `CHAINS` registry (chain → rpc/native/coingecko/explorer/decimals),
  `KNOWN_TOKENS` (~30 per chain), `GAS_ESTIMATES`, a `DISPATCH` table mapping command name →
  function, and `print_json` as the single output path.
- **Data flow:** argparse → `DISPATCH[cmd]` → `rpc_call`/`rpc_batch` → `eth_call_erc20` (manual
  ABI encode) → normalise → `print_json`.
- **Non-obvious design decisions:**
  - **A pure-Python keccak256 is implemented in-file** (`_keccak256`, `evm_client.py:444`) so
    `balanceOf`/`decimals`/`symbol` can be read with `urllib` alone. Zero-dependency is a stated
    design constraint, repeated in the SKILL.md.
  - **`_http_post`/`_http_get` retry 5 times with backoff on 429/5xx** — the transport is the
    only place with retry policy.
  - **`rpc_batch` batches up to 10 calls** (`evm_client.py:405`); `cmd_multichain` runs the 8
    chains in **parallel threads** (`cmd_multichain`, `evm_client.py:1086`) — and the SKILL.md
    admits this "can trigger rate limits on public RPCs".
  - **The output is JSON-only**: `main()` catches every exception and emits
    `{"error": str(e)}` with exit 1 (`evm_client.py:1483-1506`). There is no human-readable
    renderer, unlike the Hyperliquid client — the client is a machine surface, the SKILL.md is the
    human surface.
- **Edge cases & failure handling:** `require_address`/`require_txhash` validate `0x` prefix,
  length and hex; **EIP-55 checksum casing is deliberately NOT enforced** (SKILL.md Pitfalls) —
  the client accepts any-case hex. `KeyboardInterrupt` exits 130 with
  `{"error": "Interrupted by user"}`.
- **Surprising:** two public single-endpoint dependencies (ensideas.com for ENS, 4byte.directory
  for tx decoding) have **no fallback** — the SKILL.md states that if they are down the command
  fails and you should "re-run later". And the L2 gas estimate is explicitly **L2-execution only**,
  missing the L1 data-posting component.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/DESCRIPTION.md` | Why 100+ skills are *optional*: niche integrations, experimental features, heavyweight deps — "by keeping them optional, we keep the default skill set lean". Pins the discover→install flow (`hermes skills browse` / `search` / `install`). |
| `optional-skills/autonomous-ai-agents/DESCRIPTION.md` | One line: external coding-agent CLIs delegated to for independent coding tasks. |
| `optional-skills/autonomous-ai-agents/agent-merge-conflict-arbiter/SKILL.md` | **Multi-agent arbitration protocol.** A neutral third party resolves conflicts between two agents' branches because "agents resolving conflicts against a peer's work reliably either overwrite the peer or abandon their own change". Pins three hunk classes (disjoint-intent / same-question-different-answer / superseded), an **impartiality contract** (never favour the spawning side; touch only conflicted regions), and a hand-back summary that must enumerate *every* hunk decision so a human can veto a design call. Says: if intents tie, **escalate rather than guess**. |
| `optional-skills/autonomous-ai-agents/antigravity-cli/SKILL.md` | Operator guide for the Antigravity `agy` CLI. Pins the **orchestration boundary**: Antigravity is "a worker execution backend or third-opinion reviewer — an execution detail owned by the agent/profile running a task, NOT a first-class orchestration primitive". Also: `--always-approve` only for write autonomy, omitted for read-only audits. |
| `optional-skills/autonomous-ai-agents/antigravity-cli/references/cli-docs.md` | Condensed upstream CLI docs: install, keyring-first auth (browser fallback), permission modes (`request-review`/`always-proceed`/`strict`/`proceed-in-sandbox`), sandbox default `false`, and "malformed JSON falls back to defaults for broken actions". |
| `optional-skills/autonomous-ai-agents/blackbox/SKILL.md` | Multi-model delegation to the Blackbox CLI. Notable: a **judge model** picks the best of several models' outputs; checkpoints (`--resume-checkpoint`) allow resume; `sessionTokenLimit` in `.blackboxcli/settings.json`; `pty=true` is mandatory or the CLI hangs. |
| `optional-skills/autonomous-ai-agents/dynamic-workflow/SKILL.md` | **The orchestration contract of this repo.** Two layers: `execute_code` for deterministic work, `delegate_task` for LLM-judgment work. Pins: adversarial convergence (N independent attempts with *different framings* → merge/dedupe with agreement counts → refuters that must break each claim → surface only survivors, cap 3 rounds); the campaign recipe (one shared `BRIEF.md`, exclusive file ownership, commit per verified step, fleet size 12-16, integration per round on one branch, `git rev-list --count` must be 0 for every branch, forward-port at the end); and hard rules such as "structured output goes to files, never the `summary` field (it truncates under load)". |
| `optional-skills/autonomous-ai-agents/grok/SKILL.md` | Grok Build CLI guide. Pins headless `-p` as the preferred mode, `--no-auto-update` in automation, `--always-approve` only for write autonomy, tmux capture for TUI monitoring, worktree fan-out for parallel issue fixing, and a **read-only audit pattern** (clone to temp, omit `--always-approve`, demand "markdown only, no preamble"). |
| `optional-skills/autonomous-ai-agents/honcho/SKILL.md` | Cross-session user-modelling memory. Pins: three orthogonal knobs (cadence / depth / level), cold vs warm prompt selection, five bidirectional tools with an explicit cost table, `contextTokens` budget where "the session summary is trimmed first, then the representation, preserving the card", and **memory-context sanitisation** (strips XML/HTML tags, escapes delimiter sequences) to stop user-authored conclusions corrupting the injected prompt block. |
| `optional-skills/autonomous-ai-agents/openhands/SKILL.md` | OpenHands headless wrapper. Pins `--override-with-envs` as mandatory (without it the CLI ignores env vars and *hangs* waiting for first-run setup), the JSONL event schema (`MessageEvent`/`ActionEvent`/`ObservationEvent` discriminated by `kind`), the resume-id dash/no-dash mismatch, and that headless hardcodes always-approve so `--llm-approve` is an argparse error. |
| `optional-skills/blockchain/evm/SKILL.md` | EVM client contract: 14 commands, 8 chains, stdlib only. Pitfalls are load-bearing: L2 gas excludes the L1 data-posting fee; single-endpoint dependencies (ENS, 4byte) have no fallback; EIP-55 casing not enforced; `wallet`/`allowance` only know ~30 tokens per chain. |
| `optional-skills/blockchain/hyperliquid/SKILL.md` | Hyperliquid contract: 12 commands, read-only, no key. Pins `review` and `export` as the two analysis-grade commands, warns `review` is heuristic, and tells the agent to judge decision quality separately from outcome quality. |
| `optional-skills/blockchain/solana/SKILL.md` | Solana contract: 8 commands, CoinGecko enrichment optional (`--no-prices` for speed). Declares every heuristic limit up front (NFT detection = amount 1 + decimals 0; whale detector = latest block only; public RPC keeps ~2 days of history). |
| `optional-skills/communication/DESCRIPTION.md` | Communication/decision frameworks for proposals, trade-off analysis and stakeholder-ready recommendations. |
| `optional-skills/communication/one-three-one-rule/SKILL.md` | **1-3-1 decision brief format**: one Problem sentence, exactly three Options (A/B/C with pros and cons), one Recommendation, Definition of Done, Implementation Plan — with the rule that all three revise together if the user picks another option. Explicitly not for single-obvious-answer questions. |
| `optional-skills/creative/ai-presenter-video/LICENSE` | MIT licence text (copyright holder name only; no PII reproduced). |
| `optional-skills/creative/ai-presenter-video/SKILL.md` | **The strongest human-in-the-loop gate in the shard.** A job-state machine on `job.json` with consent flags under `input.*` (`rights_confirmed`, `adult_presenter_confirmed`, `remote_upload_approved`, `voice_clone_approved`), a separate `manual_input_review.*` block, and `preflight.py` that distinguishes `errors` (block everything) from `remote_blockers` (block only remote generation — local work may proceed). Pins: pilot before full run, retry ceiling 3, "preserve provider request bodies and task IDs … poll interrupted work before resubmitting — avoid double billing", and "do not claim completion until the final files fully decode". |
| `optional-skills/creative/ai-presenter-video/assets/job.template.json` | The job schema itself: `schema_version`, `state`, `input` (consent flags), `creative` (language/duration/aspect/style), `voice` (lufs targets), `plan` (cost, `price_evidence_date`, `pilot_approved`, `paid_generation_approved`, `retry_ceiling`), `capabilities` (7 slots), `artifacts` (one path per output), `qa` (one report per gate). |
| `optional-skills/creative/ai-presenter-video/references/editing.md` | Timeline contract: every clip keeps authored start, authored duration and source-media start; the locked narration is the master clock; video sources stay muted; captions get ~40 ms lead / 120 ms tail; measure loudness from the *rendered* file (mono duplicated to stereo measures ~3 LU louder). |
| `optional-skills/creative/ai-presenter-video/references/generation.md` | Capability routing table (voice / presenter / motion / lip-sync repair / ASR / compositor / encoder QA) with acceptance priority per capability; a **billing-and-pilot gate** (state uploads, seconds, price-or-unknown, pilot size, retry ceiling before the first paid call); a 7-part presenter prompt structure; "Do not fabricate product evidence. Label conceptual visuals clearly." |
| `optional-skills/creative/ai-presenter-video/references/qa-recovery.md` | Acceptance gates for inputs/audio/presenter/composition, and a recovery playbook per fault class — including "Three rejected paid candidates → stop, preserve candidates, prompts, task IDs, cost and rejection notes, summarise the recurring failure and the single variable proposed for the next attempt". |


### `optional-skills/creative/anatomy/` — the isometric-figure kit (rows 28-95)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/anatomy/LICENSE.txt` | MIT licence text for the upstream `wheresryan22/anatomy` port. |
| `optional-skills/creative/anatomy/SKILL.md` | The "explainer as a machine you could build" skill: output is a standalone HTML/SVG/React figure where "every number the figure shows comes from the same model that moves its parts". Pins the rule **never build inside the skill directory** (so `hermes skills update` does not flag it modified) and "start from the closest example, copy it, rename it". |
| `optional-skills/creative/anatomy/examples/arcade-cabinet/arcade-cabinet.css` | Theme tokens + state selectors for the arcade figure (`[data-on]`, `[data-blink]`, `[data-hot]`, `[data-down]`), plus a screen-reader-only `.ac-sr` class. |
| `optional-skills/creative/anatomy/examples/arcade-cabinet/build.mjs` | 714-line builder: `put/board/prism/box/turned/disc/ball/cable` helpers over the kit's iso projection; coin-stack physics (`STACK_AT`, `chuteZ`), a coin chute mesh, and a PCB with chips. |
| `optional-skills/creative/anatomy/examples/arcade-cabinet/live.js` | 597-line runtime: `newGame/insertCoin/drawCoins/wireStep/gameStep/tourStep` — a deterministic tick loop with a fixed-step coin-drop model (`ROLL_A = (2/3)*GRAV*SN`). |
| `optional-skills/creative/anatomy/examples/arcade-cabinet/parts.mjs` | `makeParts(k, G, P, D)` — the reusable parts factory for the cabinet. |
| `optional-skills/creative/anatomy/examples/arcade-cabinet/screen.mjs` | `SCREEN` — the marquee/screen geometry as a module. |
| `optional-skills/creative/anatomy/examples/desk-computer/build.mjs` | 435-line builder for the desk computer: recessed wells, CRT, keyboard with per-key press, and a `type/erase/enter/write` terminal emulation. |
| `optional-skills/creative/anatomy/examples/dial-indicator/build.mjs` | 275-line builder for the dial gauge: rails, fixture, carriage, plunger, dial with `needleAt(turn)`; an idle "tour" that steers the carriage and resets after 3.6 s. |
| `optional-skills/creative/anatomy/examples/raptor-engine/build.mjs` | 938-line builder for the rocket engine: real throat and bell contours (`throat(s)`, `bell(s)`), turbopump plumbing, flanges, bolts, harness routing, and thrust (`BACK_TF` from exit Mach × area). |
| `optional-skills/creative/anatomy/examples/raptor-engine/live.js` | 907-line runtime: burn-step physics (`stepBurn`), plume painting, take-apart interaction, and a `wording()` that swaps the hint text for touch vs pointer. |
| `optional-skills/creative/anatomy/examples/raptor-engine/raptor.css` | Theme tokens for the engine: lamp states (`off/on/glow/armed`), rim colours, flash ramp, deck ramp, with a light-theme override block. |
| `optional-skills/creative/anatomy/examples/ripple-tank/build.mjs` | 558-line builder for the ripple tank: lamp/post/arm, vcoil, ripple spring, dipper, knob and needle mapped to frequency. |
| `optional-skills/creative/anatomy/examples/ripple-tank/live.js` | 579-line runtime: `record/remember/put` history buffer, SVG fallback renderer and a WebGL renderer (`drawGl` / `drawSvg` / `drawFallback`). |
| `optional-skills/creative/anatomy/examples/ripple-tank/model.mjs` | The **pure physics model**: `WATER` constants, `omegaOf`, `wavenumberOf`, `nodalCount/nodalVertices`, `magnificationOf`, `causticOf`, `amplitudeOf`, `focusOf`, `stateOf`, `readoutOf`. No DOM — the same model drives picture, readout and aria text. |
| `optional-skills/creative/anatomy/examples/ripple-tank/ripple.css` | Stage/canvas/fallback CSS with `data-gl` toggling the SVG fallback off. |
| `optional-skills/creative/anatomy/examples/spot-plate/art.tsx` | `LiquidArt` — the React/SVG static art for the spot plate (back plate, deck, front). |
| `optional-skills/creative/anatomy/examples/spot-plate/drops.ts` | 543-line drop-merging geometry: field sampling, iso-contour rings, Douglas-Peucker simplification, signed-area orientation, hidden-region computation, solid/glass shape building. |
| `optional-skills/creative/anatomy/examples/spot-plate/fan.ts` | `fanOf(merge)` — the feeler-blade fan pose as a function of the merge parameter. |
| `optional-skills/creative/anatomy/examples/spot-plate/figure.tsx` | `SpotPlateFigure` — the public figure component. |
| `optional-skills/creative/anatomy/examples/spot-plate/geometry.ts` | Layout + part geometry constants and the `LABEL` alt-text string (a full description of the figure for screen readers). |
| `optional-skills/creative/anatomy/examples/spot-plate/live.tsx` | 339-line React runtime: `Glass` component, blade node application, and the `LiquidLive` client component. |
| `optional-skills/creative/anatomy/examples/spot-plate/rig.ts` | 230-line model: `RADII`, `GAPS`, `MERGE`, the merge→seen-gap function, well layout, and `fieldOf/halfWidth/neckOf`. |
| `optional-skills/creative/anatomy/examples/spot-plate/spot-plate.css` | Theme tokens and the `ew-resize` drag affordance. |
| `optional-skills/creative/anatomy/examples/test-rig/art.tsx` | `StretchArt` — 196 lines of static SVG art (base, rails, rider, block, frame, rods, carriage, plunger, dial, finger, arm). |
| `optional-skills/creative/anatomy/examples/test-rig/figure.tsx` | `TestRigFigure` — the public figure component. |
| `optional-skills/creative/anatomy/examples/test-rig/geometry.ts` | 305 lines of part geometry (knurls, side arcs, face rings, rulers, floor grid, bar ticks). |
| `optional-skills/creative/anatomy/examples/test-rig/live.tsx` | 511-line React runtime: `tour(t)` hand choreography, `apply(nodes, frame, held)`, `spokenOf(member, pull, held)` — the aria text derived from the same pose as the drawing. |
| `optional-skills/creative/anatomy/examples/test-rig/pose.ts` | 107 lines: `glassOf(pose)`, coil path, `needleOf(lean)`, `frameOf(pose, …)`. |
| `optional-skills/creative/anatomy/examples/test-rig/rig.ts` | 170-line **pure model**: three springs (press/hold/release as stiffness+drag), the rubber-band give law, `step`, `poseOf`, `settled`, `readoutOf`, and `STILL_ENOUGH = 0.1` (the settledness threshold). |
| `optional-skills/creative/anatomy/examples/test-rig/stretch.css` | Theme tokens + `cursor: grab` drag affordance. |
| `optional-skills/creative/anatomy/examples/test-rig/view.ts` | 98 lines of world-layout constants and the projection `P`. |
| `optional-skills/creative/anatomy/examples/turning-dial/build.mjs` | 479-line builder for the 3D turning dial: `turning(P, {recorder})` from the kit, the pawl/wheel/indicator kinematics, `tapAt/breakAt` timings, and layered SVG + canvas output. |
| `optional-skills/creative/anatomy/examples/turning-dial/dial.css` | 10 lines: stage cursor, LED tokens, focus-visible ring. |
| `optional-skills/creative/anatomy/examples/turning-dial/live.js` | 338-line runtime: `readingOf(turn)`, spark particles, a seeded PRNG (`seed*16807 mod 2^31-1`) so the visual is reproducible, and a drag/release interaction. |
| `optional-skills/creative/anatomy/examples/turning-dial/stress.mjs` | 269-line stress scene: a workshop bench with two hands, digit rendering, `follow(values)` and `poses()`. |
| `optional-skills/creative/anatomy/kit/audit.mjs` | 1850-line **geometric audit**: separation tests (GJK/quickSeparate/separate), swept-volume checks, folding/penetration detection, `folds(routes, P, {fold, turn, pinch})`, `supports(...)` (grounding + touch), `linksOf`, and `orbitReport`/`orbitFailures` — a machine-checkable "do the parts collide" gate. |
| `optional-skills/creative/anatomy/kit/canvas-painter.mjs` | 722-line Canvas2D painter: compiles SVG parts into canvas draw calls, with a scratch layer, colour probing, matrix handling and an `unsupported` list. |
| `optional-skills/creative/anatomy/kit/gl-shared.mjs` | 184 lines: shared GLSL (iso + turn shaders), `glslPose`, `glCamera`, `glLayer` (WebGL layer with uniform binding, `maxRatio` clamp, `onError`), and `settle(state, target, dt, seconds, calm)` easing. |
| `optional-skills/creative/anatomy/kit/gl.mjs` | 184 lines: the same shared GL surface (appears to be a duplicate of `gl-shared.mjs` with the GLSL inline) — see Weak spots. |
| `optional-skills/creative/anatomy/kit/iso-kit.mjs` | 674-line **core kit**: projection (`cameraOf`, `iso`, `depthOf`), solid generation (`extrude`, `slabOf`, `cylinder`, `knurl`, `coil`, ticks), SVG emitters (`solidSvg`, `lineSvg`, `dotsSvg`, `wireSvg`, `faceTextSvg`), and page/card HTML wrappers (`plateHtml`, `pageHtml`, `ISO_CSS`). |
| `optional-skills/creative/anatomy/kit/iso-kit.ts` | 842-line TypeScript twin of `iso-kit.mjs` — the same API, typed. Duplication is deliberate (the `.mjs` is the no-build path). |
| `optional-skills/creative/anatomy/kit/iso.css` | 106 lines: the whole design-token set (`--anatomy-*` colours, weights, easing, mono stack, elevation shadow) for dark and light. |
| `optional-skills/creative/anatomy/kit/lathe.mjs` | 1184-line **lathe/extrusion engine**: meridian handling, `curveRuns`, `smoothRows`, `lathe`, `outlineOf`, `saddleOf`, `prismOf`, `sphereOf`, `ribsOf`, `dotsOf`, `fillet`, `pathLength`, `cut`, `pointAlong` — i.e. a real solid-modelling kernel written for figures. |
| `optional-skills/creative/anatomy/kit/react/draw.tsx` | 204-line React SVG primitives: `Solid`, `Line`, `Wire`, `Dots`, `FaceText`, `IsoFigure`, `Plate`. |
| `optional-skills/creative/anatomy/kit/react/live.tsx` | 125-line React runtime: `useStillness` (reduced-motion), `useInView`, `Stage`, `useReadout`, `useLoop`, `follow`, `spring`. |
| `optional-skills/creative/anatomy/kit/tube.mjs` | 306-line tube/cable builder: `runsOf`, `crossingsOf`, `tubePieces` (with gaps/breaks/caps/stripes/rings), `tubeSvg`. |
| `optional-skills/creative/anatomy/kit/turn-audit.mjs` | 1096-line **3D audit**: `eventsOf(T, layer)`, polygon clipping/area, Hausdorff-ish shape comparison, tone rasterisation, `visibleChange`, `orbit(T, R, P, options)`, `continuity(...)`, `orbitReport`, and `orbitFailures` (a 16-key failure tally: separation, cycles, forced, swaps, layers, rigid, swept, posed, folds, self, crowding, endon, coverage, depth, continuity). |
| `optional-skills/creative/anatomy/kit/turn-build.mjs` | 1348-line builder for turning groups: `roundedPolygon`, GJK `gjk`, `separate`, `turning(P, {recorder})`, group/part data, state generation (`statesOf`, `tumbleStates`), `sweptGroups`, `proveLayers`, `build(T, {statics, verify, poses, strict})` and `verifyData`. |
| `optional-skills/creative/anatomy/kit/turn-fixed.mjs` | 3800-line "fixed" turn runtime: the same `t3*` family as `turn.mjs` with fixed-precision emission (prisms, round parts, balls, lathes, tubes) — a second, larger implementation of the turning runtime. |
| `optional-skills/creative/anatomy/kit/turn.mjs` | 3610-line turning runtime (`t3*`): camera, poses, roles, prism/round/ball/lathe/tube emitters, hulls, arcs, seams, ribbons, routes. |
| `optional-skills/creative/anatomy/references/3d.md` | 44 KB: the 3D authoring model — part kinds, materials, free groups, hinge chains, painter's order, shaders that follow the turn, and the orbit audit. Marked **beta**: proved on one example, "turn one subject at a time". |
| `optional-skills/creative/anatomy/references/craft.md` | 50 KB: the anti-ugly rules ("Every rule here came from a figure that was rejected or approved by a demanding reviewer"), the parts vocabulary with recipes, tones, painter's order, camera, themes, and pipes. |
| `optional-skills/creative/anatomy/references/kit.md` | 68 KB: the full kit API reference (types, camera, solids, ticks, moving things, SVG strings, card/page, React components, lathe, tubes, audit, WebGL layer, tools, turning groups). |
| `optional-skills/creative/anatomy/references/motion.md` | 22 KB: motion rules — time-based `dt` clamped to 1/30 s, exponential easing to a *target* (never snap), sub-stepped springs, **one loop per figure** writing to the DOM via refs (never re-render React per frame), `IntersectionObserver` with rootMargin 120px (and the bug of reading the *first* entry instead of the newest), `prefers-reduced-motion`, an idle tour after ~1.4 s, and a **live readout derived from the model, not the target** — with a documented failure ("end of stroke · relief 85 bar" where the phase word and the number came from different instants). |
| `optional-skills/creative/anatomy/references/react.md` | 3.6 KB: the server/client split — pure geometry runs on the server, only moving parts ship; `art.tsx` passes static parts as element props to a `"use client"` live component; the "large-page key-warning trap". |
| `optional-skills/creative/anatomy/references/verify.md` | 43 KB: the verification pipeline — headless-Chrome capture (`scripts/capture.mjs`) with `--times/--key/--zoom/--reduced/--theme`, a scripted driver (`drive.mjs`), the orbit audit, close-ups, and "Read every PNG you make: open it and look". |
| `optional-skills/creative/anatomy/references/walkthrough.md` | 5.3 KB: a full worked example — the test rig, 53 solids, showing how the pure model is the single source for the readout, the aria text, the caption numbers and every moving part. |
| `optional-skills/creative/anatomy/references/webgl.md` | 61 KB: the WebGL layer contract — "nothing pops, nothing is cut, and everything sits in the drawing's perspective", the layer stack, the camera contract, ray-marching in the iso camera, tonemap/dither, reduced motion, and the SVG fallback. |
| `optional-skills/creative/anatomy/scripts/capture.mjs` | 244-line headless-Chrome screenshotter (desktop/phone/hover/tour/keys/zoom/reduced-motion/theme). |
| `optional-skills/creative/anatomy/scripts/drive.mjs` | 312-line scripted-session driver (hover → click → type → wait for a phase), for timed or slowed contact sheets and the no-WebGL fallback. |
| `optional-skills/creative/anatomy/scripts/inline-kit.mjs` | 26 lines: inlines the kit scripts into a page by stripping `export ` — the no-build embedding path. |
| `optional-skills/creative/anatomy/scripts/line-ends.mjs` | 273 lines: `lineEnds({select, tolerance, root, mark, least, cover})` — a linter that finds line-end overlaps in a drawing. |
| `optional-skills/creative/anatomy/scripts/lines.mjs` | 31 lines: CLI flag parsing helper. |
| `optional-skills/creative/anatomy/scripts/turn-bench.mjs` | 74 lines: turn benchmark (median timing) with flag parsing. |
| `optional-skills/creative/anatomy/scripts/turn-check.mjs` | 661-line turn checker (headless Chrome, flags, chrome discovery). |
| `optional-skills/creative/anatomy/scripts/turn-fidelity.mjs` | 407-line fidelity checker: `identity(T, P, angles)`, `rounds(T, P, angles)`, `tubes(T, P, angles)` — compares the rendered turn against the intended angles. |

### `optional-skills/creative/ai-presenter-video/scripts/` (rows 23-25) — Tier 1

#### `optional-skills/creative/ai-presenter-video/scripts/preflight.py` (source, 177 lines, 7.2 KB)
- **Purpose:** the gate that decides whether a video job may proceed; it is the mechanical form of the consent flags in `job.json`.
- **Key abstractions:** `probe(path)` (ffprobe), `require_file(value, label, errors)`, `write_atomic(path, text)` (tmp + replace), `main()`.
- **Data flow:** read `job.json` → probe every referenced asset → accumulate `errors` vs `remote_blockers` → write the preflight report back into `job.json` (atomically) → print `ok` / `remote_ready`.
- **Non-obvious design decisions:**
  - **Two severities, not one.** `errors` block everything; `remote_blockers` block only *remote* generation, so local script and audio work may continue. This is what makes a paid pipeline usable on a partially-reviewed job.
  - **The report is written back into the job file**, and the SKILL.md warns "preflight also updates `job.json` in place — re-read it after running rather than editing a stale copy."
  - **Atomic write** (`write_atomic`) so a crash mid-report cannot corrupt the job.
- **Edge cases & failure handling:** a missing file becomes an entry in `errors` naming the label; ffprobe is required (the SKILL.md lists "install ffmpeg first" as a pitfall on a bare box).
- **Surprising:** the same file both *checks* and *records* — a gate that leaves evidence in the artifact it gates.

#### `optional-skills/creative/ai-presenter-video/scripts/init_job.py` (source, 151 lines, 5.4 KB)
- **Purpose:** creates a new job directory and seeds `job.json` from `assets/job.template.json`.
- **Key abstractions:** `absolute_existing(path_text, label)` (resolves and validates a path before it goes into the job), `slugify(value)`, `parse_args()`, `main()`.
- **Data flow:** flags → template copy → fill `input`/`creative` → write `job.json` → print the job dir.
- **Non-obvious design decisions:**
  - **The template is the schema** — `init_job.py` never invents field names, so the template and the script cannot drift.
  - **Consent flags are set by CLI flags at init** (`--rights-confirmed --adult-presenter-confirmed`), and they land under `input.*`. The SKILL.md's loudest pitfall: editing them at the job root "silently does nothing (preflight keeps blocking)".
  - Paths are validated as *existing* at init time, so a typo is caught before any paid work.
- **Edge cases & failure handling:** missing input path → `absolute_existing` refuses; slug collisions are avoided by the slugifier.

#### `optional-skills/creative/ai-presenter-video/scripts/finalize_delivery.sh` (source, 167 lines, 7.0 KB)
- **Purpose:** deterministic delivery: two-pass loudness normalisation, master + share encodes, decode verification, a delivery-report JSON and a nine-frame contact sheet.
- **Key abstractions:** shell-local paths (`MASTER`, `SHARE`, `REPORT`, `CONTACT`), a scratch dir under `${TMPDIR:-${HERMES_HOME:-$HOME/.hermes}/cache/scratch}`, `jq`-driven ffprobe extraction, and a two-pass `loudnorm` (pass 1 measures, pass 2 applies with the measured values).
- **Data flow:** probe source → measure loudness (pass 1) → encode master with `scale=trunc(iw/2)*2` (even dimensions) + `yuv420p` + `fps` → encode share → `ffprobe` both → detect black frames (`blackdetect.log`, `grep -c 'black_start:'`) → write report JSON → extract 9 contact-sheet frames.
- **Non-obvious design decisions:**
  - **Even-dimension scaling** (`trunc(iw/2)*2`) and `yuv420p` are baked into the video filter — a strict encoder-compat rule, not a preference.
  - **The decode check is a gate, not a note**: "a truncated render fails the decode check by design, not by accident."
  - **The loudness target is a constant** (`I=-16:TP=-1.5:LRA=9`) with a measured-offset pass, so the two-pass values are actually used rather than approximated.
  - **The scratch dir is portable** — `${TMPDIR:-...}` rather than a literal `/tmp` (the same rule `dynamic-workflow` states: Termux has no `/tmp` and native Windows breaks on it).
- **Edge cases & failure handling:** `jq`/`awk`/`bash` are prerequisites; black-frame count is reported; a missing input aborts before any encode.


### `optional-skills/creative/auteur/` (rows 102-127) — the anti-slop design system

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/auteur/LICENSE` | MIT licence + upstream provenance (repo, commit hash, date, copyright holder). |
| `optional-skills/creative/auteur/SKILL.md` | The skill hub: three registers (**build** = one excellent surface, **direct** = a cinematic scroll site, **system** = a multi-screen product), one shared taste core. Pins the "commit-sheet" (seven decisions before any code), the mockup gate, "states are the product" (hover/focus-visible/active/disabled/loading/empty/error), and "the skill has looked at its own output" before shipping. |
| `optional-skills/creative/auteur/references/ambient-backgrounds.md` | 6 quiet-texture backgrounds + a zero-motion default, each with a "NOT" trap. The one rule: the background's strongest change must stay weaker than the quietest meaningful foreground element. |
| `optional-skills/creative/auteur/references/assets.md` | Asset production: "**one frame first**" (approve art direction at the cost of one image, then batch) and "**cache everything**" (generation costs money; never regenerate what exists). "Probe with a real round trip, never with a version flag … Read the OUTPUT, not the exit code." Also the degradation ladder and a "frame B is an EDIT of frame A, never a second generation" consistency trick. |
| `optional-skills/creative/auteur/references/build.md` | The standard register's 10-step process: intake → recon → commit-sheet → **mockup gate** (one throwaway hero screen, screenshot, slopscan, get a yes) → skeleton before skin → tokens → build top-down → states → verify → lock the style. |
| `optional-skills/creative/auteur/references/direct.md` | The cinematic register: Phase 0a intake (one message, compact) → 0a.5 recon → 0b screenplay (STORYBOARD) → 0c style gate → asset production → assembly → verification → lock the style. "Every phase below ends with a gate; do not cross a gate that fails." Autonomous runs must write derived answers into the storyboard header's `Assumptions made` field, "not into your own reasoning, where the next session cannot see it". |
| `optional-skills/creative/auteur/references/motion.md` | The resolved motion policy: `ease-in` banned on UI motion; a **frequency × animation** table (100+/day → zero animation; tens/day → near zero; occasional → standard; rare → delight); a duration table; **"any UI transition over 300 ms requires a written justification"**; "if the animation feels slow, shorten the duration first — do not sharpen the curve as the primary fix". |
| `optional-skills/creative/auteur/references/recon.md` | Recon: `refscout` (profile live award sites: real stack, pinned scenes, scroll budget, fonts, palette + screenshots) and `moodboard` (feel). "Never cite a reference you didn't actually see" and never quote a fingerprint the tool marked NO CAPTURE. |
| `optional-skills/creative/auteur/references/scroll-cinema.md` | 61 KB of scroll recipes with a technique-selection table, GSAP/Lenis/Three.js stack defaults, and the "-g 8" encode. |
| `optional-skills/creative/auteur/references/scroll-flight.md` | Photoreal scroll-scrubbed video: "AI clips barely move the camera — the scroll-dolly does the travelling"; the `-g 8` encode; posters taken from the *encoded* clip; and an **SSIM seam gate** (≥0.90 pass · 0.75–0.90 warn · <0.75 FAIL — "an endpoint was a still, not the neighbour's frame — regenerate, don't rationalize"). |
| `optional-skills/creative/auteur/references/system.md` | The multi-screen register. The key table: unit of design changes from section/scene to **component × state**, and the failure mode changes from boredom to **drift** — "screen 7 invents a fourth button". "There is no peak, and hunting for one produces a dashboard with a hero animation nobody wants to sit through twice." A *failure* state is a legitimate answer. |
| `optional-skills/creative/auteur/references/taste.md` | The anti-slop system: "Slop is not ugliness; it is *predictability*" — every visible choice must be traceable to this brand, not the category average. A ban table with escape routes (side-stripe borders, gradient text, glassmorphism, hero-metric grids, eyebrows, uniform reveals) and a category-reflex test. |
| `optional-skills/creative/auteur/references/verify.md` | The acceptance pipeline in cost order: deterministic linter → screenshot journey → numeric rubric. "Paste the linter's final `Summary:` line verbatim into your report — after your LAST edit, not from an earlier run. A remembered result is not a result." Also `chromadiff` against a reference and a "when verification keeps failing" section. |
| `optional-skills/creative/auteur/scripts/chromadiff.mjs` | 129 lines: pixel-diff a render against a reference, reporting chroma/luma deltas; used by the "reference diff" gate. |
| `optional-skills/creative/auteur/scripts/moodboard.mjs` | 240 lines: fetch images from several free sources, dedupe, download, and build a contact sheet plus an index. |
| `optional-skills/creative/auteur/scripts/motionqa.mjs` | 128 lines: motion/performance QA in headless Chrome; distinguishes soft-WebGL advisories from real failures ("run --headed for a real number"). |
| `optional-skills/creative/auteur/scripts/refscout.mjs` | 402 lines: harvest award sites, detect their real library stack from bundle text, count pinned scenes (`.pin-spacer`), and write `design/refs/REFERENCES.md`. |
| `optional-skills/creative/auteur/scripts/shoot.mjs` | 211 lines: the screenshot journey tool; includes `likelyBlank(buf)` — a heuristic that flags a probably-blank capture. |
| `optional-skills/creative/auteur/scripts/slopscan.mjs` | 543 lines: the deterministic linter. 17 named checks: default-font slop, AI gradients, gradient text, `transition: all`, raw scroll listeners, glass cards, clone card grids, em-dash copy, eyebrow-everywhere, cream default, autoplay sound, video without poster, WebGL without reduced-motion, pointer without rAF, plus CSS-block and suppression parsing. |
| `optional-skills/creative/auteur/scripts/source.mjs` | 388 lines: the asset source router (Poly Haven CC0, Iconify, Google Fonts, Openverse CC, Coverr stock video) with a per-source ledger. |
| `optional-skills/creative/auteur/scripts/systemscan.mjs` | 428 lines: the **drift detector** — crawls every route, collects the component inventory, probes focus states (`PROBE_FOCUS`) and builds a component contact sheet, then reports where the screens disagree. |
| `optional-skills/creative/auteur/templates/CINEMA-QA.md` | The cinema QA sheet: every row PASS/FAIL **+ evidence** (metric value or screenshot filename); "Any FAIL loops back to its phase. Ship only on all-PASS." |
| `optional-skills/creative/auteur/templates/COMMIT-SHEET.md` | Seven decisions before the first line of code, each with a ✗ (slop) and a ✓ (bar) example. "A generic answer ('modern, clean') means the decision hasn't been made — stop and make it." |
| `optional-skills/creative/auteur/templates/DESIGN.md` | The style contract, written once after QA passes and read at the start of every later edit: "New work that contradicts this file is wrong even if it looks good in isolation — consistency IS the design." |
| `optional-skills/creative/auteur/templates/STORYBOARD.md` | The film plan: film meta (one feeling, peak scene, assets, assumptions, references), the Arc table (layout family + motion family per scene), per-scene sheets, and a **Gate 0 checklist** (exactly one scene with intensity ≥8; no two adjacent scenes share a layout or motion family; ≤3 motion families on the page; every scene has real copy and a fallback). |
| `optional-skills/creative/auteur/templates/SYSTEM-SHEET.md` | Filled *before* any markup: the route map, the component inventory with **how many variants of each thing are allowed** — "Declaring four button variants and shipping nine is the disease this file exists to prevent" — the state matrix and the density budget. |
| `optional-skills/creative/auteur/templates/scroll-flight-engine.js` | 546 lines: the vendored zero-dependency scroll-scrub engine (`mountScrollWorld`), with seeded particles and injected CSS; solves ~18 shipped-in-anger edge cases. |

### `optional-skills/creative/baoyu-article-illustrator/` + `baoyu-comic/` (rows 129-198)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/baoyu-article-illustrator/PORT_NOTES.md` | The upstream→Hermes port ledger: metadata namespace, trigger mechanism, `AskUserQuestion` → `clarify`, image generation route, reference-image handling, platform support, and what was removed. |
| `optional-skills/creative/baoyu-article-illustrator/SKILL.md` | Illustration workflow over **three dimensions**: Type (information structure) × Style (rendering) × Palette (colour), plus style presets that collapse a triple into one name. Seven steps from detection to finalisation, with an `outline.md` produced *before* any image. |
| `optional-skills/creative/baoyu-article-illustrator/prompts/system.md` | The image prompt template: specifications, core principles, text style, language. |
| `optional-skills/creative/baoyu-article-illustrator/references/palettes/macaron.md` | Palette: warm cream + macaron pastels; accent coral red used "sparingly — one or two elements per illustration". |
| `optional-skills/creative/baoyu-article-illustrator/references/palettes/mono-ink.md` | Palette: black ink on white; "accent colors … total colored pixels must remain under 10% of canvas" — a measurable constraint. |
| `optional-skills/creative/baoyu-article-illustrator/references/palettes/neon.md` | Palette: neon-on-dark, high contrast. |
| `optional-skills/creative/baoyu-article-illustrator/references/palettes/warm.md` | Palette: warm earth tones, "no cool colors (no green, blue, purple)". |
| `optional-skills/creative/baoyu-article-illustrator/references/prompt-construction.md` | Prompt file format (YAML frontmatter + body) and the rule that the `references` field is included **only if the file exists** — a path in the frontmatter with no file is an error. |
| `optional-skills/creative/baoyu-article-illustrator/references/style-presets.md` | Named presets (type+style+palette triples) by content category, with per-dimension override examples. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles.md` | The style gallery (23 styles) plus a **Type × Style compatibility matrix** — a combinatorial guard so an invalid pair is not silently produced. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/blueprint.md` | Style spec: blueprint off-white, grid overlay, engineering-paper feel. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/chalkboard.md` | Style spec: chalkboard black/green-black, dusty texture. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/editorial.md` | Style spec: magazine explainer, white/light-gray, no texture. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/elegant.md` | Style spec: warm cream, fine grain, soft accents. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/fantasy-animation.md` | Style spec: hand-drawn animation, watercolor wash. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/flat-doodle.md` | Style spec: bold black outlines, bright pastels, no gradients. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/flat.md` | Style spec: modern flat, bold shapes, no gradients or shadows. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/ink-notes.md` | Style spec: professional black-ink sketchnoting; includes a comparison table against `sketch-notes` so the two are not confused. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/intuition-machine.md` | Style spec: aged-paper technical briefing with bilingual labels. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/minimal.md` | Style spec: zen minimal, single focal point, generous negative space. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/nature.md` | Style spec: organic earth tones. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/notion.md` | Style spec: minimalist hand-drawn line art (the default). |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/pixel-art.md` | Style spec: 8-bit/16-bit, limited palette, CRT scanline option. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/playful.md` | Style spec: whimsical pastel doodle. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/retro.md` | Style spec: 80s/90s neon + Memphis geometry. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/scientific.md` | Style spec: academic diagram, off-white/blue-gray, precise labelling. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/screen-print.md` | Style spec: poster art, limited colours, halftone. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/sketch-notes.md` | Style spec: soft hand-drawn warm notes, paper grain. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/sketch.md` | Style spec: raw pencil notebook, in-progress feel. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/vector-illustration.md` | Style spec: flat vector, uniform black outlines, cream ground. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/vintage.md` | Style spec: aged parchment, explorer-journal register. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/warm.md` | Style spec: friendly cream/peach. |
| `optional-skills/creative/baoyu-article-illustrator/references/styles/watercolor.md` | Style spec: soft washes, visible brush strokes. |
| `optional-skills/creative/baoyu-article-illustrator/references/usage.md` | Trigger phrases, input modes and the output-directory rules (article path → `imgs/`, pasted content → `illustrations/{slug}/`). |
| `optional-skills/creative/baoyu-article-illustrator/references/workflow.md` | The detailed 7-step procedure: reference detection (via `vision_analyze`, since `image_generate` is prompt-only), analysis, **Q1-Q5 settings questions with a stated priority order**, outline generation, prompt generation, image generation, finalisation. |
| `optional-skills/creative/baoyu-comic/PORT_NOTES.md` | The comic port ledger: file naming convention, structural removals, image-generation strategy changes, and what was preserved verbatim. |
| `optional-skills/creative/baoyu-comic/SKILL.md` | Knowledge-comic creator: art style × tone × layout, a progress checklist, and a "user questions" step (5 questions) before any generation. |
| `optional-skills/creative/baoyu-comic/references/analysis-framework.md` | The 6-dimension content analysis (what / why / audience / value / narrative potential / adaptation) and the YAML front-matter contract (`recommended_page_count`, `recommended_art`, `recommended_tone`, `recommended_layout`). |
| `optional-skills/creative/baoyu-comic/references/art-styles/chalk.md` | Art-style spec: chalkboard, sketchy lines, chalk texture, line weight from pressure. |
| `optional-skills/creative/baoyu-comic/references/art-styles/ink-brush.md` | Art-style spec: 2-3 px dynamic brush strokes, ink wash, sharp edges. |
| `optional-skills/creative/baoyu-comic/references/art-styles/ligne-claire.md` | Art-style spec: uniform 2 px outlines, flat fills, no hatching. |
| `optional-skills/creative/baoyu-comic/references/art-styles/manga.md` | Art-style spec: expressive eyes, 1.5-2 px lines, weight variation. |
| `optional-skills/creative/baoyu-comic/references/art-styles/minimalist.md` | Art-style spec: black line art, spot colour, near-stick figures; "every line serves a purpose". |
| `optional-skills/creative/baoyu-comic/references/art-styles/realistic.md` | Art-style spec: digital painting, anatomically accurate, colour for depth. |
| `optional-skills/creative/baoyu-comic/references/auto-selection.md` | The content-signal matrix → (art, tone, layout, preset) routing table, with a stated priority order. |
| `optional-skills/creative/baoyu-comic/references/base-prompt.md` | The comic page prompt template: panel structure, bubbles, captions, typography, concept visualisation, fourth-wall narrator, historical accuracy, language. |
| `optional-skills/creative/baoyu-comic/references/character-template.md` | The character-document format: role, age, face/hair/eyes, costume, **expression range**, and a reference-sheet image prompt. |
| `optional-skills/creative/baoyu-comic/references/layouts/cinematic.md` | Layout spec: 2-4 panels, wide aspect, generous gutters (12-15 px). |
| `optional-skills/creative/baoyu-comic/references/layouts/dense.md` | Layout spec: 6-9 panels, 3×3, tight gutters (4-6 px). |
| `optional-skills/creative/baoyu-comic/references/layouts/four-panel.md` | Layout spec: exactly 4 panels, strict 2×2, uniform gutters, single-page story. |
| `optional-skills/creative/baoyu-comic/references/layouts/mixed.md` | Layout spec: 3-7 panels, intentionally irregular. |
| `optional-skills/creative/baoyu-comic/references/layouts/splash.md` | Layout spec: 1-2 dominant + 2-3 supporting. |
| `optional-skills/creative/baoyu-comic/references/layouts/standard.md` | Layout spec: 4-6 panels, 2-3 columns. |
| `optional-skills/creative/baoyu-comic/references/layouts/webtoon.md` | Layout spec: single column, 3-5 panels, 20-40 px vertical gutters, horizontal bleed. |
| `optional-skills/creative/baoyu-comic/references/ohmsha-guide.md` | The educational-manga guide: fixed character roles (student/mentor/antagonist), a visual-metaphor rule, a page-title convention, and good-vs-bad ending definitions. |
| `optional-skills/creative/baoyu-comic/references/partial-workflows.md` | Resumable sub-workflows: storyboard only (steps 1-3), prompts only (1-5), images only (7-8), regenerate. |
| `optional-skills/creative/baoyu-comic/references/presets/concept-story.md` | Preset: manga × warm × standard; concept-visualisation system, visual symbol continuity, character archetypes, narrative arc. |
| `optional-skills/creative/baoyu-comic/references/presets/four-panel.md` | Preset: minimalist × neutral × four-panel; 起承转合 narrative structure, single-page story, accent-colour system. |
| `optional-skills/creative/baoyu-comic/references/presets/ohmsha.md` | Preset: manga × neutral × webtoon; visual-metaphor requirement, gadget-reveal pattern, and a "NO Talking Heads Rule". |
| `optional-skills/creative/baoyu-comic/references/presets/shoujo.md` | Preset: manga × romantic × standard; decorative elements, eye detail, panel flow, emotional-beat timing, screen tone. |
| `optional-skills/creative/baoyu-comic/references/presets/wuxia.md` | Preset: ink-brush × action × splash; qi/energy effects, combat language, weapon effects. |
| `optional-skills/creative/baoyu-comic/references/storyboard-template.md` | The storyboard document format: cover, per-page panel layout, filename convention, and the YAML header (title, time span, narrative approach, aspect ratio, page count). |
| `optional-skills/creative/baoyu-comic/references/tones/action.md` | Tone spec: speed, impact, power. |
| `optional-skills/creative/baoyu-comic/references/tones/dramatic.md` | Tone spec: high contrast, pivotal moments. |
| `optional-skills/creative/baoyu-comic/references/tones/energetic.md` | Tone spec: bright, dynamic. |
| `optional-skills/creative/baoyu-comic/references/tones/neutral.md` | Tone spec: balanced, rational, educational (the default). |
| `optional-skills/creative/baoyu-comic/references/tones/romantic.md` | Tone spec: soft, decorative. |
| `optional-skills/creative/baoyu-comic/references/tones/vintage.md` | Tone spec: historical, aged, period authenticity. |
| `optional-skills/creative/baoyu-comic/references/tones/warm.md` | Tone spec: nostalgic, personal, comforting. |
| `optional-skills/creative/baoyu-comic/references/workflow.md` | 16 KB complete workflow: setup/analyse (with a **backup rule** — rename an existing `source-{slug}.md` to `source-{slug}-backup-YYYYMMDD-HHMMSS.md` before writing), language determination, page-count rules, a progress checklist, confirmation Q1-Q5, outline review, prompt review, completion report. |

### `optional-skills/creative/comfyui/` (rows 199-233)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/comfyui/SKILL.md` | The ComfyUI skill: two layers (official `comfy-cli` for setup/lifecycle + direct REST/WS for execution), a **hardware check first** (deciding local vs cloud), and a one-line health check that answers "comfy_cli on PATH? server reachable? at least one checkpoint? smoke-test passes?". |
| `optional-skills/creative/comfyui/references/official-cli.md` | Every `comfy` command: node management (install/enable/disable/fix, `node bisect start` for binary-searching a culprit node), model management, lifecycle, and `comfy install-deps --workflow=workflow.json`. |
| `optional-skills/creative/comfyui/references/rest-api.md` | REST + WebSocket reference; local vs cloud differences (base URL, auth, and the **302 → signed URL** download where the API key must be stripped for the second hop). |
| `optional-skills/creative/comfyui/references/template-integrity.md` | **RULE #1: never strip, simplify or "minimize" nodes from a template** — if a path is not needed, leave it wired with the bypass toggle enabled. RULE #2: server validation errors are the source of truth (`node_errors`). |
| `optional-skills/creative/comfyui/references/workflow-format.md` | Two JSON formats, only API format executable; literals vs links; the controllable parameter set per node type; embedding references inside prompt strings. |
| `optional-skills/creative/comfyui/scripts/_common.py` | 835-line shared library: cloud-aware URL resolution, API-key resolution, an `http_request` with **exponential backoff (base 1.0 s, cap 30 s) over 8 retryable status codes**, sensitive-header stripping on redirect, API-format detection, workflow unwrapping, model/embedding dependency iteration, `safe_path_join`, seed coercion to `[0, 2^63-1]`, and JSON emission. |
| `optional-skills/creative/comfyui/scripts/auto_fix_deps.py` | 227 lines: installs missing nodes/models suggested by `check_deps` (with a `--dry-run`). |
| `optional-skills/creative/comfyui/scripts/check_deps.py` | 437 lines: fetches `/object_info`, resolves model presence per folder with alias normalisation, and suggests an install command or a git URL per missing node class. |
| `optional-skills/creative/comfyui/scripts/comfyui_setup.sh` | 288 lines: idempotent setup — hardware check → install `comfy-cli` (pipx/uvx preferred) → disable analytics → install ComfyUI → detect an already-running server → launch → wait up to 60 s. "Refuses local install when hardware_check.py verdict is 'cloud'." |
| `optional-skills/creative/comfyui/scripts/extract_schema.py` | 315 lines: derives a **controllable schema** from a workflow by tracing links back to their source nodes (`trace_to_node`, max 8 hops) and finding the positive/negative prompt nodes. |
| `optional-skills/creative/comfyui/scripts/fetch_logs.py` | 157 lines: pulls a history entry / queue from local or cloud and extracts diagnostics. |
| `optional-skills/creative/comfyui/scripts/hardware_check.py` | 497 lines: GPU/RAM/disk detection (NVIDIA, ROCm, Apple Silicon, Intel Arc, WSL, Rosetta) and a `classify` that returns local-vs-cloud with reasons; thresholds 6/8/12 GB VRAM, 16/32 GB RAM, 25 GB free disk. |
| `optional-skills/creative/comfyui/scripts/health_check.py` | 223 lines: `comfy_cli_status`, `server_status`, `checkpoint_status` and a `SMOKE_WORKFLOW` smoke test — one tiny end-to-end run as the health signal. |
| `optional-skills/creative/comfyui/scripts/run_batch.py` | 243 lines: sweep expansion (`expand_sweep`) and per-item execution with optional seed randomisation. |
| `optional-skills/creative/comfyui/scripts/run_workflow.py` | 796 lines: the `ComfyRunner` class, schema loading, parameter injection, and output download. |
| `optional-skills/creative/comfyui/scripts/ws_monitor.py` | 267 lines: WebSocket progress monitor with ANSI colouring and binary frame parsing (preview image / text). |
| `optional-skills/creative/comfyui/tests/README.md` | How to run the pytest suite, including the cloud-marked live tests. |
| `optional-skills/creative/comfyui/tests/conftest.py` | Fixtures: sd15/flux/video workflow loaders, `workflows_dir`/`scripts_dir` path helpers, `cloud_key()`, and a collection hook. |
| `optional-skills/creative/comfyui/tests/pytest.ini` | `markers`, `testpaths = .`, `addopts = -p no:xdist` (no parallel runs). |
| `optional-skills/creative/comfyui/tests/test_check_deps.py` | Pins `normalize_for_match`, `model_present`, `suggest_install_command`, and the node→package map. |
| `optional-skills/creative/comfyui/tests/test_cloud_integration.py` | Live cloud tests (marked `cloud`): cloud endpoints, cloud check-deps, cloud health check. |
| `optional-skills/creative/comfyui/tests/test_common.py` | 443 lines pinning cloud detection, endpoint rename, URL resolution, API-format detection, workflow unwrapping, link detection, iterators, the embedding regex, `safe_path_join`, seed coercion, model-list parsing, folder aliases, media types and **redirect header stripping**. |
| `optional-skills/creative/comfyui/tests/test_extract_schema.py` | Pins connection tracing, positive/negative prompt detection, schema extraction, embedding deps and duplicate de-duplication. |
| `optional-skills/creative/comfyui/tests/test_run_workflow.py` | Pins input-image argument parsing, parameter injection, output download walking and runner construction. |
| `optional-skills/creative/comfyui/workflows/README.md` | The starter workflow table: purpose, required models, minimum VRAM per workflow, and the cloud-vs-local model-name difference. |
| `optional-skills/creative/comfyui/workflows/animatediff_video.json` | API-format workflow: AnimateDiff 16-frame text-to-video (KSampler, dpmpp_sde/karras). |
| `optional-skills/creative/comfyui/workflows/flux_dev_txt2img.json` | API-format workflow: Flux Dev via BasicScheduler/Guider/SamplerCustomAdvanced. |
| `optional-skills/creative/comfyui/workflows/sd15_txt2img.json` | API-format workflow: SD 1.5 text-to-image, 20 steps, smallest model. |
| `optional-skills/creative/comfyui/workflows/sdxl_img2img.json` | API-format workflow: SDXL img2img (partial denoise preserves the source). |
| `optional-skills/creative/comfyui/workflows/sdxl_inpaint.json` | API-format workflow: SDXL inpaint — white mask = regenerate, black = preserve. |
| `optional-skills/creative/comfyui/workflows/sdxl_txt2img.json` | API-format workflow: SDXL text-to-image at 1024×1024. |
| `optional-skills/creative/comfyui/workflows/upscale_4x.json` | API-format workflow: standalone ESRGAN 4× upscale. |
| `optional-skills/creative/comfyui/workflows/wan_video_t2v.json` | API-format workflow: Wan 2.1 text-to-video; "Large model — only on cloud or 24 GB+ local GPU". |

### `optional-skills/creative/concept-diagrams/` (rows 234-252)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/concept-diagrams/SKILL.md` | Flat, minimal, dark-mode-ready SVG as a single self-contained HTML file. Pins the design system: 9 colour ramps × 7 stops, no gradients/shadows/blur/glow, and a **validation checklist** before the file ships. |
| `optional-skills/creative/concept-diagrams/examples/apartment-floor-plan-conversion.md` | Worked example: architectural floor plan, dotted red proposed walls, room colour coding, circulation arrows, before/after area table, north arrow and scale bar. |
| `optional-skills/creative/concept-diagrams/examples/automated-password-reset-flow.md` | Worked example: three-column flowchart, diamond decisions computed as `cx±hw, cy±hh`, pill terminals (`rx=22`) vs process nodes (`rx=8`), a **loop-back corridor with a 5 px gap** between columns, a dashed section separator, and a legend row. |
| `optional-skills/creative/concept-diagrams/examples/autonomous-llm-research-agent-flow.md` | Worked example: the autoresearch loop with keep/discard branching that **converges** back to "Log to results.tsv", dashed loop-back arrow, semantic green/red, and a highlighted key step. |
| `optional-skills/creative/concept-diagrams/examples/banana-journey-tree-to-smoothie.md` | Worked example: narrative journey diagram, S-curve path, progressive state change (green→yellow→brown→frozen→smoothie), a bottom timeline. |
| `optional-skills/creative/concept-diagrams/examples/commercial-aircraft-structure.md` | Worked example: path/polygon/ellipse usage for curved bodies, leader lines, dashed interior sections and control surfaces. |
| `optional-skills/creative/concept-diagrams/examples/cpu-ooo-microarchitecture.md` | Worked example: six pipeline stages, µop-cache bypass, fan-out to six execution ports, a memory-hierarchy sidebar. |
| `optional-skills/creative/concept-diagrams/examples/electricity-grid-flow.md` | Worked example: four-stage flow, voltage-level hierarchy by line weight/colour, a smart-grid data overlay, multiple source convergence. |
| `optional-skills/creative/concept-diagrams/examples/feature-film-production-pipeline.md` | Worked example: phase containers with inner task nodes and a horizontal sub-flow inside a phase. |
| `optional-skills/creative/concept-diagrams/examples/hospital-emergency-department-flow.md` | Worked example: red/amber/green **semantic** priority coding, convergent paths, nested containers, a legend. |
| `optional-skills/creative/concept-diagrams/examples/ml-benchmark-grouped-bar-chart.md` | Worked example: grouped min/max bars, dual Y-axis, overlay polyline, a dashed threshold marker, zone annotations, an inset data table. |
| `optional-skills/creative/concept-diagrams/examples/place-order-uml-sequence.md` | 20 KB worked example: 6 lifelines, 14 numbered messages, an `alt` fragment with a UML pentagon notch, a nested `par`, two distinct arrowhead markers, activation bars, guard conditions, lifeline end caps. |
| `optional-skills/creative/concept-diagrams/examples/smart-city-infrastructure.md` | Worked example: hub-spoke layout, connection dots, dashboard mockup, semantic line styles. |
| `optional-skills/creative/concept-diagrams/examples/smartphone-layer-anatomy.md` | Worked example: exploded layer stack with alternating left/right labels to avoid overlap, a thickness scale. |
| `optional-skills/creative/concept-diagrams/examples/sn2-reaction-mechanism.md` | Worked example: ball-and-stick structures, curved electron arrows, a bracketed transition state with partial charges, wedge/dash stereochemistry, an energy profile. |
| `optional-skills/creative/concept-diagrams/examples/wind-turbine-structure.md` | Worked example: underground foundation with rebar, cross-section tower with ladder and cable routing, nacelle cutaway, three blades, per-system colour coding. |
| `optional-skills/creative/concept-diagrams/references/dashboard-patterns.md` | The "screen in a frame" building block for dashboard mockups inside a diagram. |
| `optional-skills/creative/concept-diagrams/references/infrastructure-patterns.md` | Hub-spoke layout, semantic line styles per domain, and a reusable CSS block. |
| `optional-skills/creative/concept-diagrams/references/physical-shape-cookbook.md` | Which SVG element for which physical form, and the layering approach. |
| `optional-skills/creative/concept-diagrams/templates/template.html` | The self-contained output template: CSS custom properties for both modes and the SVG boilerplate. |

### `optional-skills/creative/creative-ideation/` (rows 253-280)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/creative-ideation/SKILL.md` | A **routed** library of named ideation methods. Four-step routing: extract three signals from the prompt → apply overrides (highest priority, fire first) → route by phase then domain → handle ambiguity. Operating rules: "Constraint plus direction is creativity"; "**Refuse the first three ideas. They're slop.**"; "One method per response unless asked." |
| `optional-skills/creative/creative-ideation/references/anti-slop.md` | The anti-slop rules that back the "refuse the first three" rule. |
| `optional-skills/creative/creative-ideation/references/exercises.md` | Exercises for applying the methods. |
| `optional-skills/creative/creative-ideation/references/full-prompt-library.md` | The full prompt library for each method. |
| `optional-skills/creative/creative-ideation/references/heuristics.md` | The heuristics that select a method. |
| `optional-skills/creative/creative-ideation/references/method-catalog.md` | The catalogue: method name → when it applies → source discipline. |
| `optional-skills/creative/creative-ideation/references/methods/affinity-diagrams.md` | Method: affinity diagramming. |
| `optional-skills/creative/creative-ideation/references/methods/analogy-and-blending.md` | Method: analogy and blending. |
| `optional-skills/creative/creative-ideation/references/methods/biomimicry.md` | Method: biomimicry. |
| `optional-skills/creative/creative-ideation/references/methods/chance-and-remix.md` | Method: chance operations and remix. |
| `optional-skills/creative/creative-ideation/references/methods/compression-progress.md` | Method: compression and progress. |
| `optional-skills/creative/creative-ideation/references/methods/creative-discipline.md` | Method: creative discipline. |
| `optional-skills/creative/creative-ideation/references/methods/defamiliarization.md` | Method: defamiliarization. |
| `optional-skills/creative/creative-ideation/references/methods/derive-and-mapping.md` | Method: derivation and mapping. |
| `optional-skills/creative/creative-ideation/references/methods/first-principles.md` | Method: first principles. |
| `optional-skills/creative/creative-ideation/references/methods/jobs-to-be-done.md` | Method: jobs to be done. |
| `optional-skills/creative/creative-ideation/references/methods/lateral-provocations.md` | Method: lateral provocations. |
| `optional-skills/creative/creative-ideation/references/methods/leverage-points.md` | Method: leverage points. |
| `optional-skills/creative/creative-ideation/references/methods/oblique-strategies.md` | Method: oblique strategies. |
| `optional-skills/creative/creative-ideation/references/methods/oulipo.md` | Method: Oulipo constraint writing. |
| `optional-skills/creative/creative-ideation/references/methods/pataphysics.md` | Method: pataphysics. |
| `optional-skills/creative/creative-ideation/references/methods/pattern-languages.md` | Method: pattern languages. |
| `optional-skills/creative/creative-ideation/references/methods/polya.md` | Method: Pólya's problem solving. |
| `optional-skills/creative/creative-ideation/references/methods/premortem-and-inversion.md` | Method: premortem and inversion. |
| `optional-skills/creative/creative-ideation/references/methods/scamper.md` | Method: SCAMPER. |
| `optional-skills/creative/creative-ideation/references/methods/story-skeletons.md` | Method: story skeletons. |
| `optional-skills/creative/creative-ideation/references/methods/triz-principles.md` | Method: TRIZ. |
| `optional-skills/creative/creative-ideation/references/methods/volume-generation.md` | Method: volume generation. |


### `optional-skills/creative/` remainder + `data-science` + `devops` + `dogfood` + `email` (indices 279-385)

#### `optional-skills/creative/kanban-video-orchestrator/scripts/monitor.py` (source, 195 lines, 6.8 KB) — Tier 1
- **Purpose:** best-effort observability for a long-running multi-agent kanban; polls the board and
  surfaces four classes of problem without ever restarting anything.
- **Key abstractions:** `kanban_list(tenant)`, `kanban_show(task_id)`, `detect_issues(tasks)`,
  `snapshot(tenant)`, `print_snapshot(tasks, issues)`.
- **Data flow:** `hermes kanban list --json` (with a **textual fallback parser** if JSON is not
  supported by the installed CLI) → `detect_issues` → a per-status snapshot on stdout and issues on
  stderr.
- **Non-obvious design decisions:**
  - **Three issue classes, each with a distinct prefix and a remediation hint**: `STUCK` (running
    with no heartbeat for 2 minutes), `OVERTIME` (running past `max_runtime_s`), and `FLAPPING`
    (retried ≥2× — "fix root cause before next run"). These are the same three failure modes a
    trading automation needs: a stalled run, a run that overran its window, and a job that keeps
    retrying a bad input.
  - **The JSON path is preferred but never required** — the fallback parses the human table format
    and synthesises `started_at: None, heartbeat_at: None, max_runtime_s: None`, which makes the
    timeout checks simply not fire rather than crash.
  - **"This is best-effort observability. It does not auto-restart tasks; intervention decisions
    should remain human/AI-overseen."** The tool deliberately does not act.
  - **Exit code carries the verdict**: `--once` exits `0` with no issues and `2` with issues, so a
    scheduler can act on it without parsing text.
- **Edge cases & failure handling:** `hermes` missing from PATH → clear error and exit 1; malformed
  timestamps are skipped rather than crashing the scan; `Ctrl-C` exits cleanly.

#### `optional-skills/creative/kanban-video-orchestrator/scripts/bootstrap_pipeline.py` (source, 498 lines, 18.6 KB) — Tier 1
- **Purpose:** generate a whole multi-agent project from one structured plan — the brief, the team
  graph, the setup script, and one `SOUL.md` per agent.
- **Key abstractions:** `load_template(name)`, `validate_plan(plan) -> list[str]`,
  `render_brief(plan)`, `render_team_md(plan)`, `render_setup_sh(plan, brief, team)`,
  `render_soul_md(member, plan)`.
- **Data flow:** a plan dict → validation → four rendered artefacts (Markdown brief, `TEAM.md`
  task graph, a bash `setup.sh`, and one persona file per agent).
- **Non-obvious design decisions:**
  - **Validation is a separate, pure function** (`validate_plan`) that returns a *list of error
    strings* rather than raising — the caller can show all problems at once.
  - **Name and slug are validated by regex** (`PROFILE_NAME_RE = ^[a-z0-9][a-z0-9_-]{0,63}$`,
    `SLUG_RE = ^[a-z0-9][a-z0-9-]+$`) — the generated bash and profile names are shell-injection
    surfaces, so the shape is constrained at the source.
  - **One persona file per agent** (`SOUL.md`) — the agent's role, inputs it reads and outputs it
    produces are written into a file the agent reads, not into a prompt the orchestrator has to
    remember to resend.
- **Edge cases & failure handling:** a plan that fails validation produces no files; the rendered
  `setup.sh` is itself a template with `{{PLACEHOLDER}}` substitution, so a malformed plan
  cannot emit half-formed shell.

#### `optional-skills/creative/kanban-video-orchestrator/references/monitoring.md` (docs, 7.5 KB)
- **The live monitoring commands** (`hermes kanban watch --tenant <slug>` — a live event stream of
  task spawns, status changes, heartbeats and completions; a board snapshot; per-status counts plus
  **oldest-ready age**; a browser dashboard; per-task inspection with comments + events; a single
  task's event stream) and the two sections that matter most: **healthy pipeline indicators** and
  **warning signs**, followed by **intervention recipes** ("Rejecting bad output" — comment on the
  renderer's task with specific feedback).

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/creative/creative-ideation/references/anti-slop.md` | The anti-slop rules: slop signatures to reject (trending-noun mashups, the four safest domains, vague abstractions, solution-in-search-of-problem), a five-test diagnostic, and ten suppression techniques — starting with "Refuse the first three ideas" and "Force specificity". |
| `optional-skills/creative/creative-ideation/references/exercises.md` | Time-boxed exercises (5 min / 30 min / 1 h / 1 day / 1 week / multi-week), each naming its parent method and expected output. |
| `optional-skills/creative/creative-ideation/references/full-prompt-library.md` | The constraint library: General, Software/artifact, Social/collective — "Pick a constraint, generate 3 ideas that satisfy it, ship one." |
| `optional-skills/creative/creative-ideation/references/heuristics.md` | The routing decision tree: phase signals → domain signals → mood/tone signals; first match wins; plus "When to stack methods (rare)" and edge cases. |
| `optional-skills/creative/creative-ideation/references/method-catalog.md` | One-line summary + "use when" per method, grouped by family (random-stimulus, constraint-driven, theoretical, engineering/systems, generation/discipline, selection/refinement, mapping/drift, domain-specific), plus "Choosing between similar methods" and "Deliberately not in the catalog". |
| `optional-skills/creative/creative-ideation/references/methods/affinity-diagrams.md` | Method: KJ affinity diagrams — bottom-up clustering of 100+ items (user requests, bug reports, interview notes) without imposing a taxonomy first. **Directly applicable to a pile of trade-log lessons.** |
| `optional-skills/creative/creative-ideation/references/methods/analogy-and-blending.md` | Method: synectics, bisociation, conceptual blending — four-space blending architecture. |
| `optional-skills/creative/creative-ideation/references/methods/biomimicry.md` | Method: biomimicry — adapt the operative principle, not the metaphor; lists distributed-systems precedents (slime molds, ant colonies, immune systems). |
| `optional-skills/creative/creative-ideation/references/methods/chance-and-remix.md` | Method: exquisite corpse, Cage chance operations, cut-up, détournement. |
| `optional-skills/creative/creative-ideation/references/methods/compression-progress.md` | Method: Schmidhuber's compression-progress formula — interestingness = the change in compressibility as you learn; a worthwhile project compresses your model of the world. |
| `optional-skills/creative/creative-ideation/references/methods/creative-discipline.md` | Method: Tharp, LeWitt, Cleese, Cameron — practices for sustained work over weeks, not one session. |
| `optional-skills/creative/creative-ideation/references/methods/defamiliarization.md` | Method: Shklovsky's *ostranenie* and Brecht's alienation effect; "the expert knows too much" is the failure case. |
| `optional-skills/creative/creative-ideation/references/methods/derive-and-mapping.md` | Method: Situationist dérive, Lynch's cognitive mapping, Bachelard's topoanalysis. |
| `optional-skills/creative/creative-ideation/references/methods/first-principles.md` | Method: Aristotle's *protai archai* — decompose to trusted assumptions and rebuild without inheriting anything by default. |
| `optional-skills/creative/creative-ideation/references/methods/jobs-to-be-done.md` | Method: JTBD + Moesta's four forces of switching; "the real competitor is whatever currently does the job". |
| `optional-skills/creative/creative-ideation/references/methods/lateral-provocations.md` | Method: de Bono's PO operator and five provocation moves. |
| `optional-skills/creative/creative-ideation/references/methods/leverage-points.md` | Method: Meadows' 12 leverage points, least → most powerful; "almost always at lower level than problem". |
| `optional-skills/creative/creative-ideation/references/methods/oblique-strategies.md` | Method: Eno/Schmidt's ~110-card deck for breaking studio deadlocks. |
| `optional-skills/creative/creative-ideation/references/methods/oulipo.md` | Method: OuLiPo constraints (lipogram, univocalism, S+7, stile, palindrome, pilish…). |
| `optional-skills/creative/creative-ideation/references/methods/pataphysics.md` | Method: Jarry's pataphysics — "the science of imaginary solutions and particular cases". |
| `optional-skills/creative/creative-ideation/references/methods/pattern-languages.md` | Method: Alexander's pattern format (Context / Problem / **generative** Solution) and pattern languages as networks. |
| `optional-skills/creative/creative-ideation/references/methods/polya.md` | Method: Pólya's four phases (understand, devise, carry out, look back) plus the heuristic dictionary. |
| `optional-skills/creative/creative-ideation/references/methods/premortem-and-inversion.md` | Method: Klein's premortem + Munger's inversion, both exploiting prospective hindsight. |
| `optional-skills/creative/creative-ideation/references/methods/scamper.md` | Method: SCAMPER's seven transformations. |
| `optional-skills/creative/creative-ideation/references/methods/story-skeletons.md` | Method: Coats' 22 story basics, Saunders, Le Guin — with an explicit "deliberately omitted: Hero's Journey / Save the Cat / Story Circle / Three-Act" because they produce slop. |
| `optional-skills/creative/creative-ideation/references/methods/triz-principles.md` | Method: TRIZ's 40 inventive principles, contradiction matrix, and the Ideal Final Result. |
| `optional-skills/creative/creative-ideation/references/methods/volume-generation.md` | Method: Crazy 8s, brainwriting 6-3-5, James Webb Young's 5 stages. |
| `optional-skills/creative/draw-your-font/SKILL.md` | Photo of handwriting → installable TTF. Splits the work: "You do the seeing (find and label letters, judge quality); the CLI does all geometry. Never edit SVG paths or coordinates yourself." |
| `optional-skills/creative/draw-your-font/references/troubleshooting.md` | The binarizer's two knobs (`--delta`, `--cap`) with the symptom each fixes. |
| `optional-skills/creative/dream-loop/LICENSE.txt` | MIT licence text for the `dream-loop` port. |
| `optional-skills/creative/dream-loop/SKILL.md` | **Concept-art fidelity loop**: generate ideal concept art → build → screenshot the live build → have a judge score screenshot vs concept against a gated ladder → iterate to convergence. The eight steps end in "exit criteria"; a self-check step comes before the judge. |
| `optional-skills/creative/excalidraw/SKILL.md` | Write Excalidraw element JSON, save as `.excalidraw`, drag onto excalidraw.com. Required fields listed, defaults listed. |
| `optional-skills/creative/excalidraw/references/colors.md` | The palette with a role per colour (primary actions, warnings, success, data series 1-3) and text-contrast rules. |
| `optional-skills/creative/excalidraw/references/dark-mode.md` | Dark mode = a massive dark rectangle as the **first element** in the array. |
| `optional-skills/creative/excalidraw/references/examples.md` | 14 KB of copy-pasteable element JSON (flowchart, photosynthesis, UML sequence) plus "Common Mistakes to Avoid". |
| `optional-skills/creative/excalidraw/scripts/upload.py` | 133 lines: upload a `.excalidraw` file to the public API and return a share URL. |
| `optional-skills/creative/heartmula/SKILL.md` | HeartMuLa: open-source song generation from lyrics + tags (HeartMuLa/HeartCodec/HeartTranscriptor/HeartCLAP), with the dependency-patch steps spelled out. |
| `optional-skills/creative/hyperframes/SKILL.md` | Render MP4/WebM from HTML compositions; "HTML is the source of truth for video". The procedure is plan → scaffold → layout before animation → GSAP → transitions → audio/captions → lint/validate/inspect/preview/render → cleanup. |
| `optional-skills/creative/hyperframes/references/cli.md` | The `npx hyperframes` command surface: init, capture, lint, validate (WCAG contrast), inspect, preview, render, transcribe, tts, doctor. |
| `optional-skills/creative/hyperframes/references/composition.md` | Root structure, data attributes, the **timeline contract**, non-negotiable rules, scene transitions, typography/assets, animation guardrails, "Never Do". |
| `optional-skills/creative/hyperframes/references/features.md` | Captions (with the "never use `.en` whisper models unless the audio is confirmed English" rule — `.en` models TRANSLATE), word grouping, text-overflow prevention, caption-exit guarantee, TTS, audio-reactive. |
| `optional-skills/creative/hyperframes/references/gsap.md` | GSAP as the animation engine: tween methods, timelines, stagger, performance. |
| `optional-skills/creative/hyperframes/references/troubleshooting.md` | Ten symptom→fix entries, from the `beginFrame` protocol error through render timeouts, ENOSPC, blank renders and "runaway CPU from leftover preview workers". |
| `optional-skills/creative/hyperframes/references/website-to-video.md` | URL → video in 7 steps, each producing an artefact that **gates the next** ("Do not skip steps — each artefact prevents a downstream failure mode"). |
| `optional-skills/creative/hyperframes/scripts/setup.sh` | 135 lines: version gates (Node ≥ 22, hyperframes ≥ 0.4.2), ffmpeg check, CLI install/upgrade, pre-cached chrome-headless-shell, then `doctor`. |
| `optional-skills/creative/impeccable/SKILL.md` | Catalogue stub for the upstream `impeccable` design-language skill (23 …) — installs live from the upstream repo so the vendored copy cannot go stale. |
| `optional-skills/creative/ip-as-logo/LICENSE` | MIT licence + upstream commit/author provenance. |
| `optional-skills/creative/ip-as-logo/SKILL.md` | Design a mascot mark that stays readable at 32×32: complexity budget, shape language, colour/canvas, prompt skeleton, delivery behaviour. |
| `optional-skills/creative/kanban-video-orchestrator/SKILL.md` | The meta-pipeline: scope → design a team → generate a setup script (profiles, workspace, initial kanban task) → execute → monitor and intervene. "Does **not** render anything itself." |
| `optional-skills/creative/kanban-video-orchestrator/assets/brief.md.tmpl` | The brief template: one-line pitch, emotional north star, scope table (duration/aspect/resolution), slug/tenant/workspace header. |
| `optional-skills/creative/kanban-video-orchestrator/assets/setup.sh.tmpl` | 191 lines: creates the project workspace, patches profile config, writes the per-profile `SOUL.md`, and fires the initial kanban task. |
| `optional-skills/creative/kanban-video-orchestrator/assets/soul.md.tmpl` | The per-agent persona template: role, brief, team graph, style spec, inputs read, outputs produced. |
| `optional-skills/creative/kanban-video-orchestrator/references/examples.md` | Six worked pipelines (narrative short, product teaser, music video, math explainer, ASCII, installation) with team composition and task graphs. |
| `optional-skills/creative/kanban-video-orchestrator/references/intake.md` | Adaptive discovery: three baseline questions, then a per-style question bank, 2-4 questions at a time, and Tier 2 questions at the end. |
| `optional-skills/creative/kanban-video-orchestrator/references/kanban-setup.md` | The workspace layout, the `setup.sh` pattern, profile creation and config patching, `SOUL.md` per profile, the initial task, the `TEAM.md` task graph, and an API-key prerequisites check. |
| `optional-skills/creative/kanban-video-orchestrator/references/role-archetypes.md` | The role library: "Compose a team from this list, don't clone a fixed roster. Most videos need 4-7 profiles. The director is always present." |
| `optional-skills/creative/kanban-video-orchestrator/references/tool-matrix.md` | Which skills and toolsets each role gets — the mapping from role to `always_load` and toolsets. |
| `optional-skills/creative/meme-generation/EXAMPLES.md` | Five worked meme examples. |
| `optional-skills/creative/meme-generation/SKILL.md` | Meme PNGs from ~100 imgflip templates + 10 curated ones with hand-tuned text placement; two modes (classic template, custom AI image). |
| `optional-skills/creative/meme-generation/scripts/.gitignore` | Ignores the template cache directory. |
| `optional-skills/creative/meme-generation/scripts/generate_meme.py` | 470 lines: template resolution (curated + live imgflip list with a 24 h cache), font discovery, text wrapping, outlined text drawing, overlay + bar modes. |
| `optional-skills/creative/meme-generation/scripts/templates.json` | The 10 curated templates with per-field `x_pct/y_pct/w_pct/align` text placement and a `best_for` note. |
| `optional-skills/creative/mono-color/LICENSE.txt` | MIT licence text for the `mono-color` port. |
| `optional-skills/creative/mono-color/SKILL.md` | One- or two-ink editorial print posters: adaptive neutral substrate + one/two inks + mechanically reproduced image + typographic tension + a human voice. "It never uses more than two printing inks." |
| `optional-skills/creative/mono-color/design-system/carriers.json` | Carrier catalog (wall poster, bound zine, social cover, record sleeve, packaging) with `required_signals` and `forbidden_signals` per carrier. |
| `optional-skills/creative/mono-color/design-system/colors.json` | Substrates (with `counts_as_ink: false`) and ink plates, each with a `use_for` list. |
| `optional-skills/creative/mono-color/design-system/compositions.json` | Five composition geometries with percentage budgets (`dominant_subject_percent`, `empty_paper_percent`), anchors and a `manual_gesture_limit`. |
| `optional-skills/creative/mono-color/design-system/imperfections.json` | Effect budgets (contemporary 0-2, material 2-3) and a **stable seed strategy** — "a stable hash of subject, exact text, palette, and layout", preserved across retries. |
| `optional-skills/creative/mono-color/design-system/rhythm.json` | Focal-event catalog and the default tension profile. |
| `optional-skills/creative/mono-color/design-system/typography.json` | Typography roles with a selection rule: "Choose the role from content and verbal tone, not from a house-style default." |
| `optional-skills/creative/mono-color/references/composition.md` | The composition decision flow, layout families, four-move grammar, and the 25-55% empty-paper rule. |
| `optional-skills/creative/mono-color/references/quality-gate.md` | The **originality firewall**: change at least four of ten things from any supplied reference; never reproduce arrangement, line breaks, labels, logos or a distinctive slogan; never include fake signatures. |
| `optional-skills/creative/mono-color/references/visual-language.md` | Colour system, one-ink vs two-ink recipes, image treatment, typography, tone; "the paper substrate does not count as an ink". |
| `optional-skills/creative/pixel-art/ATTRIBUTION.md` | Third-party attribution for the ported `pixel-art-studio` code and licence compatibility. |
| `optional-skills/creative/pixel-art/SKILL.md` | Photo → pixel-art PNG (Floyd-Steinberg dithering) → animated MP4/GIF, with era palettes. |
| `optional-skills/creative/pixel-art/references/palettes.md` | 28 hardware-accurate and artistic palettes, with the usage call. |
| `optional-skills/creative/pixel-art/scripts/__init__.py` | Empty package marker (0 bytes). |
| `optional-skills/creative/pixel-art/scripts/palettes.py` | 167 lines: the `PALETTES` table and `build_palette_image`. |
| `optional-skills/creative/pixel-art/scripts/pixel_art.py` | 162 lines: presets and `pixel_art(input, output, preset, **overrides)`. |
| `optional-skills/creative/pixel-art/scripts/pixel_art_video.py` | 345 lines: 12 scene effect layers (stars, fireflies, leaves, dust, sparkles, rain, lightning, bubbles, embers, snow, neon pulse, heat shimmer) composed into an MP4/GIF. |
| `optional-skills/creative/pretext/SKILL.md` | DOM-free text measurement as a creative primitive: reflow around a moving sprite, text-as-geometry, shatter into particles, shrink-wrapped UI without `getBoundingClientRect` thrash. |
| `optional-skills/creative/pretext/references/patterns.md` | Eight copy-pasteable demo patterns, with the lesson "Measured spans beat magic padding" and "Separate visual layers from collision". |
| `optional-skills/creative/pretext/templates/donut-orbit.html` | 1468-line reference demo (rasterised logo, obstacle rows, cube/sphere morph, typing, noise). |
| `optional-skills/creative/pretext/templates/hello-orb-flow.html` | 95-line minimal demo. |
| `optional-skills/creative/simple-english/SKILL.md` | ASD-STE100 Simplified Technical English: the full rule catalogue (1.1-8.7) and three modes (rewrite inline, rewrite a file, **check mode** that reports rule number + offending text + compliant rewrite). |
| `optional-skills/creative/simple-english/references/checklist.md` | The verification pass, ordered mechanical → countable → judgment, with a searchable-pattern table. |
| `optional-skills/creative/simple-english/references/use-cases.md` | STE beyond aerospace: error messages ("an error message is a 2 a.m. instruction to a stressed reader"), runbooks, incident reports, commit messages, changelogs, agent instructions, UI copy. |
| `optional-skills/creative/sketch/SKILL.md` | 2-3 throwaway HTML design variants to compare, never one; each variant states a design stance, key choices, trade-offs and best-for; then a head-to-head. |
| `optional-skills/creative/social-media-content-calendar/SKILL.md` | 7-step campaign workflow ending in "Schedule or hand off" — and the honesty rule: "For platforms without a connector, the verified handoff ends at approved drafts for the user's scheduler — say so rather than claiming publication." |
| `optional-skills/creative/system-atlas/LICENSE.txt` | MIT licence text for the `system-atlas` port. |
| `optional-skills/creative/system-atlas/SKILL.md` | One data file (`data.mjs`) renders two views: an interactive isometric map and a generated text twin (`SYSTEM.md`) with the decisions table, structures, flows and **open questions by ID**. |
| `optional-skills/creative/system-atlas/assets/build.mjs` | 104 lines: builds `SYSTEM.md` and `atlas.html` from the data file with no npm install. |
| `optional-skills/creative/system-atlas/assets/data.example.mjs` | The data shape: `META`, `DECISIONS`, `GROUPS`, `NODES`, `FLOWS`, `CH` (chapters), `HOW_HTML`. |
| `optional-skills/creative/system-atlas/assets/template.html` | 423 lines: the interactive atlas runtime — packet animation along flow hops, chapter rail, panel tabs, pan/zoom, reduced-motion aware tweens. |
| `optional-skills/creative/system-atlas/references/design-language.md` | The atlas grammar: top stats strip, left index, isometric canvas, right panel with *What it does / How it's built / Open questions* tabs, and the progressive-disclosure recipe. |
| `optional-skills/creative/system-atlas/references/process-and-lessons.md` | The session record: a step/what-happened/repeat-or-avoid table, the subagent deep-dive pattern, cost-model habits, and "things that bit". |
| `optional-skills/creative/tldraw-offline/SKILL.md` | Drive the tldraw desktop app through its **local HTTP API** (`localhost:7236`) and write document scripts — "The agent does NOT use computer-use / GUI clicking, and does NOT hand-edit the `.tldraw` file directly." |
| `optional-skills/creative/tldraw-offline/scripts/counter.js` | 114 lines: a document script that takes `{ editor, helpers, signal }`. |
| `optional-skills/creative/tldraw-offline/scripts/main.js` | 78 lines: the live script file the agent edits with `read_file`/`patch`. |
| `optional-skills/creative/tldraw-offline/scripts/validate_shapes.mjs` | 65 lines: validates shape props against the tldraw SDK v5 schema. |
| `optional-skills/creative/unreal-mcp/SKILL.md` | Drive the Unreal editor through an in-process MCP server. "The Tool Surface: Discovery, Not a Fixed List" — the agent discovers tools rather than assuming them. |
| `optional-skills/creative/unreal-mcp/references/advanced-workflows.md` | Live-verified UE 5.8 behaviour, incl. **ProgrammaticToolset** for sanctioned batching, Blueprint-as-DSL, "schema-in-error is a first-class discovery mechanism", and PIE sessions. |
| `optional-skills/creative/unreal-mcp/references/pitfalls.md` | Ten ordered pitfalls: start order (editor first, Hermes second), no tools advertised, macOS needs full Xcode, port conflicts, connection refused mid-session, **one call at a time — never batch MCP calls**, the editor freezes during every call, modal dialogs deadlock the loop, Hermes times out before Unreal does, stale schemas. |
| `optional-skills/creative/unreal-mcp/references/recipes.md` | **The recipe grammar**: every step is INTENT / DISCOVER / VALUES / VERIFY — "names the capability to locate … and the exact values to feed it — not hardcoded tool names, which drift". |
| `optional-skills/creative/unreal-mcp/references/scene-craft.md` | Units and conventions, physically-based lighting values (lux, Kelvin), exposure as the "#1 why is it black/white knob", fog, camera framing. |
| `optional-skills/creative/unreal-mcp/references/tool-surface.md` | The tool surface: tool-search mode as the default contract, `call_tool` dispatch semantics, shipped toolsets, screenshots/captures, plugin config, and how to extend with custom Python/C++ toolsets. |
| `optional-skills/data-science/DESCRIPTION.md` | One line: data-science workflow skills. |
| `optional-skills/data-science/jupyter-notebook/SKILL.md` | A **stateful** Python REPL via a live Jupyter kernel — variables persist across executions, for incremental exploration (vs `execute_code`). Discover servers → execute → inspect live variables → edit cells. |
| `optional-skills/devops/actual-setup/SKILL.md` | Actual Computer as an inference provider: an end-to-end-encrypted relay (auth `ac_` key) or a local on-device daemon. "This skill does not install the Actual daemon — device authorization requires a human in a browser." |
| `optional-skills/devops/actual-setup/references/opencode.md` | The "secret in auth.json, config in opencode.json" design, and why the `{env:...}` form is more fragile. |
| `optional-skills/devops/docker-management/SKILL.md` | Docker CLI only: containers, images, volumes, networks, Compose, and log debugging. |
| `optional-skills/devops/hermes-s6-container-supervision/SKILL.md` | s6-overlay supervision in the Hermes image: key files, why Architecture B (CMD as the main program), and how to read s6 status — including the three distinct readings of `down …` (crash loop vs user-stopped vs wants-up). |
| `optional-skills/devops/inference-sh-cli/SKILL.md` | `infsh` CLI for 150+ hosted AI apps; the workflow starts with "Always Search First". |
| `optional-skills/devops/inference-sh-cli/references/app-discovery.md` | Listing, pagination, category filters, search, featured/newest, app detail, saved apps. |
| `optional-skills/devops/inference-sh-cli/references/authentication.md` | Install, login, check auth, env var, CLI update. |
| `optional-skills/devops/inference-sh-cli/references/cli-reference.md` | The full command table and the app-name format. |
| `optional-skills/devops/inference-sh-cli/references/running-apps.md` | Running apps: basic run, inline JSON, version pinning, local file uploads, sample input, a FLUX workflow. |
| `optional-skills/devops/pinggy-tunnel/SKILL.md` | Zero-install localhost tunnels over SSH: free 60-minute tunnels, TCP/TLS, and access gates (basic auth, bearer token, IP allow-list, CORS + HTTPS redirect). |
| `optional-skills/devops/setup-wizard-generator/SKILL.md` | Generate a bash wizard that walks a human through a tedious manual procedure: opens each URL, says what to click, captures the values, writes them where they belong, confirms per stage, and shows how many stages remain. |
| `optional-skills/devops/setup-wizard-generator/templates/template.sh` | 204 lines: stage counter, `WRITTEN_ENV` / `WRITTEN_SECRET` / `SKIPPED` trackers — the wizard records what it wrote, what secret it set, and what it could not do. |
| `optional-skills/devops/watchers/SKILL.md` | **The polling model**: fetch → compare against a watermark file → write the watermark back → print new items (or nothing). Three shipped scripts, a shared watermark helper, empty stdout = silence, non-zero exit on fetch error, and a wiring example that ends "If it prints nothing, stay silent." |
| `optional-skills/devops/watchers/scripts/_watermark.py` | 148 lines: the `Watermark` class — first run records a baseline and emits nothing; a bounded ID set (max 500); atomic `.tmp` + `os.replace`; a corrupt state file is treated as a first run rather than a crash; `format_items_as_markdown` returns the empty string for an empty list. |
| `optional-skills/devops/watchers/scripts/watch_github.py` | 169 lines: watch issues / pulls / releases / commits for a repo, keyed on `id` or `sha`. |
| `optional-skills/devops/watchers/scripts/watch_http_json.py` | 131 lines: watch any JSON endpoint returning a list, with a configurable id field and a dotted `items-path`. |
| `optional-skills/devops/watchers/scripts/watch_rss.py` | 121 lines: RSS 2.0 / Atom parsing keyed on `<guid>` / `<id>`. |
| `optional-skills/dogfood/DESCRIPTION.md` | One line: QA workflows beyond bug-finding. |
| `optional-skills/dogfood/adversarial-ux-test/SKILL.md` | Roleplay the worst-case user, then **filter the rant through a pragmatism layer** before turning it into tickets — six steps, with good/bad persona examples. |
| `optional-skills/email/agentmail/SKILL.md` | Agent-owned email inbox via the `agentmail` CLI; the CLI is the default path, MCP only if the harness wants it, REST only for a missing operation. |
| `optional-skills/email/agentmail/references/core.md` | Inboxes, send, read/reply, labels, attachments, REST notes. |
| `optional-skills/email/agentmail/references/mcp.md` | The hosted MCP endpoint and its auth. |
| `optional-skills/email/agentmail/references/signup.md` | Self-signup: "A human must receive and provide the OTP." |
| `optional-skills/email/agentmail/references/webhooks.md` | Public-HTTPS webhook creation for `message.received`. |
| `optional-skills/email/agentmail/references/websockets.md` | WebSockets for a local process without a public URL, plus loop rules. |


### `optional-skills/finance/` (indices 386-406) — the closest thing in this shard to trading work

#### `optional-skills/finance/stocks/scripts/stocks_client.py` (source, 750 lines, 25 KB) — Tier 1
- **Purpose:** read-only market data from Yahoo Finance (un-official endpoint) with an optional
  Alpha Vantage enrichment: `quote`, `search`, `history`, `compare`, `crypto`.
- **Key abstractions:** `fetch_url(url, headers, retries=3)` (a cookie-jar-backed opener, because
  Yahoo's `quoteSummary` needs a session), `_fetch_crumb()`, `yf_url`, `yf_chart`, `yf_search`,
  `yf_quote_summary`, `av_overview`, `extract_quote_from_chart`, `extract_quote_summary_fields`,
  and the `cmd_*` functions.
- **Data flow:** symbol → chart endpoint (`v8/chart`) → normalise into a flat dict → optional
  `quoteSummary` enrichment (each field only fills a hole; `market_cap` always prefers the
  quoteSummary formatting) → optional Alpha Vantage → JSON out.
- **Non-obvious design decisions:**
  - **Every field starts as `None`, never a zero.** `price: None` and `pe_ratio: None` are
    distinguishable from `0`, so a missing quote can never be read as a real number.
  - **Enrichment is a fill-the-hole merge, not an overwrite**, with one deliberate exception
    (`market_cap` always takes the quoteSummary value because the chart payload's raw int is
    unformatted).
  - **The `change` is computed locally** from `regularMarketPrice` (falling back to
    `chartPreviousClose`) minus `previousClose` — the client does not trust a pre-computed change
    field.
  - **`history` computes its own stats** (min/max/avg/total_return_pct) from the closes it
    actually got, and skips `None` closes rather than treating them as zero.
  - **The output carries `data_source`** on every command ("Yahoo Finance", or "Yahoo Finance +
    Alpha Vantage") so the reader knows what the numbers came from.
- **Edge cases & failure handling:** a bad range prints `{"error": ..., "valid": [...]}`; a failed
  chart fetch returns an error object with the symbol and the data source; `cmd_compare` refuses
  fewer than two symbols; the 52-week performance computation is wrapped in
  `try/except (ValueError, TypeError, ZeroDivisionError)`.
- **Surprising:** `_cookie_jar` + `_opener` at module level — the session is shared across calls
  so the crumb stays valid.

#### `optional-skills/finance/polymarket/scripts/polymarket.py` (source, 284 lines, 10 KB) — Tier 1
- **Purpose:** read-only prediction-market data across three public APIs (Gamma for metadata, CLOB
  for prices/books, Data API for trades and open interest).
- **Key abstractions:** `GAMMA`/`CLOB`/`DATA` base URLs, `_get(url)`, `_parse_json_field(val)`,
  `_fmt_pct`, `_fmt_volume`, `_print_market`, and `cmd_search` / `cmd_trending` / `cmd_market` /
  `cmd_event` / `cmd_price` / `cmd_book` / `cmd_history` / `cmd_trades`.
- **Non-obvious design decisions:**
  - **`_parse_json_field` exists because Polymarket double-encodes some fields** — the SKILL.md has
    a whole section "Parsing Double-Encoded Fields"; a helper is the only correct way to read
    `outcomes`/`clobTokenIds`.
  - **Percentages are formatted, not raw.** A prediction-market price of `0.65` is meaningless
    without the percent, and the formatter is the single place that decides.
- **Edge cases & failure handling:** every endpoint is an unauthenticated GET returning JSON, so
  the failure surface is small; `cmd_price` prints the token id back so the caller can see what
  was actually priced.

#### `optional-skills/finance/dcf-model/scripts/validate_dcf.py` (source, 291 lines, 12 KB) — Tier 1
- **Purpose:** a `DCFModelValidator` that checks a produced DCF workbook before delivery, plus
  `validate_dcf_model(excel_path) -> dict` and a CLI.
- **Non-obvious design decisions:** the validator is a **separate executable**, not a note in the
  skill — a workbook is a build artefact and needs a gate that can fail the build. The DCF
  skill's own `TROUBLESHOOTING.md` is written around the validator's output (`#REF!` from
  formulas written before row positions were fixed; "Prevention: Define all row positions BEFORE
  writing formulas").
- **Why it transfers:** August Trading's own numeric surfaces (plan validation, backtest
  summaries, Monte Carlo outputs) have the same failure mode — a spreadsheet-shaped artefact whose
  errors are invisible until something reads it.

#### `optional-skills/finance/excel-author/scripts/recalc.py` (source, 88 lines, 2.8 KB) — Tier 1
- **Purpose:** recalculate an `.xlsx` with LibreOffice before delivery, so a workbook that was
  written with `openpyxl` (which stores formulas but no cached values) has real numbers in it.
- **Key abstractions:** `find_libreoffice()` (locate the binary), `recalc(xlsx_path, timeout=60) ->
  dict`, `main()`.
- **Non-obvious design decisions:** **recalculation is a mandatory delivery step, repeated in the
  header of every finance skill** ("Recalculate before delivery: `python
  /path/to/excel-author/scripts/recalc.py ./out/model.xlsx`"). A formula string is not a value, and
  the skill treats "the file opens with numbers" as part of the contract.

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/finance/3-statement-model/SKILL.md` | Integrated IS/BS/CF workbooks. The non-negotiables: **formulas over hardcodes**, margin analysis, and a **credit-metric hierarchy check**. |
| `optional-skills/finance/3-statement-model/references/formatting.md` | The banker format standard: hard-coded inputs in **blue**, formulas in black, cross-sheet links in **green**, check cells red-if-error/green-if-balanced, negatives in parentheses. |
| `optional-skills/finance/3-statement-model/references/formulas.md` | The linkage block (Assets = Liabilities + Equity; ΔCash = CFO+CFI+CFF; ending cash (CF) = cash (BS); RE roll-forward) and the warning that **Gross Profit must come from Net Revenue, not Gross Revenue**. |
| `optional-skills/finance/3-statement-model/references/sec-filings.md` | Pulling data from 10-K/10-Q: locate via EDGAR, and **check the reporting currency before extracting** ("in thousands of U.S. dollars"). |
| `optional-skills/finance/comps-analysis/SKILL.md` | Comparable-company workbooks: a **data-source priority** (MCP providers first, web fallback), operating statistics, a statistics block, notes/methodology documentation, and quality checks. Explicitly "DO use examples for structural hierarchy … DO NOT use examples for exact reproduction". |
| `optional-skills/finance/dcf-model/SKILL.md` | 49 KB DCF builder: data retrieval and validation, 3-5 year historicals, revenue and opex projections, FCF, WACC research, discount rate, terminal value, and **sensitivity analysis at the bottom of the DCF sheet**. |
| `optional-skills/finance/dcf-model/TROUBLESHOOTING.md` | Error-value and "unreasonable valuation" triage, plus the case-selector failure. |
| `optional-skills/finance/dcf-model/requirements.txt` | `openpyxl>=3.0.0`, `requests>=2.28.0`. |
| `optional-skills/finance/excel-author/SKILL.md` | The shared conventions: output contract (`./out/<name>.xlsx`, return the relative path, one logical model per file), the blue/black/green cell colour rule, formulas over hardcodes ("WRONG — silent bug waiting to happen"), **named ranges for cross-sheet references**, a **Balance checks tab**, and a **cell comment on every hardcoded input**. |
| `optional-skills/finance/lbo-model/SKILL.md` | LBO workbooks with IRR/MOIC. **Template-first**: if a template is attached, use it — "Never decide to 'build from scratch' when a template is provided." Then common problem areas: balancing, tax, circular references, debt paydown/cash sweeps, returns, sensitivity tables. |
| `optional-skills/finance/merger-model/SKILL.md` | Accretion/dilution: inputs → purchase price → sources & uses → pro-forma EPS → sensitivity → breakeven synergies → output. "MCP first, web fallback" for data. |
| `optional-skills/finance/polymarket/SKILL.md` | Prediction-market data: three public APIs, no auth; a "Typical Workflow"; **double-encoded field parsing**; rate limits; and stated limitations. |
| `optional-skills/finance/polymarket/references/api-endpoints.md` | The endpoint reference: CLOB price/midpoint/spread (token ids from `clobTokenIds`, index 0 = Yes, 1 = No), Gamma search/events/markets/tags, Data API trades and open interest. |
| `optional-skills/finance/pptx-author/SKILL.md` | Decks backed by a model: one idea per slide, **every number traces to the model**, firm template when mounted, "Charts: PNG-from-model beats native pptx charts", "No external sends". |
| `optional-skills/finance/stocks/SKILL.md` | Read-only Yahoo market data, stdlib only, no key — and the honest caveat that "Yahoo's endpoint is unofficial and may rate-limit or change". |
| `optional-skills/gaming/DESCRIPTION.md` | One line: game server / modpack / infrastructure skills. |
| `optional-skills/gaming/minecraft-modpack-server/SKILL.md` | Modded server setup that **gathers user preferences first** (server name/MOTD, player count, hardware) and then picks a `server.properties` tier from the machine. |
| `optional-skills/gaming/pokemon-player/SKILL.md` | Headless emulator play with live dashboard; the gameplay loop is **OBSERVE — check state AND take a screenshot**. |
| `optional-skills/health/DESCRIPTION.md` | One line: BCI / neurofeedback / sleep / cognitive-state skills. |
| `optional-skills/health/fitness-nutrition/SKILL.md` | Two free APIs (wger, USDA) plus offline calculators; `DEMO_KEY` works without signup. |
| `optional-skills/health/fitness-nutrition/references/FORMULAS.md` | The formula reference (BMI, TDEE Mifflin-St Jeor, 1RM Epley/Brzycki/Lombardi, macro splits, US-Navy body fat). |
| `optional-skills/health/fitness-nutrition/scripts/body_calc.py` | 210 lines: the five calculators with their category tables. |
| `optional-skills/health/fitness-nutrition/scripts/nutrition_search.py` | 85 lines: USDA search + display. |
| `optional-skills/health/neuroskill-bci/SKILL.md` | Live BCI state; **research-use-only warning** ("NOT a medical device … Never use these metrics for clinical diagnosis"). |
| `optional-skills/health/neuroskill-bci/references/api.md` | Local server + mDNS discovery, WebSocket event shapes, and a "universal command tunnel" HTTP endpoint. |
| `optional-skills/health/neuroskill-bci/references/metrics.md` | The metric definitions: sampling rates, the preprocessing pipeline, composite scores (focus = σ(β/(α+θ))) with their thresholds, motion/artifact detection, sleep staging. |
| `optional-skills/health/neuroskill-bci/references/protocols.md` | 70+ protocols keyed to one salient signal; **"Always ask before starting"**; contraindications for Wim Hof / hyperventilation. |
| `optional-skills/mcp/DESCRIPTION.md` | One line: build/test/deploy MCP servers. |
| `optional-skills/mcp/fastmcp/SKILL.md` | Build an MCP server in Python: pick the **smallest viable server shape**, scaffold, **implement tools first**, add resources/prompts only when they help, test before integrating, install only after local validation. |
| `optional-skills/mcp/fastmcp/references/fastmcp-cli.md` | The FastMCP CLI reference and deployment checks. |
| `optional-skills/mcp/fastmcp/scripts/scaffold_fastmcp.py` | 56 lines: renders one of three templates with a `__SERVER_NAME__` placeholder. |
| `optional-skills/mcp/fastmcp/templates/api_wrapper.py` | 54 lines: a token-from-env API wrapper with a timeout and a `health_check` tool. |
| `optional-skills/mcp/fastmcp/templates/database_server.py` | 77 lines: a **read-only** SQLite server — `_reject_mutation(sql)` blocks non-SELECT statements, the table name is regex-validated, and every query is row-capped. |
| `optional-skills/mcp/fastmcp/templates/file_processor.py` | 55 lines: text read/summarise/search with a preview cap and a max-match cap. |
| `optional-skills/mcp/mcp-oauth-remote-gateway/SKILL.md` | Why the built-in OAuth flow breaks on a remote gateway (the loopback `redirect_uri` resolves to the user's laptop, not the container) and the manual PKCE + dynamic-registration workaround. |
| `optional-skills/mcp/mcp-oauth-remote-gateway/references/stripe-mcp-oauth-revocation.md` | A worked "it dies after a while" case: three wrong hypotheses, the real cause (server-side grant revocation), and the durable fix (drop OAuth for a restricted API key) with a decision rule. |
| `optional-skills/mcp/mcp-oauth-remote-gateway/scripts/diagnose-oauth-mcp.py` | 178 lines: token discovery, metadata discovery, and an `_mcp_initialize` probe. |
| `optional-skills/mcp/mcporter/SKILL.md` | Discover, call and manage MCP servers from the terminal (`npx mcporter list`, call by tool name, connect by URL without config). |
| `optional-skills/migration/DESCRIPTION.md` | One line: import user state from other agent systems. |
| `optional-skills/migration/openclaw-migration/SKILL.md` | The OpenClaw → Hermes migration: path resolution, an interactive protocol, a **decision-to-command mapping**, post-run reporting rules, and presets (e.g. `user-data` = migrate without secrets). |

#### `optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py` (source, 3253 lines, 150 KB) — Tier 1
- **Purpose:** a whole-system importer: memories, skills, SOUL/persona, workspace instructions,
  provider keys, model config, cron jobs, hooks, MCP servers, agents, approvals and UI identity.
- **Key abstractions:** the `Migrator` class (≈70 methods, one per domain), `ItemResult`,
  `load_yaml_file`/`dump_yaml_file`/`parse_env_file`/`save_env_file`, `merge_entries`,
  `rebrand_text`, `redact_migration_value`, `write_report`, `backup_existing`.
- **Non-obvious design decisions:**
  - **The report is redacted before it is written, but the in-process object is not.**
    `write_report` calls `redact_migration_value(report)` and only persists the redacted copy
    ("Callers who need the raw object (in-process) still get it back from `build_report()`; only
    the on-disk copy is redacted"). This is the right shape for an audit artefact.
  - **Redaction is two-layered**: whole-value replacement for keys whose normalised form matches a
    credential marker (`accesstoken`, `apikey`, `authorization`, `bearertoken`, `clientsecret`,
    `cookie`, `credential`, `password`, `privatekey`, `refreshtoken`, `secret`, plus anything
    ending in `token`), *and* inline regex replacement inside any string for `Bearer …`, `sk-…`,
    `ghp_…`, `xox…`, `AIza…`. A cycle in the object graph is handled by a `seen` set.
  - **Every item gets a status**: `migrated`, `archived`, `skipped`, `conflict`, `error`,
    `planned`, each with a named reason constant — and the Markdown summary has a dedicated
    section, **"What Was Not Fully Brought Over"**, listing every skipped/conflict/error item with
    its source, destination and reason. A migration that silently drops things is the failure
    mode this section exists to prevent.
  - **Conflicts are a mode, not a crash**: `SKILL_CONFLICT_MODES = {"skip", "overwrite", "rename"}`
    — renaming is how a migration avoids clobbering an existing skill.
  - **Secrets are handled by target allow-list** (`SUPPORTED_SECRET_TARGETS`), and the
    `user-data` preset deliberately omits them.
  - **Backups before overwrites** (`backup_existing` → `backup_root`).
- **Edge cases & failure handling:** YAML load errors raise a typed `ConfigReadError`; text is
  normalised before comparison; entries beyond a character limit are written to an overflow file
  rather than truncated silently.


### `optional-skills/mlops/` (indices 433-573) — the largest block, and the least relevant to trading

This whole subtree is MLOps documentation for third-party training and serving tools. It is
catalogued here with one line per file because the *set* is the unit: it is a **tool-by-tool
cheat-sheet collection** in which each skill follows the same house shape — `SKILL.md` with YAML
frontmatter (`name`, `description`, `version`, `author`, `license`, `dependencies`, `platforms`,
`metadata.hermes.tags`), a "When to use", a "Quick start" of copy-pasteable commands, and a
`references/` directory of longer pages. The value for August Trading is therefore in the
**pattern** (a skill is a procedure + a verification step + a pitfalls list), not in any single
tool.

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/mlops/accelerate/SKILL.md` | HuggingFace Accelerate: distributed training in 4 changed lines; single→multi GPU, mixed precision (FP16 with scaler, BF16, FP8). |
| `optional-skills/mlops/accelerate/references/custom-plugins.md` | Plugin architecture: `GradScalerKwargs`, `DistributedDataParallelKwargs`, `FP8RecipeKwargs`. |
| `optional-skills/mlops/accelerate/references/megatron-integration.md` | Megatron-LM: tensor / pipeline / data / sequence parallelism. |
| `optional-skills/mlops/accelerate/references/performance.md` | Profiling (warmup, PyTorch profiler → Chrome tracing), gradient accumulation, memory optimisation. |
| `optional-skills/mlops/chroma/SKILL.md` | Chroma: an embedding DB for RAG and semantic search. |
| `optional-skills/mlops/chroma/references/integration.md` | LangChain / LlamaIndex integration and retriever use. |
| `optional-skills/mlops/clip/SKILL.md` | CLIP: zero-shot image classification and image-text search. |
| `optional-skills/mlops/clip/references/applications.md` | Worked zero-shot classification recipes. |
| `optional-skills/mlops/evaluation/DESCRIPTION.md` | One line: evaluation, experiment tracking, curation, tokenizers, interpretability. |
| `optional-skills/mlops/evaluation/evaluating-llms-harness/SKILL.md` | lm-eval-harness: 60+ benchmarks (MMLU, HumanEval, GSM8K, TruthfulQA, HellaSwag) across HF / vLLM / API backends. |
| `optional-skills/mlops/evaluation/evaluating-llms-harness/references/api-evaluation.md` | Evaluating API models (OpenAI, Anthropic, completions vs chat). |
| `optional-skills/mlops/evaluation/evaluating-llms-harness/references/benchmark-guide.md` | What each benchmark measures and how to read the number. |
| `optional-skills/mlops/evaluation/evaluating-llms-harness/references/custom-tasks.md` | Writing domain-specific eval tasks — the mechanism for a project-specific score. |
| `optional-skills/mlops/evaluation/evaluating-llms-harness/references/distributed-eval.md` | Data / tensor parallelism for evaluation. |
| `optional-skills/mlops/evaluation/weights-and-biases/SKILL.md` | W&B: experiment logging, sweeps, model registry, dashboards. |
| `optional-skills/mlops/evaluation/weights-and-biases/references/artifacts.md` | Dataset and model versioning as artifacts. |
| `optional-skills/mlops/evaluation/weights-and-biases/references/integrations.md` | Framework integrations (HF Trainer, etc.). |
| `optional-skills/mlops/evaluation/weights-and-biases/references/sweeps.md` | Hyperparameter sweep configuration. |
| `optional-skills/mlops/faiss/SKILL.md` | FAISS: billion-scale vector similarity search. |
| `optional-skills/mlops/faiss/references/index_types.md` | Index selection guide (flat vs IVF vs HNSW etc.). |
| `optional-skills/mlops/flash-attention/SKILL.md` | Flash Attention: 2-4× speed, 10-20× memory reduction via IO-aware tiling and recomputation. |
| `optional-skills/mlops/flash-attention/references/benchmarks.md` | Per-GPU speed tables. |
| `optional-skills/mlops/flash-attention/references/transformers-integration.md` | Enabling `flash_attention_2` per architecture. |
| `optional-skills/mlops/guidance/SKILL.md` | Guidance: constrain LLM output with grammars/regex so JSON is guaranteed valid. |
| `optional-skills/mlops/guidance/references/backends.md` | Per-backend configuration. |
| `optional-skills/mlops/guidance/references/constraints.md` | Regex constraints, grammar generation, token healing. |
| `optional-skills/mlops/guidance/references/examples.md` | Production examples (JSON, agents, workflows). |
| `optional-skills/mlops/huggingface-tokenizers/SKILL.md` | Fast BPE/WordPiece tokenization and custom vocabulary training. |
| `optional-skills/mlops/huggingface-tokenizers/references/algorithms.md` | BPE / WordPiece / Unigram, step by step. |
| `optional-skills/mlops/huggingface-tokenizers/references/integration.md` | `AutoTokenizer` and fast-tokenizer checks. |
| `optional-skills/mlops/huggingface-tokenizers/references/pipeline.md` | Normalizers, pre-tokenizers, models, post-processors, decoders. |
| `optional-skills/mlops/huggingface-tokenizers/references/training.md` | Training a tokenizer from scratch. |
| `optional-skills/mlops/inference/DESCRIPTION.md` | One line: model serving, quantisation, structured output, inference optimisation. |
| `optional-skills/mlops/inference/llama-cpp/SKILL.md` | llama.cpp + GGUF: local inference, quant selection, HF Hub discovery. |
| `optional-skills/mlops/inference/llama-cpp/references/advanced-usage.md` | Speculative decoding (draft model, self-speculative). |
| `optional-skills/mlops/inference/llama-cpp/references/hub-discovery.md` | URL-only workflows to find a GGUF and its quant. |
| `optional-skills/mlops/inference/llama-cpp/references/optimization.md` | Thread tuning and CPU matrix advice. |
| `optional-skills/mlops/inference/llama-cpp/references/quantization.md` | GGUF quant formats and conversion. |
| `optional-skills/mlops/inference/llama-cpp/references/server.md` | `llama-server` deployment with an OpenAI-compatible API. |
| `optional-skills/mlops/inference/llama-cpp/references/troubleshooting.md` | Build and runtime triage. |
| `optional-skills/mlops/inference/outlines/SKILL.md` | Outlines: structured JSON / regex / Pydantic generation. |
| `optional-skills/mlops/inference/outlines/references/backends.md` | Per-backend setup. |
| `optional-skills/mlops/inference/outlines/references/examples.md` | Extraction and classification examples. |
| `optional-skills/mlops/inference/outlines/references/json_generation.md` | JSON generation with Pydantic models and schemas. |
| `optional-skills/mlops/inference/serving-llms-vllm/SKILL.md` | vLLM: high-throughput serving, OpenAI-compatible API, quantisation, tensor parallelism. |
| `optional-skills/mlops/inference/serving-llms-vllm/references/optimization.md` | PagedAttention and block-size tuning. |
| `optional-skills/mlops/inference/serving-llms-vllm/references/quantization.md` | AWQ / GPTQ / FP8 comparison and setup. |
| `optional-skills/mlops/inference/serving-llms-vllm/references/server-deployment.md` | Docker and Kubernetes deployment patterns. |
| `optional-skills/mlops/inference/serving-llms-vllm/references/troubleshooting.md` | OOM triage (load-time vs inference-time). |
| `optional-skills/mlops/instructor/SKILL.md` | Instructor: structured LLM output validated with Pydantic. |
| `optional-skills/mlops/instructor/references/examples.md` | Extraction, classification, multi-entity, batch. |
| `optional-skills/mlops/instructor/references/providers.md` | Provider configuration (Anthropic recommended mode, etc.). |
| `optional-skills/mlops/instructor/references/validation.md` | Advanced validation patterns and automatic retry with error feedback. |
| `optional-skills/mlops/lambda-labs/SKILL.md` | On-demand GPU cloud instances. |
| `optional-skills/mlops/lambda-labs/references/advanced-usage.md` | Multi-node DDP. |
| `optional-skills/mlops/lambda-labs/references/troubleshooting.md` | Launch failures, region fallbacks. |
| `optional-skills/mlops/llava/SKILL.md` | LLaVA: vision-language chat (VQA, captioning, image dialogue). |
| `optional-skills/mlops/llava/references/training.md` | The two training stages (feature alignment, then visual instruction tuning). |
| `optional-skills/mlops/modal/SKILL.md` | Modal serverless GPU for jobs and model APIs. |
| `optional-skills/mlops/modal/references/advanced-usage.md` | Multi-GPU and container configuration. |
| `optional-skills/mlops/modal/references/troubleshooting.md` | Auth and install triage. |
| `optional-skills/mlops/models/DESCRIPTION.md` | One line: specific model architectures and tools. |
| `optional-skills/mlops/models/huggingface-hub/SKILL.md` | The `hf` CLI (replaces the deprecated `huggingface-cli`). |
| `optional-skills/mlops/models/segment-anything-model/SKILL.md` | SAM: zero-shot segmentation via points/boxes/masks. |
| `optional-skills/mlops/models/segment-anything-model/references/advanced-usage.md` | SAM 2 video segmentation. |
| `optional-skills/mlops/models/segment-anything-model/references/troubleshooting.md` | CUDA and dependency triage. |
| `optional-skills/mlops/nemo-curator/SKILL.md` | NeMo Curator: GPU data curation with dedupe, filtering, PII redaction. |
| `optional-skills/mlops/nemo-curator/references/deduplication.md` | Exact / fuzzy / semantic dedup comparison. |
| `optional-skills/mlops/nemo-curator/references/filtering.md` | 30+ quality filters (word count, repeated-line ratio, …). |
| `optional-skills/mlops/obliteratus/SKILL.md` | OBLITERATUS: refusal abliteration by diff-in-means, 9 methods / 28 analysis modules / 116 presets. |
| `optional-skills/mlops/obliteratus/references/analysis-modules.md` | The 28 interpretability modules. |
| `optional-skills/mlops/obliteratus/references/methods-guide.md` | The 9 abliteration methods and their trade-offs. |
| `optional-skills/mlops/obliteratus/templates/abliteration-config.yaml` | A reproducible, version-controlled run config. |
| `optional-skills/mlops/obliteratus/templates/analysis-study.yaml` | An analysis-before-abliteration study config. |
| `optional-skills/mlops/obliteratus/templates/batch-abliteration.yaml` | Batch runs of the same method across models for comparison. |
| `optional-skills/mlops/peft/SKILL.md` | PEFT/LoRA/QLoRA: fine-tune with <1% of parameters. |
| `optional-skills/mlops/peft/references/advanced-usage.md` | DoRA, AdaLoRA, LoRA+ variants. |
| `optional-skills/mlops/peft/references/troubleshooting.md` | bitsandbytes/CUDA triage. |
| `optional-skills/mlops/pinecone/SKILL.md` | Managed vector DB for production RAG. |
| `optional-skills/mlops/pinecone/references/deployment.md` | Serverless vs pod-based, hybrid search. |
| `optional-skills/mlops/pytorch-fsdp/SKILL.md` | FSDP for large-model training (generated from official docs). |
| `optional-skills/mlops/pytorch-fsdp/references/common-patterns.md` | **Skipped (tier 3):** 158 KB generated dump of the PyTorch FSDP API; catalogued by size, head and heading index. |
| `optional-skills/mlops/pytorch-fsdp/references/index.md` | The doc index (one line). |
| `optional-skills/mlops/pytorch-fsdp/references/other.md` | **Skipped (tier 3):** 338 KB generated dump (15 pages of distributed-API docs); catalogued by size, head and heading index. |
| `optional-skills/mlops/pytorch-lightning/SKILL.md` | LightningModule + Trainer: training loops without boilerplate. |
| `optional-skills/mlops/pytorch-lightning/references/callbacks.md` | Callbacks for checkpointing, early stopping, logging. |
| `optional-skills/mlops/pytorch-lightning/references/distributed.md` | DDP and other strategies with one parameter change. |
| `optional-skills/mlops/pytorch-lightning/references/hyperparameter-tuning.md` | Ray Tune integration. |
| `optional-skills/mlops/qdrant/SKILL.md` | Qdrant: Rust vector search engine for production RAG. |
| `optional-skills/mlops/qdrant/references/advanced-usage.md` | Cluster setup and sharding. |
| `optional-skills/mlops/qdrant/references/troubleshooting.md` | Docker and port triage. |
| `optional-skills/mlops/research/DESCRIPTION.md` | One line: declarative ML research frameworks. |
| `optional-skills/mlops/research/dspy/SKILL.md` | DSPy: declarative LM programs with auto-optimised prompts and RAG. |
| `optional-skills/mlops/research/dspy/references/examples.md` | RAG and agent examples. |
| `optional-skills/mlops/research/dspy/references/modules.md` | The built-in modules (Predict, etc.). |
| `optional-skills/mlops/research/dspy/references/optimizers.md` | The optimisers (BootstrapFewShot, …) and how to pick one. |
| `optional-skills/mlops/saelens/SKILL.md` | SAELens: training sparse autoencoders to interpret model features. |
| `optional-skills/mlops/saelens/references/README.md` | The reference index. |
| `optional-skills/mlops/saelens/references/api.md` | The `SAE` class API. |
| `optional-skills/mlops/saelens/references/tutorials.md` | Loading and analysing pre-trained SAEs. |
| `optional-skills/mlops/simpo/SKILL.md` | SimPO: reference-free preference alignment, simpler than DPO. |
| `optional-skills/mlops/simpo/references/datasets.md` | Dataset format and popular preference datasets. |
| `optional-skills/mlops/simpo/references/hyperparameters.md` | LR and other hyperparameter guidance. |
| `optional-skills/mlops/simpo/references/loss-functions.md` | The SimPO loss (sigmoid / hinge). |
| `optional-skills/mlops/slime/SKILL.md` | slime: RL post-training with Megatron + SGLang. |
| `optional-skills/mlops/slime/references/api-reference.md` | The three-module Ray architecture and core types. |
| `optional-skills/mlops/slime/references/troubleshooting.md` | SGLang, weight-sync and memory issues. |
| `optional-skills/mlops/stable-diffusion/SKILL.md` | Stable Diffusion: text-to-image, inpainting, img2img. |
| `optional-skills/mlops/stable-diffusion/references/advanced-usage.md` | Custom pipelines and a custom denoising loop. |
| `optional-skills/mlops/stable-diffusion/references/troubleshooting.md` | Package conflicts, xFormers. |
| `optional-skills/mlops/tensorrt-llm/SKILL.md` | TensorRT-LLM: NVIDIA high-throughput inference. |
| `optional-skills/mlops/tensorrt-llm/references/multi-gpu.md` | Tensor and pipeline parallelism. |
| `optional-skills/mlops/tensorrt-llm/references/optimization.md` | FP8 / INT4 quantisation and calibration. |
| `optional-skills/mlops/tensorrt-llm/references/serving.md` | `trtllm-serve` and the OpenAI-compatible API. |
| `optional-skills/mlops/torchtitan/SKILL.md` | TorchTitan: composable 4D parallelism pretraining. |
| `optional-skills/mlops/torchtitan/references/checkpoint.md` | PyTorch DCP fault-tolerant checkpointing. |
| `optional-skills/mlops/torchtitan/references/custom-models.md` | Adding a model following the repo's patterns. |
| `optional-skills/mlops/torchtitan/references/float8.md` | Float8 training with tensorwise/rowwise scaling. |
| `optional-skills/mlops/torchtitan/references/fsdp.md` | FSDP2 vs FSDP1. |
| `optional-skills/mlops/training/axolotl/SKILL.md` | Axolotl: YAML fine-tuning (LoRA, DPO, GRPO), 100+ models. |
| `optional-skills/mlops/training/axolotl/references/api.md` | **Skipped (tier 3):** 121 KB generated API dump (150 pages). |
| `optional-skills/mlops/training/axolotl/references/dataset-formats.md` | 46 KB of dataset format documentation (9 pages). |
| `optional-skills/mlops/training/axolotl/references/index.md` | The doc index. |
| `optional-skills/mlops/training/axolotl/references/other.md` | **Skipped (tier 3):** 140 KB generated dump (26 pages). |
| `optional-skills/mlops/training/trl-fine-tuning/SKILL.md` | TRL: SFT, DPO, GRPO, RLOO. |
| `optional-skills/mlops/training/trl-fine-tuning/references/dpo-variants.md` | Sigmoid / IPO / hinge DPO losses. |
| `optional-skills/mlops/training/trl-fine-tuning/references/grpo-training.md` | 16 KB deep guide to GRPOTrainer and reward-function design. |
| `optional-skills/mlops/training/trl-fine-tuning/references/online-rl.md` | PPO / GRPO / RLOO / OnlineDPO. |
| `optional-skills/mlops/training/trl-fine-tuning/references/reward-modeling.md` | Training a reward model. |
| `optional-skills/mlops/training/trl-fine-tuning/references/sft-training.md` | SFT dataset formats. |
| `optional-skills/mlops/training/trl-fine-tuning/templates/basic_grpo_training.py` | 228 lines: a GRPO run with a **correctness reward function, a format reward function, and an incremental-format reward function** — three separable reward terms. |
| `optional-skills/mlops/training/unsloth/SKILL.md` | Unsloth: 2-5× faster LoRA/QLoRA with less VRAM. |
| `optional-skills/mlops/training/unsloth/references/index.md` | The doc index. |
| `optional-skills/mlops/training/unsloth/references/llms-full.md` | **Skipped (tier 3):** 1.05 MB generated documentation dump. |
| `optional-skills/mlops/training/unsloth/references/llms-txt.md` | **Skipped (tier 3):** 813 KB llms.txt dump (136 pages). |
| `optional-skills/mlops/training/unsloth/references/llms.md` | 12 KB pointer document. |
| `optional-skills/mlops/whisper/SKILL.md` | Whisper: transcription and translation in 99 languages. |
| `optional-skills/mlops/whisper/references/languages.md` | The 99 languages with WER bands. |

### `optional-skills/payments/` + `productivity/` (indices 574-593)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/payments/mpp-agent/SKILL.md` | Pay HTTP 402 APIs via the Machine Payments Protocol; three client options, "pick the lightest one that solves the user's need". |
| `optional-skills/payments/stripe-link-cli/SKILL.md` | Agent purchases via Stripe Link (one-time virtual cards, shared payment tokens). "**Every spend is gated by an in-app approval in the Link mobile/web app — Hermes cannot self-approve.**" |
| `optional-skills/payments/stripe-projects/SKILL.md` | Provision SaaS services and sync credentials into the user's `.env` via the Stripe Projects CLI. |
| `optional-skills/productivity/canvas/SKILL.md` | Read-only Canvas LMS: list courses and assignments with an API token. |
| `optional-skills/productivity/canvas/scripts/canvas_api.py` | 160 lines: `_paginated_get(url, params, max_items=200)` — a bounded paginator, plus a config check that fails loudly when the token/base URL are unset. |
| `optional-skills/productivity/decision-questionnaire/SKILL.md` | Turn an unanswerable decision into a **questionnaire document** for one person to fill in async. The core principle: "Interview the Send, Not the Subject." |
| `optional-skills/productivity/here-now/SKILL.md` | Publish sites to a hosted slug and store private files in Drives. |
| `optional-skills/productivity/here-now/scripts/drive.sh` | 406 lines: Drive upload with a **hard size cap** (`MAX_FILE_BYTES = 500 MB`), a bundled `jq`, and `ALLOW_NON_HERENOW_BASE_URL=0` — a guard that refuses to send data anywhere but the expected host unless explicitly enabled. |
| `optional-skills/productivity/here-now/scripts/publish.sh` | 445 lines: multi-part upload → finalize → claim, with a `.herenow/state.json` record of every publish (slug, version id, site URL) so a later run can update rather than duplicate. |

#### `optional-skills/productivity/memento-flashcards/scripts/memento_cards.py` (source, 353 lines, 11 KB) — Tier 1
- **Purpose:** a local, file-based spaced-repetition flashcard system: `add`, `add-quiz`, `due`,
  `rate`, `list`, `stats`, `export`, `import`, `delete`, `delete-collection`.
- **Key abstractions:** `CARDS_FILE` under `$HERMES_HOME/skills/productivity/memento-flashcards/data/cards.json`,
  a **`RETIRED_SENTINEL = "9999-12-31T23:59:59+00:00"**, `_load`/`_save` (atomic), and the
  command functions.
- **Non-obvious design decisions:**
  - **Retirement is a sentinel date, not a fourth status.** A retired card is still in the file
    with a due date of `9999-12-31`, so the scheduler needs no special case and the card's history
    survives. This is the same trick August Trading's own `skillIdleLifecycle` uses
    (`enabled: false` plus `meta.suspendedAt`, not a fourth `SkillStatus`).
  - **The store is one JSON file** under the agent's home — no database, and the file is the
    artefact a user can read, diff or copy.
  - **`stats`** aggregates over the store, so the schedule's health is visible without opening it.
- **Why it transfers:** it is a working example of "a learning loop whose artefacts are files, and
  whose retirement is expressed as data rather than as a new state machine case".

#### `optional-skills/productivity/live-dashboard/SKILL.md` (docs, 8.3 KB) — Tier 1 (design entry)
- **Purpose:** turn one sentence into a **persistent, self-refreshing status page** — exactly the
  shape of a trading monitor.
- **The contract (step 1):** pin the purpose, the entities (rows), the fields (columns), what
  "needs attention" means, **the source each field is read from**, and the cadence. "Done when
  every field on the dashboard names the source it will be read from." A dashboard that tracks the
  wrong grain is worthless.
- **The tick (steps 5-7):**
  1. **Re-read and diff** at field level. "A failed source read means unknown state: keep the last
     good value, mark the field stale with the failure time, and **never overwrite good data with
     an error**."
  2. **Update state, re-render.** `dashboard.json` is the contract *plus* current state: per-field
     value, **per-field source + retrieval timestamp**, a `needs_attention` list and an
     **append-only change log (most recent first)**. `index.html` is regenerated from the JSON on
     every refresh — "never hand-edit HTML state".
  3. **Deliver on material change, else stay silent.** Otherwise respond with `[SILENT]` — "no
     'still watching' noise unless the user asked for a periodic digest."
- **The non-negotiables (pitfalls):** verify each source with one live read **before** scheduling;
  never overwrite last-known-good values with an error page; **`dashboard.json` is the source of
  truth, HTML is a projection**; alert on material change only; resolve the Hermes home path from
  the running install and write absolute paths into the cron prompt.
- **The verification checklist:** every field names its source and passed a foreground read; JSON
  and HTML agree and every value carries a retrieval timestamp; failed reads mark fields stale
  without destroying state; no-change runs were `[SILENT]`; the change log replays the dashboard's
  history **from the state file alone**.


### `optional-skills/research/` (indices 591-699)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/research/bioinformatics/SKILL.md` | A **gateway** skill: instead of bundling hundreds of domain skills, it indexes two external libraries and fetches what it needs on demand. |
| `optional-skills/research/blogwatcher/SKILL.md` | Track blog and RSS/Atom updates with `blogwatcher-cli`; the section "Working with Hermes tools (read this first)" resolves the tool-vs-CLI boundary. |
| `optional-skills/research/darwinian-evolver/SKILL.md` | Run an LLM-driven **evolutionary search loop** to optimise a prompt, regex, SQL query or code artefact. |
| `optional-skills/research/darwinian-evolver/scripts/parrot_openrouter.py` | 218 lines: the worked example — an `Organism`, a `Mutator`, an `Evaluator` and an `EvaluationFailureCase` subclass, showing the four pieces any evolved artefact needs. |
| `optional-skills/research/darwinian-evolver/scripts/show_snapshot.py` | 92 lines: print a snapshot of the evolution run. |
| `optional-skills/research/darwinian-evolver/templates/custom_problem_template.py` | 240 lines: the template for a custom problem (organism / failure case / evaluator / mutator / `make_problem`). |
| `optional-skills/research/domain-intel/SKILL.md` | Passive OSINT: subdomains (CT logs), SSL inspection, WHOIS, DNS — stdlib only, no keys. |
| `optional-skills/research/domain-intel/scripts/domain_intel.py` | 397 lines: the four lookups plus `bulk_check(domains, checks, max_workers=5)`. |
| `optional-skills/research/drug-discovery/SKILL.md` | ChEMBL search, drug-likeness, interactions. |
| `optional-skills/research/drug-discovery/references/ADMET_REFERENCE.md` | Lipinski Ro5, Veber, BBB penetration, CYP450. |
| `optional-skills/research/drug-discovery/scripts/chembl_target.py` | 53 lines: target/compound lookup. |
| `optional-skills/research/drug-discovery/scripts/ro5_screen.py` | 44 lines: fetch PubChem properties and screen them against the rule sets. |
| `optional-skills/research/duckduckgo-search/SKILL.md` | Free keyless web/news/image search; a **detection flow** (is the CLI there? is the package there?) and a stated fallback role when the main web-search toolset is unconfigured. |
| `optional-skills/research/duckduckgo-search/scripts/duckduckgo.sh` | 28 lines: a thin query wrapper. |
| `optional-skills/research/gitnexus-explorer/SKILL.md` | Index a codebase into a knowledge graph and serve an interactive web UI for symbols, call chains, clusters and execution flows. |
| `optional-skills/research/gitnexus-explorer/scripts/proxy.mjs` | 92 lines: a static+API proxy in front of the graph UI. |
| `optional-skills/research/osint-investigation/SKILL.md` | Public-records cross-reference framework: government contracts, corporate filings, lobbying, sanctions, offshore leaks, property records. |
| `optional-skills/research/osint-investigation/references/sources/courtlistener.md` | CourtListener: summary, access methods, data schema, coverage, cross-reference potential. |
| `optional-skills/research/osint-investigation/references/sources/gdelt.md` | GDELT: global news monitoring. |
| `optional-skills/research/osint-investigation/references/sources/icij-offshore.md` | ICIJ Offshore Leaks. |
| `optional-skills/research/osint-investigation/references/sources/nyc-acris.md` | NYC property records. |
| `optional-skills/research/osint-investigation/references/sources/ofac-sdn.md` | OFAC SDN. |
| `optional-skills/research/osint-investigation/references/sources/opencorporates.md` | OpenCorporates. |
| `optional-skills/research/osint-investigation/references/sources/sec-edgar.md` | SEC EDGAR. |
| `optional-skills/research/osint-investigation/references/sources/senate-ld.md` | Senate lobbying disclosures. |
| `optional-skills/research/osint-investigation/references/sources/usaspending.md` | USAspending. |
| `optional-skills/research/osint-investigation/references/sources/wayback.md` | Wayback CDX. |
| `optional-skills/research/osint-investigation/references/sources/wikipedia.md` | Wikipedia + Wikidata. |
| `optional-skills/research/osint-investigation/scripts/_http.py` | 82 lines: the shared HTTP client (a descriptive User-Agent, retries, timeouts). |
| `optional-skills/research/osint-investigation/scripts/_normalize.py` | 67 lines: name normalisation at three strengths + `token_overlap_ratio` — the fuzzy-match primitive. |
| `optional-skills/research/osint-investigation/scripts/build_findings.py` | 221 lines: `CONFIDENCE_ORDER` and `SEVERITY_ORDER` — findings are **ranked**, and confidence is a first-class field. |
| `optional-skills/research/osint-investigation/scripts/entity_resolution.py` | 228 lines: resolve names to entities with a confidence label per match. |
| `optional-skills/research/osint-investigation/scripts/fetch_courtlistener.py` | 149 lines: column-mapped fetch into a normalised CSV. |
| `optional-skills/research/osint-investigation/scripts/fetch_gdelt.py` | 161 lines: the same shape for GDELT. |
| `optional-skills/research/osint-investigation/scripts/fetch_icij_offshore.py` | 234 lines: downloads and caches the bulk zip, then filters rows by normalised name. |
| `optional-skills/research/osint-investigation/scripts/fetch_nyc_acris.py` | 203 lines: two Socrata endpoints merged into one row shape. |
| `optional-skills/research/osint-investigation/scripts/fetch_ofac_sdn.py` | 175 lines: three SDN CSVs (SDN, ADD, ALT) merged into one column set. |
| `optional-skills/research/osint-investigation/scripts/fetch_opencorporates.py` | 191 lines: API path with an HTML fallback. |
| `optional-skills/research/osint-investigation/scripts/fetch_sec_edgar.py` | 184 lines: ticker → CIK resolution, then the submissions JSON. |
| `optional-skills/research/osint-investigation/scripts/fetch_senate_ld.py` | 146 lines: the lobbying API. |
| `optional-skills/research/osint-investigation/scripts/fetch_usaspending.py` | 170 lines: a POST search normalised to the same columns. |
| `optional-skills/research/osint-investigation/scripts/fetch_wayback.py` | 142 lines: CDX queries. |
| `optional-skills/research/osint-investigation/scripts/fetch_wikipedia.py` | 266 lines: OpenSearch → summary → Wikidata QID resolution. |
| `optional-skills/research/osint-investigation/scripts/timing_analysis.py` | 252 lines: **date-proximity analysis** — "nearest distance" between a donation date and a set of award dates, with date-format parsing across five formats. The shape of a "did these two events happen near each other?" test. |
| `optional-skills/research/osint-investigation/templates/source-template.md` | The per-source card template (Summary / Access / Schema / Coverage / Cross-Reference Potential). |
| `optional-skills/research/parallel-cli/SKILL.md` | A third-party search/extract/research/enrichment CLI, explicitly "not a Hermes core capability". |
| `optional-skills/research/pinecone-research/SKILL.md` | Pinecone as the RAG and long-term-memory backend for agent conversations. |
| `optional-skills/research/pinecone-research/scripts/memory_manager.py` | 155 lines: `store_memory` / `recall_memories` / `cleanup_session` / `show_stats` — memory with an explicit **session-scoped cleanup**. |
| `optional-skills/research/pinecone-research/scripts/rag_pipeline.py` | 156 lines: index creation, document loading, batched indexing, top-k query. |
| `optional-skills/research/qmd/SKILL.md` | Local, on-device hybrid search over notes, docs and transcripts. |
| `optional-skills/research/research-paper-writing/SKILL.md` | 72 KB end-to-end paper pipeline: "This is **not a linear pipeline** — it is an iterative loop. Results trigger new experiments. Reviews trigger new analysis. The agent must handle these feedback loops." |
| `optional-skills/research/research-paper-writing/references/autoreason-methodology.md` | The Autoreason iterative-refinement loop: architecture, roles, configuration, prompts. |
| `optional-skills/research/research-paper-writing/references/checklists.md` | Conference checklists — "missing them results in desk rejection"; the NeurIPS 16 required items and the response format. |
| `optional-skills/research/research-paper-writing/references/citation-workflow.md` | Citation verification to prevent AI-generated citation hallucination. |
| `optional-skills/research/research-paper-writing/references/experiment-patterns.md` | Evaluation protocols: blind judge panels, code/objective evaluation, compute-matched comparison, human evaluation design, plus monitoring and failure recovery. |
| `optional-skills/research/research-paper-writing/references/human-evaluation.md` | Designing, running and reporting human evaluations, with annotation-guideline structure. |
| `optional-skills/research/research-paper-writing/references/paper-types.md` | Theory, survey/tutorial, benchmark/dataset and position papers. |
| `optional-skills/research/research-paper-writing/references/phase5-paper-drafting.md` | The full drafting procedure: context management for large projects, the narrative principle, time allocation, writing workflow. |
| `optional-skills/research/research-paper-writing/references/reviewer-guidelines.md` | The four universal evaluation dimensions (quality, clarity, significance, originality) and what reviewers look for. |
| `optional-skills/research/research-paper-writing/references/sources.md` | The source bibliography the skill was built from. |
| `optional-skills/research/research-paper-writing/references/writing-guide.md` | The narrative principle, the abstract-writing formula, and a 5-sentence formula for the abstract. |
| `optional-skills/research/research-paper-writing/templates/README.md` | Which conference templates ship and how to use them. |
| `optional-skills/research/research-paper-writing/templates/aaai2026/README.md` | The unified AAAI 2026 template guide (Chinese + English). |
| `optional-skills/research/research-paper-writing/templates/aaai2026/aaai2026-unified-supp.tex` | 144 lines: the supplementary-material template. |
| `optional-skills/research/research-paper-writing/templates/aaai2026/aaai2026-unified-template.tex` | 952 lines: the unified AAAI 2026 main template. |
| `optional-skills/research/research-paper-writing/templates/aaai2026/aaai2026.bib` | 111 lines: the sample bibliography. |
| `optional-skills/research/research-paper-writing/templates/aaai2026/aaai2026.bst` | 1493 lines: the BibTeX style (read via a function index). |
| `optional-skills/research/research-paper-writing/templates/aaai2026/aaai2026.sty` | 315 lines: the LaTeX style package. |
| `optional-skills/research/research-paper-writing/templates/acl/README.md` | The *ACL style-file instructions. |
| `optional-skills/research/research-paper-writing/templates/acl/acl.sty` | 312 lines: the *ACL style. |
| `optional-skills/research/research-paper-writing/templates/acl/acl_latex.tex` | 377 lines: the pdflatex entry point. |
| `optional-skills/research/research-paper-writing/templates/acl/acl_lualatex.tex` | 101 lines: the LuaLaTeX/XeLaTeX entry point. |
| `optional-skills/research/research-paper-writing/templates/acl/acl_natbib.bst` | 1940 lines: the urlbst bibliography style. |
| `optional-skills/research/research-paper-writing/templates/acl/anthology.bib.txt` | The consolidated ACL Anthology bib (semantic bibkeys). |
| `optional-skills/research/research-paper-writing/templates/acl/custom.bib` | 70 lines: citations not in the Anthology. |
| `optional-skills/research/research-paper-writing/templates/acl/formatting.md` | The *ACL proceedings instructions (length, anonymity, multiple submission). |
| `optional-skills/research/research-paper-writing/templates/colm2025/README.md` | One line: CoLM 2025 template. |
| `optional-skills/research/research-paper-writing/templates/colm2025/colm2025_conference.bib` | 11 lines: a minimal sample bib. |
| `optional-skills/research/research-paper-writing/templates/colm2025/colm2025_conference.bst` | 1440 lines: the CoLM BibTeX style. |
| `optional-skills/research/research-paper-writing/templates/colm2025/colm2025_conference.pdf` | **Skipped (tier 3):** binary PDF, 123 KB; header confirmed. |
| `optional-skills/research/research-paper-writing/templates/colm2025/colm2025_conference.sty` | 218 lines: the CoLM style macros. |
| `optional-skills/research/research-paper-writing/templates/colm2025/colm2025_conference.tex` | 305 lines: the CoLM example document. |
| `optional-skills/research/research-paper-writing/templates/colm2025/fancyhdr.sty` | 485 lines: the vendored `fancyhdr` package. |
| `optional-skills/research/research-paper-writing/templates/colm2025/math_commands.tex` | 508 lines: the DL-book math macros. |
| `optional-skills/research/research-paper-writing/templates/colm2025/natbib.sty` | 1246 lines: the vendored `natbib` package. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/iclr2026_conference.bib` | 24 lines: a minimal sample bib. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/iclr2026_conference.bst` | 1440 lines: the ICLR BibTeX style. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/iclr2026_conference.pdf` | **Skipped (tier 3):** binary PDF, 200 KB; header confirmed. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/iclr2026_conference.sty` | 246 lines: the ICLR macros. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/iclr2026_conference.tex` | 414 lines: the ICLR example document. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/math_commands.tex` | 508 lines: the DL-book math macros. |
| `optional-skills/research/research-paper-writing/templates/iclr2026/natbib.sty` | 1246 lines: the vendored `natbib` package. |
| `optional-skills/research/research-paper-writing/templates/icml2026/algorithm.sty` | 79 lines: the `algorithm` float package. |
| `optional-skills/research/research-paper-writing/templates/icml2026/algorithmic.sty` | 201 lines: the `algorithmic` package. |
| `optional-skills/research/research-paper-writing/templates/icml2026/example_paper.bib` | 75 lines: the example bibliography. |
| `optional-skills/research/research-paper-writing/templates/icml2026/example_paper.pdf` | **Skipped (tier 3):** binary PDF, 194 KB; header confirmed. |
| `optional-skills/research/research-paper-writing/templates/icml2026/example_paper.tex` | 662 lines: the ICML 2026 example submission. |
| `optional-skills/research/research-paper-writing/templates/icml2026/fancyhdr.sty` | 864 lines: the vendored `fancyhdr` package. |
| `optional-skills/research/research-paper-writing/templates/icml2026/icml2026.bst` | 1443 lines: the ICML BibTeX style. |
| `optional-skills/research/research-paper-writing/templates/icml2026/icml2026.sty` | 767 lines: the ICML 2026 two-column layout parameters. |
| `optional-skills/research/research-paper-writing/templates/icml2026/icml_numpapers.pdf` | **Skipped (tier 3):** binary PDF, 2.8 KB; header confirmed. |
| `optional-skills/research/research-paper-writing/templates/neurips2025/Makefile` | The figure-cropping build rule for the NeurIPS template. |
| `optional-skills/research/research-paper-writing/templates/neurips2025/extra_pkgs.tex` | 53 lines: extra packages for the template. |
| `optional-skills/research/research-paper-writing/templates/neurips2025/main.tex` | 38 lines: the NeurIPS entry point. |
| `optional-skills/research/research-paper-writing/templates/neurips2025/neurips.sty` | 382 lines: the NeurIPS style. |
| `optional-skills/research/rss-feeds/SKILL.md` | Read RSS 2.0 / RSS 1.0-RDF / Atom / JSON Feed into a date-sorted list, and **discover the feed behind an ordinary page** (`<link rel="alternate">` or a set of common paths). |
| `optional-skills/research/rss-feeds/scripts/feed.py` | 246 lines: `parse_xml`, `parse_json_feed`, `discover(page_url)`, `looks_like_feed`, `filter_entries(entries, limit, since)`, and a text renderer. |
| `optional-skills/research/scrapling/SKILL.md` | Stealth scraping and Cloudflare bypass (three fetch strategies); educational-use disclaimer and a ToS obligation. |
| `optional-skills/research/searxng-search/SKILL.md` | Free keyless meta-search over 70+ engines; it "automatically appears as a fallback when the main web search toolset is not configured". |
| `optional-skills/research/searxng-search/scripts/searxng.sh` | 22 lines: a query wrapper with an engine list. |

### `optional-skills/security/` (indices 700-791)

#### `optional-skills/security/unbroker/scripts/ledger.py` (source, 170 lines, 8 KB) — Tier 1
- **Purpose:** the case ledger — a validated state machine plus an append-only audit log. One case
  is one (subject × broker).
- **Key abstractions:** `STATES` (13), `TRANSITIONS` (a dict of allowed successor sets),
  `new_case`, `can_transition`, `transition(subject, broker, new_state, **fields)`, `due`,
  `log_disclosure`, `followup_fields`.
- **Non-obvious design decisions:**
  - **The transition table is data, and the comments explain WHY each edge exists.** E.g.
    `found → not_found` exists because "a parent re-verification (or re-scan) found the 'found' was
    a false positive (namesake, or an address-only property-record match) -- **retract it with
    evidence**". `verification_pending → awaiting_processing` exists "…**confirmed_removed still
    requires a verifying re-scan, never the submission flow's own say-so**".
  - **A success state is only reachable by independent evidence.** `confirmed_removed` is not
    reachable from `submitted`; it needs a re-scan.
  - **Every transition is mirrored into `audit.jsonl`** and into the case's own `history`
    (`{at, from, to}`). Two records of the same event, for two readers.
  - **An illegal transition raises**, it does not silently coerce: `raise ValueError(f"illegal
    transition {old!r} -> {new_state!r} …")`.
  - **The whole load-modify-save is inside a lock** — "so a concurrent cron re-scan / other tenant
    can't read a stale ledger and clobber this transition."
  - **Follow-up dates are derived from the state**, not typed by the caller:
    `DEFAULT_PROCESSING_DAYS = 14` when a broker does not state its own window, and
    `VERIFICATION_POLL_DAYS = 1` for an unarrived verification email. `record` auto-stamps
    `next_recheck_at`.
  - **Disclosure is itself logged** (`log_disclosure(subject, broker, fields, channel)`) — what
    was disclosed, to whom, through which channel.

#### `optional-skills/security/unbroker/scripts/storage.py` (source, 138 lines, 4.5 KB) — Tier 1
- **Purpose:** the storage primitives — atomic JSON, append-only JSONL, strict permissions, and a
  portable advisory lock.
- **Key abstractions:** `locked(target, timeout=10, stale=30)` (a context manager),
  `ensure_dir`, `_secure(path, mode)`, `_is_sensitive(path)`, `_atomic_write`, `write_json`,
  `read_json`, `append_jsonl`, `read_jsonl`.
- **Non-obvious design decisions:**
  - **The lock is an `O_EXCL` lockfile next to the target**, and a lock older than `stale` (30 s) is
    treated as abandoned and broken — "so a dead process can never deadlock the queue". The
    comment names the exact race it defends: "a cron re-scan overlapping a manual run, or multiple
    tenants".
  - **Every write is tmp-then-`os.replace`**, so a crash cannot leave a half-written state file
    that permanently breaks dedup. The watcher helper uses the same trick.
  - **Permissions are set twice** — the tmp file and the final file, both `0o600` — and
    directories are `0o700`.
  - **Encryption is opt-in but refuses to degrade**: if `encryption=age` is configured and the
    `age` binary is missing, `write_json` raises "refusing to write PII as plaintext" rather than
    falling back.
  - **The JSON and the JSONL have different jobs**: `write_json` replaces a whole document;
    `append_jsonl` is the audit trail. The docstring says so plainly — "Default backend is
    local-json. The optional google-sheets tracker is handled in report.py by emitting rows … this
    module stays dependency-free so the hermetic tests never touch the network."

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/security/1password/SKILL.md` | `op` CLI: service-account auth (recommended for automation) vs desktop-app integration (interactive). |
| `optional-skills/security/1password/references/cli-examples.md` | Sign-in, read, inject, run-with-secrets examples. |
| `optional-skills/security/1password/references/get-started.md` | The core flow, multiple accounts, non-interactive use. |
| `optional-skills/security/DESCRIPTION.md` | One line: secrets management, credential handling, security tooling. |
| `optional-skills/security/godmode/SKILL.md` | Three prompt-level jailbreak modes (system-prompt templates, input obfuscation, multi-model racing) plus Hermes-native persistent configuration. |
| `optional-skills/security/godmode/references/jailbreak-templates.md` | Five model+prompt jailbreak combinations. |
| `optional-skills/security/godmode/references/refusal-detection.md` | Refusal, hedge and compliance **scoring** — hard refusals score `-9999`. |
| `optional-skills/security/godmode/scripts/auto_jailbreak.py` | 776 lines: model-family detection, canary queries (`QUICK_CANARY`), config/prefill writing, and `undo_jailbreak()` — the undo path is a first-class command. |
| `optional-skills/security/godmode/scripts/godmode_race.py` | 530 lines: `ULTRAPLINIAN_MODELS`, tier sizes, `is_refusal`, `count_hedges`, `score_response`, and the race driver. |
| `optional-skills/security/godmode/scripts/load_godmode.py` | 45 lines: a loader shim. |
| `optional-skills/security/godmode/scripts/parseltongue.py` | 550 lines: 33 input-obfuscation transforms (leetspeak, unicode homoglyphs, morse, braille, …) with tier sizes. |
| `optional-skills/security/godmode/templates/prefill-subtle.json` | The subtle prefill template. |
| `optional-skills/security/godmode/templates/prefill.json` | The standard prefill template. |
| `optional-skills/security/oss-forensics/SKILL.md` | A **7-phase multi-agent** supply-chain investigation: prompt parsing and IOC extraction, then per-source investigators, then correlation and reporting. |
| `optional-skills/security/oss-forensics/references/evidence-types.md` | The evidence taxonomy: 8 evidence types, 14 IOC types, and 3 verification states. |
| `optional-skills/security/oss-forensics/references/github-archive-guide.md` | GitHub Archive on BigQuery: "events cannot be deleted or modified after recording" — force-push and deleted-branch detection. |
| `optional-skills/security/oss-forensics/references/investigation-templates.md` | Pre-built hypothesis templates (malicious dependency injection, typosquatting / dependency confusion) with a cross-cutting checklist. |
| `optional-skills/security/oss-forensics/references/recovery-techniques.md` | Deleted-content recovery: "GitHub Never Fully Deletes Force-Pushed Commits … until garbage collection runs (which can take weeks to months)". |
| `optional-skills/security/oss-forensics/templates/forensic-report.md` | The report template: "Every factual claim must cite at least one `[EV-XXXX]` evidence ID … Redact all secrets to `[REDACTED]`." |
| `optional-skills/security/oss-forensics/templates/malicious-package-report.md` | The short malicious-package report. |
| `optional-skills/security/sherlock/SKILL.md` | Username search across 400+ social networks. |
| `optional-skills/security/unbroker/README.md` | The project README: "An agent-native skill that finds a consenting person's exposed personal information … and removes it. It runs automatically wherever it can, and hands off …". |
| `optional-skills/security/unbroker/SKILL.md` | **The autonomy contract.** "After intake (+ recorded consent) there are exactly TWO legitimate human touchpoints: (1) the intake conversation itself, and (2) ONE consolidated human-task digest at the end of the run." Hard limits autonomy never overrides: no acting without recorded consent, no disclosure beyond `disclosure_fields`, no CAPTCHA/anti-bot bypass, and `confirmed_removed` only after a verifying re-scan. Also the **map → reduce → act** two-phase rule and the warning that a browser-toolset subagent given a big broker list times out. |
| `optional-skills/security/unbroker/assets/unbroker.png` | **Skipped (tier 3):** binary PNG, 358 KB; header confirmed. |
| `optional-skills/security/unbroker/references/brokers/addresses.json` | Broker record: Addresses.com. |
| `optional-skills/security/unbroker/references/brokers/advancedbackgroundchecks.json` | Broker record: AdvancedBackgroundChecks. |
| `optional-skills/security/unbroker/references/brokers/beenverified.json` | Broker record: BeenVerified. |
| `optional-skills/security/unbroker/references/brokers/clustal.json` | Broker record: Clustal. |
| `optional-skills/security/unbroker/references/brokers/clustrmaps.json` | Broker record: ClustrMaps. |
| `optional-skills/security/unbroker/references/brokers/cyberbackgroundchecks.json` | Broker record: CyberBackgroundChecks. |
| `optional-skills/security/unbroker/references/brokers/familytreenow.json` | Broker record: FamilyTreeNow. |
| `optional-skills/security/unbroker/references/brokers/fastpeoplesearch.json` | Broker record: FastPeopleSearch. |
| `optional-skills/security/unbroker/references/brokers/intelius.json` | Broker record: Intelius (the largest broker record, 11 KB). |
| `optional-skills/security/unbroker/references/brokers/mylife.json` | Broker record: MyLife. |
| `optional-skills/security/unbroker/references/brokers/nuwber.json` | Broker record: Nuwber. |
| `optional-skills/security/unbroker/references/brokers/peekyou.json` | Broker record: PeekYou. |
| `optional-skills/security/unbroker/references/brokers/peoplefinders.json` | Broker record: PeopleFinders. |
| `optional-skills/security/unbroker/references/brokers/radaris.json` | Broker record: Radaris. |
| `optional-skills/security/unbroker/references/brokers/rehold.json` | Broker record: Rehold. |
| `optional-skills/security/unbroker/references/brokers/searchpeoplefree.json` | Broker record: SearchPeopleFree. |
| `optional-skills/security/unbroker/references/brokers/socialcatfish.json` | Broker record: Social Catfish. |
| `optional-skills/security/unbroker/references/brokers/spokeo.json` | Broker record: Spokeo. |
| `optional-skills/security/unbroker/references/brokers/thatsthem.json` | Broker record: That's Them. |
| `optional-skills/security/unbroker/references/brokers/truepeoplesearch.json` | Broker record: TruePeopleSearch. |
| `optional-skills/security/unbroker/references/brokers/usphonebook.json` | Broker record: USPhoneBook. |
| `optional-skills/security/unbroker/references/brokers/whitepages.json` | Broker record: Whitepages. |
| `optional-skills/security/unbroker/references/legal/ccpa.md` | The CCPA/CPRA request: rights invoked, request content, the authorised-agent clause. |
| `optional-skills/security/unbroker/references/legal/drop.md` | The California DROP portal: "one verified request" deletes from every registered broker. |
| `optional-skills/security/unbroker/references/legal/gdpr.md` | The GDPR/UK-GDPR roadmap (Phase 3, explicitly outside the P0 US-first scope). |
| `optional-skills/security/unbroker/references/methods.md` | 27 KB of per-method playbooks; the headline rules: "blind opt-out is the default (not a fallback)", "A 404 (or empty body) is INCONCLUSIVE, not 'not_found'", and least-disclosure. |
| `optional-skills/security/unbroker/references/site-playbooks.md` | Field-verified per-site game plans, blocked-tail pass matrix, and "Backend clusters (one operator's behavior predicts the others)". |
| `optional-skills/security/unbroker/references/state-machine.md` | The case state machine: states, allowed transitions, and gotchas learned in the field. |
| `optional-skills/security/unbroker/scripts/autopilot.py` | 417 lines: `next_actions(...)` — the ordered action list. `CACHE_STALE_DAYS = 7`, `FANOUT_THRESHOLD = 8` (above that, use `delegate_task` fan-out), and `_HUMAN_GATES = ("gov_id", "fax", "mail", "phone_voice", "phone_callback", "account")`. |
| `optional-skills/security/unbroker/scripts/badbool.py` | 177 lines: parses the live people-search list; **`MIN_EXPECTED = 20` with the comment "BADBOOL's People Search section lists ~47; far fewer => upstream reorg, warn" — a sanity floor on a scraped feed.** |
| `optional-skills/security/unbroker/scripts/brokers.py` | 77 lines: the broker loader, a priority order (`crucial`/`high`/`standard`/`long_tail`), and `clusters()` — one operator's brokers collapse into one cluster. |
| `optional-skills/security/unbroker/scripts/cdp.py` | 159 lines: find and launch the operator's own Chrome over CDP on a dedicated debug profile. |
| `optional-skills/security/unbroker/scripts/config.py` | 144 lines: `DEFAULT_CONFIG`, a `VALID` key set, `detect_capabilities(env)`, and `auto_configure(env)` — the "never ask the operator to choose configuration" implementation. |
| `optional-skills/security/unbroker/scripts/crypto.py` | 97 lines: optional `age` encryption for PII, with an identity file. |
| `optional-skills/security/unbroker/scripts/dossier.py` | 135 lines: the subject dossier. `NEVER_VOLUNTEER = {"ssn", "social_security_number", "passport", "drivers_license"}` and `VALID_CONSENT_METHODS = {"self", "written_authorization", "poa"}`; `is_authorized` / `require_authorized` gate everything, and `select_disclosure` computes the least-disclosure field set. |
| `optional-skills/security/unbroker/scripts/email_modes.py` | 76 lines: draft rendering and verification-link extraction with anti-phishing hints. |
| `optional-skills/security/unbroker/scripts/emailer.py` | 342 lines: SMTP/IMAP and browser-mode sending, a **per-broker rate limit** (`_respect_rate_limit`), a recipient allow-list (`_broker_domains`), and permanent-vs-transient error classification. |
| `optional-skills/security/unbroker/scripts/legal.py` | 63 lines: renders the opt-out request templates per legal regime. |
| `optional-skills/security/unbroker/scripts/paths.py` | 79 lines: the path layout (`subjects_dir`, `dossier_path`, `ledger_path`, `audit_path`, `evidence_dir`, …) — one module owns every path. |
| `optional-skills/security/unbroker/scripts/pdd.py` | 914 lines: the CLI itself — ~35 commands (`setup`, `doctor`, `cdp`, `intake`, `brokers`, `plan`, `fanout`, `record`, `send-email`, `poll-verification`, `next`, `tasks`, `due`, `status`, `report`, …). |
| `optional-skills/security/unbroker/scripts/registry.py` | 293 lines: the CA data-broker registry CSV parser with `MIN_EXPECTED_CA = 100` ("CA registry has ~500+; far fewer => wrong/empty file, warn"). |
| `optional-skills/security/unbroker/scripts/report.py` | 161 lines: `status_counts`, `metrics`, the Markdown status report, the **human-tasks digest**, and Sheets rows. |
| `optional-skills/security/unbroker/scripts/scan.py` | 32 lines: fetch + `looks_listed(html, match_signal)`. |
| `optional-skills/security/unbroker/scripts/tiers.py` | 283 lines: `select_tier`, `plan`, `fanout`, and the **batch plan** that groups brokers by next action, orders cluster parents first and emits a `parent_playbook`. |
| `optional-skills/security/unbroker/scripts/vectors.py` | 53 lines: `search_vectors(subject, broker)` — the per-broker search terms. |
| `optional-skills/security/unbroker/templates/consent/authorization.md` | The authorisation-to-act template. |
| `optional-skills/security/unbroker/templates/emails/ccpa-authorized-agent.txt` | The CCPA authorised-agent request email. |
| `optional-skills/security/unbroker/templates/emails/ccpa-deletion.txt` | The CCPA delete-and-opt-out request email. |
| `optional-skills/security/unbroker/templates/emails/ccpa-indirect-deletion.txt` | The third-party-listing deletion request (your PII on someone else's record). |
| `optional-skills/security/unbroker/templates/emails/gdpr-erasure.txt` | The GDPR Art. 17 erasure request. |
| `optional-skills/security/unbroker/templates/emails/generic-optout.txt` | The generic opt-out request. |
| `optional-skills/security/web-pentest/SKILL.md` | A phased, **authorised** pentest workflow: engagement setup → live read-only recon → proof-based exploitation, with an explicit "When to Stop". |
| `optional-skills/security/web-pentest/references/bypass-techniques.md` | WAF/filter bypasses, used to avoid classifying a finding as a false positive. |
| `optional-skills/security/web-pentest/references/exploitation-techniques.md` | Per-class witness-payload playbooks; "ALWAYS apply scope enforcement before sending anything from this file." |
| `optional-skills/security/web-pentest/references/scope-enforcement.md` | **The three authorities** and the `scope.txt` format; "every active request must [be checked against the scope]". |
| `optional-skills/security/web-pentest/references/vuln-taxonomy.md` | Two classification systems (injection slots, XSS render contexts) mapped to OWASP Top 10. |
| `optional-skills/security/web-pentest/scripts/recon-scan.sh` | 126 lines: recon that writes `request-log.jsonl` and an `evidence/` directory next to `scope.txt` and `authorization.md`. |
| `optional-skills/security/web-pentest/templates/authorization.md` | The engagement authorisation form to fill before any active testing. |
| `optional-skills/security/web-pentest/templates/exploitation-queue.json` | The exploitation queue schema (`vuln_class` enum, etc.). |
| `optional-skills/security/web-pentest/templates/pentest-report.md` | The report, split into verified-exploitable findings (L3/L4) and not-exploited candidates (L1/L2). |

### `optional-skills/smart-home/` + `social-media/` + `software-development/` + `web-development/` + `yuanbao/` (indices 792-856)

| File | What it is / what it pins |
| --- | --- |
| `optional-skills/smart-home/DESCRIPTION.md` | One line: smart-home device control. |
| `optional-skills/smart-home/openhue/SKILL.md` | Philips Hue control via a bridge and the `openhue` CLI. |
| `optional-skills/social-media/reddit-reading/SKILL.md` | Read Reddit without a browser: subreddit listings, search, threads with comments, user activity. |
| `optional-skills/social-media/reddit-reading/scripts/reddit.py` | 311 lines: OAuth or anonymous Atom access, 429-aware retry that reads `Retry-After` (`_reset_seconds`), and comment flattening with depth. |
| `optional-skills/software-development/ast-grep/LICENSE` | MIT licence text. |
| `optional-skills/software-development/ast-grep/SKILL.md` | AST-aware search and rewrite. "Three things the agent must internalise": ast-grep is NOT regex; **patterns must be valid code**; `--update-all` and `--json` are silently mutually exclusive. The helper adds offline pattern validation, a two-pass write trick, and binary auto-resolution. |
| `optional-skills/software-development/ast-grep/install.ps1` | The Windows installer (pip/uv/npm/winget/scoop → pinned GitHub release fallback). |
| `optional-skills/software-development/ast-grep/install.sh` | The POSIX installer with the same priority order. |
| `optional-skills/software-development/ast-grep/references/cli.md` | The `sg` reference; "prefer `ast-grep` over `sg` because `sg` collides with `setgroups` from `util-linux`". |
| `optional-skills/software-development/ast-grep/references/install.md` | Cross-platform install methods. |
| `optional-skills/software-development/ast-grep/references/patterns.md` | The canonical pattern-syntax primer: meta-variables, and what goes wrong when a sub-expression is not valid on its own. |
| `optional-skills/software-development/ast-grep/references/pitfalls.md` | The failure-mode guide; `validate` mechanically checks the §1 items before calling `sg`. |
| `optional-skills/software-development/ast-grep/references/recipes.md` | Verified copy-paste patterns per language. |
| `optional-skills/software-development/ast-grep/references/sgconfig.md` | `sgconfig.yml`: rule dirs, test dirs, and global utility rules. |
| `optional-skills/software-development/ast-grep/references/yaml-rules.md` | The YAML rule reference: atomic, relational (`inside`/`has`/`precedes`), composite, transform, fix. |
| `optional-skills/software-development/ast-grep/scripts/ast_grep_helper.py` | 764 lines: binary resolution (cached → npm → PATH → homebrew → env → runtime), offline `validate_pattern` with language-specific hints, and the `search`/`replace`/`scan`/`test`/`doctor`/`install` subcommands. |
| `optional-skills/software-development/ast-grep/tests/smoke.ps1` | 123 lines: the Windows smoke suite (Pass/Fail helpers, temp workspace). |
| `optional-skills/software-development/ast-grep/tests/smoke.sh` | 212 lines: the POSIX smoke suite; it fakes a binary in a fake env to prove the resolution order. |
| `optional-skills/software-development/code-wiki/SKILL.md` | Generate a full wiki for any codebase — overview, architecture, per-module deep-dives, Mermaid class and sequence diagrams — using only existing Hermes tools (no Docker, no external services). "This skill produces **reference documentation (what/how). It does not produce strategic narrative (why — that's a different skill)**." |
| `optional-skills/software-development/code-wiki/templates/README.md` | The wiki home template. |
| `optional-skills/software-development/code-wiki/templates/architecture.md` | The architecture page template. |
| `optional-skills/software-development/code-wiki/templates/getting-started.md` | The getting-started page template. |
| `optional-skills/software-development/code-wiki/templates/module.md` | The per-module page template. |
| `optional-skills/software-development/grill-me/SKILL.md` | Adversarial plan interview before implementation: the plan is a **design tree**, and the agent walks its **frontier** (the undecided branches) with questions, then synthesises when the frontier is empty. |
| `optional-skills/software-development/pr-lens/LICENSE.txt` | MIT licence text. |
| `optional-skills/software-development/pr-lens/SKILL.md` | Draw code changes as animated architecture/data-flow SVGs from one JSON document. "There is no findings lens — PR Lens is a comprehension layer, not a review bot. There is no field for a bug, risk, or security note, and a document that invents one is rejected." |
| `optional-skills/software-development/pr-lens/references/config.md` | The correction overlay `.github/pr-lens.yml`: "The generated document is regenerated on every run, so editing it is pointless … Inference never writes back into this file, which is why a correction keeps holding as the code moves." |
| `optional-skills/software-development/pr-lens/references/example.graph.json` | A validating example graph document. |
| `optional-skills/software-development/pr-lens/references/graph-document.md` | The field-by-field format, enums and limits. |
| `optional-skills/software-development/rest-graphql-debug/SKILL.md` | REST/GraphQL diagnosis: status codes, auth, schemas, repro — "Isolate the failing layer before guessing at the fix." |
| `optional-skills/software-development/subagent-driven-development/SKILL.md` | Execute a plan by dispatching a fresh subagent per task with a **two-stage review**. |
| `optional-skills/software-development/subagent-driven-development/references/context-budget-discipline.md` | The context-budget rules: never read agent-definition files (the tool loads them), never inline large files into a subagent prompt, read depth scales with the context window, and a **four-tier degradation model** (PEAK 0-30 %, GOOD 30-50 %, DEGRADING 50-70 %, POOR 70 %+) with explicit behaviour per tier. Also the three **early warning signs** (silent partial completion, increasing vagueness, skipped protocol steps) and the fundamental limitation: "you cannot verify semantic correctness of subagent output — only structural completeness", mitigated by demanding explicit "must-have" truths. |
| `optional-skills/software-development/subagent-driven-development/references/gates-taxonomy.md` | **The four gate types**: pre-flight (block entry, no partial work), revision (loop back, capped at 3, escalate on stall), escalation (pause, present options, never guess), abort (stop, preserve state, report the reason). Every checkpoint names its gate type and answers three questions: what triggers it, what happens on failure, who resumes and from where. |
| `optional-skills/web-development/DESCRIPTION.md` | One line: building agents INTO user-facing web apps, as distinct from Hermes' browser automation which operates ON websites. |
| `optional-skills/web-development/cloudflare-temporary-deploy/SKILL.md` | Deploy a Worker to a live `workers.dev` URL with no account, via `wrangler deploy --temporary`; the claim URL is valid for 60 minutes and unclaimed accounts auto-delete. "This gives an agent a tight write → deploy → verify loop without any OAuth, signup, or token copy-paste." |
| `optional-skills/web-development/cloudflare-temporary-deploy/scripts/parse_deploy_output.py` | 122 lines: parses the deploy output into live URL / claim URL / account / claim window, with a **self-test** (`_selftest`) and two sample fixtures. |
| `optional-skills/web-development/har-derived-api-client/SKILL.md` | Record a site's XHR into a HAR, then distil the HAR into a private JSON API client. |
| `optional-skills/web-development/har-derived-api-client/scripts/har_capture.py` | 72 lines: the local-browser capture. |
| `optional-skills/web-development/har-derived-api-client/scripts/har_capture_cdp.py` | 135 lines: the CDP-browser capture, normalising HAR entries. |
| `optional-skills/web-development/har-derived-api-client/scripts/har_to_client.py` | 147 lines: HAR → client; filters `BORING_HEADERS`, detects API entries, and **templates numeric/uuid path segments** into parameters. |
| `optional-skills/web-development/page-agent/SKILL.md` | An in-page GUI agent: it "reads the DOM as text (no screenshots, no multi-modal LLM)" and executes natural-language instructions client-side. |
| `optional-skills/web-development/publish-site/SKILL.md` | Versioned site deploys: "preview locally for sign-off, **version every deploy with a git tag**, deploy through a provider ladder, verify the live URL with a real HTTP check, and keep rollback one command away." |
| `optional-skills/web-development/scrollcraft/LICENSE.txt` | MIT licence text. |
| `optional-skills/web-development/scrollcraft/SKILL.md` | Scroll-driven landing pages: "Scroll is the only input every visitor already knows. This skill treats it as a timeline." Step 0 is an interview; step 2 is "Grammar, gate, then score". |
| `optional-skills/web-development/scrollcraft/engine/scrollcraft.css` | 432 lines: the taste floor — a TOKENS layer (per-brand overrides) over a BASE layer, with the split called out in the file header. |
| `optional-skills/web-development/scrollcraft/engine/scrollcraft.js` | 1167 lines: the runtime — "Vanilla JS. Zero dependencies. Zero DOM generation … You author real, semantic HTML and mark it up with data-sc-* attributes". |
| `optional-skills/web-development/scrollcraft/references/assets.md` | 13 KB: measure → expand levels → encode for scrubbing. |
| `optional-skills/web-development/scrollcraft/references/device-diag.html` | A real-device scrub diagnostic page: "Headless verification cannot reproduce a phone's video decoder, autoplay policy, Low Power Mode, or touch scrolling." |
| `optional-skills/web-development/scrollcraft/references/devices.md` | 22 KB: the nine scroll devices (pin, reveal, parallax, flow+in, …), each answering "what does the visitor's hand actually do here". |
| `optional-skills/web-development/scrollcraft/references/feel.md` | 13 KB: the emotion axis and the feel check. |
| `optional-skills/web-development/scrollcraft/references/taste.md` | 15 KB: the taste floor — typography, text over media, cards, states, and a refuse list. |
| `optional-skills/web-development/scrollcraft/references/template.html` | 138 lines: the skeleton; "a page that keeps this structure verbatim will look like every other page that kept it verbatim". |
| `optional-skills/web-development/scrollcraft/references/uniqueness.md` | 24 KB: the structure axis and the template trap, with four worked sites. |
| `optional-skills/web-development/scrollcraft/references/verify.md` | 24 KB: "A scroll page cannot be checked by looking at it. It has no single state" — the harness photographs the wrong site without telling you. |
| `optional-skills/web-development/scrollcraft/references/worldflight.md` | 16 KB: the continuous-world mode and the **seam law** for assets (last frame of a leg = first frame of the next). |
| `optional-skills/web-development/scrollcraft/references/worlds.md` | 8 KB: eight art directions, each used as a style preamble pasted verbatim into every generation prompt. |
| `optional-skills/web-development/scrollcraft/scripts/doctor.mjs` | 177 lines: a doctor with required/warn severities and a fix string per row. |
| `optional-skills/web-development/scrollcraft/scripts/encode.sh` | 80 lines: the ffmpeg encode for scrubbing. |
| `optional-skills/web-development/scrollcraft/scripts/kie.mjs` | 202 lines: the generation client with key discovery and local-file upload. |
| `optional-skills/web-development/scrollcraft/scripts/serve.mjs` | 52 lines: a static server. |
| `optional-skills/web-development/scrollcraft/scripts/shoot.mjs` | 644 lines: the screenshot harness. |
| `optional-skills/web-development/scrollcraft/scripts/workspace.mjs` | 106 lines: workspace resolution (`findUp`) and `ensure`. |
| `optional-skills/web-development/scrollcraft/scripts/worldflight-assert.mjs` | 273 lines: the worldflight assertions (the seam law, made executable). |
| `optional-skills/web-development/scrollcraft/templates/FINGERPRINTS.md` | A registry of what each shipped site took, so the next build can prove it is a different page. |
| `optional-skills/yuanbao/SKILL.md` | Yuanbao group interaction. The critical rule is at the top: "**Your text reply IS the message sent to the group/user.** The gateway automatically delivers your response text to the chat. You do NOT need any special 'send message' tool." |


## 2. Ideas worth stealing

1. **A state file is the contract; the UI is a projection, and a failed read never destroys good
   data.** `optional-skills/productivity/live-dashboard/SKILL.md` step 5: "A failed source read means unknown
   state: keep the last good value, mark the field stale with the failure time, and never
   overwrite good data with an error." Every field carries **its source and a retrieval
   timestamp**; the JSON holds an append-only change log; the HTML is regenerated from it and
   "never hand-edit HTML state". *Why it transfers:* August Trading's automations, price alerts
   and settled-trade rows are exactly this shape, and today's "last known price" fields are
   silently overwritten by fetch errors. — `UNIQUE` (no other shard in the three reference repos
   states this as a contract).

2. **A fixed, closed vocabulary of gate types for every checkpoint.**
   `optional-skills/software-development/subagent-driven-development/references/gates-taxonomy.md`: pre-flight
   (block, create nothing), revision (loop back, capped at 3, escalate on stall), escalation (pause
   for the human, "never guesses, never picks a default"), abort (stop, checkpoint, report). Each
   checkpoint must answer three questions: what triggers it, what happens on failure, who resumes
   and from where. "If you find yourself inventing a fifth, it's probably a revision gate with
   extra branching." *Why it transfers:* August Trading's plan validation, approval inbox and
   automation gates each re-invent their own vocabulary; one shared four-word vocabulary would
   make the app's gates legible and testable. — `UNIQUE`.

3. **Decide what to notify about, and stay silent otherwise.** `live-dashboard` step 7: deliver a
   summary only on material change, otherwise respond `[SILENT]`; the watchers skill makes the
   same rule a *transport* rule — "Empty stdout on no-new — the caller treats that as silent" and
   "If it prints nothing, stay silent"; the unbroker skill batches every human-only step into
   **one** digest at the end of the run instead of interrupting. *Why it transfers:* the
   automation run history in August Trading is a notification log; a "material change" predicate
   plus a silent default is cheaper and far less annoying than a daily digest nobody reads. —
   `CONVERGENT` (three independent skills in this repo agree; the same idea appears in `pi` and
   `deepseek-harness` as a cron/notification convention).

4. **A post-trade review that diagnoses *behaviour*, not just P&L.** The Hyperliquid client's
   `_review_findings` (`optional-skills/blockchain/hyperliquid/scripts/hyperliquid_client.py:706`)
   encodes six specific failure modes: net-after-fees negative; **fee drag** (`fees /
   |realized_pnl| >= 0.25` → "fees consumed X% of absolute realized PnL, so execution efficiency
   is materially affecting results"); **churn without edge** (fees non-trivial while PnL is flat);
   **overtrading** (`fill_count >= 20 and net_after_fees < 0 and win_rate < 45` → "activity was
   high relative to results"); best/worst coin by net-after-fees; and **counter-trend losses**
   ("losses came while leaning short into a rising market window"). The SKILL.md adds the
   instruction to "judge decision quality separately from outcome quality". *Why it transfers:*
   this is the most directly portable artefact in the shard for August Trading's post-trade
   reflection loop and its fees/overtrading analytics. — `UNIQUE`.

5. **A versioned, reproducible data export that refuses to pretend it is a backtest.**
   `run_export` writes `schema_version: "hyperliquid-market-export-v1"`, an explicit
   `window {start_time_ms, end_time_ms, hours}`, normalised candles and funding rows, and accepts
   `--end-time-ms` so the same window regenerates identically; the SKILL.md says outright: "The
   `export` command writes a normalized dataset, **not a backtest engine. You still need your own
   slippage/fill model**." *Why it transfers:* the same honesty is needed for any export
   August Trading hands to a backtester. — `UNIQUE`.

6. **A queryable structured log in one JSON file, with content addressing and a chain of
   custody.** `optional-skills/security/oss-forensics/scripts/evidence-store.py`: each entry
   carries `content_sha256`, `collected_at`, `event_timestamp`, a `verification` state
   (`unverified` / `single_source` / `multi_source_verified`), and an `ioc_type`; every add is
   appended to a `chain_of_custody` list; `verify` re-hashes every entry and exits non-zero on a
   mismatch; `query` searches content/source/actor/url; `export` renders a Markdown registry.
   *Why it transfers:* August Trading's trade log and rule notebook need exactly this — an
   append-only, hashable, queryable record that a model can read without a database. —
   `UNIQUE`.

7. **A state machine whose transition table is data, with the reasoning in comments, and whose
   success state is only reachable by independent evidence.**
   `optional-skills/security/unbroker/scripts/ledger.py`: `TRANSITIONS` maps 13 states to their
   allowed successors, and the comments say why each edge exists (`found → not_found` is
   "retract it with evidence" for a false-positive namesake match); `confirmed_removed` is
   **not** reachable from `submitted` — "confirmed_removed still requires a verifying re-scan,
   never the submission flow's own say-so"; an illegal transition raises rather than coerces;
   every transition is mirrored into `audit.jsonl` *and* into the case's own `history`; and the
   whole read-modify-write happens under a lock. *Why it transfers:* the same table shape fits
   August Trading's trade lifecycle (`planned → proposed → logged → settled → reviewed`) and
   would make "the model says it settled" vs "the record says it settled" explicit. — `UNIQUE`.

8. **An advisory lock that breaks its own stale lock, so a crashed writer cannot deadlock the
   queue.** `optional-skills/security/unbroker/scripts/storage.py:21` — an `O_EXCL` lockfile with
   a 30-second staleness window, plus the comment naming the race it defends: "a cron re-scan
   overlapping a manual run, or multiple tenants". *Why it transfers:* August Trading's
   notebook writes and automation runs can overlap; a write path that silently loses an update
   because two writers raced is exactly the class of bug the trade log cannot afford. — `UNIQUE`.

9. **Baseline-then-delta polling with a bounded watermark.**
   `optional-skills/devops/watchers/scripts/_watermark.py`: the first run records a baseline and
   emits **nothing** (so a new watcher never floods the channel with history); the seen-set is
   capped at 500 ids; the write is tmp+`os.replace`; and a **corrupt state file is treated as a
   first run rather than a crash**. *Why it transfers:* a price-alert or filing monitor for
   August Trading needs exactly this shape, and the "corrupt file = baseline" rule is the
   difference between a monitor that recovers and one that needs a human. — `CONVERGENT` (the
   same baseline/silence idea appears in the live-dashboard's stale-marking rule).

10. **A sanity floor on a scraped feed: too little data means the source changed, not "no
    data".** `security/unbroker/scripts/badbool.py:165` — `MIN_EXPECTED = 20` with the comment
    "BADBOOL's People Search section lists ~47; far fewer => upstream reorg, warn"; the same in
    `registry.py:212` (`MIN_EXPECTED_CA = 100`, "CA registry has ~500+; far fewer => wrong/empty
    file, warn"). *Why it transfers:* any market-data fallback in August Trading should be able
    to say "the vendor changed shape" instead of quietly returning an empty series that the model
    reads as "no trades occurred". — `UNIQUE`.

11. **A recipe grammar for a tool surface that drifts.** `optional-skills/creative/unreal-mcp/references/recipes.md`
    — every step is **INTENT / DISCOVER / VALUES / VERIFY**: "names the capability to locate
    (via `list_toolsets` / `describe_toolset`) and the exact values to feed it — not hardcoded
    tool names, which drift while the plugin is experimental". *Why it transfers:* the same
    grammar turns any MCP-ish or provider tool into a portable instruction, and it is the
    difference between a prompt that breaks when a provider renames a tool and one that does
    not. — `UNIQUE`.

12. **Adversarial convergence: claims must be individually falsifiable, refuters see the sources
    and not the reasoning, and only survivors surface.** `autonomous-ai-agents/dynamic-workflow`
    — N independent attempts with *different framings*, merge and dedupe on the parent with an
    agreement count, then a second batch told to "BREAK each claim with counter-evidence"
    (given the sources, not the attempts' reasoning), then "surface only survivors; drop refuted
    claims with a one-line reason", capped at 3 rounds. *Why it transfers:* this is the shape of
    a robust answer to a question August Trading asks the model every day ("is this setup
    tradeable?") — the refutation round is what stops the confident wrong answer. — `UNIQUE`,
    with a partial convergence in `subagent-driven-development`'s two-stage review.

13. **A neutral arbiter for conflicts between two agents' work.** `autonomous-ai-agents/agent-merge-conflict-arbiter` — three hunk classes (disjoint-intent / same-question-different-answer / superseded), an **impartiality contract** ("never favor the side that spawned you; touch ONLY conflicted regions"), and a hand-back summary that must name every design decision so a human can veto it. "If intents genuinely tie, escalate rather than guess." *Why it transfers:* the same conflict appears whenever two agents propose changes to August Trading's prompt registry or rule set. — `UNIQUE`.

14. **An autonomy contract with exactly two human touchpoints and hard limits that autonomy never
    overrides.** `optional-skills/security/unbroker/SKILL.md`: after intake (which records consent) there is ONE
    consolidated human-task digest at the end; "Never pause before individual submissions when
    `autonomy=full` … the consent recorded at intake is standing authorization"; and four
    absolute limits — no acting without recorded consent, no disclosure beyond the permitted
    field set, no CAPTCHA bypass, and success only after a verifying re-scan. *Why it
    transfers:* the exact shape August Trading needs for anything that proposes a real trade —
    one recorded authorisation, a bounded disclosure set, a hard "only a verified re-check may
    say it worked", and a single batched handoff to the human. — `UNIQUE`.

15. **A "read-only discovery, then act" two-phase pipeline with an explicit fan-out threshold.**
    `security/unbroker` — Phase 1 DISCOVER crawls every target read-only and records a verdict
    (`found` / `not_found` / `indirect_exposure` / `blocked`); only then does it act. It also
    records where fan-out is worth it (`FANOUT_THRESHOLD = 8`) **and where it is not**: "Do NOT
    hand a browser-toolset subagent a big list of brokers to crawl — in the field this timed out
    repeatedly (600s, ~5-6 brokers each, no summary) because browser navigation is heavy". *Why
    it transfers:* the same discovery-before-action and "use the cheap tool by default, escalate
    only for reasoning-heavy items" rule applies to August Trading's parallel analysis. — `UNIQUE`.

16. **A gate with two severities so a partially-reviewed job can still do safe work.**
    `optional-skills/creative/ai-presenter-video/scripts/preflight.py` distinguishes `errors` (block everything)
    from `remote_blockers` (block only the paid/remote step), and **writes its report back into
    the job file** so the gate leaves evidence. *Why it transfers:* August Trading's approval
    inbox has the same need — a plan can be fully approved for analysis while still being
    blocked for auto-execution. — `UNIQUE`.

17. **A one-item, two-item, one-item decision brief whose sections move together.** The 1-3-1
    rule (`communication/one-three-one-rule`): one Problem sentence, exactly three Options with
    pros and cons, one Recommendation, Definition of Done, Implementation Plan — and "If the
    user picks a different option, Recommendation, DoD, and Implementation Plan update
    accordingly". *Why it transfers:* the 1-3-1 shape is a good fit for August Trading's
    "here are three ways to size this position" answers, and the "sections update together" rule
    prevents the stale-DoD failure. — `UNIQUE` (though `pi` and `deepseek-harness` have their own
    proposal formats — a partial convergence).

18. **Make the model refuse the first three answers.** `creative/creative-ideation` — "Constraint
    plus direction is creativity", "**Refuse the first three ideas. They're slop.**", "One method
    per response unless asked", plus an explicit list of slop signatures to reject (vague
    abstractions, solution-in-search-of-problem, the four safest domains). *Why it transfers:*
    August Trading's model answers are full of plausible-but-generic setup advice; a mechanical
    "generate three, discard three" step plus a signature list is cheap. — `UNIQUE`.

19. **A four-tier degradation model with named early-warning signs.** `subagent-driven-development`
    — PEAK / GOOD / DEGRADING / POOR with explicit behaviour per tier, and three warning signs
    that fire *before* the hard limit: "Silent partial completion", "Increasing vagueness" (the
    agent starts saying "appropriate handling" instead of specifics), and "Skipped protocol steps"
    (8 success criteria, 5 reported → "suspect context pressure, not 'the agent decided 5 was
    enough'"). *Why it transfers:* these are the exact symptoms August Trading would see when a
    long analysis turn degrades; naming them turns a vague "the answer got worse" into a
    detectable state. — `UNIQUE`.

20. **An auditable-model convention: formulas over hardcodes, colour-coded by trust, named
    ranges, a checks tab, and a recalculation before delivery.** `finance/excel-author` —
    hard-coded inputs in blue, formulas in black, cross-sheet links in green, check cells
    red-if-error; a cell comment on every hardcoded input; a Balance-checks tab; and
    `recalc.py` as a mandatory delivery step because "a formula string is not a value".
    *Why it transfers:* the same discipline applies to any model August Trading ships to a
    user (a position-sizing sheet, a backtest export) — the trust-colouring and the
    "recalculate before you deliver" step are what make a workbook reviewable by someone else.
    — `CONVERGENT` (the same conventions appear in `pi` and `deepseek-harness`'s finance
    material).

21. **The "unit of design" changes with the surface, and so does the failure mode.**
    `optional-skills/creative/auteur/references/system.md` — for a one-page site the unit is the section and the
    failure is boredom; for a multi-screen product the unit is the **component × state** and the
    failure is **drift** ("screen 7 invents a fourth button"). The cure is a declared **variant
    budget** ("how many variants of each thing are allowed") enforced by a scanner. *Why it
    transfers:* August Trading is exactly the multi-screen product case; a declared variant
    budget per control, enforced by a check, is the mechanism that stops the UI drifting as
    features land. — `UNIQUE`.

22. **A measurement floor before the real work, and a hard ceiling on paid retries.**
    `creative/ai-presenter-video` — every paid generation is preceded by a stated budget
    (files uploaded, seconds, price or "the cost is unknown", pilot size, retry ceiling) and a
    **pilot**; "Stop after three rejected paid candidates and summarize the failure mode"; and
    "poll interrupted work before resubmitting — avoid double billing". *Why it transfers:*
    August Trading's model calls cost money too, and the same three-part budget statement is
    the right preamble to any expensive batch. — `UNIQUE`.

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** This shard's answer is a four-part pattern, spread
across three skills.
`optional-skills/devops/watchers/SKILL.md` is the polling model: *fetch → compare against a
watermark file of previously-seen IDs → write the watermark back → print new items (or nothing
on no-change)*. The three shipped watchers (`watch_rss.py`, `watch_http_json.py`,
`watch_github.py`) share `_watermark.py`, which adds the first-run baseline, the 500-id bound,
the atomic write, and the corrupt-file-is-a-first-run rule. The wiring example ends: "Every 15
minutes, run `watch_rss.py --name hn --url … . If it prints anything, summarize the headlines
and deliver them. **If it prints nothing, stay silent.**"
`optional-skills/productivity/live-dashboard/SKILL.md` adds the state model: `dashboard.json`
holds the contract plus per-field value, **per-field source and retrieval timestamp**, a
`needs_attention` list and an **append-only change log**; `index.html` is regenerated from it;
a failed read **marks the field stale and keeps the last good value**; and a no-change tick
responds `[SILENT]`. Its frontmatter even ships a ready-made `cronjob` blueprint
(`0 8 * * *`) whose prompt names the state file path.
`optional-skills/creative/kanban-video-orchestrator/scripts/monitor.py` is the health check:
`detect_issues` raises `STUCK` (no heartbeat in 2 minutes), `OVERTIME` (past `max_runtime_s`)
and `FLAPPING` (retried ≥ 2× — "fix root cause before next run"), prints the snapshot to stdout
and the issues to stderr, and exits `0`/`2` so a scheduler can act without parsing text.
`optional-skills/security/unbroker/scripts/autopilot.py` adds the queue discipline:
`next_actions(...)` returns the exact ordered actions to take right now, `CACHE_STALE_DAYS = 7`
re-queues a stale broker list, `FANOUT_THRESHOLD = 8` decides when to fan out to subagents, and
`ledger.py` computes `next_recheck_at` from the state (`DEFAULT_PROCESSING_DAYS = 14`,
`VERIFICATION_POLL_DAYS = 1`) so a re-scan queue needs no manual scheduling.
**What is *not* in this shard:** catch-up for missed runs, and a breaker that disables a job
after repeated empty runs. The nearest equivalents are the first-run baseline (so a restart does
not replay) and the `[SILENT]` convention (so a job that produces nothing is harmless). Both of
those belong in a different shard of this repo.

**Human-in-the-loop approval.** The strongest instance is `optional-skills/security/unbroker/SKILL.md`'s
**autonomy contract**: exactly two human touchpoints (the intake, and one consolidated
human-task digest at the end), no configuration questions ("Never ask the operator to choose
configuration"), no mid-run pauses ("Never interrupt the run for human-only work. Record it
(`record … human_task_queued --reason "…"`) and keep going"), and four hard limits autonomy
never overrides — no acting without recorded consent, no disclosure beyond `disclosure_fields`,
no CAPTCHA bypass, and `confirmed_removed` only after a verifying re-scan.
`creative/ai-presenter-video` is the second instance and the more mechanical one: consent flags
(`rights_confirmed`, `adult_presenter_confirmed`, `remote_upload_approved`,
`voice_clone_approved`) live under `input.*` in `job.json`; `preflight.py` separates `errors`
from `remote_blockers`; and the state machine's `human_task_queued` state is a first-class
status with its own exit routes.
The **audit trail** is consistently an append-only artefact: `unbroker/scripts/storage.py`'s
`append_jsonl` writes `audit.jsonl` alongside the ledger, and `ledger.transition` writes the
same event to both `audit.jsonl` and the case's `history`; `openclaw_to_hermes.py`'s
`write_report` writes a redacted `report.json` **and** a `summary.md` whose "What Was Not Fully
Brought Over" section lists every skipped/conflict/error item with its reason; and
`web-pentest` keeps `scope.txt` + `authorization.md` + a `request-log.jsonl` in the engagement
directory. The one that answers "can the agent self-approve?" most directly is
`payments/stripe-link-cli`: "Every spend is gated by an in-app approval in the Link mobile/web
app — **Hermes cannot self-approve**."

**Post-mortem / reflection loops.** The concrete loop in this shard is the Hyperliquid
`review` command described in idea 4: fills → per-coin buckets → a market-context read (candles
and funding) → a **fixed ledger of six behavioural findings**, capped at six and de-duplicated.
The SKILL.md's own instruction is the transferable part: "For deeper post-trade analysis: start
with `review` to find problem coins or windows → pull `fills` and `orders` for that period → pull
`candles` and `funding` for each traded coin → **judge decision quality separately from outcome
quality**." A second loop is the `research-paper-writing` experiment pattern set (blind judge
panels for subjective tasks, code/objective evaluation, compute-matched comparison, human
evaluation design). A third is the `darwinian-evolver` shape — an *organism* (a candidate), a
*mutator*, an *evaluator* and an *EvaluationFailureCase* — which is the minimal structure any
"evolve a rule/prompt from failures" loop needs. On **stopping bad rules accumulating**: this
shard has the *mechanisms* but not the *policy*. `memento-flashcards` retires a card with a
`RETIRED_SENTINEL` date rather than a fourth status, `nemo-curator` filters and de-duplicates
training data, and `creative-ideation`'s affinity-diagram method clusters 100+ items bottom-up
into a taxonomy — but **no expiry, weighting, retirement or consolidation rule for learned
*rules*** appears anywhere in this shard; that is a different shard.

**Multi-agent.** The clearest statement of where fan-out pays and where it is wasted is
`security/unbroker`: read-only discovery first (parallel, idempotent, no side effects), then
act — and the measured lesson is "the ledger writes that survived came at **10x the cost** of
parent `web_extract`", so the default is the *parent* probing directly and delegation is
escalated only for "genuinely reasoning-heavy work". `autonomous-ai-agents/dynamic-workflow`
supplies the complementary shape: a deterministic Layer A (`execute_code`) and a judgment Layer B
(`delegate_task` with N isolated tasks), with the parent holding only verified results;
per-child sizing (~8-12 mechanical edits, ~2-3k lines of reading, or ~50-70 KB of corpus, sized
by the **largest** unit); and "structured output goes to files, never the `summary` field (it
truncates under load)". Where **debate** adds value: `agent-merge-conflict-arbiter`'s
"same-question-different-answer" class (two agents answered one design question differently —
pick one and surface the decision) and `dynamic-workflow`'s refutation round. Where it is wasted:
`blackbox`'s multi-model judge for a *coding* task, and any fan-out given work that a cheaper
tool can do (the browser-subagent lesson above).

**Structured logs the model can query.** The shard's answer is **files, not databases**:
a single JSON evidence store with per-entry SHA-256, a chain of custody, a verification state
and a keyword query (`oss-forensics/scripts/evidence-store.py`); atomic JSON plus an append-only
JSONL audit log with a lock (`unbroker/scripts/storage.py`); a watermark JSON per watcher
(`optional-skills/devops/watchers/scripts/_watermark.py`); a contract-plus-state JSON plus a change log
(`live-dashboard`); a cards JSON with a retirement sentinel
(`memento-flashcards/scripts/memento_cards.py`); a redacted `report.json` + `summary.md`
(`openclaw_to_hermes.py`); and — the most interesting shape — a **single data file that renders
two views**: `system-atlas` keeps `data.mjs` as the only thing anyone edits, and generates both
an interactive atlas and a text twin `SYSTEM.md` containing "the decisions table, every
structure, the flows, and the open questions by ID". There is no SQLite, no FTS and no service
in this shard; the only database appears inside a *template* (`optional-skills/mcp/fastmcp/templates/database_server.py`,
which is read-only and row-capped).

**Staying simple as features accumulate.** The repo's own answer is structural: the
`optional-skills/` split keeps the **default skill set lean** while the catalogue stays large
("Niche integrations", "Experimental features", "Heavyweight dependencies … by keeping them
optional, we keep the default skill set lean"), and each skill is one folder with one
`SKILL.md`. Inside the skills the anti-bloat devices are: the **variant budget** in
`SYSTEM-SHEET.md` ("Declaring four button variants and shipping nine is the disease this file
exists to prevent"), the **one-method-per-response** rule in `creative-ideation`, the
**"one page / one file"** output contracts (one self-contained HTML dashboard, one
`.excalidraw` file, one workbook, one JSON data file), the **"no peak"** rule in the system
register ("A settings screen with a wow moment is a bug"), and the "**the catalog wins over this
prose**" rule in `mono-color` (the JSON `design-system/` files are authoritative; the markdown
explains them). `mcp/fastmcp`'s "**implement tools first**, add resources and prompts only when
they help" is the same instinct for APIs.

## 4. Non-obvious decisions and gotchas

- **"The catalog wins over this prose."** `optional-skills/creative/mono-color/references/composition.md` says
  the geometry IDs live in `design-system/compositions.json` and "the catalog wins over this
  prose" — a JSON catalogue is the source of truth and the reference only explains it. A doc that
  restates the catalogue is a doc that will drift.
- **A `blocked` result is not a verdict.** In `unbroker`'s transition table, `blocked` can still
  reach `not_found` — "a later pass … can resolve it to any real scan verdict, so blocked reaches
  not_found / indirect_exposure too, not just found."
- **A 404 is INCONCLUSIVE, not "not found."** `unbroker/references/methods.md` heads the
  scan-ladder section with it.
- **A missing market context must not kill the review.** `hyperliquid_client.py`'s
  `_safe_info_query` swallows `SystemExit` so one failed candles/funding fetch degrades the
  review to "no context" instead of aborting it.
- **"Do not claim completion until the final files fully decode."** `ai-presenter-video`'s
  finalizer runs a decode check on both encodes; "a truncated render fails the decode check by
  design, not by accident."
- **"Poll interrupted work before resubmitting — avoid double billing."** And "Preserve provider
  request bodies and task IDs (minus credentials/expiring URLs)."
- **The consent flags are in the wrong place if you edit them by hand.** "The consent booleans
  set by init flags land under `input.*`; editing them at the job-json root silently does nothing
  (preflight keeps blocking)."
- **"A remembered result is not a result."** `auteur/references/verify.md` requires the linter's
  final `Summary:` line to be pasted verbatim, **after the LAST edit** — "not from an earlier
  run".
- **"Never cite a reference you didn't actually see, and never quote a fingerprint the tool
  marked NO CAPTURE."** The same rule appears in the reference-scouting reference.
- **The `IntersectionObserver` trap.** `anatomy/references/motion.md`: read the *newest* entry
  (`entries[entries.length - 1]`), "because when the stage leaves and comes back between two
  callbacks, one callback delivers both entries oldest first, and reading the first one leaves
  the figure frozen on screen."
- **Read the phase word and the number from the same instant of the same source.** The same
  reference records a blind-test bench printing "end of stroke · relief 85 bar" where the word
  came from the model and the number from a gauge needle lagging 0.25 s behind it.
- **`--update-all` and `--json` are silently mutually exclusive** in `ast-grep`.
- **Redaction is applied to the artefact, not to the process.** `openclaw_to_hermes.py`:
  "Callers who need the raw object (in-process) still get it back from `build_report()`; only
  the on-disk copy is redacted."
- **The `adversarial-ux-test` skill has a mandatory filter step.** "Step 4 — The Pragmatism
  Filter (Critical — Do Not Skip)" separates real UX problems from "I hate computers" noise; skip
  it and the output is a rant, not a ticket list.
- **`1-3-1` sections move together.** If the user picks another option, the Recommendation, the
  Definition of Done *and* the Implementation Plan all update — otherwise the brief contradicts
  itself.
- **"Do NOT hand a browser-toolset subagent a big list."** Measured: 600 s for 5-6 brokers and no
  summary; the surviving ledger writes cost 10× the parent's cheaper probe.
- **Every gate answers three questions** (what triggers it, what happens on failure, who resumes
  and from where) — "Answering these three up front means your skill never hits 'what do we do
  now?' at runtime."
- **`@media (hover:hover)`** gates hover styles; `focus-visible` is always styled ("it must look
  designed, not default-blue-unless-brand").
- **A "rebuild" flag, not a re-generate flag.** `comfyui/references/template-integrity.md`
  RULE #1: never strip nodes from a template — if a path is not needed, leave it wired with the
  bypass toggle enabled.

## 5. Weak spots

- **Duplication at scale inside the `anatomy` kit.** `kit/iso-kit.mjs` (674 lines) and
  `kit/iso-kit.ts` (842 lines) are the same API twice; `kit/turn.mjs` (3610 lines) and
  `kit/turn-fixed.mjs` (3800 lines) are the same `t3*` family twice; `kit/gl.mjs` and
  `kit/gl-shared.mjs` are **byte-identical 184-line files**. The LaTeX templates repeat
  `fancyhdr.sty`, `natbib.sty` and `math_commands.tex` across four conference folders, and
  `colm2025_conference.bst` and `iclr2026_conference.bst` are the same 1440-line file. Six
  megabytes of the shard's 11.6 MB is content that exists more than once.
- **Six generated doc dumps over 120 KB** (`pytorch-fsdp/references/common-patterns.md` 158 KB,
  `other.md` 338 KB, `axolotl/references/api.md` 121 KB, `other.md` 140 KB,
  `unsloth/references/llms-full.md` 1.05 MB, `llms-txt.md` 813 KB) are upstream API dumps that no
  model can read in one pass and that go stale immediately. They are catalogued, not read.
- **Prose-as-a-program does not scale.** `research-paper-writing/SKILL.md` is 72 KB,
  `optional-skills/finance/dcf-model/SKILL.md` 49 KB, `optional-skills/creative/anatomy/references/craft.md` 50 KB. The style
  works for a 5 KB procedure; at 50 KB the reader has to be lucky, and there is no index that
  tells it which third to read.
- **A "persistent jailbreak" writer in a skills tree.** `optional-skills/security/godmode/scripts/auto_jailbreak.py`
  writes a jailbreak system prompt into `~/.hermes/config.yaml` and a prefill into
  `~/.hermes/prefill.json`, and ships an `undo_jailbreak()`. Even when the intent is research,
  a skill that mutates global agent configuration on install deserves a much louder warning than
  this one gets.
- **Hard-coded site recipes rot.** `security/unbroker` carries 21 broker JSON files, a 47 KB
  `pdd.py` and a 25 KB SKILL.md whose per-site playbooks are explicitly "field-verified" against
  live people-search sites that change their HTML whenever they want to. The skill is honest
  about it ("one operator's behavior predicts the others") but the maintenance cost is real and
  the upstream feed is scraped with a `MIN_EXPECTED` floor precisely because it does break.
- **Almost no tests in this shard.** Only `comfyui` (pytest, 7 files) and `ast-grep` (two shell
  smoke suites) have any test at all. The 100+ creative, mlops and research skills ship
  procedures whose correctness is unverified — and the creative ones ship *generated artefacts*
  (the anatomy kit's geometric audit, the concept-diagram examples) with no test that they
  still render.
- **The finance skills assume a headless-Python + LibreOffice + .xlsx world.** `excel-author`,
  `dcf-model`, `comps-analysis`, `lbo-model` and `merger-model` all terminate in "write
  `./out/model.xlsx`, then run `recalc.py`". None of that works in an Electron + Capacitor app
  on a phone, which is where August Trading actually runs — so the *conventions* transfer and the
  *mechanism* does not.
- **PII-adjacent metadata repeated across the tree.** Roughly forty SKILL.md files carry an
  `author:` field with a personal name and GitHub handle, and several LICENSE files reproduce the
  upstream copyright holder's name and URL. Harmless individually, but it is a lot of personal
  data to carry in a vendored skills directory, and a scanner that copies `author` verbatim into
  generated output will leak it.
- **Two of the largest skills are essentially catalogue dumps.** `unbroker` and `godmode` are
  ~90 KB of site/technique tables between them, and neither has a test, a version pin for its
  targets, or a stated expiry. They are the most likely files in the shard to be quietly wrong.
