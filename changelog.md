# Changelog

Plain-English log of change rounds. Newest first.

## Sessions remember themselves, an LLM supervises the queues, and your model is actually yours

- **Every Chart AI session keeps its own world.** Each session now stores the
  chart instrument + timeframe it was set up on, the thinking-effort choice,
  and the model — restored the moment you return to that session from Past
  Conversations (and when you reopen the app, which also lands back in the
  session you left). Solo answers now show **which model** said each line.
- **Your selected model is the one that answers.** The composer's pick used
  to be a bare model name, and when two providers offered the same model the
  answer could silently come from the wrong one. The picker is now
  provider-qualified (provider + model together), the choice is migrated
  once, and the same rule is used everywhere a chat model is resolved.
- **Effort now actually changes Claude's thinking.** The Low/Medium/High/Max
  knob previously only switched extended thinking on or off for Anthropic
  models (same budget either way); the budget now scales with the tier.
- **An LLM supervises the approval queues.** A model — the one your current
  session uses (a panel's first seat when several are selected) — reviews
  every new skill draft, forged-tool candidate, memory amendment and ladder
  proposal automatically, in its own streamed calls: it verifies against your
  catalog/graveyard/memory, **enhances** the salvageable (mechanical IF,
  activation-key description, tighter prediction), and approves the solid
  ones as candidates — or rejects with a reason. Watch it live from the
  sparkle icon in the Chart AI header: the panel streams what the model is
  doing item by item, and **every decision is yours to undo** (reject an
  approval, approve a rejection) plus a pause toggle. Approved skills still
  enter as candidates — the evidence ladder still decides enforcement.
- **Trade theses resolve the moment price says so.** Beyond the
  every-3-sessions review, unresolved trade ideas discussed in chat are
  re-scored against fresh candles after each send (throttled), so a lesson
  lands in the Inbox when it becomes knowable — not at the next counter tick.
- **"Thinking…" became "Tip: …".** While a model works you get rotating,
  specific trading tips — and every third one is personal, drawn from what
  August has learned about you.
- **August learns your trading habits between sessions.** Every couple of
  sessions it distills durable facts — preferred symbols and timeframes, risk
  habits, recurring mistakes, how you like answers — into Assistant memory
  (Settings → Memory, AUTO-badged and forgettable), so the next session
  starts where the last one ended.

## Triggers now alert your computer, richer market data, and skills learned from the chat

- **Notifications actually reach your computer.** A shared desktop-notification
  helper (`notify`) now covers web, Electron, and native (Capacitor) in one
  path, and it fires when a **price watch or a plan level hits** — before this,
  a trigger only queued a chat bubble, so if you'd tabbed away you'd never
  know. Arming a watch requests notification permission up front, so the grant
  exists before a trigger fires minutes later.
- **More of Binance, as a trend not a snapshot.** The market packet now carries
  **funding-rate history** (how many sessions the crowd has been paying —
  squeeze risk), **open-interest history** (is new money funding the move, or
  is it short-covering?), and **spot–futures basis** (a stretched premium flags
  crowded leverage). Rendered as a one-line "Positioning trend" the models read
  alongside the existing OI/funding/long-short snapshot.
- **Skills learned from the conversation, not just logged trades.** Every few
  Chart AI sessions a quiet review pass reads what you and the model actually
  discussed, pulls out each concrete trade idea (direction + entry + stop +
  target), **scores it against the price history that followed** (did TP or SL
  hit first?), and turns the resolved ones into skill drafts — a thesis that
  won becomes a `repeat` skill, one that lost an `avoid` skill. It only ever
  queues drafts for your approval (never auto-applied), skips ideas still
  unresolved, and never drafts the same idea twice.
- **Skills now lead with WHEN to use them.** The skills index the model sees
  was just an IF/THEN clause; per the Agent-Skills guidance (the description is
  the activation key), each line now leads with the skill's what/when
  description and kind, with the IF/THEN rule after it — so the model can
  actually decide to reach for a skill.

## Your strategy PDFs became skills, and a scanner that reads them live

- **Twelve playbooks, queued for your approval.** The strategy PDFs in
  `Pdf's Strategies` are distilled into candidate IF/THEN skills — breakout
  retest, failed-breakout fade, exhaustion-gap reversion, breakaway-gap join,
  pin-bar range fade, inside-bar resolution, RSI divergence, band reversion,
  band-walk momentum, Al-Brooks trend pullback, range-edge fade with ATR
  sizing, and momentum thrust. They land in the **Inbox as pending drafts**
  (not the live library) — you approve or dismiss each. Seeded once; your
  decisions are never undone by a later launch.
- **`scan_setups` — the books, as code.** A new desk tool runs those
  playbooks' machine-checkable cores against live candles and reports which
  setups are firing in the last few bars — range breakouts/fades, pin bars,
  inside-bar resolutions, gap classes (breakaway/runaway/exhaustion, filled
  or not), RSI divergences, Bollinger band plays, trend-pullback second
  entries, failed breakouts — each with its evidence and the library skills
  that match. The model calls it before answering "is anything setting up?",
  so it reads the tape instead of guessing.

## Floor mode removed; the chart now loads 1,000 candles

- **The CHAT | FLOOR toggle is gone.** The full-screen trading-floor debate
  view (and its Ctrl+Shift+F shortcut, command-palette entry, and header
  toggle) has been deleted — the debate lives in the desk view and Chart AI.
- **1,000 candles.** The chart's history load went from 300 bars to 500 and
  now to **1,000** — the Binance maximum, still one request per timeframe.

## Chart AI and the left panel now follow the Antigravity layout

- **Chart AI looks like the Agent panel now.** The dock header is the
  reference's clean cluster — identity on the left, and on the right:
  **＋** new chat, **🕘 Past conversations**, **⋯** customization (panel
  models, expand over chart, Start options), and **✕** collapse. The history
  button opens a **Past Conversations palette**: a search box, "Recent"
  sessions with relative times ("2 days ago"), ↑↓ to navigate / ↵ to select,
  "Show N more…" — sessions are no longer a tab strip at all. The composer is
  one rounded card (input + attach/model/effort/send row) under a
  symbol-section header, with the reference's generous spacing and a plain
  sentence-case disclaimer.
- **The left panel works like Antigravity's.** The four surfaces live on a
  slim 48px activity bar; clicking the ACTIVE surface icon toggles its side
  panel — on Trade that's the **order book, now a proper left sidebar**
  (300px) instead of a permanent column, so closing it hands the width to the
  chart. The choice persists across reloads.

## Panel seats stop failing silently; the left rail moves behind a hamburger

- **A multi-model panel seat that fails now says WHY.** When one of your
  panel models errored, every seat just showed "(this seat failed to answer)"
  with no clue. The real provider error is now printed in the bubble (e.g.
  "…failed to answer: … request failed (400)"), and a seat whose model was
  removed from Settings shows a clear "Seat unavailable" line instead of vanishing.
- **The "thinking and response are the same" bug, fixed.** Two causes: the
  chat output budget was 2048 tokens, so a thinking-heavy model's answer was
  often just its own truncated reasoning and nothing else — raised to 8192.
  And when a model echoed its chain-of-thought verbatim into the answer, the
  previous cleanup fell back to showing that echo again; now a pure echo is
  detected and the answer keeps only the text after it (or a plain "the model
  streamed only its reasoning" note, with a hint to lower thinking effort).
- **The left navigation is a hamburger now.** The four surfaces (Trade /
  Journal / Studio / Agents) were a permanent icon column; they now live
  behind a ☰ flyout on a slim 40px strip (was 64px), with the current
  surface's icon always shown so you know where you are. That hands width
  back to the chart and dock.
- **Expanded Chart AI drag + collapse fixed.** Expanding the dock then
  dragging the separator felt dead (the drag was setting a pixel width the
  expanded layout ignored). Now a drag while expanded first shrinks back out
  and then resizes from the dock's actual width, and collapsing the dock clears
  the expanded state so you can't get stuck in a wide dock with no collapse.

## Customizable timeframes, a roomier dock, and a memory you can see

- **Pick your own timeframes.** The chart's timeframe bar was hardcoded to
  1m / 5m / 15m / 1h / 4h / 1D. It now offers the full Binance set (adds 3m,
  30m, 2h, 6h, 12h, 3D, 1W, 1M) and a ⚙ button opens a TradingView-style
  picker where you toggle which intervals show in the bar. Your choice is
  saved per user, and the timeframe you're currently viewing always stays on
  the bar no matter what. (Fixed a latent bug where a monthly chart would have
  subscribed to the 1-minute stream — `1M` lowercased to `1m`.)
- **The dock breathes.** The row of session tabs is gone — sessions now live
  behind a hamburger in the header (showing the active session's name). The
  menu lists your sessions (switch / delete) plus the New chat / panel / agent
  / Coach / room / bot starters, and it can't be clipped the way the old tab
  strip's dropdown was. That frees a whole row for the conversation.
- **See what the assistant remembers.** Settings → Memory gained an **Assistant
  memory** card listing every collaboration memory (kind, description, body,
  slug) with a Forget button, so you can inspect and delete exactly what Chart
  AI remembers about you — the human-editable counterpart to the model's own
  memory index.

## Chart AI now has a memory about YOU (like a good assistant's notes)

- **A second kind of memory.** The Trader Notebook remembers what the *market*
  taught the models. Now Chart AI also keeps a small, typed memory about the
  *collaboration* — the same shape this coding agent's memory has: one fact per
  entry, four kinds (**user** who they are, **feedback** how they want you to
  work, **project** ongoing goals, **reference** pointers), each with a
  one-line description that says when it matters.
- **Always loaded, pulled on demand.** A compact index (slug + one-liner per
  entry) rides *every* Chart AI turn and the analysis pipeline's context, so
  the model always knows what it already remembers — then reads a full body
  with `read_memory` only when relevant. Nothing is dumped into every prompt.
- **The model maintains it.** Three new desk tools — **remember** (save, or
  UPDATE an existing entry by slug so it never duplicates), **read_memory**,
  and **forget** (delete wrong memories). A system-prompt rule teaches the
  discipline: check the index first, update over duplicate, carry Why/How-to-
  apply lines on feedback, and never store trading lessons (those belong to the
  notebook) or one-off conversation detail. Every save shows as a side-effect
  row. Stored per user, bounded, survives reloads.

## Chart AI responds instantly and its answers render clean

- **No more dead time after you hit send.** The dock used to fetch the live
  market packet over the network *before* drawing anything, so the screen sat
  blank for a beat. Now your message and a "Thinking…" bubble appear the
  instant you send, and the model call starts once the packet is ready.
- **Answers stop leaking the model's scratchpad.** Some models stream their
  reasoning into the answer as a "Thinking: … / FINAL_OUTPUT: …" header (or
  repeat their thinking inline). The live stream only stripped tagged thinking,
  so the raw scratchpad landed in the answer bubble — which also broke the
  markdown (a stray fence swallowed the real reply). At settle, Chart AI now
  runs the same splitter the journal uses: leaked thinking moves into the
  collapsible Thought row and the answer is only the model's reply. A clean
  answer — even one that opens with a word like "Verdict:" — is left untouched.
- **Follow-up questions are faster.** The slow market-packet fetch is now
  cached briefly (8s, per symbol), so a quick second question starts the model
  immediately instead of re-pulling. Drawings, armed plans and watches still
  refresh every message, and the block carries the real fetch time so the model
  knows the packet's age.

## Chart AI: watch/schedule triggers + a batch of dock fixes

- **Watch or schedule — the model tracks the chart in real time.** Three new
  desk tools: **watch_price** ("alert me when BTC prints above 112,000"),
  **wake_me** ("re-check the breakout in 30 minutes"), and **cancel_watch**.
  The model arms a trigger and the harness wakes it with a `[HARNESS TRIGGER]`
  signal the moment the condition holds (or the scheduled time arrives) — it
  then pulls a fresh read and tells the user whether it's ready to trade.
  Price triggers fire once and lapse; wake-ups run off the clock, not the
  tape; armed watches persist per user across a reload. Every armed watch
  rides the model's context so it never double-arms.
- **You can actually add a new session again.** The "+ New" dropdown lived
  inside the 29px-tall scrollable session bar, which clipped it out of
  existence — so "New chat / New panel / New agent" were unreachable. The
  button moved out of the scroller and the menu now floats over the
  transcript, with click-outside to close.
- **Adding panel models is findable.** The panel chip in the header is now a
  button ("panel · 1/5 ▸ models") that opens the seat editor any time, not
  just once right after creating a panel.
- **The thinking timer stops when thinking stops.** It used to keep counting
  for the entire answer because it was tied to the whole stream; now it settles
  the moment the answer text starts.
- **The chart speaks Philippine time.** Axis labels, the crosshair, the live
  context stamp, drawing timestamps and harness signals all render in
  Asia/Manila (UTC+8) instead of UTC — 13:08 UTC now reads 21:08.
- **Copy any message.** A Copy chip appears on hover for both your messages
  and the model's answers.
- **Wide tables scroll instead of losing columns.** A markdown table with many
  columns now keeps its natural width and scrolls sideways with a visible
  scrollbar, rather than shrinking until some columns vanish.

## The harness now watches your plan levels and warns you in Chart AI

- **Level-hit signals.** When you present a trade, the harness arms a watch
  on its Entry/SL/TP levels. When the live mark price reaches one, Chart AI
  gets a machine `[HARNESS SIGNAL]` and warns you in the dock: what hit, at
  what price, whether the rest of the plan holds — naming each level by a
  stable id. Each level fires **once**, ever (the latch persists per user
  across reloads), and the model's context block always lists the armed plan
  plus which levels already spoke.
- **Advisory only — one owner per decision.** The watch warns; it never
  resolves. The outcome autopilot still owns SL/TP resolution and the
  post-mortem for logged trades. Both watch the same levels on purpose (one
  grades the trade, one prompts the conversation), and a plan that's already
  through its stop or a target when armed stays silent (stale-plan guard) —
  no tick-0 pings for a dead or paid plan.
- **Hits can't be dropped.** The signal queue lives in the chat store, not a
  component, so a level that fires while the model is mid-answer — or while
  the dock is unmounted — flushes as a warning turn when the session goes
  idle. It renders as a notice row + the model's warning, never as a fake
  user message.

## Five fixes from the in-flight review

- **Chat sessions no longer leak across users.** The dock's session store
  remembers which user it loaded for; after a user switch it reloads from
  the new profile's key instead of writing the old chats into it, and a
  `storage` listener keeps two open windows from silently clobbering each
  other.
- **Panel seats that pass stay invisible.** A seat replying `(pass)` used to
  take a visible turn and pollute the room the other seats read; now silence
  never renders and never enters the cross-talk (a panel that lost seats
  says so instead of silently swallowing your message).
- A duplicated-branch ternary when creating sessions was collapsed; the
  skills index is read fresh on every prompt, so a skill proposed mid-session
  re-enters the conversation immediately.

## Learning-loop cleanup (verified-dead only)

- Deleted the `distill` learning-queue kind (declared + labeled, zero
  emitters) and the dead `EnhancedDebateService` (imported once, never
  called). The judge-precision producer (`recordJudgePrecision`) stays
  backlogged as its own scoped follow-up — it's a feature, not a fix.

## Chart AI can present a trade and the harness learns from it

- **`present_trade` desk tool** — the model puts a concrete setup on the
  table (direction, entry, stop, targets, confidence, rationale,
  invalidation). It draws the Entry/SL/TP lines on the chart AND renders a
  **proposal card** in the chat with **Log this trade** / **Cancel**.
- **Log this trade → an open trade.** Logging appends a PENDING trade to the
  conversation carrying the model's levels and attribution. The existing
  outcome autopilot already registers any PENDING trade, watches its SL/TP on
  the live feed, and — when it resolves — runs the full post-mortem →
  skill-learning loop. So a trade the model proposes in chat is scored
  against reality exactly like a trade the analysis pipeline produced; no new
  close-out machinery was needed.
- **The multi-model requirement is gone.** The post-mortem already ran on a
  single model; the "enable at least 3 providers" hint is now clearly
  optional ("…analysis and post-mortems run fine with just one"). One model is
  always enough; extra models only add a debate when they're available.

## Chart AI: the whole picture, the model can draw, and streams survive a tab switch

- **`get_all_timeframes`** — one call returns EVERY timeframe at once: for
  5m/15m/1h/4h/1d the last candles, trend vs EMA20/50, RSI, swing structure
  (higher-highs/higher-lows vs the reverse) and named candle formations
  (engulfings, hammers, shooting stars, dojis, inside bars, impulse bars),
  plus the global layer — order book with spread/imbalance/walls, funding,
  open interest and recent liquidations. The model can now read the complete
  market in a single lookup.
- **The model can draw on your chart** — the same tools you have. New desk
  tools `mark_trade_levels` (lays an Entry/Stop/TP plan as labeled lines),
  `draw_on_chart` (trendline / ray / zone / level, anchored in bars-ago +
  price so it survives pan/zoom), and `clear_chart_drawings`. The model's
  marks render on the live canvas, flow back into its own context (so it
  builds on what it drew), and are cleared when you switch instruments.
- **Chart AI no longer dies when you switch tabs.** The dock's session state
  moved into a module store, so navigating to the Journal (which unmounts the
  trade surface) no longer aborts an in-flight answer — it keeps streaming
  into the store and the completed reply is there when you come back. Only an
  explicit Stop, or deleting a session, cancels a run; switching between
  sessions no longer cancels the one you left. Verified live: a stream
  unmounted mid-answer finished to completion and reappeared intact.
- **The model can see what you traded.** Your logged trade history now flows
  into the Chart AI desk tools, so `recall` and `get_setup_history_stats`
  answer from your real fills instead of an empty notebook.

## Chart AI gets truly live: streaming answers, working pens, honest knobs

A fix round for everything that only looked finished in the Chart AI dock —
every item below was verified end-to-end in the running app against a live
SSE provider, not just in unit tests:

- **Answers stream for real now.** The desk-tool loop ran on a
  non-streaming call, so tool-using turns (and any plain answer) rendered
  all at once when the model finished. Every loop round now streams through
  the same SSE pipeline: text lands word-by-word while tools run, native
  tool calls are accumulated from the stream itself, and a clean in-loop
  answer is never re-asked (no more duplicate continuation). The dev
  provider proxy now also forwards `tools`/`tool_choice` on streams and a
  client-translated `reasoningPatch` on every route — before this, streamed
  chats in the dev browser silently lost ALL desk tools and the effort
  toggle did nothing on the wire.
- **The effort toggle really works.** Off/Auto/Low/Medium/High/Max now
  reaches the provider: capability-class translation happens in the renderer
  and the dev proxy merges the patch into the upstream body (verified:
  GLM-class model received `thinking.enabled` + `thinking_effort` on High).
- **Stop actually stops.** An armed controller now covers the whole turn
  (context fetch included), the tool loop checks the signal between rounds,
  and the continuation refuses to fire on a dead signal. Verified
  mid-stream: an answer froze at 122 of 395 characters the moment Stop was
  pressed.
- **The drawing tools actually draw.** The overlay canvas sat BELOW
  lightweight-charts' internal z-indexed canvases, so no tool ever received
  a pointer — clicks previewed and never committed. The overlay now clears
  the chart stack (z-10), and screen↔data conversion goes through logical
  bar coordinates, so drawings stay glued through pan/zoom and work even
  when the first candle is scrolled off-screen (the old anchor-time math
  returned null there and silently killed every commit). Verified: hline
  click, trendline drag, persistence across reloads, one-click reset.
- **Tool calls got their own Thinking-style section.** A collapsible
  "Tool activity" row (same look as the Thought row) shows the live call
  ticker while streaming and the full call/result log after; the old
  always-visible "▸" lines are gone.
- **"Thinking…" no longer flickers.** The placeholder is static text with
  only the three dots animating.
- **One + button for everything.** Uploads and the chart screenshot live in
  a single attach menu on the composer, matching the reference client.
- **New agents are born inside Chart AI.** The New-session menu gains
  "New agent": the full New Bot dialog opens, and creating the bot saves it
  to the roster and drops you straight into its bound session.
- **The system prompt now commands tool + skill discipline.** The copilot
  must ground market claims in desk tools, consult the skills library and
  APPLY matching skills (the composer injects a compact index of every
  skill's slug + IF/THEN rule), and grow the desk (memory notes, skill
  revisions/proposals) when a chat earns it.
- 300 candles load on every timeframe (chart + get_chart_view), and the
  debate-count expectations in debateFlow were updated for the streamed
  routing call (same provider requests, both now visible as streams).

## The Chat surface folds into Chart AI

The Messages tab is gone. The trade surface's Chart AI dock is now the
conversation home for the whole app — a full rebuild of the panel plus the
chart underneath it:

- **Sessions in the dock.** Chats run as parallel, persisted sessions with a
  New-session menu: one-model chat, a PANEL of up to five models that answer
  together (each seat sees the others' turns, can direct-message a peer
  mid-turn through the debate mailbox, can @mention a peer to pull it into
  the queue next, and the round closes with one synthesized answer), a
  session bound to any roster BOT (its persona + provider/model), a group
  ROOM (the room transcript embeds live in a session tab), and the Coach
  inbox. The Agents tab now opens bots/rooms/coach INTO the dock instead of
  a separate surface.
- **Composer like the reference agent client.** Model selector, a + attach
  button (images ride as vision parts when the model can see; files inline
  as labeled text), a chart-screenshot button, and a thinking-effort toggle
  (Off/Auto/Low/Medium/High/Max). A new explicit 'off' effort tier routes
  per capability class: Anthropic skips the thinking block, GLM/DeepSeek
  send thinking:disabled, the responses API sends minimal, xAI steps to low.
  Answers stream into a real collapsible Thinking row and fade in as text
  lands.
- **The model can grow itself from this chat.** The desk set gains
  write_memory_note (direct notebook authoring through the harness's own
  guards), get_notebook_map, propose_skill (pending draft in the Coach
  inbox) and revise_skill (pending proposal in Settings → Skills), joining
  amend_memory and forge_tool. Every side-effect renders as a visible
  status row naming where the human reviews it; a rejection is a visible
  "Blocked — nothing stored" row.
- **Chart tools.** get_chart_view now reports everything on screen: candles,
  timeframe, live mark, verdict levels, the order book the ladder shows,
  and the user's own drawings. Every message also carries an ON SCREEN block
  read from the live canvas snapshot — the exact painted numbers, not a
  re-fetch. The full hybrid pull remains callable as get_market_packet.
- **TradingView-style drawing tools on the chart.** Trendline, horizontal
  line, ray, rectangle zone and freehand brush with a five-color palette,
  eraser, undo and clear. Shapes anchor in DATA space (bar time + price),
  persist per symbol per user, survive reload/zoom/pan, and reach the model
  as plain English lines.
- **Screenshot tool.** The chart (candles + drawings composited) captures to
  a PNG the user attaches to a message; it renders in the transcript and
  goes to vision-capable models as an image part.
- **The dock is a real dock.** Drag the separator to resize (persists,
  double-click resets), collapse to a rail, expand over the chart.
- **Realtime hardening.** A stall watchdog re-syncs history whenever the
  feed claims live but goes quiet ~12s, and a closed-bar refresh keeps the
  last painted bar honest — a socket that silently dies can no longer
  freeze the chart.
- **Deleted, with everything transferred first:** ChatArea, ChatInput,
  MessageItem, TranscriptRow, ThreadTabs, WorkspaceWelcome, AnalysisDetails,
  TeamRosterMenu, InlineApprovalCard, PreReadGate, ContextDisclosure,
  LeverageSection, TodayReassessmentPanel and their suites. Bot/group/coach
  surfaces survive inside the dock; the ensemble pipeline is reachable from
  the composer ("Full analysis" runs it and answers back into the chat). The
  app boots on Trade; stored 'chat' surface values migrate.

## v1.0.21 — Fix the stuck-on-loading boot crash

The v1.0.20 desktop build could hang on the splash screen forever: the
production bundle threw `Cannot access 'Sc' before initialization` during
module evaluation, killing React before it mounted (dev mode never runs
that code path, which is why CI's e2e smoke stayed green).

Root cause: the memory-retrieval module exported its functions as `const`
arrow bindings. Those initialize only when the module's body executes, and
that module sits inside several long-standing import cycles through the
notebook barrel — the bundle init order after v1.0.20's new modules
touched one of those cycles mid-flight and read the binding too early.
The fix makes every export in that module a hoisted `function`
declaration, which is initialized at module instantiation and immune to
evaluation order. Verified by booting the real production bundle
headlessly: the splash now clears and the console is clean.

## Renamed to August Trading

The app and the GitHub repository are now **August Trading** (repo
`Acepay25/august-trading`). Every user-facing string (window title, header,
onboarding, update overlay, reports, PWA manifest, Capacitor app name) and the
package identity (`august-trading`, installer `August-Trading-Setup-*.exe`)
follow. Two things deliberately did NOT change: the app ids
(`com.august35.tradingapp` — the invisible NSIS/update identity; changing it
would parallel-install instead of upgrading) and the localStorage keys
(rename would orphan saved settings). Because Electron derives the local data
directory from the product name, the desktop shell now carries the old
folder's contents across to the new one exactly once on first boot, so
provider keys, journals and preferences survive the rename. Old release URLs
and the auto-update feed keep working through GitHub's redirect.

Also defused a time-bomb in the harness-memory tests: three of them seeded
skills with fixed August dates, and once those aged past the 30-day
evidence-decay gate the decay halving demoted the skill before the
refinement gate could fire. The seeds are now relative to the clock, so
they cannot rot again.

## v1.0.20 — The harness learns strategy families, not just setups

Ported the transferable framework from Kakushadze & Serur's *151 Trading
Strategies* (SSRN 3247865) — the book's taxonomy, strategy template,
regime-dependence and alpha-decay theses — into six connected changes:

- **Controlled strategy vocabulary.** Every analysis now carries a
  `strategyFamily` from a fixed eight-family enum (trend-following,
  mean-reversion, breakout, range-fade, pairs/stat-arb, volatility,
  event-driven, market-neutral). The moderator names it in the trade plan;
  when it doesn't, the free-text strategy is keyword-classified into a
  family, and legacy rows backfill at parse time. Learning-loop statistics
  can finally aggregate over comparable buckets instead of strings the
  models invent.
- **Strategy template on skills.** Skills gained the book's template fields
  (signals, invalidation, horizon, sizing, family) so mined skills,
  imported skills and PDF-extracted strategies share one shape; the
  book-summarizer prompt now emits that shape.
- **Regime × family scoreboard.** Closed trades accumulate a family-per-
  regime win-rate matrix. Retrieval tilts skill ranking by how the family
  has been performing in the CURRENT regime, and the moderator's verdict
  prompt gets a compact "which playbook does the tape favor" line.
- **Alpha-decay demotion.** Confirmed skills now also track their last 12
  counted outcomes; a skill whose recent window decayed below 35% is
  demoted to candidate even while lifetime stats look fine — edges fade,
  and cumulative counters used to hide it.
- **Strategy archetypes at the flat floor.** Debate seats rotate through
  five strategy archetypes (trend-follower, mean-reverter, breakout
  hunter, range fade, stat-arb) by seat index, in openings and rebuttals
  alike, so seats disagree structurally instead of converging on one
  style. Lens mode and team personas are untouched.
- **Seed corpus.** Twelve crypto-executable strategies from the book land
  as `prior: book` candidate skills on boot — injected from birth (labeled
  as priors, not earned evidence) and then tested by the existing worth
  gate, so the library starts with hypotheses instead of a blank slate.

## CI gates the e2e smoke on every push

The release run caught three weeks of UI rot because the e2e smoke suite
only executed on version tags — the CI workflow stopped at
typecheck/tests/lint, so nothing exercised the real boot path between
releases. The End-to-end smoke step (Playwright, same suite the release
runs) now gates every push and PR to main. UI drift gets caught the day
it lands, not three weeks later at the tag.

## Release-blocking fixes: boot surface, a11y tree, and the smoke suite

The v1.0.18 release run failed its end-to-end smoke step — 9 of 11 tests.
Root-causing them surfaced three real app bugs (plus stale tests pinning
a removed surface), all fixed:

- **Booting landed in the Coach inbox, orphaning your conversation.**
  The chat-mode rework defaulted the active thread to the Coach panel —
  the learning-loop inbox — so the app opened on drafts-and-proposals
  while the actual trading transcript sat one click away, and the main
  ChatArea surface was unreachable without a room. A new `team` thread
  kind restores the ensemble transcript as the boot surface: a pinned
  Team row sits at the top of the roster (the rail's docstring always
  promised one), deleted rooms/bots fall back to it, and Coach demotes
  to the opt-in row it should be.
- **The Playbook drawer claimed `aria-modal` while closed.** It is
  permanently mounted (CSS-transform hidden), so with `aria-modal="true"`
  the ENTIRE rest of the app vanished from the accessibility tree —
  screen readers and the e2e role engine both saw a bare drawer and no
  Trading Journal, Live Market, or anything else. Modal semantics now
  ride real visibility, with `aria-hidden` + `inert` while closed.
- **Quick actions vanished with the unified sidebar.** The Journal /
  Live Market / Watch list rows lived inside the sessions-only sidebar
  fragment, so switching the sidebar to the BOTS pane removed the only
  entry points to them. The nav now renders in both panes.
- **Debate surfaces lost their labels.** The in-transcript debate stage
  regained `aria-label="Floor"`, each seat button carries
  `aria-label="Open {name} analysis"`, and the side panel is a labelled
  complementary landmark (`{name} transcript`).
- **Floor smoke tests rewritten to the current contract.** They pinned
  the removed bubble/ticker floor (`.debate-stage-bubble`,
  `data-thought`), which died in the floor-polish round; the suite only
  runs on release tags, so nothing caught it for three weeks. The
  rewritten tests pin today's contract — settled debate turns render
  one seat card per speaker with a bounded reasoning line, no
  cross-seat leakage, the verdict lives in the seat transcript rather
  than the card — seeded the way a reload actually persists (live
  debate flags are stripped on load, so seeded fixtures are settled).

## Skill creation traced end-to-end and pinned by a file-integrity suite

The question was "how do skills get created, and is the created skill
PROPER?" — answered by tracing every creation path and then pinning the
artifact's shape with tests.

**The paths a skill can be born from** (all funnel through the same
locked writer, `maybeUpsertSkill`):

1. **Evidence mining** — a closed trade joins a cluster of similar
   closed trades (same coin + direction + pattern family + regime).
   At `MIN_CLUSTER_FOR_SKILL` (3) similar outcomes with no matching
   skill already on file, the cluster is proposed to the worth gate.
2. **The LLM worth gate** (`skillWorthGate.evaluateSkillWorth`) — an
   LLM judge decides create / merge / skip, and when it says create it
   also writes the IF/THEN clauses and a falsifiable prediction. The
   gate's JUDGED clauses are what gets persisted (validated ≡ persisted
   — the writer never re-parses the raw post-mortem behind the gate's
   back). Verdicts: `create` validates and writes; `merge` tightens the
   named overlapping skill; `skip` stays skip.
3. **Post-mortem IF/THEN ingestion** — a hand-written IF/THEN in a
   trade's post-mortem promotes to a skill on the first closed trade
   (execution-error post-mortems are excluded — a broker rejection is
   not a market claim).
4. **Coach-crafted skills** (`SkillCraftService`) — verdict-evidence
   drafts, human-approved, ingested via `skill_ingest`.

**The guards that make a created skill proper** — cluster ≥ 3, no
duplicate matching skill, graveyard check (a retired twin drafts a
REVIVAL review card instead of a fresh re-create), a real lesson is
required (cluster statistics alone never fabricate a procedure), the
library cap turns creation into a displacement proposal at the cap,
and every write holds the notebook write lock.

**What a created file carries**: slug-named markdown in the skills
folder with valid frontmatter — status (`candidate` until evidence
promotes it), kind (avoid/repeat from the cluster's W/L balance), scope
(coin/direction/family/regime), win/loss counts with a monotonic
evidence counter, trade-id provenance, the loss streak, the IF/THEN
clause, a falsifiable prediction birth certificate, and a derived
one-line description (what the /slug menu and index lines show).

**New test suite** (`tests/skillFileIntegrity.test.ts`): creates a skill
through the real writer and pins the contract — slug-named file in the
skills folder, frontmatter round-trips through serialize/parse, complete
evidence (counts, provenance, streak, prediction, description), a
non-empty instruction body, and downstream usability: it matches the
setup that birthed it, resolves via /slug with kind and status, and
renders in the invoked-skills section. Five tests, all green.

## Bot threads get live data, member cards get identity, learning loop audit

Three things to land together: make Hybrid Intelligence reach every
bot (DMs were running blind), give the empty-room member cards the
identity tint we agreed to, and confirm the learning loop is actually
cycling so the harness improves run over run.

- **Hybrid data now reaches bot threads.** With the HYBRID toggle on, a
  bot answering in its own thread used to reason blind while the debate
  analysts and group-room members saw live prices. The mailbox now
  fetches the same live snapshot (once per turn, keyed on the symbol the
  prompt names) and appends it to the bot's system prompt — same gate
  the rooms and analysts use, silent fallback when the fetch fails or
  no symbol is present. Verified by three new hook tests: ON injects,
  off doesn't fetch, and a fetch failure never fails the turn.
- **Member cards wear the bot's identity.** The empty-room cards are
  now tinted with the bot's own avatar hue (a face-kind bot's spec, or
  the deterministic name hash for auto/pixel/upload). A new scoped CSS
  exception `.member-tint` (same doctrine as `.status-surface`) layers
  two faint radial gradients of that hue over a zinc base — the cards
  read as tinted, not as colored chrome, and the gradient is identity
  (same bot = same tint across renders), never decoration.
- **Learning loop audit.** The end-to-end cycle is intact: trade close
  in `useTradeLogging` → `syncClosedTradeToNotebook` (skill creation +
  eval scheduler kick) → attribution writes via `recordMemoryInjection`
  and `skillAdherenceForRun` → read-back into the next run's moderator
  bundle, the final card, and the veto lane. Nothing was missing;
  nothing needed patching. `applyNotebookSkillsToAnalysis` carries the
  current regime into the strict matcher so a regime-scoped skill
  doesn't veto in another regime. Skills become enforced telemetry
  only when a username is active — otherwise writes are still kept as
  history but cannot be attributed to a run.

## Empty rooms get an onboarding hero (side-by-side with OpenBot's)

A side-by-side against OpenBot's empty channel showed august's empty group
room losing badly: one muted sentence floating in a black void, an
"Activity" bar whose only content was a second hint, and a squished flat
composer bar. OpenBot answered the same moment with a headline, a big
inviting composer, a routing hint, and an agent gallery.

- **Empty group rooms now onboard.** The void is replaced with a hero:
  an eyebrow ("N bots · every member answers in turn"), a serif "Start a
  new thread" headline matching the home greeting, the @directing hint,
  a member card per bot on the floor (face, name, role or model — the
  grounded version of OpenBot's agent gallery), and starter prompts
  ("Introduce yourselves", "Debate the current BTC setup", …) that
  prefill the composer and focus it — never auto-send; prefill is a hand
  on the wheel, not a turn taken.
- **The Activity bar stops shouting into an empty room.** It now renders
  only when there is activity or a run in flight; an empty feed's sole
  content was a hint duplicating the hero.
- **The room composer reads as one surface.** Centered on the column
  like the main composer, pill radius, larger type, and a focus ring on
  the whole pill (focus-within) instead of none.
- **1:1 bot threads match.** The bare "No messages with X yet" line is
  now a hero: the bot's face, its name in serif, and the same honest
  line.

## Composer round: the input finally grows, skills are discoverable, replies are copyable

- **The composer textarea grows with its content.** It was fixed at one
  row with `overflow: hidden`, so anything past the first line was
  CLIPPED — multi-line prompts were invisible to the person typing them.
  It now grows with the text up to the cap, then scrolls.
- **Typing `/` opens the skill menu.** Skills are invoked by slug, but a
  slug you cannot see is a feature nobody can use. The composer now
  offers the notebook's skills (slug, summary, kind · status) as you
  type the token, filtered as you go; picking one completes it. Same
  grammar as the @mention menu: click to insert, Escape to dismiss. The
  skill's actual content still rides the run at send time.
- **Plain AI replies get a hover Copy affordance.** `handleCopy` existed
  and analysis cards used it, but ordinary chat replies had no copy
  affordance at all. It now appears on hover with the same ✓/⧉
  confirmation the cards use.
- **Click-send returns the caret to the composer.** Enter-send never
  leaves the textarea, but clicking send parked focus on a button that
  was about to swap meaning; focus now goes back to the input.

## Bot-mode UI: envelopes read like envelopes, tool rows expand, empty states tell the truth

The UI half of the bot-mode batch — the handoff envelope landed as logic
and prompt text first; this round makes what the human SEES match it.

- **Teammate DMs render as envelopes, not blobs.** The target thread's
  DM row used to be one flat string ("📩 Macro (teammate DM): …
  Constraints: … Wanted back: …" all inline, with the sender's name
  buried in the text). The row now carries a structured view: the header
  names the SENDER (in the target's thread, "You" was a lie about who
  spoke), the task is the body, and constraints and the expected answer
  render as separate muted lines. The flat text stays on the row for
  prompt/history replay — presentation only.
- **Tool action rows expand and rejections are loud.** Model side-effect
  rows (memory amendments, desk tool proposals, skill drafts) now open to
  their per-item detail with the review location — which previously lived
  only in a hover tooltip. A rejected proposal renders destructive
  ("Blocked — … rejected, nothing stored") instead of a zinc footnote;
  a refusal is a status.
- **The roster distinguishes its two nothings.** With a search query
  active and no matches, the rail used to render completely blank (the
  "No bots yet" line only fired when the roster was truly empty). A
  no-match search now quotes the query back — "Nothing matches '…' — no
  bot, group, or thread here is named that or contains it" — so a typo
  reads as a miss, not as lost bots; the genuinely-empty roster keeps its
  own explanation.

## Chat readability batch: streaming markdown repair, queued sends, handoff envelopes, invoked skills

Ports the highest-value mechanics from a deep review of CopilotKit/OpenBot
(the harness used for this app's peer review), adapted to august's
architecture. Two commits: the transcript/composer work, then the
bot-to-bot and skill work.

- **Streaming markdown repairs itself.** The live tail of a streaming
  reply used to render as raw pre-wrapped text — unfinished bold and code
  fences flashed as literal asterisks and backticks, and the tail's line
  breaking differed from the settled markdown, so text visibly reflowed
  the moment the stream moved on. The tail now renders through the same
  markdown pipeline as the settled text, after a repair pass that closes
  half-open fences, bold, inline code, and strikethrough (unambiguous
  closers only — a lone `*` is as often a bullet as an emphasis opener).
  Covered by ten new unit tests.
- **Typing while a run is live parks your words instead of chipping
  them.** Mid-run sends render as real, faded message bubbles above the
  composer with a "Queued · Remove" footer — the toast and the tiny chips
  are gone. When the run ends — however it ends — everything parked
  drains as ONE follow-up turn (newline-joined) that auto-runs. Park a
  correction, press Stop, and the correction is what runs next. This also
  fixed a real gap: notes queued during non-debate runs (casual chat,
  solo analysis) were never consumed by anything.
- **Send wins over Stop.** With a draft mid-run, the send button parks
  the message (screen-reader label says "Queue message") instead of
  killing the run; Stop is only stop when the box is empty.
- **New rows arrive instead of popping.** Message rows fade in with an
  8px rise — transform/opacity only so the virtualizer's measurements
  hold, 0.2s, reduced-motion keeps the fade and drops the movement. While
  a run has started but no AI row exists yet, a shimmering "Thinking"
  line fills the reply slot (shown only while the newest row is still the
  user's own message, so it never doubles up under a half-written
  answer).
- **Streaming no longer re-renders the whole transcript.** The per-run
  context maps were rebuilt on every chunk, defeating every memoized row;
  they are now keyed on a stream-stable signature (message ids plus a
  hash of user texts, so edits still rebuild), and only the streaming row
  redraws.
- **Bot-to-bot DMs are typed handoffs.** The `[[dm:@handle]]` grammar
  gains two optional follow-up lines — `[[constraints:…]]` (what the
  teammate must respect) and `[[expecting:…]]` (what you want back) —
  which attach to the most recent DM and ride the envelope. The target's
  visible DM row and its prompt carry the task plus "Constraints:" /
  "Wanted back:" lines; the teammate protocol teaches the fields. The
  protocol's "at most two teammates" rule is now ENFORCED: a reply that
  tries to DM a third teammate gets a model-actionable refusal, and an
  identical (handle, text) marker repeated in one reply is deduplicated.
  The prompt also now says why `[[expecting:…]]` matters: a handoff
  without an expected answer comes back as prose nobody asked for.
- **Invoked skills carry their content.** `/slug` in the composer used to
  send only the NAME ("Apply notebook skill(s): x") — a wish, not an
  instruction. Invoked slugs now resolve against the notebook and their
  actual markdown body rides the run's instructions lane (every seat and
  the moderator receive it), labeled with kind and status; a slug that
  matches nothing is stated in place instead of silently dropped.
- **Chart series get a fixed palette with red/green reserved.** The model
  performance chart's gray ramp had duplicate colors — two models could
  share one line color. Series colors are now positional from a fixed
  palette (`utils/seriesPalette.ts`) that never reuses a slot and never
  borrows rose/red (LOSS) or emerald/green (WIN) — a chart series in the
  loss color would read as a verdict. Colors stay positional, never
  provider-derived.

## App.tsx split into orchestration hooks, shared lookup helpers, one review fix

Continues the approved implementation plan. App.tsx went from 4,588 to
3,328 lines; every extraction was verified as a behavior-preserving move
with regression tests, and the full suite grew to 2,071 passing tests.

- **Workspace bootstrap is mount-only again (bug fix).** The profile
  loading extraction had re-armed the startup workspace scan on every
  identity change of `loadUserData` — and that callback legitimately
  changes identity whenever provider configs, the lens config, or the
  ensemble selection change. Each re-run reloaded the whole profile from
  disk (loading flash, autopilot reset, migrations and startup backups
  re-running) and wiped work outside the debounced save window. The
  effect now reads the loader through a ref and depends only on stable
  setter identities; a regression test edits provider configs mid-session
  and asserts the profile loads exactly once.
- **Journal actions hook** (`useTradeJournalActions`): delete trades with
  thinking-record/autopilot cascade, clear-all with undo, insight
  generate/rewrite/delete, outcome/PnL/leverage corrections, AI Review
  regeneration. App keeps the stable debounced auto-refresh trigger; the
  regeneration latest-ref is assigned inside the hook.
- **Profile persistence hook** (`useProfilePersistence`): heavy DATA save
  (1500ms debounce), light SETTINGS save (2500ms), 15s mid-run heartbeat,
  synchronous unload flush. New fake-timer suite covers the debounces,
  the heartbeat's dirty check during a simulated streaming run (the DATA
  debounce perpetually restarting), idle silence, and the no-user
  bail-out.
- **Conversation housekeeping hook** (`useConversationHousekeeping`):
  clear-all with undo, new-conversation reuse, load, single/selected
  delete with the active-session fallback, user-message editing, and the
  Ctrl/Cmd+N + "/" shortcuts. A stale duplicated shortcut comment was
  removed.
- **Lens/ensemble config hook** (`useLensAndEnsembleConfig`): moderator
  picks with last-pick persistence, lens config setter, ensemble model
  selection, accuracy-mode confirmation, custom prompt setters,
  once-per-session ensemble seeding, catalog reconcile wiring.
- **Agent threads hook** (`useAgentThreads`): bots/groups roster state
  (pub/sub mirrored), thread selection with its composer side effects,
  unread badges, group-edit targeting, roster CRUD with confirm dialogs.
  The group runner, DM mailbox, and attention derivations stay in App —
  they are glued to the analysis-pipeline bridge.
- **Watch + autopilot hook** (`useWatchAndAutopilot`): watch toggling,
  open-risk badge, follow-up/pre-read handlers, the diff-based autopilot
  registration effect, startup catch-up, resolution confirm/dismiss, and
  deferred cross-conversation watch-list actions. The price-triggered
  re-debate trigger stays in App (it needs the pipeline's rerun-payload
  builder).
- **Floor projection hook** (`useFloorProjection`): gauge stats, positions
  rail, squawk tape (prints, reviews, harness lessons, run log, turns),
  day PnL, per-seat wire states, tickers, and the seat-click opener.
- **Shared lookup helpers**: `findProviderById` (providerUtils) and
  `findBotById` (agentRoster) replace ~20 inline `find(x => x.id === …)`
  call sites across hooks, components, and App. Composite-predicate
  lookups (ready-provider checks) and the Hermes bot registry (a
  different type) deliberately keep their local predicates.
- **Claim rejected after re-probe:** the plan's step to delete
  `NumericChartService.detectPattern` as a "strict subset" of
  `CandlePatternDetector.scan` is false — the two differ in input shape,
  pattern vocabulary, strengths, and priority, and the chart pattern
  feeds the AI prompt string and a state-confidence nudge. A repoint
  would change model-facing numbers, and an output-preserving adapter
  would keep the entire function. Dropped.

Gates after every step: tsc 0 · vitest green (2,071 passed / 11 skipped) ·
vite build clean · eslint 0 errors on touched files · dev boot 200.

---

## reviewer follow-ups: dead code, per-file import, sweep backoff

Follow-ups from the R54 independent code review (all non-blocking
suggestions, now landed):

- **Merge artifacts deleted.** `TeamDialog.tsx` (unreferenced since the
  Team→Group merge) and `BotDetail.tsx` (unreferenced since bots open
  straight into chat) are gone from disk along with their now-dead
  component tests and the unused lazy import in App. The Team-UI
  behaviors they covered (role picker, Inherit, seat prompt editing)
  live on the NewBotDialog persona section — which now has its own test.
- **Skill import never sinks a batch on one bad file.** `readSkillFiles`
  returns per-file outcomes (`Promise.allSettled`): read failures carry
  a reason and surface as normal import-failure toasts while the
  readable rest of the batch still imports. Test covers a 2-file pick
  with one unreadable file.
- **Trigger-less skills dedupe on title.** Frontmatter without
  `ifCondition` previously bypassed dedupe entirely; the import key now
  falls back to the normalized first `# heading`, so the same skill
  can't be re-imported under shuffled file names.
- **Model catalog sweep retries sooner after a total failure.** A sweep
  where EVERY ready provider failed (e.g. booted offline) persists
  `lastSweepFailed`, shrinking the next window from 6h to 15min —
  stale model dropdowns no longer pin for six hours. Partial failures
  keep the normal 6h gap. Tests cover the total-failure retry and the
  partial-failure exclusion.

Gates: tsc 0 · **2013 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## bot failure visibility + reasoning-budget starvation fix

- **Why "(Raven could not reply — provider error)" appeared while models
  worked elsewhere.** Two distinct failure modes were both rendered as
  generic errors:
  1. The room/DM turns run through the STREAMING transport
     (`streamQuickResponse` → `streamViaProxy` on dev), which — unlike the
     non-streaming `sendChatRequest` — had NO retry: one 429/network blip
     killed the turn instantly, and the catch threw the real message away.
     Now `streamViaProxy` retries the stream OPEN via `withRetry` (3
     attempts, same backoff as non-streaming), and both `useAgentGroups`
     and `useBotMailbox` put the transport's user-safe reason INTO the
     bubble and the activity feed instead of "provider error".
  2. "I am sorry, I could not generate a response." was a lie: the stream
     completed cleanly (HTTP 200), but a reasoning model burned the whole
     chat budget (2048 max_tokens) inside its hidden chain of thought and
     never emitted visible text — gateways that ignore `reasoning_effort`
     make this routine. `streamQuickResponse` now detects exactly that
     (zero visible + reasoning seen + not aborted), retries ONCE with a
     doubled budget, and if it still lands empty the fallback says the
     model spent its budget on hidden reasoning instead of claiming it
     "could not generate".
- **Where the truth already lived:** Settings → Providers shows each
  provider's persisted `lastError` (ProviderHealthService) and the roster
  ⚠ tooltip classifies it — the new bubble text just surfaces it inline.

Gates: tsc 0 · **2013 passed / 11 skipped** (4 new regression tests) ·
build clean · eslint 0 errors.

---

## group room: cancel, hybrid toggle, reference reply styling

- **Cancel a group request.** While a room round runs, the composer's
  New Thread button becomes **Stop** (and an inline Stop sits next to
  the "X is thinking…" line). Stopping aborts the in-flight stream, the
  round loop bails at the next member boundary, partial bubbles are
  finalized (kept when they have content, hidden when empty), and the
  activity feed records "Room passed (cancelled)". Implementation:
  `useAgentGroups` gains an `AbortController` per run + a public
  `cancelRun` (nonce bump + abort).
- **Toggleable Hybrid Intelligence for the room.** The group header has
  a **Hybrid** switch (shares the main hybrid setting). When ON, live
  market data is fetched ONCE per send and the enhanced packet
  injection is appended to EVERY member's system prompt — the whole
  room reasons over the same live read. Fetch failures fall back to
  plain prompts; the room never blocks on it.
- **Reference reply styling.** Member replies now render as Markdown on
  the canvas (bold headers/labels like the reference's BTC reads) with
  a hover **copy** icon at the row's right — matching the Hermes group
  screenshots. The title-links/`onOpenTeam` prop (a Team-era artifact)
  is gone with the Team merge.

Gates: tsc 0 · **2020 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## Team→Group merge, group-tabs-only strip, member personas, skill import

- **Team and Group are now ONE concept — the Group.** The group UI
  (Activity timeline, reply-in-thread, member tabs, gear/trash) is kept
  as-is; Team's features merged into it; every Team surface removed:
  - `ThreadSelection` no longer has a `team` kind; defaults land on the
    Coach inbox instead. The Team tab is gone from `ThreadTabs` (strip =
    group tabs only, rendered only inside group threads).
  - The roster rail has no Team row and no New Team menu entry; groups
    gain a hover **gear** that opens the group editor (membership +
    member personas). TeamDialog is no longer imported by App (file kept,
    unreferenced); team state/handlers (`teams`, `activeTeamId`,
    `activateTeam`, `syncTeamToHarness`, dialog open state) deleted.
  - Debate personas now come from **group members**: each bot carries
    `role` + `instructions` (set via the New Bot dialog's Debate persona
    section or group editing); `useAnalysisPipeline` keys personas by
    provider+model across all groups — any group send debates with the
    room's member roles/instructions. Opening a group still re-arms the
    ensemble. (Team store code retained for data migration only.)
- **Skill import.** Settings → Skills gains **⬆ Import**: pick one or
  many `.md` files; each is validated (skill frontmatter required),
  deduped by trigger, name-unique (`-2`, `-3`… on collisions), and
  written into the harness skills folder — so imported skills are usable
  by the models in debates immediately. Outcomes surface as toasts:
  imported count, per-file failure reasons (nothing silently dropped),
  duplicates-skipped notice. New `SkillImportService` + 4 tests.

Gates: tsc 0 · **2010 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## Bot Mode UI parity: unified sidebar panes, thread tabs, bot page, room actions

The six Hermes Bot Mode screenshots as the reference; the app's chat
surface rebuilt to match, in four slices:

- **Unified sidebar (SESSIONS | BOTS | TERMINAL).** The desktop sidebar
  and the old second-column roster rail merged into one column with
  underline tabs (persisted via `useSidebarPane`, same pattern as the
  chat/floor toggle). BOTS embeds the full roster rail
  (`variant="embedded"` — transparent, no docked footer); TERMINAL is
  the background-jobs status stack (`JobsPane`, extracted from
  JobsDrawer, which now shares the same body). Floor mode and the
  collapsed rail fall back to the classic sessions body; the mobile
  drawer is byte-identical to before.
- **Open-thread document tabs.** A tab strip above the chat — Team,
  Coach, one tab per bot, one per group — mirroring the reference's
  `• BOT CHAT / • NEW SESSION` docs. Hidden in floor mode.
- **Bot detail page.** Opening a fresh 1:1 shows the reference's bot
  page first: large avatar, `Bot · @handle` (mono), description,
  "This device" host chip, Open chat. Dismissed per bot for the
  session; a 1:1 with history skips straight to the conversation.
- **New Bot dialog: Upload tab.** Faces / Upload / Pixel; an uploaded
  image is downscaled to a 96px cover-cropped data URL (localStorage
  quota safe) and clipped to circle/square/blob. Dialog copy matches
  the reference ("own memory, skills, and chat… can message your other
  agents"); description textarea deepened.
- **Room UX.** Group header gains gear + trash (gear reuses the New
  Group dialog as Group Settings — membership edits update the room,
  transcript untouched; `updateGroup` added to the roster store). The
  title links to the Team transcript. "Reply in thread" opens an inline
  composer under a prompt and runs a direct @everyone round — members'
  incremental context carries the prior thread, so it continues in
  place (no derived-thread surgery).
- **Model side-effect status rows (Hermes transcript parity).** When a
  seat proposes a tool (`forge_tool`), amends memory (`amend_memory`),
  or runs a forged/custom tool, the desk-tool loop now persists a
  `ToolAction` ledger on the message (`toolActions`, capped at 50) and
  the analysis bubble renders Hermes-style status rows: "Memory
  amendment proposed — review in Settings → Memory", "Desk tools
  proposed — review in Settings → AI Models" with count chips and seat
  names, and a ⚠ "rejected — nothing stored" row for failed proposals.
  Data lookups stay out (reads, not changes). Wired through all three
  run phases: openings (per-seat `analyzeTradingView`), debate rounds +
  every moderator call (`conductRealDebate`/`conductDebate` opts bag),
  and reset per run.
- **Skills + notebook writes join the ledger.** The post-mortem flow's
  three model-driven writes now surface the same way on the
  post-mortem bubble: evidence-backed skills created by the IF/THEN
  auto-ingest ("Skill created from evidence — slug"), the LLM-crafted
  skill draft ("Skill draft queued — review with the Coach"), and the
  AI-authored notebook note ("Notebook created/appended —
  folder/file"). The chat quick-save ("save this to the notebook")
  carries its status row too. Ledger appends go through one shared
  helper (`utils/toolActions.ts`) so every writer caps and persists
  identically.
- **Thinking rows restyled to the reference.** Settled collapsed rows are
  now a bare quiet `Thought ›` line — no lightbulb icon, no duration, no
  first-line preview, no "Show full reasoning" affordance, no box —
  blending into the transcript exactly like the reference. While
  streaming the row reads `Thinking · Ns` with the live ticker and
  bouncing dots; expanded it becomes the boxed, scrollable trace with
  Show more/less (unchanged). Custom labels ("Moderator thinking",
  "Thinking · N traces") are preserved verbatim; only the default label
  flips Thinking ↔ Thought with state. Applies everywhere ReasoningRow
  renders (chat bubble, debate replay, side panel).

- **TERMINAL sidebar tab removed** (user call: useless — the same
  background-jobs status stack lives in the header's Jobs drawer). The
  sidebar is now SESSIONS | BOTS; a stale stored 'terminal' value
  migrates to sessions, `JobsPane` is folded back into `JobsDrawer`
  (single surface again).
- **Message presentation to the reference pattern.** User prompts are
  now full-width, left-aligned cards — subtle panel, "You · time"
  header (DM badge inline) — instead of right-aligned plain text /
  right bubbles; this was THE gap that made the chat not match the
  reference. AI replies stay flat on the canvas. Group threads use the
  same card with the Reply-in-thread link inside it. The floating
  Hybrid Intelligence widget no longer hovers over the fresh welcome
  canvas (it returns once the conversation has content).

- **Sessions removed from the sidebar.** The desktop sidebar is the BOTS
  roster, full stop — the SESSIONS tab is gone (conversation history
  stays reachable through the header's history affordances). Floor
  mode / mobile drawer / collapsed rail still fall back to the legacy
  sessions body so no surface goes empty.
- **Model catalogs stay fresh automatically.** New
  `useModelCatalogRefresh`: on boot (+ every 6h) each ready provider's
  /models endpoint is queried and newly discovered ids merge into the
  config via the same update path Settings uses — so the composer
  selector, New Bot dialog, team seats, and automation editor all show
  the provider's CURRENT models without visiting Settings. Merge-only
  (manual additions survive), failures silent (offline keeps the
  stored list authoritative), staggered per provider.
- **Team seats: role inheritance is explicit.** Picking a role for a
  seat keeps inheriting the built-in role prompt at runtime (unchanged
  behavior) AND gains an **Inherit** button that copies the role's full
  prompt into the instructions box as editable text — refine it freely;
  the seat runs role + instructions (instructions win on conflict).
  No Inherit on the general-analyst default (nothing to copy).

Tests: +47 net across the round. Gates: tsc 0 · 2013 passed /
11 skipped · build clean · eslint 0 errors (whole dirty tree).

---

## Learning flow: seat diversity, ToolForge, manual A/B eval, memory self-correction

Four upgrades to how the harness learns and what the models may build:

- **Unroled team seats now diverge.** A 4–10 seat team left on "General
  analyst" gave every seat the same default mandate — N seats produced
  near-identical reads. Unroled seats rotate a FOCUS DIMENSION
  (structure → entry mechanics → risk/invalidation → momentum/regime →
  liquidity/positioning → macro context), stable per seat index; roled
  seats are unchanged.
- **ToolForge — models can create tools.** Any seat (or the arbiter)
  can call `forge_tool` to propose a new desk tool as a DECLARATIVE
  HTTP RECIPE — URL template, param mapping, JSONPath extract. No code
  execution, ever. The harness hardens proposals (https-only, SSRF
  guards, header rules, response caps, per-tool cache TTL) and stores
  them as CANDIDATES; a human approves network access in
  Settings → Skills → Forged tools before a tool can run. Confirmed
  tools merge into every seat's tool loop (`custom_*` executor with
  size caps + failure counting); stats drive retire decisions.
- **Manual skill A/B eval.** Skill detail gains "Run A/B eval" — the
  same with-skill/without-skill comparison the auto-scheduler runs,
  on demand, writing the same verdict ledger (helps/hurts streaks can
  promote or demote). Requires a memory model.
- **Memory self-correction.** New `amend_memory` desk tool: models can
  PROPOSE corrections to non-auto notebook files (edit = replace body,
  supersede = append a provenance-stamped correction section).
  Proposals land in Settings → Memory's review inbox — auto-managed
  files are unamendable, identical content is rejected, approvals apply
  through the notebook write lock, rejections are tombstoned.

UX wiring: every proposal fires a toast the moment it lands ("approve
in Settings → …"), and the Settings nav shows pending counts on the
Skills (forged tools) and Memory (amendments) tabs — nothing waits in
silence. Tool calls themselves already render as live chips in the
transcript via `onToolEvent`. Seat personas are now VISIBLE: the run
ledger carries each seat's role short name (or, for unroled seats, the
focus dimension), rendered as a tag beside the seat name on the floor,
in the transcript's actor cards, and in the rail's team-row subtitle
("Macro · Technical · Risk"). The floor squawk also prints seat
activity from the debate run log (rounds, drops, charges) and per-turn
working/passed/replied lines — the desk reads alive, reference parity.

Tests: toolForge (13), memoryAmendments (5), seatPersonas (+dim),
stageActors role/focus tags, teamSlots roleTag, plus catalog updates.
Gates: tsc 0 · 1966 passed / 11 skipped · build clean.

---

## Teams: seat roles, the 3-provider cap removed, living defaults

The Standard-mode debate blocked at 3 providers even though teams seat
up to 10 — the stale cap now matches the Team menu (`TEAM_MAX_SEATS`,
with the same pod-tier engine handling 6+ seats that was already
wired). Before creating a team, each seat gets a **role** (Macro,
Technical, Risk — inheriting that role's built-in debate prompt) and
optional **trader instructions**; both are editable later. A seat with
no role and no instructions isn't empty — it defaults to a
general-analyst mandate: analyze the market across all dimensions, aim
for the strongest actionable signal, ground everything in real data
via desk tools and web search (`web_search` is a registered desk tool
every seat can already call). Personas ride the whole run: the seat
directive in the openings phase, a per-seat prefix in the rebuttal
rounds (`conductRealDebate` gained `seatPersonas`, keyed by seat
name), and role-scoped tool presets (`defaultToolsForRole`) on the
opening call. A mid-debate replacement steps INTO the dropped seat's
persona under its own name. Ad-hoc ensembles (no active team) keep the
legacy 3-rotation mandate — no behavior change there. Also fixed the
rail avatar stacks bleeding over team names (properly sized 52px/46px
containers; group rows likewise). New: `services/agents/seatPersonas.ts`;
tests in `tests/seatPersonas.test.ts` (7), `tests/teamDialog.test.tsx`
(+4), `tests/debateFlow.test.ts` (+1). Gates: tsc 0 · 1948 passed /
11 skipped · build clean · eslint 0 errors.

---

## Bot Mode: rooms, attention badges, @mentions, bot Routines

Finished the port plan (`.hermes/plans/botmode-scan-and-plan.md`): group
rooms become real coordination, bots surface their own failure states,
the composer knows the roster, and a bot can own a schedule.

- **G2 room rounds — `services/agents/groupRounds.ts` (new, pure)** —
  the Hermes room engine: bounded round-robin rounds per user send,
  speakers chosen by a deterministic @mention parse (name/title/no-space
  forms, @everyone), replying exactly `(pass)` (or nothing/failing) is
  silence, and a round where everyone passed = settled. Per-member
  `lastSeenIndex` into the room log feeds each turn only what it hasn't
  seen (incremental context — what makes multi-round cheap).
  `hooks/useAgentGroups.ts` is rewritten onto the engine; `Message.hidden`
  + a GroupChatView filter keep passed turns out of the transcript while
  preserving thread attribution.
- **G3 needs-attention badges — `services/agents/botAttention.ts` (new,
  pure)** — `classifyBotAttention` over ProviderConfig +
  ProviderHealthService telemetry: no_provider / model_missing / no_key /
  disabled outrank transient auth / quota / benched. AgentRosterRail rows
  show a ⚠ badge with the one-line fix hint as tooltip (attentionMap
  computed in App).
- **G4 @mention autocomplete (ChatInput)** — mention chips now derive
  from the live roster via `botHandle()`; the old localStorage hack
  truncated "Risk Bot" to "@Risk", which no parser matched. Un-gated
  from ensemble mode — mentions work in every chat surface.
- **G5 bot-scoped Routines** — `AutomationConfig` gains optional
  `botId`: the run executes AS that bot instead of the ensemble
  pipeline. `services/agents/botRoutine.ts` (new, pure executor):
  persona via `buildBotSystemPrompt`, the bot's own provider/model over
  `streamQuickResponse`, reply persisted as an AI row attributed to the
  bot's identity pair (threadForProvider files it into the bot's 1:1),
  `[[dm:@…]]` markers stripped and delivered through the mailbox (one
  hop below a direct DM turn). Dangling bot / unconfigured provider /
  missing prompt = VISIBLE skipped runs (reason stored on the run +
  toast), never silent no-shows; ensemble automations are untouched.
  Editor gets a "Run as bot" SelectMenu (ensemble seats hidden and
  cleared while a bot is selected); the rail shows a Routines
  disclosure on a bot's row (schedule peek + Run now). App wires the
  automations hook to Bot Mode via a fire-time roster getter + mailbox
  DM delivery. AutomationRunCard renders bot-run cards properly: the
  persona reply in the bubble labeled "Bot reply" (was an empty
  "Neutral" card), skipped runs surface their reason in the body with
  it as the badge tooltip, outcome buttons stay analysis-gated.

Tests: `tests/groupRounds.test.ts` (12) + room tests in
`tests/agentGroups.test.tsx` (G2), `tests/botAttention.test.ts` (6, also
tsc-fixed), `tests/chatInputTalkTo.test.tsx` (+4, G4),
`tests/botRoutine.test.ts` (9) + `tests/automationBotRoutine.test.tsx`
(5) + `tests/botRoutinesUI.test.tsx` (9) — readiness/skip doctrine,
persona turn, marker strip + delivery, ensemble isolation, editor
gating, rail disclosure, run-card bot/skip/ensemble rendering. Gates:
tsc 0 · 1936 passed/11 skipped · build clean · eslint 0 errors on
touched files (new files fully clean).

---

## Bot Mode: teammate DMs (the Grok/Hermes heartbeat)

Deep-scanned Hermes Bot Mode at source level (plugin
`apps/desktop/src/plugins/hermes-bots/`, core `tools/bot_mode_probe.py`,
`bot_mode_dm.py`, `tools/bot_relay.py`, AGENTS.md's Bot Mode section) and Grok Bot
(xAI's "AI teammates" that share a cloud computer and text each other).
Wrote the mechanism map + port plan to `.hermes/plans/botmode-scan-and-plan.md`
(G1–G5). Implemented **G1 — teammate DMs**, the headline behavior:

- **`services/agents/botMailbox.ts` (new, pure half)** — `[[dm:@handle]] text`
  marker grammar (line-scoped body so prose after a marker stays in the
  bubble), roster-handle resolution (exact / collapsed / title, Hermes
  parity), `validateDM` with visible refusals (unknown target, self-DM,
  unreachable provider, hop cap, TTL, rate budget, malformed — a lost DM
  is the bug class Hermes's #93091 fixed), the byte-stable teammate
  protocol section (roster as `- @handle — role` lines, "fire-and-forget
  like texting, never predict a teammate's answer"), and
  `buildBotSystemPrompt` (persona system.md + notes memory.md + protocol —
  also fixes the pre-existing gap where bot threads used the generic
  assistant prompt).
- **`hooks/useBotMailbox.ts` (new, async half)** — per-target serial queues
  (Hermes's per-profile lock, in-memory since august's bots are
  in-process), 15-min envelope TTL checked at drain, 12/min global budget,
  3-hop chain cap. A DM runs the target's turn with its persona over its
  own thread; the reply lands in the target thread AND wakes the sender's
  thread with a "↩ replied to your DM" notice — the completion-notification
  shape, never auto-running the sender.
- **Pipeline (casual branch)** — bot-thread sends run AS the bot: exact
  provider+model, persona system prompt, thread-scoped history
  (`threadForProvider`), and the settled reply is handed to the mailbox to
  strip markers + deliver. Outside bot threads behavior is byte-identical
  to before. Bridge via `getActiveBot`/`onBotReply` refs (roster state is
  declared below the pipeline hook).
- **Transcript** — DM rows badge as "DM · teammate" (never read as the
  trader speaking); notices are attributed system rows; the rail's
  working-pulse merges draining DM queues.

Tests: `tests/botMailbox.test.ts` (13: grammar, resolution, refusals,
hop cap, protocol byte-stability) + `tests/botMailboxAsync.test.ts` (7:
wake-up notice, marker strip + next hop, TTL expiry, idempotent dispatch,
provider-not-ready fallback). Gates: tsc 0 · 1889 passed/11 skipped ·
build clean · eslint 0 errors.

---

## Reference-parity UI pass + Coach thread

Target: the Hermes-style reference screenshot (flat dark rows, fill-hover
selection, checkmark on the current row, avatar+name+time+preview list,
status-icon vocabulary). Gates: tsc 0, **1869 passed / 11 skipped / 0
failed**, build clean, eslint 0 errors on touched files.

- **New `components/shared/SelectMenu.tsx`** — the reference-styled dropdown:
  bare trigger, portal listbox, 13px rows, selection by background fill,
  check glyph on the current row, right-aligned muted meta, section labels,
  full keyboard (arrows/Enter/Escape, focus wraps), viewport flip. Optional
  `triggerClassName` for boxed form usage.
- **Native `<select>` popups replaced** (their OS-white chrome broke the
  dark theme): ChatInput's Talk-to (now Team / Bots / Models sections with
  model meta instead of the `─── models ───` hack), NewBotDialog provider +
  model, TeamDialog seat provider/model ×N + moderator pair. Tests rewritten
  to drive the listbox via `data-option` (teamDialog's "invalid seat" case
  now points a seat at a model-less provider — menus can't select '').
- **Monochrome fixes:** ModelPicker's cyan "free only" checkbox → zinc;
  the roster's "is working" emerald pulse now sits inside a `status-surface`
  scope so it renders as intended; roster "+" menu glyphs (☻ ⚿ ⚔) → lucide
  Bot/Users/Swords icons.
- **Coach thread — built.** `ThreadSelection` gains `kind:'coach'`;
  the roster rail gets a Coach row (GraduationCap avatar, unread badge =
  drafts + queue proposals waiting, "in sync" when zero, preview line);
  `components/chat/CoachThreadPanel` (lazy) renders the learning loop's
  inbox as cards in the reference vocabulary — drafts (If→then clauses,
  Save-as-skill / Discard routed through App's existing ingest + tombstone
  handlers, "View the trade" jumps back to the highlighted verdict card)
  and proposals (Apply for displacement/revival/demote via the
  learning-queue actuation paths, Dismiss for the human-edit kinds). Live on the same
  `august-skill-drafts` / `august-learning-queue` events. 8 tests
  (tests/coachThread.test.tsx). The coach thread is exempt from the
  last-opened marking effect (its badge is a backlog count, not unread
  messages).
- **Learning/memory/skill loop wiring re-verified end-to-end:** verdict →
  citations → adherence (exact-runId join) → evidence ladder + birth
  claim → proposals → Coach thread + Settings→Skills queue panel
  → apply paths → notebook. Drafts → Inbox + Coach cards → ingest.
  Pass mining → weekly sweep → drafts → same approval surface. Every queue
  now has a human-visible, human-actionable exit.

---

## Post-batch audit + review fixes: the learning loop's silent breaks

Full review of the uncommitted work from the preceding seven rounds: every
changelog claim re-verified against source, UI/UX wiring audited component by
component, three deep logic reviews. Gates after: tsc 0, **1861 passed / 11
skipped / 0 failed**, build clean, eslint 0 errors on all touched files.

**Wiring fixes (features that existed but never fired):**
- `annotateVerdictCitations` had ZERO callers → the `cited` field was never
  written → OVERRIDDEN adherence was dead. Now called at verdict commit
  (hooks/useAnalysisPipeline.ts), scoped to the run's own record via runId +
  a short settle wait so a slow Preferences write can't stamp the previous run.
- `runPassMiningSweep` had zero callers → wired into the weekly boot
  pass (fire-and-forget, ≤5 kline fetches/sweep) + 8 regression tests
  (tests/passMining.test.ts: TP-first vs SL-first resolution, cluster→draft,
  no draft from misses, the splice guard below).
- Journal now surfaces the miss-cost counter-metric (`missCostLine`);
  WeeklyReviewCard now renders `digest.metaCalibration` (Brier / gate
  precision / refinement recovery) — both computed but never displayed.
- Boot passes read `loggedTradesRef` BEFORE the profile's trades loaded →
  moved after the load, `loadedTrades` passed directly (App.tsx).

**Logic bugs:**
- passMining upsert: `splice(findIndex(...), 1)` with findIndex = −1 deleted
  the LAST record (JS negative-index semantics). Guarded.
- PreReadGate re-gated every old settled card → latest-only via
  `context.latestMessageId`.
- SkillCitationChips / ContextDisclosure queried injections by createdAt
  only → later runs' records leaked into older cards. Bound by the message's
  own `finishedAt`.
- **The adherence join was inverted** (the big one): the window looked at
  records AFTER `trade.timestamp` — but the run that shaped the trade
  PREDATES the log click, so every followed skill was mislabeled CONTROL and
  no skill ever earned FOLLOWED credit. Replaced with an EXACT runId join:
  runId (= triggering user message id) now persists on the injection record,
  `runStats.runId`, and `trade.sourceRunId`; `skillAdherenceForRun` joins on
  it. Legacy trades/records without linkage keep full credit (UNKNOWN).
  skillHoldout fixtures moved to production timing + 2 new regression tests
  (later run must not steal attribution; legacy trade = UNKNOWN).
- `runContradictionSweep`'s queued count was discarded → logged like the
  other passes.

**P0 — the learning queue was write-only (loop E):**
`listLearningProposals` had ZERO consumers — five subsystems (cap
displacement, graveyard revival, zero-evidence demote, re-scope ×3,
contradiction ×2) queued proposals into localStorage every week and nobody
could ever see or act on them. New `components/settings/LearningQueuePanel`
mounted in Settings → Skills: newest-first list, kind badges, Apply where a
deterministic actuation exists, Open-in-chat / Dismiss otherwise, live on the
`august-learning-queue` event. New apply paths in SkillMemoryService:
`applyRevivalProposal` (archive → live, as candidate — never straight to
confirmed), `applyDemoteProposal` (confirmed → candidate), and
`applyDisplacementProposal` now actually INSTALLS the challenger the gate
compared (its docstring promised this; the body only retired the incumbent).
6 tests (tests/learningQueueApply.test.ts).

**P0 — the birth certificate was never tested:**
`evaluateClaim` existed, was imported, and was called nowhere;
`claimTestedEvidence` was declared but never serialized or written. Now:
deriveStatus consumes the claim directly (an UNMET claim at horizon blocks
promotion; met/pending defer to the ladder), recordEvalVerdict tests the
claim each pass (stamps `claimTestedEvidence`, appends MET/UNMET/pending to
evalDetail), and the eval-promotion path honors an unmet claim. 7 tests
(tests/skillBirthClaim.test.ts).

**Dead code:** `skillInjectedSince` (zero callers; the dashboard derives the
same set inline) removed.

**Remaining scope (not defects):** Coach thread (roster bot rendering
drafts + queue proposals as inline cards) and message search were claimed in
batch 13 but never built — the drafts/queue now have real surfaces (Inbox +
LearningQueuePanel), so the Coach thread is a convenience layer, not a
functional gap. Deferred pending user go-ahead.

---

## Graveyard + retirement taxonomy, contradiction sweep, settled-belief challenge

**Skill graveyard — `services/learning/skillGraveyard.ts`:**
- Tombstone index per user (cap 40, newest-first): one line per retired skill —
  "tried X, retired: <reason> after N=<n>, lift <±pts>" — written at the
  archive sweep (retirement time), and injected into the WORTH GATE's context
  (capped 40, dynamic import; never into debates).
- Retirement taxonomy: `insufficient-evidence | regime-shifted | superseded |
  eval-hurts | user-veto`, mapped from the ledger's transition reason. The
  retire-band transition now stamps `regime-shifted` when the regime-drift sentinel
  sees a regime mix divergence, else `insufficient-evidence`; manual retire
  stamps `user-veto` (history + tombstone, not just 'manual').
- Creation dedup against the ARCHIVE (exact + token-shuffled trigger
  normalization) at both creation paths (worth-gate fold, crafted ingest) —
  a retired twin queues a REVIVAL review card with its re-entry rule instead
  of a silent re-creation; live dedup untouched.
- **Contradiction sweep — `utils/contradictionSweep.ts`:** live skill pairs with ≥2 shared
  condition tokens AND conflicting action (opposite kind / opposite direction)
  → one deduped merge/priority proposal per pair, fired weekly beside the
  review (no LLM).
- **Belief challenge — `services/learning/beliefChallenge.ts`:** per-slug rolling
  30-day counter for WIN trades whose direction contradicts the settled
  belief's claim (context-matched); ≥3 flags a review proposal — NEVER
  auto-invalidated.
- Tests (+26): graveyard exact/token-twins, tombstone lines + cap, reason
  mapping + re-entry rules, revival dedupe; sweep pair detection + dedupe;
  claim extraction, flag threshold, context/direction guards, status stays
  settled.

**Batch 6: self-improvement loop A→E**
- **A extractor** (`extractEpisodes`): post-hoc, read-only, outcome-linked
  episodes from closed post-mortems (rootCauseClass, key lesson, clause),
  180-day retention. **B fingerprints**: failure class + setup identity,
  normalized (ids/numbers/paths stripped); stable cause = mineable;
  unclassifiable → `unknown:<first-line>`; ≥2 occurrences ⇒ flagged.
- **C judge gate**: extract-only by DEFAULT (no drafting at all) until a judge
  precision ≥ 0.8 over ≥ 30 samples is recorded (`recordJudgePrecision`).
- **D distill + queue**: deterministic three-way classification (no cover →
  create-draft via the existing skill-draft inbox; shallow overlap →
  amend-trigger proposal; deep overlap → amend-body Pitfalls-only proposal);
  one draft per fingerprint/action/target (dedupe ledger); pruning: zero
  evidence AND zero injection hits in 30 days ⇒ demote SUGGESTION (kind
  `demote`) — never automatic. Human gate = the existing
  approval-inbox/skill-draft + learning-proposal queues.
- **E measurement loop**: fingerprint↔skill linking (re-linkable later),
  `recurrence_after_install` credited, zero recurrence in 30 days ⇒ resolved
  (+ skill credited), recurrence auto-drafts a REVISION proposal (never a
  silent rewrite); metrics via `loadLearningMetrics`.
- Wired into the weekly review pass (offline, add-only). Tests (9) incl. the
  plan's end-to-end seeded chain: inject failure → fingerprint → flagged →
  draft → approve → simulate recurrence → revision proposal appears.

Gates (both rounds): tsc exit 0, 1832 passed / 11 skipped / 0 failed,
vite build clean.

---

## Regime-mix drift sentinel (stale-by-regime, not stale-by-time)

Time-decay is the only staleness axis skill evidence had; a fast crypto
regime shift is invisible to a 30-day age constant. The sentinel compares the
mix during which a skill's evidence accumulated against the market's current
30-day mix, and downweights divergent skills in retrieval — the main way a
whole library goes quietly wrong at once now has a tripwire.

- `utils/regimeSentinel.ts` — `skillEvidenceMixWeights` (regimeStats counts →
  weights, raw keys mapped through the ledger's own `marketRegimeToLedger`);
  `currentRegimeMix` (regimeLedger sync cache, 30-day window); L1 distance
  with `REGIME_MIX_L1_THRESHOLD = 0.6` (strict >; boundary is NOT divergent);
  `STALE_BY_REGIME_DOWNWEIGHT = 0.6`.
- **Live-derived flag, no persisted state**: `regimeRankFactor` is computed
  on every retrieval read, so it auto-clears the moment fresh evidence in the
  current mix moves the skill's evidence weights back toward the market mix
  (no invalidation machinery to forget).
- Wired into the single ranking point (`rankedMatchedSkills` score =
  status × overlap × evidence-decay × regime factor) — the same score every
  consumer (opening slice, verdict extras, retrieval list) sees.
- Tests (`tests/regimeSentinel.test.ts`, 9): weight normalization, L1 math +
  threshold boundary, null safety, auto-clear, and a full-stack ledger-cache
  test (25 trending + 5 ranging days via `recordRegimeDay`) proving a
  cross-regime skill is flagged + downweighted (0.6×) while a dominant-regime
  skill is untouched, and unknown coins are silent.

Gates: tsc exit 0, 1806 passed / 11 skipped / 0 failed, vite build clean.
All four learning-loop follow-ups (a–d) are now complete.

---

## Context-budget economics (cost vs benefit of every injected skill)

Injection chars are the scarce resource; now the cost side is measured,
ranked, and audited on a cadence.

- **Per-source char telemetry** — `InjectedSource.chars` records the actual
  chars each block contributed to the prompt (retrieval's `push()` returns the
  sliced length; every source — skill, risk rules, mistake line, similar
  trades, identity — now logs it).
- **`utils/skillEconomics.ts`** — per-skill economics: cost = Σ injected chars
  (legacy records fall back to per-stage defaults: index line 120 / full-body
  retrofit 450 — the memory-index economics price an index line AND a recall pull
  differently), benefit = lift pts × injection frequency, value = lift-per-char.
  `worstBudgetOffender` picks the smallest lift-per-char among measured
  skills (highest cost when no lift data exists).
- **Monthly scoreboard** — `buildMonthReport` (with optional injections)
  names the worst offender in the card's `needsAttention` short list
  ("costs ~N chars for ±Xpt lift — worst value per char…"), and
  `runMonthlyReport` feeds the injection log in. The library's cost side is
  now reviewed monthly, alongside adherence, mistakes, and Brier.
- Tests (`tests/skillEconomics.test.ts`, 6): cost/benefit math from fixture
  logs, best-first sorting, index-line vs recall pricing (defaults differ
  >2×), no-lift skills never outrank measured ones, cost-highest fallback,
  empty-log safety. Existing monthlyReport tests unchanged (param optional).

Gates: tsc exit 0, 1797 passed / 11 skipped / 0 failed, vite build clean.

---

## Meta-calibration (the loop learns about the loop)

Three deterministic ratios, maintained by recorders at ground-truth points
and computed weekly into a per-user Preferences blob; surfaced in the AI
Learning Profile header (LearningDashboard) and on the weekly digest.

- `services/learning/metaCalibration.ts` — counters + a pending watch for
  gate-approved triggers; `computeMetaCalibrationRatios` (null when no
  sample); `runWeeklyMetaCalibration` (called by the weekly review pass)
  persists the ratios and, when worth-gate precision < 40% at sample ≥ 10,
  emits a harness wire lesson (`worth-gate-precision-decay`) with a
  default-change proposal (raise `MIN_SAMPLE_CONFIRMED` / tighten the Wilson
  band) — a decayed gate gets a proposal, never a silent threshold tweak.
- **Worth-gate precision** — `recordWorthGateApproval` at the gate fold's
  create path (the only `maybeUpsertSkill` caller, when `preferredClause` was
  the gate's judged clause); `recordWorthGateConfirm` on the candidate→confirmed
  transition (matched via the pending watch, so only gate-approved skills count).
- **Refinement recovery** — `recordRefinementOutcome` at both shadow
  settlements (the inline evidence-path settle and `settleSkillShadow`).
- **Eval-verdict agreement** — the first FOLLOWED trade after a helps/hurts
  verdict era counts once per era: helps→WIN / hurts→LOSS agreed.
- **UI** — three-chip row under the LearningDashboard header (monochrome;
  ‘—’ when a ratio has no sample); `WeeklyReviewDigest.metaCalibration`.
- Tests (`tests/metaCalibration.test.ts`, 8): approval→confirm via the watch,
  no confirm without approval, pending stays pending, once-per-era counting,
  null ratios on empty data, decay lesson at sample ≥ floor + below floor
  sample, no lesson above the floor.

Gates: tsc exit 0, 1791 passed / 11 skipped / 0 failed, vite build clean.

---

## Permanent ε-holdout (the long-run honesty mechanism)

~10% of runs now withhold skill injection so the CONTROL group keeps growing
and counterfactual lift stays honest after year one. Seeded per run id and
reproducible; deliberately NOT configurable.

- `utils/skillHoldout.ts` — pure, platform-stable decision: FNV-1a of the run
  id, `hash % 100 < 10` (≈10%). Same id → same decision, always; no id ⇒ no
  holdout (conservative default, never misclassifies).
- Decided at the single retrieval entry point (`getMemoryFilesContext`): a
  holdout run injects NO skill blocks (primary + verdict extras) for BOTH the
  analyst-opening and moderator-verdict slices (same runId), and the injection
  record carries `holdout: true` with no skill source — so downstream
  `skillAdherenceSince` sees "not-injected" and the matched skill's outcomes
  accumulate in `controlIds` (the CONTROL evidence group) instead of W/L.
- Run id = the triggering user message id (the run's stable identity in
  `handleSendMessage`), threaded `useAnalysisPipeline` →
  `assemblePipelineMemoryContext(runId)` → `MemoryContextOptions.runId`.
- `RunStats.skillHoldout` mirrors the same seeded decision, so every
  downstream consumer (signal card, dashboards, audits) can see whether a run
  was a control run.
- Tests (`tests/skillHoldout.test.ts`, 8): determinism, ~10% rate over 1000
  ids, no-id default, both outcomes; integration — holdout run injects no
  skill + records holdout:true; normal run injects + records the source;
  holdout-run outcome → controlIds, counts untouched; normal-run outcome →
  full credit.

Gates: tsc exit 0, 1782 passed / 11 skipped / 0 failed (one full-suite load
flake in roomComponents.test.tsx — passes 10/10 isolated, same class as the
documented skillsGrid issue), vite build clean.

---

## Stabilize the debate-pods tree: restore harnessSettings regression, fix type errors, reconcile tests

The debate-pods tree was NOT green: `tsc` exited 2 and 3 tests failed. A mid-flight
edits broke a foundational settings module and left the birth-certificate +
the three-state-adherence work half-integrated. This round gets it green again (gates: tsc exit 0,
1775 passed / 0 failed, build clean) without disturbing the debate-pods feature
surface.

- **Restore `utils/harnessSettings.ts` (regression).** The library-cap
  work rewrote the module from scratch, flattening the existing settings
  surface and deleting `getHarnessSettings` / `saveHarnessSettings` /
  `getSessionGuardConfig` (plus prompt-A/B, desk-tools, equity/risk, debate-cap
  fields) — breaking 11 consumers of the session-guard config and landing
  features. Reconstructed the full original module and extended it with
  `skillLibraryCap` + `DEFAULT_SKILL_LIBRARY_CAP` / `getSkillLibraryCap` /
  `setSkillLibraryCap`, so the cap ships on top of the working settings
  instead of replacing them. `getSessionGuardConfig` (preset + per-field
  overrides) is back as the single static source.
- **Fix the birth-certificate type errors.** `SkillMemoryService` frontmatter parse now
  `parsePredictionLine(...) ?? undefined`, and `skillWorthGate` builds its
  `SkillWorthDecision` with `prediction ?? undefined` instead of conditionally
  spreading (the `| null` from `sanitizePrediction` no longer leaks as `| undefined`).
- **Reconcile 3 tests to the shadow-refinement + Wilson-gate contract.** `harnessMemory` seed never
  set a live `ifCondition`, so the shadow-semantics assertion (live trigger
  retained vs. refined version in `shadow`) saw `undefined`; the seed now
  carries `ifCondition`/`thenAction`. `skillLedgerInvariant` fixtures were pinned
  at N=5 where the Wilson cold-start gate (N≥8, band excludes 50%) holds a
  skill at `candidate`; fixtures moved to 7W/1L (repeat) and 1W/7L (avoid) so the
  evidence-driven and worth-gate-merge transitions genuinely confirm.

---

## Debate pods + chat/floor observability, journal remainder, memory index, store unification

All uncommitted work in this tree, gated green (tsc exit 0, 1775 tests
passed, vite build clean).

**Batch 5 remainder:**
- Monthly report card: `services/learning/monthlyReport.ts`
  (deterministic what-happened/learned/needs-attention assembly incl.
  grade-the-panel Brier per provider + ensemble line) rendered by
  `components/journal/MonthlyReportCard.tsx` in the Journal.
- Pre-read capture: opt-in gate (`components/chat/PreReadGate.tsx` +
  `utils/preRead.ts`) — commit direction + confidence BEFORE the verdict
  reveals, stored as `userPriorCall`; human-vs-verdict calibration line in
  the journal and session usage panel.
- Index-layer memory injection: `buildGlobalMemoryIndex` replaces the
  JSON dump of GlobalMemory in `constructOptimizedContext` — one line per
  entry, ~900-char cap, `familyPerformance` stays injected verbatim; detail
  remains a `recall` tool pull.

**Batch 12 — seat tier + health read side:**
- Lens pods: `services/providers/debatePods.ts` — 6–10 seats map to
  3 pods, one trust-chosen representative carries the pod position to the
  floor, every seat still seals its own conviction; verdict transcript cap
  scales 2400 + 400×(seats−5). Roster cap raised 5→10 (`MAX_ROSTER_SEATS`),
  team chips and composer steering cover 10 seats. debateFlow tests at 6
  seats + pod unit tests.
- Provider health view: live last-error/latency/rate-limit read-out
  in Settings → Providers (the read side ProviderHealthService always
  promised).

**Batch 13 — chat + floor observability:**
- Unread thread badges on the roster rail + `markThreadOpened` on focus;
  message search over the flat thread array.
- Skill-citation chips on verdict messages (tap → skill card), per-message
  context disclosure ("what this seat saw"), harness-lessons browser in
  Settings.
- Floor mode: seat desks show thinking/effort/cooldown posture from the
  wire audit + health data, harness-lesson squawks, sealed-auction dot plot,
  guard state on the Big Board, pin-a-seat side pane.

**Batch 9 — store unification:**
- The attributed-insight store moved into the trader notebook: new
  `distilled/` folder, one auto-managed file per lesson
  (`services/learning/distilledMemory.ts`), `distilled:<fingerprint>`
  provenance, cap 200 pruning lowest-quality-first, write-through sync cache
  so reads-after-writes stay consistent. Old `attributed_insights_kb`
  preference rows migrate once on boot, then the key is retired.
- `AttributedInsight` type moved to types/learning.ts; the store API in
  PatternMemorySynthesisService is unchanged for consumers — only the
  persistence backend moved. The mandatory-pattern gate verdicts are pinned
  by a snapshot test (`tests/storeUnification.test.ts`).
- Regex miner deleted (`InsightExtractionService.ts`, ~870 lines): regex
  mining rewarded fluent writing, not correct writing, and its prompt-
  injection layer was dead code. Severity + provider-attribution machinery
  moved to `services/learning/severityInsights.ts` (cyclic import with the
  synthesis service reduced to one documented safe edge); provider
  attribution now pulls lesson text via the notebook's own deterministic
  lesson extractor — one lesson per provider, not up to 5 regex hits.
- Fingerprint dedupe: two lessons with the same normalized shape merge into
  one fact (magnitudes/ids stripped), keeping the merged feedback counters —
  the recurrence-counting substrate. `JobQueueService`'s
  EXTRACT_INSIGHTS job still records severity + provider lessons, minus the
  miner; the App-side per-profile insight-KB feed was removed.
- VersionHistoryDashboard's knowledge-base tab reads the notebook-backed
  store; insight feedback is awaited before reload.

---

## Audit-fix batch, dead-code cleanup, weekly review

**Batch 14 (all audit findings from the v5 plan review, fixed with
regression tests in tests/auditFixes.test.ts + tests/probeSelfHarm.test.ts):**
Kelly advisory sign bug (journal losses are negative — the advisory never
rendered in production; now normalized at both function and call site).
The wire audit now fires on the messages (Claude) and google (Gemini)
transports too — every apiFormat gets a budget line. The known-answer
probe no longer pins off a WORKING provider: 64→512 probe budget,
"200 + no OK" is inconclusive (no lesson), and the knob-rejection
heuristic requires rejection wording. Wire-shape assertions added to
debateFlow (rebuttals carry effort 'high', verdict 'max', audit sink on
every call). The lesson loop closed: the clarification audit stream writes budget
lessons, and the moderator verdict now sees a capped HARNESS NOTES block.
Trade cap buckets by OPEN time (analysis.createdAt); realized P&L keeps
close time. Shared rowPnlUsd converter (margin = investmentAmount, else
risk base) now used by SessionGuard AND disciplineAnalytics. Guard config
is live: preset picker (tight/FTMO) + per-field overrides in Settings →
Harness, read by every assessSession call site. SMC block moved high in
the hybrid packet so the 2400-char head-slice can't truncate it first.
Cooldown in-memory scope + success-clears ruling documented; all-benched
moderator fallback now warns. Dead P2 tiers wired (post-mortem medium,
chat/OCR low). quietHours got its test suite; skillsGrid timeout raised.

**Batch 8:** deleted the six orphaned components and the ~980-line
conductTwoWayDebate/conductThreeWayDebate generators + their five test
blocks (error-path coverage already lives on conductRealDebate); stale
"dead generators" comments updated.

**Batch 5 partial:** pre-trade checklist (utils/checklist.ts,
FTMO defaults, OFF by default, Settings toggle, checkboxes in the capture
modal, completion stored on the trade); weekly review service
(services/learning/weeklyReview.ts — deterministic week stats + ONE
improvement impulse from a provider call, 7-day + 3-trade gate, boot
trigger next to the rollup, WeeklyReviewCard on the Journal analytics
tab). Still open from batch 5: monthly report card, pre-read capture,
index-layer memory injection.

Gates: tsc 0, full suite 1715 passed / 0 failed, build clean.

---

## zcode/claude UI parity, debate hardening, learning-loop review fixes

**UI parity with the reference screenshots.** The whole app moved onto the
Claude-dark gray ramp (#111111 page / #1a1a1a panels / #262626 composer /
~#37373d active fills). Composer rebuilt as the borderless pill: centered
placeholder, bare Chat/Trade pills, seat-glyph avatars (1/2/3 — no more
accidental "KKK" from provider initials), leverage relocated into the Team
menu, Templates row removed (skills still fire via `/slug`, now with a
reference-native "Try in chat" button on every skill card). Sidebar became a
lighter-than-page rail with bullet rows and a footer account popover. Hero:
solo serif greeting ("Up late" from 22:00). Debate feed rows are typed and
tinted (violet DMs / blue lookups) with zcode-style count-grouping
("Lookups · 4"). Settled verdict cards carry a Replay · Run log · Audit tab
strip plus protocol/prompt-version provenance chips. Reasoning rows are
collapsed by default everywhere, truncate on line boundaries, and markdown
rendering tightened (paragraph rhythm, neutral inline code).

**Debate engine hardening.** Protocol lanes are deterministic (hashed from
the setup — same idea, same structure, no more flaky round counts); residual
clarification concerns surface in the verdict prompt; seats cut off by the
budget keep their last sealed conviction in the auction; rebuttal budget
raised and a missing CONVICTION line retries once; debates without live
hybrid data force one grounding tool call before any seat may speak;
moderator DM receipts carry real round numbers.

**Learning-loop review fixes** (post-implementation audit, all verified):
eval A/B arms rebuilt on the production context builder with skill exclusion
+ telemetry suppression (no more contaminated baselines or phantom
attribution credit); worth-gate create/merge restored behind the notebook
write lock; strict matcher extended to eval-trade selection and lift so the
audit measures what enforcement enforces; consolidation dedupes evidence
counts instead of double-counting; merge transitions ride the temporal
ledger; refine reports real change instead of always toasting success;
inline-approval memo deps fixed so cards track drafts.

Tests: 1147 passing across 122 files (new suites: debateMailbox,
debateSidePanel, protocolAndInlineApprovals, skillConsolidation). Lint 0
errors, typecheck clean, production build green.

---

## Conviction drift tracking + recall_chat session search

**D2.2: conviction drift.** New `services/analysis/convictionDrift.ts`:
extracts each seat's ordered sealed-conviction trajectory from stored debate
transcripts and measures whether rounds actually MOVE anyone. The moderator's
seat-trust record now says which seats are "movable" (changed stance in ≥40%
of debates) vs "rigid" (never moved), with the direction — so a movable
seat's FINAL conviction gets weighted over its first. The Learning
Dashboard's conviction card shows the same signal ("moves · avg Δ−18").

**U7: recall_chat desk tool.** New `services/infrastructure/sessionSearch.ts`
— unified search over stored conversations (term-frequency × role weight ×
recency, 1600-char bounded digest). Exposed as a 10th desk tool so seats can
search past debates mid-run ("did we discuss this before?"); the arbiter's
tool policy includes it. One backend, ready for future UI search too.

Tests: convictionDrift (extraction quoting-guard, trajectories,
movable/rigid profiles) + sessionSearch (rank, no-match, digest bounds).

---

## Debate-stage polish: inline steer input + cost tooltips

The two known-open polish items from the graph-ranking round:

**Inline steer input.** Clicking a seat's paper-plane no longer opens a
browser `window.prompt` — an inline row appears under the debate stage
("→ Macro · [note for Macro — only they see it] · Queue"). Enter queues,
Esc cancels. Monochrome, in keeping with the composer.

**Cost/latency tooltips.** Each stage actor's hover tooltip now carries the
quiet ledger line from `runStats.analysts` — "Macro — qwen3-1.7b · 41s ·
1.2k out" — so per-seat cost is visible without opening the side panel.

Tests: `tests/debateStageSteer.test.tsx` (inline queue flow, tooltip line,
stop button).

---

## Graph-scored ranking, temporal skill ledger, per-seat controls, jobs drawer

The four queued deep-scan items, implemented together:

**Graph-scored skill ranking (M3 reconciliation).** `rankedMatchedSkills`
now scores every matched skill as status weight (confirmed 2 / candidate 1)
× setup-dimension overlap × evidence-freshness decay (120-day constant,
same as MemoryGraph). The dashboard graph and production retrieval can no
longer disagree about what matters. The M3 conflict is resolved by design:
moderators keep seeing skills through audience filtering (index tier at
verdict), not exclusion.

**Zep-style temporal ledger.** Skills carry a `history:` frontmatter array —
every status transition stamps validFrom → invalidAt with a reason
(evidence / eval hurts N/M / manual). Demotions and retirements close the old
era instead of erasing it; `skillStatusAt(meta, timestamp)` answers "what did
I believe at this moment?" for replay audits. Wired into evidence-driven
status derivation, eval 'hurts' demotions, and manual retire/restore.

**U3: per-seat Steer/Stop.** Hover a live actor bubble on the debate stage:
the paper-plane queues a note that rides ONLY that seat's next prompt
("**USER STEERING — DIRECTED AT YOU**"), the square benches the seat at the
next round boundary (drop path reuses the tested transcript purge). Both flow
through new engine hooks (`getSeatSteeringNote`, `shouldDropSeat`) and the
pipeline exposes `handleSteerSeat` / `handleStopSeat`.

**U4: Jobs drawer.** Header "Jobs" button opens a right drawer (Hermes
status-stack pattern): live job queue rows (insight extraction etc., with
status + error) and the 20 most recent skill audits with their verdicts.
Background autonomy becomes visible instead of fire-and-forget toasts.

Also: lint error in ChatArea hero greeting fixed (useless assignment).
Tests: `tests/temporalLedger.test.ts` covers transition stamping, replay
queries, and frontmatter round-tripping.

---

## Root-cause failure patterns in the evidence pack (2026-08-23)

The first production payoff from the graph-engineering research (GraphRAG /
Zep / LightRAG): the memory system's root-cause classification — which until
now only fed the dashboard graph — surfaces as a **high-level failure-pattern
line** in the verdict evidence pack.

When a coin+direction cluster has ≥4 admitted technical losses and ≥50% of
them classify as SETUP_EDGE_FAILURE, both the moderator's prompt block and the
card's evidence panel now say so explicitly: *"Failure pattern: 3/4 of your
admitted BTC Short losses are SETUP_EDGE_FAILURE — the setups themselves, not
execution or macro shocks. Tighten entry criteria before trusting this class
again."* Execution errors and macro shocks never fire the line (they don't
admit edge lessons), small samples stay silent, and the card renders it in the
status-surface scope.

This is LightRAG's dual-level idea in miniature: seats reason at low level
(specific skills, similar trades); the arbiter now also gets one high-level
line summarizing what the cluster's cause nodes say — no new infrastructure,
just reading data that already existed.

---

## Memory honesty fixes + composer declutter (2026-08-23)

**Edge decay now actually reaches prompts (M1).** The 120-day exponential
decay documented in the seat-trust round lived only in the dashboard's memory graph —
`getMemoryFilesContext` fed prompts from raw similarity. `findRelevantTrades`
gains a `decayByAge` option and both prompt consumers (similar-trades block,
verdict evidence pack) now use it: old trades still appear with their lessons,
but at honest reduced weight, and can no longer crowd out fresh evidence.

**Bot memory respects the setup (M2).** `getBotMemoryContext` ignored its
query entirely (`void query`). Bot notes are now line-filtered to this
coin/regime: matching lines and general lessons pass, other-coin-specific
lines are dropped, persona blocks always pass. Multi-bot merges are capped at
1,800 chars total so N bots can't balloon the analyst prompt outside the
stage-budget discipline.

**Provenance counter (M4).** Skills serialize a monotonic `evidenceCount`
frontmatter field; the verdict block's "learned from N logged trade(s)" now
reads it instead of the tail-20 tradeIds list, which silently capped long-lived
skills at 20 forever.

**Composer declutter (from screenshot audit).** The nine-chip suggestion row
(@roles, debate templates, skill slugs) collapses behind one "Templates ▾"
toggle — the default composer is text + attach + Team + send, DeepSeek-minimal.
The duplicate footer "Team" chip is suppressed (the composer dropdown already
carries that control); overflow counting uses visible chips only.

Verified: typecheck, 1106 tests, lint, build all green. New suite
`tests/memoryHonesty.test.ts` pins decay math, bot-note filtering, and
evidence-count round-tripping.

---

## DeepSeek-parity chat polish (2026-08-23)

Component-by-component comparison against the DeepSeek harness UI (thinking
row, settled turn, composer) drove three polish items — all view-layer:

**Quiet model byline.** Every settled AI bubble now ends with a whisper line:
`Macro · Technical · Moderator · 41s` (seat roster from the run ledger +
wall-clock duration). This is the exact "DeepSeek-R1 · 12s" convention —
previously august buried model names inside a details table.

**One container language.** New shared `AuditPanel` wrapper; the run-contract
panel, evidence-pack card, and used-notes strip all render through it, so a
stack of audit surfaces reads as one grouped system instead of five competing
boxes. Same radius/border/background everywhere.

**Chip-bar overflow.** Past three active context chips above the composer,
the tail collapses into a single `Context · N ▸` summary with a hover/focus
popover listing the hidden chips. No second toolbar row, no portal, no deps.

Verified matches (no change needed): `ReasoningRow` already implements the
DeepSeek thinking row exactly — live expand while streaming, scroll-pinned
latest-line ticker, collapse to "Thought for Xs" on settle, plain-text body
while running and markdown on settle. Hover-copy affordance also matched.

---

## Arbiter evidence, setup-stats tool, run contract UI (2026-08-23)

**The moderator can finally see its own journal.** `getModeratorAnalysisStream`
now accepts the trade log, so the `recall` desk tool works at every moderator
surface (clarification questions, judgment, verdict, accuracy verification,
post-mortem debates) — previously only analysts had history and the arbiter
recalled nothing.

**Arbiter tool policy.** The moderator's default desk is now memory + context
(`recall`, `get_setup_history_stats`, session, web search). Order-book and
derivatives data no longer reach the binding verdict by default — argument
quality decides, not wall noise.

**New desk tool: `get_setup_history_stats`.** Any seat can check a claim like
"this setup usually fails" against the real journal: sample size, win rate,
average R, last outcome, worst lesson for a coin+direction cluster. Honest
"no logged trades" when the sample is empty.

**Verdict evidence pack.** Before the moderator writes the verdict, a compact
block is assembled automatically: this desk's record on the setup, top similar
closed trades, matched notebook skills, doctrine header. The binding decision
no longer depends on the moderator remembering to call recall.

**Run Contract panel.** Every debate card shows its stage ladder as a live
todo — Gate scan → openings → rebuttals → clarification → verdict — derived
from the existing run log. Skips are honest and labeled ("USD budget cap
reached", floor alignment), so a lopsided-floor verdict is visible instead of
silent. Frozen into the finished card for replay audits.

**Evidence pack card.** The settled verdict card shows what the arbiter's
evidence pack contained: journal record line, similar trades with lessons,
matched skills with freshness, doctrine header. Prompt-side block and UI card
show the same data.

**Chat surface color pass.** Post-mortem headers, live post-mortem stream and
the hybrid session panel dropped their purple/indigo accents back to the
charcoal + steel-blue theme; the strategy auto-discover button joins the accent
family properly.

Also: skill injection credit is scoped to each trade's time window (one old
injection no longer upgrades credit forever); the dead Bayesian calibration in
post-mortem debates is wired into the transcript; README rewritten to describe
this repo.

---

## Seat trust, provenance, edge decay (2026-08-22)

**Seat-trust weighting.** The moderator verdict prompt now includes each seat's historical record: Brier calibration score, overconfidence gap, and average sealed conviction from stored debates. Seats with proven accuracy are flagged trustworthy; overconfident seats get an explicit discount instruction when they dissent from better-calibrated peers. Data comes entirely from the existing trade log.

**Skill provenance.** Verdict-stage skill blocks now state what they were learned from ("learned from 7 logged trade(s)") alongside freshness, so the model knows both how old and how well-evidenced a rule is.

**Per-skill lift measurement.** New `MemoryProvenanceService` computes whether a skill actually improved outcomes: win rate on matching setups *after* the skill existed versus before it. Positive lift = the skill helps; negative = it misleads despite plausible evidence. Surfaced in the Learning Dashboard Skills card (`lift +12pp`) and folded into its color coding.

**Memory-graph edge decay.** `similarTo` edges now fade with trade age (~120-day exponential half-life). Old associations stop surfacing without deletion — the same decay philosophy applied to skill counts during memory simplification, extended to the graph.

**Settings: audience toggle.** Skill files in Settings → Memory files show an `audience:` button cycling all → analyst → moderator, controlling which debate audience may load them.

Also: changelog.md created (this file).

---

## Fully-automated skill self-evaluation (2026-08-22)

The harness audits its own knowledge with zero user action:

- After every trade-log sync, one due confirmed skill gets an A/B eval (re-analyze up to 6 of its matched historical trades with the skill on vs off).
- Due policy: enabled + confirmed, ≥3 matched trades, ≥10 closed trades since last eval, ≥24h cooldown. Max 2 auto-evals per session.
- Verdicts stamp into frontmatter (`evalVerdict: helps (3/3)`, `lastEvalAt`).
- **Causal override:** a `hurts` verdict demotes a confirmed skill to candidate on the next evidence pass. Injection-causation outranks outcome correlation.
- Doctrine staleness header: `(beliefs last consolidated around trade N)` injected above doctrine so models know how current their convictions are.

The loop is closed end-to-end without human intervention: write → count evidence → confirm → A/B verify → demote if harmful → re-verify later.

---

## Progressive disclosure + eval engine; IF/THEN removal (2026-08-22)

- **modified:** timestamps on every skill write; injection surfaces human-readable freshness ("evidence 12d old").
- **Tiered skill injection:** openings/rebuttals get a one-line index (`AVOID [confirmed · 1W/6L · …] IF…THEN…`); verdicts + recall serve full bodies.
- **audience frontmatter** (analyst/moderator/all) controls which debate seat may load a skill.
- **Dynamic context:** `${SYMBOL}`/`${REGIME}`/`${DIRECTION}` substituted live at assembly.
- **SkillEvalService**: with-skill vs without-skill benchmarking engine (deterministic flip scoring).
- **IF/THEN rules system removed** (completed alongside the eval engine): post-mortem lessons flow only through skills; validation-gate structured rules retired; CONFIDENCE_RULES safety rails kept as constants; legacy rule data migrates mechanically to candidate skills.

---

## Memory simplification (2026-08-22)

Fewer, truer memories:

- Hard stage budgets (opening 900 / rebuttal 400 / verdict 600 chars) with ranked fill order; doctrine has its own always-on slot.
- Diary = raw storage, never injected.
- Recurring-mistakes lines go quiet once a skill owns the cluster.
- Similar-trade history moved to verdict-only.
- Skill refinement slowed (3 consecutive losses spanning ≥48h); doctrine rewrite every 15 trades with ≥⅔ carry-forward.
- Evidence decay: counts halve when >30 days stale or earned in a different regime.
- IF/THEN rules retired from prompt injection (folded into skills).
- `recall` desk tool: debate seats pull their own memory on demand instead of receiving bigger prompts.

---

## Earlier rounds

See git history for the earlier work (Brier calibration summaries, skill effectiveness review, debate upgrades B1–B4, memory-as-own-knowledge voice work, UI surfacing).
