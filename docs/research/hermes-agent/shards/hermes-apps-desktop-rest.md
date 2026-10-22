# hermes-agent :: hermes-apps-desktop-rest

**Files in shard:** 463 (read: 362, skipped with reason: 101)
**What this shard covers:** Three TypeScript/Rust front-end packages of the Hermes agent repo — `apps/shared` (a runtime-free shared library: the JSON-RPC gateway client, colour/fuzzy/i18n primitives, billing refusal policy), `apps/bootstrap-installer` (a Tauri-based bootstrapper that installs/updates the agent binary on a fresh machine, with its own update/marker/powershell Rust core), and `apps/desktop` (an Electron desktop client whose bulk is *not* product code but the build/packaging/signing/test harness around it: ~90 Playwright e2e specs, ~100 packaging scripts, perf harnesses, and the design docs that explain why). The shard is therefore mostly about **how a serious desktop agent client is operated and gated** — install/update correctness, replay-safe reconnection, human approval plumbing, and a build pipeline with real gates.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `apps/shared/src/json-rpc-channel.ts`
- **Purpose:** The transport-agnostic half of every Hermes JSON-RPC connection: request ids, pending-call map with timeouts + AbortSignal, response→typed-error mapping, event-notification decoding, server→client request routing, and the `gateway.ping` heartbeat.
- **Key abstractions:** `JsonRpcRequestChannel` (the class), `JsonRpcTransport` (`send(text)` — the only thing the channel knows about the wire), `ServerRequest`/`ServerRequestHandler`, `JsonRpcGatewayError`, `jsonRpcErrorFromFrame`, `wireFrameText`.
- **Data flow:** Owner supplies a transport per *connection generation* and calls `handleFrame(text)` for every inbound frame. `handleFrame` classifies: server→client request (string `id` + string `method`) → `deliverRequest`; a response with a known `id` → settle the pending call; an `event` notification → `onEvent`. `gateway.ready` triggers `advertiseCapabilities()` (one `client.capabilities` call per generation).
- **Non-obvious design decisions:**
  - `heartbeatLiveness` is a *mode*: `'response'` (TUI contract — only a pong/response counts) vs `'any-inbound'` (desktop/web contract — a streaming delta is life). The desktop uses `'any-inbound'` (json-rpc-gateway.ts:196).
  - The heartbeat deadline is judged against **the last ping we actually sent**, not the last frame received (json-rpc-channel.ts:544): a hidden Chromium window spaces ticks 60 s apart, so a naive "age of last pong" deadline kills every idle hidden socket.
  - A crashing request handler is answered `-32603` immediately (json-rpc-channel.ts:428) instead of leaving the backend to wait out its full deadline ("clarify blocks 3600s").
  - An unhandled request is answered `-32601` (json-rpc-channel.ts:470) so the backend never waits against a client that cannot answer.
  - `respond`/`fail`/`decline` are **idempotent** — a `settled` flag means the first answer wins; a card re-delivered after a reconnect answering twice is a no-op on the wire.
  - `decline` is conditional on `backendCountsDeclines`, learned from `client.capabilities` → `declines_not_shown`; an older backend settles on the first error, so there `decline` stays silent (json-rpc-channel.ts:416).
- **Edge cases & failure handling:** `AbortSignal` drops the pending call immediately (no dangling resolver or timer); a `send` throw clears the pending entry; `detach(error)` rejects every in-flight call; `wireFrameText` returns `null` for anything that is not string/ArrayBuffer/view, so a malformed frame is skipped rather than parsed.
- **Surprising:** `JSON_RPC_SESSION_NOT_SHOWN = 4404` is an **application** code, not a JSON-RPC standard one — a "no window here shows this session" decline is modelled as a distinct error so the backend can count it as one client abstaining rather than as an answer.

### `apps/shared/src/json-rpc-gateway.ts`
- **Purpose:** WebSocket client for the gateway, built on `JsonRpcRequestChannel`; owns the **lossless reconnect replay** contract (per-session `seq` watermarks, replay epochs, gap events).
- **Key abstractions:** `JsonRpcGatewayClient`, `GatewayEventHub` (typed per-event fan-out plus a `'*'` wildcard), `ConnectionState`, `REPLAY_CURSOR_MAX = 256`, `APPROVAL_RESPOND_TIMEOUT_MS = 300_000`.
- **Data flow:** `connect(wsUrl)` → open → `channel.attach` → `fetchReplay()` (fire-and-forget) → `setState('open')`. Inbound frames → `handleEvent` → either parked in `replayHold` (if a replay for that session is in flight) or dispatched. On reconnect, `session.events.since` is asked per session with the client's watermark; replayed frames go through the **same** `dispatchIfNewer` path as live frames, gated on `seq`.
- **Non-obvious design decisions:**
  - **A replay epoch is server-process identity.** Seq counters are in-process on the backend, so a restart resets them while the client still holds high watermarks — without the epoch check, `events_since(sid, 97)` returns `[]` + `truncated=false` forever and the client silently believes nothing was missed (json-rpc-gateway.ts:150).
  - **Live frames racing a replay are parked, not dispatched** (`replayHold`), because dispatching them early either double-dispatches or advances the watermark so the replayed gap events get skipped (json-rpc-gateway.ts:139).
  - `APPROVAL_RESPOND_TIMEOUT_MS` (300 s) is deliberately **equal to the backend's own approval window** (json-rpc-gateway.ts:44): a shorter client timeout races it, and the frontend shows "request timed out" on a card the backend already resolved (#60654).
  - `snapshot_required` from the server drops the watermark *and* the session epoch, then emits a synthetic `session.replay_gap` so the pane re-snapshots — "nothing is silently lost" (json-rpc-gateway.ts:432).
  - A `truncated` replay window is **skipped entirely** and the cursor advanced to the server head, rather than painted as a gap — the tail has a hole, so the authoritative transcript must be re-read (json-rpc-gateway.ts:414).
  - `replaySessionGone` (`reason: 'not_found'`) deletes the cursor instead of leaving it to be re-asked on every reconnect forever (json-rpc-gateway.ts:395).
  - `REPLAY_CURSOR_MAX = 256` mirrors the backend's own ring limit; the least-recently-advanced cursor is retired *with a gap event*, not silently dropped.
  - Connect failures are **classified**: "server refused the token", "TLS/DNS/refused before open" and "nothing answered" are distinct messages, because the boot overlay renders the message verbatim (#41566).
- **Edge cases & failure handling:** `invalidate()` drops the generation *before* closing so a synchronous `close` event cannot re-run the closed path on the replacement socket; `connectTimeoutMs` (15 s) closes the half-open socket so the next `connect()` does not short-circuit on a zombie `connecting` state; a server that closes during the handshake may never fire `error`, so a `close` listener rejects with the code.
- **Surprising:** `sessionReplayBarrier()` returns `false` (not `undefined`) when a history response beats the replacement connection — "a pending history read must be abandoned (the next open re-reads)".

### `apps/shared/src/color.ts`
- **Purpose:** THE sRGB colour primitive shared by the desktop themes and the Ink TUI: parse, mix, measure, and fix colours so both surfaces share one definition of "readable".
- **Key abstractions:** `parseColor`, `toHex`, `mix`, `relativeLuminance`, `contrastRatio`, `readableOn`, `ensureContrast`, `lighten`/`darken`.
- **Data flow:** a colour string → `parseColor` (hex3/hex6/rgb()) → WCAG luminance → contrast ratio → either pick the better ink or step-mix toward the opposite pole until the ratio clears.
- **Non-obvious design decisions:**
  - **Unparseable input returns `null`, never `0`** (color.ts:16): a silent `0` makes `ansi256(245)` look like pure black and passes garbage through contrast checks as if it were a real measurement.
  - `readableOn` **measures** both candidate inks rather than thresholding on luminance — GitHub's dark green `#4f9e5e` is 3.29:1 with white but 5.50:1 with near-black, and a luminance threshold gets exactly that case wrong (color.ts:118).
  - `ensureContrast` **accumulates** the mix amount (`amount += rung`) rather than computing `i * step`, because the desktop's shipped `--dt-primary-solid` values are derived from the exact float sequence of the accumulating loop (color.ts:172). The tests pin byte-identical outputs (`#cba6f7` → `#514263`).
  - Mixing is **sRGB lerp on purpose** for byte parity with the desktop's `color-mix(in srgb, …)` ladder; perceptual OKLCH math is desktop-only.
  - A pathological `step` (NaN, Infinity, ≤0, denormals) is normalised back to the default 0.2 ladder, and the loop terminates for every JS number.
- **Edge cases & failure handling:** unparseable bg → colour returned unchanged; a colour that already passes is returned byte-identical.
- **Surprising:** the 0.2 rung size is a **cross-surface constant**: "The TUI's chainable form opts into 0.05 for less hue loss" — two surfaces, one ladder, two documented rungs.

### `apps/shared/src/translucency.ts`
- **Purpose:** The single definition of what "window translucency" means, agreed between the Electron main process (native window) and the renderer (page surfaces).
- **Key abstractions:** `TranslucencyState`, `TranslucencyBook` (per-appearance layered settings), `GLASS_MATERIALS`, `GLASS_SCOPES`, `normalizeState`/`normalizeBook`/`resolveTranslucency`/`setTranslucencyValues`, `glassActive`, `windowOpacityFor`, `vibrancyFor`, `backgroundMaterialFor`, `hudFrostFor`.
- **Data flow:** persisted JSON → `normalizeBook` → `resolveTranslucency(book, appearance, isWindows)` → the resolved state drives (a) main's `setOpacity`/`setVibrancy`/`setBackgroundMaterial`, (b) the renderer's surface tint via `glassSurfaceKeep(intensity)`.
- **Non-obvious design decisions:**
  - **Two modes, one lever.** `clear` maps the lever to native window opacity (the whole window fades, text included); `glass` keeps the window opaque natively and *thins the renderer's page surfaces* so a platform material reads as a matte blur while text keeps full contrast (translucency.ts:8).
  - The **material IS the frost control** on macOS — `VibrancyOptions` has no blur-radius knob, so the 14 materials were reduced to 4 by a **pixel census on macOS 26**; the census also found `sidebar`/`hud` collapse into `under-window` when unfocused, which "shipped as two indistinguishable picker options once" (translucency.ts:26).
  - The Windows frost list is **derived** from the frost→backdrop mapping (`WINDOWS_GLASS_MIN_BUILD = 22621`, build number not kernel version) so two rungs can never composite identically again (translucency.ts:110).
  - The book is a **three-rung ladder**: appearance slot → base → default, per key, so an untouched appearance inherits and an edited one does not (translucency.ts:176). A v1 flat payload migrates into `base` so an already-tuned window keeps exactly what it had.
  - `normalizeMode` prefers **glass** on a capable OS when no mode was recorded, but a profile with a non-zero *legacy* intensity keeps `clear` — "flipping a window someone already tuned is the one thing a default must not do" (translucency.ts:196).
  - `windowOpacityFor` under glass reads `fade` (a separate lever), and `fade` is gated on `glassActive` — "Off has to mean off" (translucency.ts:390).
  - `glassMaterialForPicker` folds a Mac-only rung onto the rung that renders the same backdrop, so the picker shows a truthful selection without rewriting the value the user saved on another machine.
- **Edge cases & failure handling:** every persisted field is re-normalised on load, so a hand-edited `translucency.json` cannot crash the window; Linux fails closed to `clear` and the setting row is not shown at all.
- **Surprising:** the whole module is a **negative-space** design — much of its value is in what it refuses to expose (duplicate rungs, `auto` material, a Linux glass option).

### `apps/shared/src/charge-settlement.ts` + `apps/shared/src/billing-policy.ts`
- **Purpose:** Drive a billing charge to a terminal state, and decide what each refusal code means for recovery.
- **Key abstractions:** `driveChargeSettlement(deps)`, `SettlementOutcome` (a discriminated union of `settled | failed | refused | ambiguous | timed_out | cancelled`), `BILLING_REFUSAL_POLICY` (a `Record<KnownBillingRefusalCode, BillingRefusalPolicy>`), `refusalPolicy(code)`.
- **Data flow:** `fetchStatus()` → `status.ok`? → refusal code → policy → (`ambiguousMidPoll` ⇒ stop; `retry` ⇒ sleep `retry_after` capped at 30 s and poll again; else ⇒ `refused`) → otherwise `settled`/`failed`/poll every 2 s until the 5-minute cap.
- **Non-obvious design decisions:**
  - **`ambiguous` is a first-class outcome.** `insufficient_scope`, `remote_spending_revoked` and `session_revoked` are marked `ambiguousMidPoll` because "losing scope mid-poll cannot undo an accepted charge, so its outcome is unknown" (billing-policy.ts:22). The client must not retry these as if they were clean failures.
  - **Retry-safe codes reuse the idempotency key** (`reuseIdempotencyKey: true`) — network errors, rate limits, Stripe unavailability and temporary unavailability may all retry the *same* charge.
  - `refusalPolicy` on an **unknown** code returns `{recovery:'none'}` — "unknown codes must still show the server message; no special handling is the safe fallback" (billing-policy.ts:61).
  - The refusal table is typed over a **closed** `KnownBillingRefusalCode` union, so adding a code without a policy is a compile error (billing-types.ts:73).
- **Edge cases & failure handling:** a transport throw is `ambiguous` with the cause attached; the poll cap (5 min) yields `timed_out`; `isCancelled()` is checked at the top of every iteration.
- **Surprising:** `SETTLEMENT_MAX_RETRY_AFTER_MS = 30_000` clamps a server-supplied `retry_after` — the client refuses to obey an unbounded wait.

### `apps/shared/src/billing-types.ts`
- **Purpose:** The Remote Spending wire contracts shared by the Python gateway and the TS clients.
- **Key abstractions:** `KnownBillingRefusalCode` / `BillingRefusalCode` (`Known | (string & {})`), `BillingPaymentMethod` (a narrowable discriminated union), `BillingStateResponse`, `SubscriptionStateResponse`, `UsageModelData`.
- **Non-obvious design decisions:** `BillingPaymentMethod` is a **three-arm union with literal `kind`s** — the `(string & {})` trick used for refusal codes *deliberately does not* apply here, because on an object union it makes the discriminant non-literal and defeats narrowing for every arm (billing-types.ts:130). A compile-time guard file exists solely to keep that narrowing honest.
- **Edge cases & failure handling:** `card` is a **lossy older view** of `payment_method` — `!card` does **not** mean "no payment method on file" (a Link customer would be told they have nothing), and absence of the field means "this gateway didn't say", not "nothing on file" (billing-types.ts:126).
- **Surprising:** `billing-payment-method.test-d.ts` is a *type-only* test file — its only job is that `tsc` accepts it.

### `apps/shared/src/session-http-mutations.ts`
- **Purpose:** A client-side identity/precondition protocol for session mutations (the closest thing in this shard to a write-ahead intent log).
- **Key abstractions:** `createSessionMutationClient()` → `mutate(key, read, send, importing?)`; `SessionMutationSnapshot` (`runtime_revision`, `runtime_generation`, `exists`); `SessionMutationIdentity` (`request_id`, `expected_revision`, `expected_generation`).
- **Data flow:** a snapshot is read → a `request_id` + expected revision/generation are captured → the write is sent with that identity → on success, **every other retained identity for the same session is retired** (their revision is superseded, so replaying them could only conflict or return a stale receipt); on a *definitive* rejection the identity is dropped.
- **Non-obvious design decisions:**
  - **The captured precondition is never silently refreshed.** A retry or a profile switch may not re-read the revision, because the identity "must stay until the same intent is acknowledged" — otherwise an ambiguous write could be applied twice (session-http-mutations.ts:5).
  - The retirement key is a **JSON array whose first two entries are the destination scope and the session id**, so a profile switch does not strand identities (session-http-mutations.ts:60).
  - A refusal regex enumerates only *definitively rejecting* codes (`revision_conflict`, `stale_generation`, `permission_denied`, `profile_mismatch`, `admission_conflict`, `session_busy`, `mutation_identity_required`, …); a network error does **not** clear the identity, because the write may have landed.
  - A malformed snapshot (`runtime_revision` not a safe integer, `exists` false when not importing, missing generation) throws "refresh before trying again" rather than sending a write with a guessed precondition.
- **Edge cases & failure handling:** `crypto.randomUUID` with a hand-rolled v4 fallback (bytes 6/8 patched to the RFC variant/version bits) when the platform lacks it.
- **Surprising:** the whole module is ~70 lines of dense, semicolon-free code — the densest file in this shard, and the hardest to review.

### `apps/shared/src/fuzzy.ts`
- **Purpose:** A dependency-free fuzzy subsequence scorer used by every model/plugin picker on desktop, web and TUI so a query ranks identically everywhere.
- **Key abstractions:** `searchFold`, `fuzzyScore`, `fuzzyScoreMulti` (AND across whitespace tokens), `fuzzyRank` (filter + stable sort by score, original index as tiebreak), `FuzzyMatch {score, positions}`.
- **Non-obvious design decisions:**
  - The **separator fold** (`-`, `_`, `.` → space, on both query and target) is length-preserving, so returned match positions still index the original string and a highlighter can apply the same fold without drift (`gpt.4o` finds `gpt-4o`, `qwen3-8` finds `qwen3.8-flash`).
  - Scoring weights are deliberate: exact match +20, prefix +8, first-character +5, contiguous +5, word-boundary +3, gap penalty up to −3, minus `target.length * 0.01` so a shorter exact prefix beats the same prefix on a longer id.
  - Word boundaries include the **camelCase lower→upper transition**, so `gptO` matches `gpt-4o` at a boundary.
- **Edge cases & failure handling:** a non-subsequence returns `null` (the item is dropped, not ranked last); an empty/whitespace query returns every item in original order with no positions.
- **Surprising:** the file's own header says it is "intentionally simple — no external dependency", and it is shared through a *subpath export* (`@hermes/shared/fuzzy`) so each surface imports the module directly rather than the barrel.

### `apps/shared/src/slash.ts`
- **Purpose:** The slash-command wire contract every TS surface shares: how a typed line splits into name + argument, and the shape of the `command.dispatch` response union.
- **Key abstractions:** `SLASH_COMMAND_RE`, `looksLikeSlashCommand`, `parseSlashCommand`, `parseCommandDispatch`, `CommandDispatchResponse` (union of `alias | exec | plugin | prefill | send | skill`).
- **Non-obvious design decisions:**
  - The argument regex is `[\s\S]*`, not `.*` — a `.*$` regex fails the whole match on any newline, so **every multiline slash command parsed as an empty name and got swallowed** (#41323, #55510). The argument's *interior* whitespace survives verbatim ("flattening it once turned every pasted diff into one line").
  - The name is lower-cased because every consumer is case-insensitive; keeping the typed case only made surfaces disagree.
  - `looksLikeSlashCommand` requires the slash at **position 0** and a single bare segment: `/usr/local` and `run /clean` are prose.
  - `parseCommandDispatch` returns `null` for malformed payloads rather than a half-parsed union — including a `send` without `message`, because dropping the `notice` once made `/goal` "look like it did nothing on the desktop".
- **Edge cases & failure handling:** `exec` and `plugin` deliberately share one arm (`type: 'exec' | 'plugin'`).
- **Surprising:** the `skill` arm carries **both** `display` (what the UI renders) and `message` (the expanded skill body) — the wire deliberately sends the scaffolding but names the human-facing half.

### `apps/shared/src/skill-scaffold.ts`
- **Purpose:** A client-side twin of the gateway's skill-scaffolding projection, so a UI shows the *invocation* (`/work fix the leak`) and never the expanded skill body.
- **Key abstractions:** `skillInvocationText(text)` → `string | null`; the marker constants mirror `agent/skill_commands.py` byte for byte.
- **Non-obvious design decisions:**
  - The markers are **duplicated by necessity** ("The markers below mirror `agent/skill_commands.py` byte for byte") — the client must recognise a body the server sent, including when talking to an *older* gateway.
  - The single-skill instruction trails the body (which may itself quote the marker), so it is matched **from the end** (`between(..., fromEnd=true)`); the bundle header's instruction is matched from the front.
  - Ordinary user prose returns `null` so it renders as written.
- **Edge cases & failure handling:** newlines in the instruction are collapsed to spaces so the bubble stays one line.
- **Surprising:** the failure mode it prevents is **harness scaffolding leaking into a user bubble** — the same concern as August Trading's `utils/harnessMarks.ts`.

### `apps/shared/src/i18n.ts`
- **Purpose:** Locale scaffolding shared by the desktop and web i18n layers: deep-merge partial locales, bridge YAML packs onto function-valued base entries, and unflatten dotted pack keys.
- **Key abstractions:** `mergeTranslations`, `adaptStringOverrides`, `formatPositional`, `unflattenMessages`, `flattenMessageKeys`, `LOCALE_ENDONYMS`, `RTL_LOCALES`, `applyDocumentLocale`.
- **Non-obvious design decisions:**
  - `unflattenMessages` uses the **base catalog as a guide**: at each level the longest run of segments naming an existing base key wins, so a dotted leaf key (`keybinds.actions["session.slot.1"]`) round-trips instead of being shredded into four nested levels.
  - A flat key that collides with an earlier branch is **dropped, not allowed to clobber** — "one bad line can't erase a subtree".
  - `adaptStringOverrides` is the only bridge between YAML (text-only) and a base catalog of functions: a pack string over a function base entry is wrapped into a positional formatter so the merged catalog keeps the base's *call shape*.
  - `TranslationOverride<T>` makes functions and arrays **atomic** while recursing into plain objects — so a pack can never half-override a function's internals.
- **Edge cases & failure handling:** `formatPositional` renders an index the call did not supply as empty string rather than "undefined".
- **Surprising:** `LOCALE_ENDONYMS` deliberately carries **no country flags** — "languages are not countries (English ≠ GB, Portuguese ≠ PT)".

### `apps/shared/src/reconnect-backoff.ts`
- **Purpose:** The exponential backoff shared by every Hermes front-end socket (desktop gateway/plugins, web events feed, web PTY, Ink TUI attach mode).
- **Key abstractions:** `reconnectBackoffDelayMs(attempt, options)`, `isStableOpen(openedAt)`, `RECONNECT_STABLE_OPEN_MS = 5_000`.
- **Non-obvious design decisions:**
  - **Full jitter** (AWS "Exponential Backoff And Jitter") by default, because a bare exponential backoff lets a whole fleet retry in lockstep after a gateway restart — "a reconnect storm by another name".
  - `jitter: false` returns the exact ceiling, because the web dashboard renders *that* ladder into its "reconnecting in Ns" banner.
  - A socket that opens and dies inside 5 s counts as a **failed attempt**; resetting the ladder on every such "open" redials at attempt 0 forever (#83134: 55 sockets in 12 s).
- **Edge cases & failure handling:** negative attempts are clamped to 0; the exponent is clamped at 32 so `2 ** attempt` never reaches Infinity.

### `apps/shared/src/cron-trigger-controller.ts`
- **Purpose:** A renderer-local guard that stops one mounted UI surface from double-firing a cron-style trigger.
- **Key abstractions:** `createCronTriggerController(onRunningChange)` → `{isRunning, run}`; `CronTriggerRunResult {started, value}`.
- **Non-obvious design decisions:** the header is explicit that **this is an interaction guard, not the execution lock** — "Cross-window and cross-process exclusion remains the backend's responsibility via its durable cron claim; a renderer-local Set must never be treated as the execution lock."
- **Edge cases & failure handling:** the key is removed in a `finally`, so a throwing action still releases the guard.
- **Surprising:** the *honest* scoping of the guard (what it is not) is more valuable than the guard itself — a rare and good pattern.

### `apps/shared/src/usage-tick.ts`
- **Purpose:** Normalise the owner's `session.usage` / `session.stats` payloads into the `Usage` fields both status bars read.
- **Key abstractions:** `usageFromTick(payload)`, `TickUsage`, the `COUNTERS` mapping table.
- **Non-obvious design decisions:**
  - **A partial tick never zeroes a counter it did not carry** — each figure maps only when its source is present; the counter table maps one canonical name to an ordered list of *aliases* and takes the first non-zero.
  - `context_estimated` is derived from `context_source !== 'provider_usage'`, and a compressor (sized or not) sets `context_source` — so "estimated" is a fact about the source, not a guess.
  - The nested sidecar ticker's `usage` object passes through unchanged; the canonical owner's top-level counters are mapped field by field.
- **Edge cases & failure handling:** `pct` clamps to 0–100 and `context_used` is clamped to `context_max`.

### `apps/shared/src/update-debt.ts`
- **Purpose:** Read the *owed* post-commit work of a dashboard-started `hermes update` from its receipt summary, so the web toast and the desktop backend-apply store name the same debt by the same rules.
- **Key abstractions:** `updateDebt(receipt, actionId)`, `UpdateDebt {followups, userAction}`, `UpdateDebtReceipt`.
- **Non-obvious design decisions:**
  - **A receipt only belongs to an action if `action_id` matches** — the status route attaches the latest receipt when the action has none, so the id check is what separates "this run's debt" from "some other run's debt".
  - Debt is read for **every committed outcome** (`success` or `partial`), not only exit 0 — `record_user_action` turns a committed success into `partial`/exit 1.
  - The user-action string is never phrased as "re-run hermes update": **"a rerun does not restore it"** (a parked stash, e.g.).
- **Edge cases & failure handling:** a null receipt, a missing action id, or a non-committed outcome yields `null` (no debt banner).

### `apps/shared/src/gateway-events.ts`
- **Purpose:** The wire types for the `tui_gateway` JSON-RPC surface, plus the client-local synthetic events the TUI transport publishes into the same handler stream.
- **Key abstractions:** `GatewayEventMap` (backend-generated ∪ client-local), `GatewayEvent<K>` envelope, `CanonicalPromptEvent`, `ClientLocalGatewayEventMap`.
- **Non-obvious design decisions:**
  - The backend shapes are **generated from Python** (`tui_gateway/contracts`); `scripts/gen_gateway_contracts.py` regenerates the TS and `tests/tui_gateway/contracts/test_generated.py` fails when the committed file is stale — so a field the backend stops sending fails `tsc` instead of drifting.
  - The envelope carries **three different identity stamps**: `replay_epoch` (session-scoped replay generation), `authority_epoch` (runtime epoch of the owner), `execution_generation` (claimed generation) — plus `admission_id` (the turn's admission id) — so a renderer can tell "the same frame arriving on two sockets" from "a frame from a superseded run".
  - `session.replay_gap` is **synthetic on the client** *and* emitted by canonical gateways on fanout overflow; consumers re-resume the session for a snapshot.
- **Edge cases & failure handling:** `replayed: true` marks client-local recovery so a consumer can distinguish it from fresh user-facing work.

### `apps/shared/src/backend-scope.ts`
- **Purpose:** Composite backend scope keys for the multi-connection registry, derived identically by the Electron main process and the renderer.
- **Key abstractions:** `backendScopeKey`, `registryBackendScopeKey`, `backendScopePrefix`, `LOCAL_CONNECTION_ID = 'local'`.
- **Non-obvious design decisions:** the **local/primary connection keeps the bare profile key**, so every legacy pool entry, reaper log line and touch call stays byte-identical for single-source users; non-local connections get `conn:<id>::<profile>`, which cannot collide with a plain profile name because colons are invalid in profile names.
- **Edge cases & failure handling:** a null/blank profile normalises to `'default'`; `registryBackendScopeKey` does *not* collapse an explicit `'local'` id (a distinct source id).

### `apps/shared/src/ansi.ts`
- **Purpose:** ANSI escape stripping shared by every TS surface (TUI, desktop, web).
- **Key abstractions:** `stripAnsi`, `sanitizeAnsiForRender` (keeps SGR so a styled renderer can colorize), `hasAnsi`.
- **Non-obvious design decisions:** the coverage is deliberately broad — CSI (complete *and* truncated tails), OSC (hyperlinks, titles), DCS/SOS/PM/APC strings, multi-byte non-CSI ESC sequences, stray ESC bytes and C0 controls — because "a weaker SGR-only regex leaves `]8;;url\x07` payloads and `[12;` tails visible".
- **Edge cases & failure handling:** the order of the replacements matters (OSC/string first, incomplete-CSI before complete-CSI, then non-CSI, then stray ESC); `sanitizeAnsiForRender` keeps only `m`-command sequences.

### `apps/shared/src/catalog-featured.ts` / `catalog-browse.ts` / `catalog-install.ts`
- **Purpose:** The catalog taxonomy, the weekly-rotating hero pick, and the `hermes://` deep-link identifiers shared by the website, the docs galleries and the desktop.
- **Key abstractions:** `PLUGIN_CATEGORIES`, `PLUGIN_CATEGORY_ORDER`, `sortCatalogPlugins`, `groupCatalogPlugins`, `featuredPicks`, `pickFeatured`, `OFFICIAL_SKILL_SOURCES`, `skillCatalogInstallIdentifier`, `skillCatalogInstallUrl`.
- **Non-obvious design decisions:**
  - `featuredPicks` **rotates the curated list weekly by wall-clock week index** so slide one is the same entry everywhere the pick is shown; with no curated pick it falls back to the newest pictured official entry of the last 30 days, then to the official entry with art and the most stars. "Nothing here reads a download or install count; the feed has none."
  - `sortCatalogPlugins('stars')` **returns the published snapshot's order unchanged** — "Preserve its order, including ties, rather than reinterpreting missing star counts."
  - `groupCatalogPlugins` buckets an unknown category into `'general'` rather than dropping the entry.
  - `skillCatalogInstallIdentifier` handles three id regimes (explicit `installIdentifier`, legacy local skills with no identifier, and `clawhub/`-prefixed ids).
- **Edge cases & failure handling:** `catalog-install.ts` returns `null` for a built-in skill with no identifier (it is not installable), and `official/<name>` for an optional skill.

### `apps/shared/src/theme-presets.ts`
- **Purpose:** The raw palette table for every built-in theme preset — one source shared by the desktop (which layers OKLCH synthesis on top) and the web dashboard (which projects each preset to a 3-slot model).
- **Key abstractions:** `THEME_PRESET_PALETTES`, `ThemePresetColors` (a Tailwind-style slot list plus `midground`/`composerRing`/`userBubble*` extensions), `ThemePresetName`.
- **Non-obvious design decisions:** the palette-bearing presets (nous, github, catppuccin, everforest, solarized) are **forks of their VS Code originals**, so the rule is "re-convert from the upstream extension rather than hand-edit hexes"; `nous-alt` is first-party and must not be re-derived.
- **Edge cases & failure handling:** `midgroundForeground` is auto-derived from `midground` luminance when omitted; optional slots (`sidebarBackground`, `userBubble*`) are absent for some presets.
- **Surprising:** `nous-alt` is expressed as **`color-mix(in srgb, …)` tints of a single blue** rather than a second set of hand-picked hexes — a whole palette derived from three constants.

### `apps/shared/src/format.ts`, `model-search-text.ts`, `reasoning-effort.ts`, `data-url-read-max.ts`
- **format.ts** — the ONE compact-number formatter (`999 → "999"`, `1230 → "1.2k"`, `1_500_000 → "1.5M"`). `M` is the top rung **by design**: token and cost figures stay well under a billion, so `1e9` reads `"1000M"` rather than growing a `B` rung that no surface needs *and that would collide with the "bytes" reading in size labels*. Thresholds sit just under the unit boundary (`999_950`, `999.5`) so rounding can never produce `"1000k"`.
- **model-search-text.ts** — extra *search-only* tokens for the model picker (`k3 → kimi-k3 kimi`), because some providers report short or brand-less wire ids (`k3`) that users still search for by the familiar naming of sibling models. **The wire id is never changed**; the alias table has a documented Python twin.
- **reasoning-effort.ts** — the reasoning ladder `minimal|low|medium|high|xhigh|max|ultra` with `none` modelled as "thinking disabled" rather than as a level; `isReasoningEffort` is case-insensitive; `DEFAULT_REASONING_EFFORT = 'medium'`.
- **data-url-read-max.ts** — the shared cap for local files loaded as data URLs (16 MB default, 1–4096 MB bounds), with the honest note that "The whole file is base64-buffered in main, so this is a memory guard, not a model limit… values well below it can still OOM the app."

### `apps/shared/src/index.ts`
- **Purpose:** The barrel for `@hermes/shared`.
- **Non-obvious design decisions:** it re-exports **named symbols only** (no `export *` except for `gateway-events`), and the package also publishes **per-module subpath exports** (`./fuzzy`, `./slash`, `./color`, …) so a surface can import one module without pulling the barrel — and, importantly, without pulling the **generated** 262 KB gateway contract into its bundle.

---

### `apps/bootstrap-installer/src-tauri/src/marker.rs`
- **Purpose:** The cross-process "update in progress" lock: a tiny file whose bytes ARE the protocol, shared byte-for-byte with `hermes_cli/update_lock.py` and the Electron gate.
- **Key abstractions:** `UpdateMarkerGuard` (RAII owner), `AcquireError` (`Busy(MarkerOwner)` | `Unwritable(String)`), `MarkerOwner {pid, age_secs, held}`, `MarkerRecord`, `Release` (`Keep`/`Delete`/`Rewrite`), `MarkerState` (`Absent`/`Live`/`Dead`).
- **Data flow:** `acquire(path, install_root)` → sweep tmp litter → **exclusive publish** (write to a tmp sibling, fsync, hard-link onto the path) → if the path already exists, take the `<marker>.lock` sidecar's kernel lock → judge the existing record → adopt ours / refuse (`Busy`) / reclaim a dead one and re-publish. `complete()` (and `Drop`) → under the same lock → compare-and-delete or rewrite (hand the claim to a live delegate).
- **Non-obvious design decisions:**
  - **The marker body is a versioned wire format, not a blob:** `<pid>\n<started_at>\nct:<process creation time>\n[delegate:<pid> ct:<ct>]\n[run:<id>]`. The `ct:` line makes the pid a **process identity** rather than a number, so liveness never needs an age ceiling for a live owner and a **recycled pid is not mistaken for the original owner** (marker.rs:44).
  - **The first publish is lock-free but every decision-and-mutation runs under the `<marker>.lock` sidecar's kernel lock** (A7 rule 1). The sidecar is *never deleted* — deleting it would split the lock namespace. The verdict and the delete are therefore one critical section, so a claim published after a stale read cannot be deleted on the stale verdict (R3).
  - **A dead marker is removed ON READ**, not merely ignored — "otherwise the stale bytes keep failing every acquire until the 20-minute age ceiling expires" (marker_tests.rs:349).
  - **R6: a dead marker is NOT removed while the install's *checkout* kernel lock is held** — the update that died started a process that is still mutating the tree. The refusal then names a `held` owner (pid 0).
  - **A 0-byte marker younger than 5 s is a claim in flight** (live, pid 0, never deleted) — the brief window between an exclusive create and its first write.
  - **Own-pid claims are adopted only with an exact creation-time match** (`OWN_CT_EPSILON_SECS = 0.005`); a no-`ct` claim naming our own pid is a *previous incarnation* and is reclaimed. The 2-second tolerance for foreign pids never applies to our own.
  - **`ERROR_ACCESS_DENIED` on Windows means ALIVE** (the process exists but is elevated/other-user): "racing an elevated updater is worse than postponing".
  - **Zombies are dead**: `kill(pid, 0)` succeeds for an unreaped zombie, so `/proc/<pid>/stat` state `Z` (Linux) or `ps -o stat=` (macOS) is consulted first (#77259).
  - **Tmp litter is swept by dead pid**: `<marker>.<pid>.<nanos>-<seq>.tmp` siblings whose pid is gone are deleted; a tmp under our *own* pid is only litter if older than 60 s ("containers reuse pids every boot").
  - `release_decision` has three outcomes: our claim deletes the marker; our claim with a **live delegate** rewrites the marker with the delegate as owner; a marker not naming us is kept.
- **Edge cases & failure handling:** a marker under a regular file or in a read-only dir is `Unwritable` with an actionable message ("Run the update as the user that owns the install") — "never proceed unclaimed"; three failed claim attempts → refuse rather than run unserialised; `u64::MAX` `started_at` is age 0, never a panic; a 400-digit `ct:` is `f64::INFINITY` and matches nothing.
- **Surprising:** the whole lock protocol is pinned by a **shared JSON corpus** (`tests/fixtures/update_marker_corpus.json`, >=30 judge cases + release cases) that the Rust, Python and TypeScript implementations all run against, so three languages cannot drift.

### `apps/bootstrap-installer/src-tauri/src/update.rs`
- **Purpose:** The `--update` flow: hand off from the desktop, run `hermes update`, rebuild the desktop, swap the macOS bundle, relaunch.
- **Key abstractions:** `start_update` (Tauri command), `run_update`, `UPDATE_EXIT_CONCURRENT = 2`, `update_stages(include_install)` (the synthetic manifest), `swap_in_new_bundle`, `resolve_hermes`, `update_target_from_args`.
- **Data flow:** acquire the marker → emit the synthetic manifest → stage `handoff` (wait for the old desktop's payload locks to free) → stage `update` (stream `hermes update`) → stage `rebuild` (legacy installs only) → stage `install` (macOS bundle swap) → emit `complete` → **release the marker** → relaunch the desktop → exit.
- **Non-obvious design decisions:**
  - **A re-entrancy guard on a process-global `AtomicBool`**, because the frontend kicks `startUpdate()` from a mount effect and React strict-mode double-invokes effects; two `run_update` tasks racing on `git stash` corrupt the tree (update.rs:41). A duplicate call re-emits the manifest instead of spawning a second run, so the UI can recover its stage list.
  - **The marker is released BEFORE the relaunch**, not on exit: the Tauri/Cocoa event loop can outlive `app.exit(0)`, and a live pid on a fresh marker would make a *successful* update look active — blocking desktop startup and every other updater forever (v2 markers have no age ceiling).
  - **A hard `process::exit(0)` fallback 3 s after the graceful exit request**, because a native event loop can ignore the graceful request and a finished updater must not linger as a live pid.
  - **Exit 2 ("another Hermes is running") is surfaced with the child's own refusal block**, extracted from the last 40 stdout lines by finding the last line starting with the cross-mark — the block names the real holder/PID (#78135). A generic "still running" string is only the fallback.
  - **A self-owned-marker heal** (#75788): a stale checkout's `hermes update` refuses over *its own parent's* marker, so the refusal loop is unbreakable from the user's side — the update being refused is the one that ships the fix. The decision is extracted into a pure function (`should_heal_self_marker_refusal`) requiring ALL of: exit 2 + the marker names *this* process + nothing holds the checkout lock.
  - **`PYTHONUNBUFFERED=1` is forced on the child** — CPython block-buffers a pipe, so long quiet steps (zipping multi-GB archives) render as a frozen stage and users cancel a healthy update.
  - **`HERMES_UPDATE_HANDOFF_PID` names our pid** so the child recognises the live holder as its own orchestrator; without it every GUI update refuses its parent's marker with exit 2.
  - **The update target is the channel the desktop checked against**, not `hermes update`'s own default: "A stable install the desktop checked against its release must not be updated onto the pinned branch".
  - **Retry-once policies are bounded and explained** (the update-boundary crash, the rebuild, the self-heal) — each says *why* a second attempt is safe.
  - `swap_in_new_bundle` has a **hard invariant: on any failure path the target is left pointing at a working bundle** (the original is rolled back from the parked `.hermes-update-old`).
- **Edge cases & failure handling:** the handoff waits up to 20 s for the old desktop to release the `app.asar` payload and then refuses with the locked paths named; a launch failure after a successful update is **logged, not fatal** ("the update succeeded"); the launcher is resolved **only from this installation** (never PATH) and, for user-bin migration, verified through the CLI's own `--version` output ("Install directory: ...").
- **Surprising:** the install-lock probe is deliberately **Windows-only in effect** ("On Unix this almost always succeeds (no mandatory locking), which is fine — application-output contention is a Windows-only problem").

### `apps/bootstrap-installer/src-tauri/src/powershell.rs`
- **Purpose:** Drive `install.ps1` / `install.sh` with line-buffered streaming, cancellation, and a bounded drain.
- **Key abstractions:** `pump_child`, `PumpOutcome {exit_code, killed, abandoned}`, `DRAIN_GRACE = 20s`, `StreamSink`, `decode_console_bytes`, `read_decoded_line`, `parse_stage_result`, `parse_manifest`.
- **Data flow:** spawn the script → pump stdout/stderr line by line → on cancel, `start_kill` → phase 2 bounded drain → reap the process → return `{stdout, stderr, exit_code, killed}`.
- **Non-obvious design decisions:**
  - **The exit status comes from waiting on the PROCESS, never from pipe EOF.** A child's descendants inherit the write end of a redirected pipe, so EOF is not the child's to give; a resident gateway would hold the pipe for its whole life and strand every obligation downstream of the read (#90455). The same bound exists in Go's `exec.Cmd.WaitDelay`.
  - **The drain is bounded, and abandonment is announced out loud**: "a silently truncated log is indistinguishable from one that was empty".
  - **`BufReader::lines()` is banned** — it requires valid UTF-8 and aborts the line at the first accented byte, so Windows PowerShell 5.1's localized ParserError text was truncated to `No` instead of the full Portuguese sentence (#67193). The decoder prefers UTF-8 and falls back to a real **CP1252** mapping (not Latin-1).
  - **`read_decoded_line` is cancel-safe**: the buffer is NOT cleared on entry, because a dropped future inside `tokio::select!` has already appended consumed bytes — clearing would silently drop them.
  - **The PowerShell interpreter is resolved by absolute path** (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`) before PATH, because Windows silently drops PATH entries once the variable grows past its length limit and the spawn then dies with "program not found" before `install.ps1` ever runs — the installer stalls at "0 of 0 steps".
  - **A child script's cwd is pinned to a stable directory** (HERMES_HOME), because the installer can be launched from an `.app` bundle that is later replaced during self-update and a deleted cwd makes bash emit `getcwd` errors at the end of a successful install.
- **Edge cases & failure handling:** a partial line at EOF is still emitted; an unterminated final line is emitted; the "pipes died but the process outlives them" topology keeps the final wait cancellable (a bare `child.wait()` there would strand the cancel channel).
- **Surprising:** the pump's behaviour is pinned by **five** topology tests (grandchild holds the pipe / clean pipes / 20 000-line flood / cancel with a stranded pipe / cancel after EOF), including a regression test for "idling after every chunk it did read metered the drain and backpressured the running child".

### `apps/bootstrap-installer/src-tauri/src/bootstrap.rs`
- **Purpose:** Orchestrate the install: resolve the script, fetch the manifest, run each stage, publish the completion marker.
- **Key abstractions:** `start_bootstrap` / `cancel_bootstrap` / `get_bootstrap_status` (Tauri commands), `BootstrapHandle`, `write_bootstrap_complete_marker`, `resolve_marker_commit`, `MAX_STAGE_ATTEMPTS = 3`.
- **Data flow:** `install.ps1 -Manifest` → a `Manifest` event → per stage: `install.ps1 -Stage NAME -NonInteractive -Json` → a `Stage` event → on success: write `.hermes-bootstrap-complete` atomically → copy the installer into HERMES_HOME → a `Complete` event → the frontend launches the desktop.
- **Non-obvious design decisions:**
  - **The marker is published ATOMICALLY** (temp sibling + flush + rename) because the launcher's predicate only checks *existence* — a partial direct write would incorrectly enable the fast path. The Windows-specific "rename fails if the destination exists" is handled by removing the old marker first.
  - **The marker's `pinnedCommit` is resolved in three tiers**: the pin, else the checkout's HEAD read **straight from the ref files** (install.ps1 resolves git through a staged binary that is not on PATH, so a bare `git` spawn returns nothing on a git-less machine), else the previous receipt.
  - **Only the "abrupt host exit" shape is retried** (exit `-1` with no JSON frame): a Windows PowerShell host can terminate with raw status `0xffffffff` while a long-running native child is still active, bypassing `install.ps1`'s `finally`. Retry is bounded at 3 attempts so ordinary failures stay immediate, and the retry backoff is itself cancellable.
  - **`-IncludeDesktop` must be passed to the manifest call too**, not just the per-stage call, or the desktop stage never appears in the manifest.
  - **Log lines are tee'd to the rolling installer log** at `info!` (not `debug!`, which "got dropped on the floor, leaving us blind whenever install.ps1 failed"), and stderr lines are `warn!` so they are visually distinct.
  - **The detached desktop launch clears inheritable std handles on Windows** (#112856): Windows duplicates every inheritable handle into the child regardless of its stdio, so the installer's stdout pipe stayed open after the installer exited.
- **Edge cases & failure handling:** a marker write failure emits `Failed` so the UI leaves the progress state (the frontend does not poll the status); the self-copy to HERMES_HOME is best-effort and never fails an otherwise-successful install; a missing desktop build produces an actionable message naming the expected path.
- **Surprising:** `read_checkout_head` parses `.git/HEAD` and `packed-refs` **by hand** rather than shelling out to git.

### `apps/bootstrap-installer/src-tauri/src/install_script.rs`
- **Purpose:** Resolve and download the install script (dev checkout → bundled → network).
- **Key abstractions:** `resolve(kind, pin, emit_log)`, `ResolvedScript`, `ScriptSource`, `ScriptKind`, `Pin`, `prepare_cached_script_bytes`.
- **Data flow:** env override → dev checkout → network fetch of `raw.githubusercontent.com/.../<ref>/scripts/install.ps1` → cached under `HERMES_HOME/bootstrap-cache/install-<sanitised-ref>.ps1`.
- **Non-obvious design decisions:**
  - **Always download; a previously downloaded script is never reused** — "A stale script drives a tree it predates (the repository stage follows the live branch), and a failed download is fatal so Retry refetches."
  - **The `.ps1` cache is written WITH a UTF-8 BOM** (the `.sh` is not — a BOM would break `#!/usr/bin/env bash`): Windows PowerShell 5.1 reads a BOM-less `.ps1` using the system ANSI code page, and the `irm | iex` path strips BOMs on purpose while the GUI bootstrap runs the *cached file* via `-File` (#67193).
  - **The download is atomic** (`.tmp` → rename) "so a partial write is never executed", with explicit 10 s connect / 60 s total timeouts so a black-holed connection fails instead of hanging forever.
  - **A commit pin must look like a git SHA** (7–40 hex chars); a branch pin may be any non-empty ref. A malformed commit is a hard error, not a fallback.
- **Edge cases & failure handling:** the ref is sanitised to `[A-Za-z0-9._-]` for a flat cache filename; the BOM is never doubled.

### `apps/bootstrap-installer/src-tauri/src/paths.rs`
- **Purpose:** The canonical `HERMES_HOME` resolution, the log/bootstrap-cache locations, and the update-marker path.
- **Key abstractions:** `hermes_home`, `hermes_root`, `hermes_root_from`, `platform_default_home_with`, `installer_dest`, `update_in_progress_marker`, `init_logging`.
- **Non-obvious design decisions:**
  - **`hermes_home` vs `hermes_root` are different things.** Host-wide state (the update marker) lives at the *root*; a per-profile home under `<root>/profiles/<name>` resolves back to the root, "so a profile-scoped HERMES_HOME must not split it into a second, unguarded file".
  - The doc comment records a **real drift bug**: an earlier macOS implementation used `Application Support` while Python's `get_hermes_home()`, `install.sh` and the desktop's `resolveHermesHome()` all use `~/.hermes` — "the installer wrote the install to one dir and the desktop looked for it in another, so first launch never found the backend".
  - **`HERMES_DATA_DIR_SUFFIX` is appended to the leaf** exactly as Python and the desktop do, so a channel build keeps its own data dir — and its own update marker.
  - `copy_self_to_hermes_home` **no-ops when already running from the destination** (canonicalised on both sides, so symlinks/8.3 short paths/case differences do not trick it into a Windows sharing violation).
  - On macOS the staged helper is **`xattr -cr`'d and re-signed** so it survives quarantine and Gatekeeper.
- **Edge cases & failure handling:** if the log dir cannot be created, logging falls back to stderr and the installer stays usable ("the installer should still be usable on an exotic filesystem").
- **Surprising:** the file carries a long comment about a **path contract that must match Python exactly** — a good pattern for any cross-process path contract.

### `apps/bootstrap-installer/src-tauri/src/events.rs`
- **Purpose:** The Rust → React event vocabulary for the installer, plus ANSI stripping at the UI boundary.
- **Key abstractions:** `BootstrapEvent` (`Manifest | Stage | Log | Complete | Failed`), `StageState`, `LogStream`, `StageInfo`, `Manifest`, `StageResultPayload`, `strip_ansi`.
- **Non-obvious design decisions:**
  - **One channel (`"bootstrap"`), discriminated by `type`** — the frontend routes on the discriminator rather than subscribing to four channels.
  - **`LogStream` is structured metadata**, so stderr can be styled subtly "rather than mislabeling it as an error" (uv/pip/git/npm write normal progress to stderr by design).
  - **`sanitized_for_ui` strips ANSI only from Log lines** — the disk tee keeps the raw bytes; the webview renders plain text. The Rust-side `strip_ansi` handles CSI, OSC/DCS/PM/APC, charset selection and **collapses `\r` in-place redraws to the last visible frame**, which is what a terminal would be left showing (#112675).
- **Edge cases & failure handling:** serde renames are snake_case on the wire with camelCase aliases, so both conventions parse; `duration_ms`/`result`/`error` are skipped when absent.

### `apps/bootstrap-installer/src-tauri/src/lib.rs`, `main.rs`, `build.rs`, `hermes-setup.manifest`, `capabilities/default.json`, `tauri.conf.json`, `Cargo.toml`, `Info.plist`, `entitlements.plist`
- **lib.rs** — the Tauri entrypoint: `AppMode` (Install | Update) resolved from args, `force_setup_from_args` (`--reinstall`/`--repair`), `handoff_before_appkit` (macOS relaunch happens **before** AppKit registers the process as a Dock app, because "the real desktop is a different bundle id, so that registration is a second Hermes icon"), and the command registry. Mode selection and force-setup are **independent axes**, pinned by unit tests.
- **main.rs** — the `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` attribute **must live on the binary crate**: "placing it on the lib was the bug that left a stray cmd window behind Hermes-Setup.exe on release builds."
- **build.rs** — bakes the install-script pin into the binary. **Commit pinning is opt-in** (`HERMES_BUILD_PIN_COMMIT`); the default is branch-follow, "tolerant of fast-forwards/new commits, and never references a SHA the local checkout hasn't pushed". A pin that cannot be resolved **panics** rather than baking an unresolvable ref; a build that resolves *no* pin at all warns loudly. `rerun-if-changed` covers `.git/HEAD` **and the ref file it points at**.
- **`hermes-setup.manifest`** — a Windows application manifest declaring `asInvoker` so the product name "Hermes Setup" does not trip Windows's installer-detection heuristic and fail `CreateProcess` with `ERROR_ELEVATION_REQUIRED` (740); it also declares PerMonitorV2 DPI awareness, UTF-8 active code page and Common Controls v6.
- **`capabilities/default.json`** — the Tauri permission set is narrowly scoped on purpose: "we don't write user files outside HERMES_HOME, we don't read arbitrary paths, and the only external network call goes through reqwest (Rust side, not exposed to the webview)."
- **`Cargo.toml`** — the binary is renamed to `Hermes-Setup` ("Grandma sees what we hand her, period"); the release profile is `panic = "abort"`, `lto`, `opt-level = "s"`, `codegen-units = 1`, `strip` — "A 5-10MB signed installer is the goal".
- **`tauri.conf.json`** — the window is created **hidden** (`visible: false`) and revealed only after the fast path decides to show the installer, so a relaunch never flashes a UI. The CSP is strict (`script-src 'self'`, no inline scripts) — which is why `theme.ts` cannot use an inline pre-paint script.

### `apps/bootstrap-installer/src/store.ts` (nanostores)
- **Purpose:** The single source of truth for the installer's four screens, fed by the Rust event channel.
- **Key abstractions:** `$route`, `$mode`, `$bootstrap`, `$progress` (computed), `withStageState`, `initialize`, `startInstall`, `startUpdate`, `cancelInstall`.
- **Non-obvious design decisions:**
  - **`startedAt` is stamped client-side** on the running edge so the UI can tick a live elapsed timer — the backend only reports a duration when a stage is already over.
  - **The log buffer is bounded to 2000 lines** ("the UI doesn't get OOM'd during a long install (playwright chromium download is ~10k lines)").
  - **In update mode the app stays on the progress screen on completion**, because the installer relaunches the desktop and exits within a few hundred ms — routing to success would just flash.
  - **A "fake boot" preview mode** (`?fake=install|update|failure`, gated on `import.meta.env.DEV`) synthesises the whole event stream so the screens can be reviewed in a plain browser — and it drives the **same `withStageState` reducer** as the live handler, so the two cannot diverge.
- **Edge cases & failure handling:** an event for an unknown stage is warned about and dropped, not crashed on; the initial `get_log_path`/`get_hermes_home`/`get_mode` fetch is wrapped in a try/catch.

### `apps/bootstrap-installer/src/routes/*.tsx`, `src/components/*`, `src/lib/*`, `src/theme.ts`, `src/styles.css`, `vite.config.ts`, `index.html`, `tsconfig*.json`, `eslint.config.mjs`, `package.json`, `.gitignore`
- **`progress.tsx`** — a flat stage list where only the running step is opaque; the terminal check/cross is **neutral** ("no celebratory green"); a 1 s ticker drives a live elapsed time so a long single step "reads as working, not frozen"; the live-output pane auto-scrolls and stderr is rendered at 45% opacity.
- **`success.tsx`** — the launch action **catches the Tauri error and surfaces it inline**: "the previous version had `onClick={() => void launchHermesDesktop()}` which swallowed the rejection and left the user staring at an unresponsive button."
- **`failure.tsx`** — Retry + "Open logs" + the exact log path; the error message is shown as muted text under the wordmark.
- **`welcome.tsx`** — deliberately shows **no install path**: "Showing %LOCALAPPDATA% to grandma is developer-brain."
- **`lib/format.ts`** — `formatElapsed` has an hour rollover because a stalled overnight stage read as "744:38" — minutes rendered unbounded — "which one user understandably reported as '744 hours'". Pure functions are kept out of the component so tests can exercise them without dragging in the Tauri renderer.
- **`theme.ts`** — the authoritative dark-mode signal in Tauri is **the window's own theme** (`getCurrentWindow().theme()` + `onThemeChanged`), not `prefers-color-scheme`, "which is not reliable across WebView2 / WebKitGTK"; the media query is only the synchronous first paint and the non-Tauri fallback.
- **`styles.css`** — the installer **imports the desktop's `styles.css` wholesale** rather than re-implementing the design system, with a documented caveat about Tailwind v4's `@source` re-resolving relative to the importing file. The dark seeds are mirrored from the desktop's `nousTheme.darkColors` because "the installer has no theme runtime".
- **`components/button.tsx`** — copied verbatim from the desktop, with the **reason** recorded: the DS Button's `bg-midground`/`text-background-base` utilities resolve to hardcoded gold/brown defaults unless overridden at runtime, so the installer routes through the same `--dt-*` token chain.
- **`components/loader.tsx`** — a single Fourier-flow curve ported standalone, with the trade-off stated: "cross-app coupling + bundle bloat that defeats the point of a lightweight installer".
- **`components/hackery-button.tsx`** — the `[ LABEL ]` bracketed CTA lifted from the desktop onboarding overlay, "sans the exit-scramble choreography, which is overlay-specific".
- **`vite.config.ts`** — port 5175 with `strictPort`, chosen to stay out of the way of web (5173) and desktop (5174); `clearScreen: false` is "the Tauri convention — they spawn vite as a child process and want our errors to stay visible"; the Rust side is excluded from the watcher.
- **`package.json`** — every dependency is **pinned to an exact version** (no `^`), which is a notable discipline for a signed installer whose bundle is part of the trust story.
- **`eslint.config.mjs`** — re-exports the repo-wide shared config; nothing app-specific.

---


### `apps/desktop/AGENTS.md` — the desktop engineering contract (docs)
- **Purpose:** The judgment guide for the Electron desktop app: the invariants and the reasoning behind them, so a change fits as files move.
- **What it DECIDES (the stealable parts):**
  - **"Decide state by authority."** The first question for any piece of state is *who is allowed to be right about it*, not where it is convenient to store it: the backend is authoritative for anything another Hermes surface can also change (the renderer's copy is a **cache**), Electron for machine/runtime facts, the renderer only for window presentation. "A new global store is a claim that many distant surfaces need it — earn that claim."
  - **Persisted state must declare its scope in its own key** (global / connection / profile / session / project / window) — "Getting the scope wrong is how one profile's setting bleeds into another."
  - **Server truth is cached, not owned:** merge don't clobber; paint optimistically and roll back visibly; a stale async result never overwrites newer intent (generation counters, request tokens); only the foreground surface publishes into the shared view; coalesce cosmetic updates but flush terminal transitions; preserve reference identity on no-ops.
  - **"Switching context is a re-home, not a reboot"** — three distinct switch shapes (soft connection/mode apply, hard `HERMES_HOME` change, live profile swap); conflating them is "the classic bug."
  - **"Cross everything as an observable ladder"** — one ordered ladder per policy: precedence as data, a candidate trusted only after it is probed, a failed read falls to the next rung but a failed authoritative write surfaces or rolls back, a missing capability is not a transient failure, retries are bounded and end in a recovery affordance, and **one resolver owns each policy**.
  - **"Guest content never opens anything by itself"** (GHSA-9f4c-93c8-jc8g) — `setWindowOpenHandler` denies everything, the webview has no `allowpopups`, and a guest `target="_blank"` link reaches `hermes:openExternal` only through a trusted-click bridge that admits `http:`/`https:` only.
  - **"Never navigate, move focus, or open a surface because something happened in the background. Offer; don't hijack."**
  - **"The states around loading are distinct experiences"** — empty, loading, reconnecting, degraded/stale, exhausted-recovery each deserve their own honest copy and their own way out.
  - **"Expensive, stateful surfaces stay alive when hidden. Visibility is not lifecycle."**
  - **"Keep the waist narrow, grow at the edges"** — "The shell's internal registries are composition seams, not a public plugin ABI; do not build a universal extension system… Design a shared contract only once more than one real consumer proves its shape."
  - **"Surface capability is a property of the SESSION, not of the backend host"** — wire availability off the `source: 'desktop'` the app already sends on `session.create`, "never off an env var on the backend process: that process might be a remote or cloud gateway this app merely connected to."
  - **"Nous free tier: state is pulled, never latched in the renderer"** — the ready screen and the own-key strip are the SAME state rendered twice; no localStorage latch, so the CLI and the desktop cannot disagree about whether the notice was shown.
  - The handoff checklist ("The taste test before you hand off") is six questions, each answerable.

### `apps/desktop/ENGINEERING.md` — the long form behind AGENTS.md (docs)
- **Purpose:** The worked detail behind the summarized rules; read on purpose, not automatically.
- **What it DECIDES:**
  - **Sessions have three identities** (durable / runtime / lineage-root) and conflating them is "a recurring source of 'session not found' and vanishing history." Pick the one the surface needs and translate at the boundary.
  - **"The user's message is durable at send"** (#111868): `prompt.submit` writes the session row AND the user row before the agent build starts; the turn adopts that row instead of appending a second one — so a freeze or force-quit during a slow first build leaves a **resumable transcript**.
  - **A new profile-keyed localStorage family must join BOTH `migrateTilesForProfile` and `dropTilesForProfile`** — "Add any new profile-keyed localStorage family to BOTH, or a rename leaves it pointing at a backend that no longer exists."
  - **A verifiably-gone session drops to a fresh draft** with no toast, no navigation, no focus steal, and the unsent text follows it once ("Offer, don't hijack").
  - **The six server-truth reconciliation rules**, spelled out.
  - **One-time credentials are never reused** — an OAuth gateway mints a fresh WebSocket ticket on every dial and never falls back to the cached URL; only a confirmed 401/403 means reauthentication; timeout/network/malformed/server failures stay connectivity errors.
  - **"A connection test must exercise the leg you'll actually use"** — an HTTP status probe passing while the WebSocket/auth leg fails "is a false positive that ships as 'it said connected but nothing works.'"
  - **`persist:` partition names contain nothing Electron percent-escapes** — a `%3A` in a partition name becomes a cookie store Windows can neither read nor write, "so the session silently never persists"; renaming a partition signs its users out once, so say so.

### `apps/desktop/DESIGN.md` — the visual and interaction contract (docs)
- **Purpose:** "One source per concern, tokens over literals, flat over boxed." The doc holds **Principles** (durable) and **Named contracts** (the design system's current API, maintained *with the code* — "a stale name in this file is a bug, exactly like a stale type").
- **What it DECIDES (stealable rules):**
  - **Seven principles**, incl. "Flat, not boxed", "One primitive per concern" (one Button, one SearchField, one Loader, one ErrorState — "Migrate onto them; don't fork"), "Tokens, not literals", "Style lives in the primitive", "Intent before automation" (don't open panes because a tool produced something), "Immediate feedback" (paint first, reconcile after, roll back visibly).
  - **Elevation is two tokens** — `shadow-nous` + `border-(--stroke-nous)`; "Don't add per-overlay `shadow-[…]` one-offs; if elevation needs to change, change the token."
  - **A tooltip policy worth stealing:** "`<Tip>` is for discovery, not a tax on every icon. Ask: does hover reveal something the user cannot already see or infer?" plus an explicit DO-NOT list (menu triggers, close X, controls whose visible label already says what the tip would), and **"Never use native HTML `title=` on buttons"** — enforced by a test (`no-native-title.test.ts`).
  - **Tooltip timing**: 200 ms before first open, 300 ms warmth window after a tip has opened, cooldown from close, no entrance animation, 100 ms exit fade.
  - **Overlay z-index is a LADDER in `styles.css`** (`--z-modal-backdrop` / `--z-modal` / `--z-modal-popover` / `--z-over-modal` / `--z-switcher-backdrop` / `--z-switcher` / `--z-connecting` → `--z-onboarding` → `--z-setup` → `--z-crash`) — "Persistent terminal/content layers, route overlays, dialogs, and boot surfaces must not compete through ad-hoc z-index literals."
  - **"One cancel gesture does one thing"** — cancel the active interaction, or close the topmost dismissable surface; never both, never the control underneath. And "Cancellation is synchronous in the UI even if cleanup is async."
  - **"Motion follows state; it never delays state."** Plus "Do not animate layout geometry with `transition-all` on a hot interaction."
  - **"Direct manipulation paints first; persistence reconciles after and rolls back visibly on failure."**
  - **"Prove speed with realistic content. A fast empty-state demo says nothing about a long transcript."**
  - **i18n:** every string through `useI18n()`, **update all locales together**, and complete locales (`fr`, `de`, `es`) are typed as full `Translations` objects so a missing key fails the type check.
  - The "Before you add something — checklist" is a 15-item pre-handoff gate.

### `apps/desktop/BUILDING.md` — artifact and release contracts (docs)
- **Purpose:** The artifact/update-ownership matrix and the complete native build contract.
- **What it DECIDES:**
  - **The artifact table**: signed MSIX per architecture → `.msixbundle` + `.appinstaller` (owner: Windows App Installer); Store MSIX (owner: Microsoft Store); signed+notarized `.app` in DMG and ZIP (owner: electron-updater/Squirrel.Mac); AppImage (external replacement; Linux legs disabled).
  - **"The ZIP is the update artifact, not an optional duplicate of the download DMG."**
  - **"Do not refresh facts in `afterSign`: that changes resources covered by the signature."**
  - **"Staging does not prove native startup or package replacement"** — acceptance requires a native run with the actual signed release artifacts; "A helper test or unpacked-app smoke is not proof of native install, update, or automatic relaunch."
  - **The prepare/consume split**: `--prepare-only` publishes `prepared.json` with absolute paths for the job; consumption "rejects missing or changed dependencies **without repairing or downloading them**"; "Strict consumption means no dependency acquisition, not offline signing."
  - **A local release claim** (`-Store` allocates `rc.<N>-vX.Y.Z`, N from 900, deleted at build end, never pushed, printed as `HERMES_RELEASE_EPOCH`) so two architectures can be combined — and the epoch must come from ONE claim.
  - **Signing order is explicit**: the exe is signed after rcedit, inner payload binaries are batch-signed in `afterPack`, and the MSIX envelope is signed by a separate hook (Store envelopes stay unsigned for Partner Center).
  - **A payload-signature cache whose key binds input bytes + Azure policy + signing tools + timestamp policy** — "Filenames and release versions do not determine identity."
  - **Windows refuses to run a venv's `Scripts\python.exe`** (WinError 5); Hermes never runs a venv's own executables — children start through `pm.environments.venv_command`.
  - **App semver and package version are different facts** — Store versions use `year.hour-of-year.second-of-hour.0`, sideload stable is `X.Y.Z.0`.

### `apps/desktop/README.md` — the operator-facing manual (docs)
- **Purpose:** What the app is, how to install/update it, and the three boundaries.
- **What it DECIDES:** Electron owns the machine; React owns the experience; the agent backend owns the work. "The renderer never reaches for Node or Electron directly; native power arrives through a deliberate capability, not a general escape hatch." A bundled artifact uses its payload — "If that payload is unusable, the app reports damage rather than installing a second checkout. It does not adopt an arbitrary `hermes` command on PATH or a system Python installation." Also: changing profiles/connection modes is a soft workspace switch that "does not cancel turns or stop a backend."

### `apps/desktop/docs/canonical-gateway-protocol.md` (docs)
- **Purpose:** The contract for the canonical local gateway protocol — what Desktop may and may not assume of a gateway.
- **What it DECIDES:** `gateway ensure --json` returns a **credential-free** endpoint; native main requests **private `session-ticket` grants** with exactly `profile_id`, `instance_id`, `purpose` (WebSocket grants use `interactive`, JSON/file HTTP uses `native-http`); each HTTP retry mints a fresh grant and sends it only in `X-Hermes-Gateway-Ticket` scoped to the endpoint's exact origin; "HTTP credentials are not stored in the renderer or attached to URLs/public connection descriptors." Also: the canonical `admission_id` is distinct from the submitted input ID; receipt projection verifies `ref.session_id` before acknowledging; canonical `session.title`/`session.archive` become `session.mutate` with a **retained request ID and expected revision**; an ambiguous failure retains that CAS payload. And an honest limits section: "Successful authenticated transport is not proof of a usable mounted chat or native journal retirement."

### `apps/desktop/docs/canonical-groups.md` (docs)
- **Purpose:** How Bot Mode's gateway-owned groups work from the Desktop side.
- **What it DECIDES:** the gateway owns the log and work; Desktop reads `groups.state`/`groups.log`, sends through `groups.send`, stops through `groups.stop`; pending actions come **only** from `driver_status.pending_actions`; discard requires an explicit confirmation that prior side effects are not undone; retry and approvals retain the exact member/task/generation/request identity; "no failed canonical mutation falls back to hidden-session submission."

### `apps/desktop/electron-builder.config.cjs`
- **Purpose:** THE whole packaging configuration, one file.
- **Non-obvious design decisions:**
  - **One file, `.cjs`, not JSON** — the variant (`HERMES_DESKTOP_VARIANT=light|bundled|store`) is decided at require time, and "splitting the config across JSON + this overlay is how the two halves drift."
  - **The exe identity stamp runs in `afterExtract`, not `afterPack`** (#105629): with ASAR integrity on, electron-builder rebuilds the whole PE in memory with resedit to push the `ELECTRONASAR` resource, and rcedit cannot commit to that rewritten file.
  - **`asar.unpack` is `['**/*.node', '**/prebuilds/**', 'dist/**']`** — the unpack contract is *derived by the test* (`packaged-smoke.spec.ts` reads the config at test time), so the shipped tree is checked against the declared list.
  - **The DMG background is a prebuilt `.tiff`, not a PNG + `@2x` sibling** — dmg-builder's PNG path runs `tiffutil -cathidpicheck`, which on macOS 26 rewrites both frames to 72 dpi and silently drops the 2x representation.
  - **The macOS icon choice is per build host** (`mac-icon.cjs`): the Icon Composer `.icon` package needs `actool` ≥ Xcode 26, so older hosts fall back to the `.icns` and `after-pack.mjs` restores the full-resolution `.icns` either way.
  - **MSIX write virtualisation is disabled** (`desktop6:FileSystemWriteVirtualization`/`RegistryWriteVirtualization`) with the matching `unvirtualizedResources` capability, because Hermes state in `%LOCALAPPDATA%` is deliberately shared with the unpackaged CLI/gateway.
  - **The Windows floor is 10.0.22621.0** and the reason is pinned: below build 18307 the manifest schema caps AppExtension `Name` at 39 chars and Microsoft's own `com.microsoft.windows.copilotkeyprovider` is 40.
  - **`setBuildNumber: false`** — the native quad is baked into the manifest template, so the builder's own override would stamp a second, conflicting version.
  - `feedBaseUrl` rejects a non-canonical URL because "The feed origin is baked into app-update.yml and trusted by every installed client for the life of the build."
- **Surprising:** `electron-builder.config.cjs` is itself type-checked (`tsc --ignoreConfig --allowJs --checkJs` in `npm run typecheck`) — a plain CJS build file in a TS repo.

### `apps/desktop/vite.config.ts`
- **Purpose:** The renderer build: React Compiler pass, chunking strategy, offline assets.
- **Non-obvious design decisions:**
  - **The React Compiler preset is filtered to React-bearing modules only** — the default filter matches every TS module, "which made the babel pass parse all ~1.5k source files when only ~750 are React-bearing."
  - **The production build memoizes the compiler pass on disk** (`scripts/compiler-cache.mjs`), keyed on the lockfile + the config file — the React Compiler pass is ~85 % of a production renderer build.
  - **`react` and `react-dom` are resolved from the workspace, not the hoisted root** — "React refuses to run when `react` and `react-dom` come from two different installed copies ('Minified React error #527' — a blank window, since it throws before the first paint)."
  - **Chunking is a deliberate middle ground**: `codeSplitting: false` inlined every lazy import (28 MB, ~1 s of launch eval); default splitting emits a chunk per shiki grammar (thousands of files, which electron-builder OOMs scanning, #38888). `advancedChunks` merges heavyweight libraries into a handful of named vendor chunks.
  - **`vendor-react` groups `@tanstack/react-query` WITH react** — it carries module-level context, and splitting it produced **two react-query runtimes** in the packaged app, so `useQuery` threw "No QueryClient set" on the launch path (#95560).
  - **PostCSS is pinned to an empty plugin list** — otherwise `postcss-load-config` walks UP the filesystem and picks up a stray Tailwind v3 config, failing the build with "`@layer base` is used but no matching `@tailwind base` directive is present." "Pinning the config makes the build hermetic."
  - **Emoji data is served locally** — the default CDN breaks offline Electron.
  - **The dev-only render counters are aliased to a no-op in production** — "react-dom captures the devtools hook at module init, so a dynamic import lands too late and observes zero commits."
  - `driver.js` is excluded from dep optimisation (its `?raw` IIFE import would break the raw-text transform and trigger a mid-session full reload).

### `apps/desktop/eslint.config.mjs`
- **Purpose:** The desktop's lint rules — and it is where two *architectural* mistakes are made impossible.
- **Non-obvious design decisions:**
  - **THE PLUGIN FENCE**: `src/plugins/**` may import only `@hermes/plugin-sdk` (and react) — "the same isolation a runtime-fetched published plugin gets, enforced on bundled ones so the SDK surface stays honest and sufficient."
  - **A lint rule that bans the "atom-mirrored ref" antipattern**: `useEffect(() => { someRef.current = value }, [value])` is an error, with the reason spelled out — "A ref synced from a nanostores atom via useEffect lags the atom by one render, which creates stale-read bugs in callbacks that read the ref (cancelRun sent session.interrupt to the wrong session…)."
  - **A lint rule that bans calling a plugin's `render()` inline in JSX** — "the callback's hooks become the host's and plugin load/replace changes the host hook count (React #310)." Mount it as a child instead.
- **Why it matters for August Trading:** three of the most expensive React bugs in that codebase are exactly what these two rules make impossible.

### `apps/desktop/product-identity.cjs` / `product-identity.d.cts` / `update-feed.cjs` / `update-feed.d.cts`
- **Purpose:** The ONE source for every name-shaped value a build variant owns, and the updater-feed layout contract.
- **Non-obvious design decisions:**
  - **The variant is a flag, and every name derives from it** (`Hermes` / `Hermes Light` / `Hermes Agent`; `hermes` / `hermes-light` / `hermes-bundled`).
  - **A canary build can never overwrite the stable feed file** — the channel is keyed on the payload tag, so one release workflow serves both channels.
  - **Nonstable installs own their package family and local desktop state** — the seven-character commit suffix names the CLI and fits MSIX's name cap.
  - **"Store packaging is only eligible for stable releases"** — the build throws otherwise.
  - **`feedBaseUrl` demands a canonical https base** (no credentials, query, fragment, or trailing slash) because the origin is baked into `app-update.yml` and trusted for the life of the build.
  - The channel name is validated against a Windows-reserved-name regex (`con`, `prn`, `aux`, `nul`, `com1`…).

### `apps/desktop/package.json`
- **Purpose:** The workspace manifest and the script surface.
- **What it DECIDES:** the `typecheck` script **type-checks the renderer, the electron main, the e2e project AND `electron-builder.config.cjs`** in one command (`--ignoreConfig --allowJs --checkJs`); `lint` covers `src/ electron/`; the vitest split is `test:ui` (jsdom) vs `test:desktop:platforms` (node); `test:desktop:all` is the release-path gate; `prebuilder` is the hook that patches the macOS builder binary. Every dependency is **pinned to an exact version**.

### `apps/desktop/vitest.config.ts` / `vitest.setup.ts` / `vitest.run-tmp.ts` / `vitest.hermes-python.ts`
- **Purpose:** Two vitest projects (`ui` = jsdom, `electron` = node) plus their setup.
- **Non-obvious design decisions:**
  - **`css: { include: [/status-stack\.css$/] }`** — "Keep padding regressions observable instead of mocking the stylesheet away."
  - **`env: { NODE_ENV: 'development' }`** — React 19.1+ stubs `react.act` to undefined in the production build, so `@testing-library/react`'s `act()` throws "React.act is not a function"; forcing the dev build makes `act` resolve "regardless of any ambient NODE_ENV".
  - **Timeouts are generous on purpose**: `testTimeout: 15_000` because "the first test in each file pays jsdom env init + full module transform"; `asyncUtilTimeout: 12_000` because the default 1000 ms `findBy*` deadline "trips on runs whose only common factor was load".
  - **A one-temp-root-per-run setup** — "one run of the `electron` project left 54 dirs behind"; workers inherit `TMPDIR`.
  - **`vitest.hermes-python.ts` resolves the Hermes test interpreter** only for the contracts that need it, "resolving it may sync the Python environment, which UI-only runs must not wait for."
- **Surprising:** `vitest.setup.ts` installs an in-memory `localStorage` because **Node 26 defines its own `localStorage` accessor** that returns `undefined` without `--localstorage-file`, and in jsdom `globalThis` IS the window, so every `localStorage.getItem(...)` in a test threw.

### `apps/desktop/playwright.config.ts` / `apps/desktop/e2e/core/playwright.config.ts` / `apps/desktop/e2e/update/playwright.config.ts`
- **Purpose:** Three Playwright configs — the general visual lane, the **required** core lane, and the install/update lane.
- **Non-obvious design decisions:**
  - **Visual diffs do NOT fail the suite** — they are surfaced in the CI step summary and uploaded as artifacts for human review ("This keeps visual regressions visible without gating PRs on pixel-perfect matches"), with `maxDiffPixelRatio: 0.01` and a per-channel threshold of 0.2 to absorb font-rendering variance.
  - **`reducedMotion: 'reduce'` is forced** so a screenshot never catches an overlay mid-fade.
  - **The core lane has `retries: 0`** — "a required job that retries hides exactly the flake it exists to catch."
  - **`forbidOnly: !!process.env.CI`** — "A stray `test.only` must never let CI report a partial green run."
  - **`fullyParallel: false`** — each test gets its own worker so the Electron process is fully isolated.
  - **`testIgnore: ['**/*.unit.test.ts', 'core/**', 'update/**']`** — the `*.unit.test.ts` helpers are owned by the vitest `electron` project so they run in exactly one runner.

### `apps/desktop/index.html`
- **Purpose:** The renderer shell.
- **Non-obvious design decision:** the inline **pre-paint theme script** — "Without this, the first frame (which is what `ready-to-show` waits for) is the UA-default white page… i.e. the 'white flash' on every new window." It reads the persisted boot background/colour-scheme, falls back to the OS preference, and **skips the transparent window kinds** (`hud`, `overlay`, `quick`, `wake`) — "pre-painting a theme colour there does not prevent a flash, it IS the flash."

### `apps/desktop/assets/msix-manifest.xml`, `apps/desktop/assets/icon.icon/icon.json`, `apps/desktop/components.json`, `apps/desktop/tsconfig*.json`, `apps/desktop/preview-demo.html`
- **msix-manifest.xml** — a fork of app-builder-lib's template; the only intended delta is the `uap5` namespace declaration + `IgnorableNamespaces` entry. It carries the **write-virtualisation-disabled** properties so the Store and sideloaded builds do not split the user's `%LOCALAPPDATA%` state.
- **icon.icon/icon.json** — the Icon Composer package: light/dark art specialisations plus a `mono` layer with `glass: true` for the tinted appearance.
- **components.json** — shadcn `new-york` style, `cssVariables: true`, `iconLibrary: tabler`.
- **tsconfig.json** — `strict`, and **path aliases for the shared package's SUBPATH exports** (`@hermes/shared/ansi`, `/billing`, `/color`, `/i18n`, `/translucency`) so a surface imports one module without pulling the generated gateway contract into its bundle.
- **tsconfig.electron.json** — the electron project relaxes strictness (`strict: false`) but keeps `composite` + declarations; it includes the shared modules the main process needs.
- **tsconfig.e2e.json** — the e2e project includes `../../tests-js/scripts` so the e2e specs and the shared mock server type-check together.
- **preview-demo.html** — a tiny standalone HTML artifact used to exercise the artifact-preview path with no server and no build step.

---


### `apps/shared/src/websocket-url.ts`
- **Purpose:** Build and refresh the gateway WebSocket URL, including the OAuth re-auth path.
- **Key abstractions:** `resolveGatewayWsUrl(deps, conn)`, `buildHermesWebSocketUrl(options)`, `GatewayReauthRequiredError`, `isGatewayReauthRequired`.
- **Non-obvious design decisions:**
  - **An OAuth gateway mints a fresh ticket on every dial** — "OAuth-gated gateways use single-use tickets, so callers should mint immediately before opening the socket." A token-auth connection may fall back to a cached URL; an OAuth one may not.
  - **Only a `needsOauthLogin` answer becomes `GatewayReauthRequiredError`**; everything else propagates unchanged, so a network failure never masquerades as an auth problem.
  - The scheme is derived from the page protocol (`https:`/`wss:` → `wss:`), the base path is normalised (leading slash added, trailing slashes stripped), and the auth param is set **after** the extra params so it cannot be overwritten.
- **Edge cases & failure handling:** `getGatewayWsUrl` is optional — a build without it throws a message telling the user to update Hermes Desktop rather than failing obscurely.

---

### Tier 2 — bulk: a compact table, one row per file

### `apps/shared` — tests and configs

| File | What it is / what it pins |
| --- | --- |
| `apps/shared/eslint.config.mjs` | Re-exports the repo-wide shared ESLint config; nothing app-specific. |
| `apps/shared/package.json` | Private workspace package; **per-module subpath exports** (`./fuzzy`, `./slash`, `./color`, `./json-rpc-channel`, …) so a surface can import one module without pulling the 262 KB generated contract into its bundle. |
| `apps/shared/tsconfig.json` | `strict`, `isolatedModules`, `noEmit`, `moduleResolution: Bundler`; includes only `src`. |
| `apps/shared/src/catalog-curation.json` | The committed curation: artwork filenames plus the `featured` rank lists (skills and plugins) that the weekly hero rotation walks. |
| `apps/shared/src/ansi.test.ts` | Pins the full ANSI coverage: CSI + truncated CSI tails, OSC-8 hyperlinks, DCS strings, multi-byte ESC, stray ESC, CR — and that `sanitizeAnsiForRender` keeps only SGR (`m`) sequences. |
| `apps/shared/src/billing-payment-method.test-d.ts` | A **compile-time-only** guard: keeps `BillingPaymentMethod.kind` narrowable (the `(string & {})` trick defeats narrowing on an object union). |
| `apps/shared/src/catalog-featured.test.ts` | Pins the weekly rotation (same pick anywhere within one week, order by curated rank), the 30-day pictured-official fallback, the never-a-community fallback, and the slider's slide list. |
| `apps/shared/src/color.test.ts` | Pins WCAG anchors, that `readableOn` returns the ink that **measures** better (not a hardcoded hex), that `ensureContrast` clears the ratio, that a pathological `step` normalises to the default ladder, and the **byte-identical** ladder outputs (`#cba6f7` → `#514263`). |
| `apps/shared/src/format.test.ts` | Pins the compact-number rungs and the promotion guard (never `"1000k"` or `"1000"`); `1e9` reads `"1000M"` because `M` is the declared top rung. |
| `apps/shared/src/fuzzy.test.ts` | Pins subsequence matching, the score ordering (exact > prefix > scattered), AND-semantics across tokens, stable tie-break, and the **separator fold** (`gpt.4o` → `gpt-4o`, `claude_3` → `claude-3-opus`, `qwen3-8` → `qwen3.8-flash`) with positions still indexing the original string. |
| `apps/shared/src/i18n.test.ts` | Pins deep-merge semantics (functions/arrays replaced wholesale, siblings kept), the YAML→function bridge, and that a flat leaf **never clobbers an existing branch** while a dotted base key round-trips. |
| `apps/shared/src/json-rpc-channel.test.ts` | Pins the request/response/error routing, that a non-object JSON line is ignored without throwing, per-call timeout messages, both heartbeat liveness modes, `client.capabilities` advertisement, the `declines_not_shown` gate, `-32601`/`-32603` handling, and `open_requests` re-delivery **before** the caller sees the result. |
| `apps/shared/src/json-rpc-gateway-connect.test.ts` | Pins the **connect failure classes**: a handshake close carries its code and reason, a timeout names its budget, and every failure keeps the base message as its prefix (#41566). |
| `apps/shared/src/json-rpc-gateway-legacy-replay.test.ts` | Pins the legacy-backend contract: `session.events.since` must be sent with exactly the legacy keys (an extra key is a 4000), a session epoch qualifies a canonical replay, and a **backend restart** is detected from the answer's epoch so the stale cursor is dropped. |
| `apps/shared/src/json-rpc-gateway-replay.test.ts` | The replay contract, in depth: watermarks, replay-on-reconnect, dispatched through the normal handler path, no replay when nothing was observed, **watermarks never regress**, envelope-shaped replay elements are rejected (#94219), live frames racing a replay are **parked**, per-session vs process epochs, a replaced socket's stale cleanup cannot own the new replay, sessions settle independently on timeout/unsupported, a new epoch lets waiting history reads proceed, a **truncated window is never dispatched**, restart poisoning is cleared, `snapshot_required` drops the cursor and emits a gap, and the cursor set is bounded with a gap announced for the retired one. |
| `apps/shared/src/model-search-text.test.ts` | Pins that search aliases (`k3` → `kimi`) surface the right model, that the wire id still matches, and that no alias is invented for unrelated queries. |
| `apps/shared/src/reasoning-effort.test.ts` | Pins one duplicate-free effort set with `none` as the only non-level, and a default that is a real level. |
| `apps/shared/src/reconnect-backoff.test.ts` | Pins the ceiling ladder, the cap, **full jitter** (`delay ∈ [0, ceiling)`), negative attempts clamped to 0, and `jitter:false` returning the exact ceiling the web banner prints. |
| `apps/shared/src/skill-scaffold.test.ts` | Pins that a scaffolded turn renders as the **invocation** (`/work fix the leak`), never the skill body; bundles render as the typed keys; multi-line instructions collapse; ordinary prose is left alone. |
| `apps/shared/src/slash.test.ts` | Pins the split (name lower-cased, argument verbatim including newlines), CLI parity for a bare `/`, that only position 0 counts as a command, and that `parseCommandDispatch` rejects every malformed payload and **keeps `notice`/`display`**. |

### `apps/desktop/e2e` — the end-to-end lanes

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/e2e/test.ts` | The extended Playwright fixture: **any error banner in the DOM fails the test** — "the test should fail with the error message, not silently pass while an error toast is visible on screen." |
| `apps/desktop/e2e/fixtures.ts` | The two fixture modes (`mockBackend` — real Electron → real `hermes serve` → fake LLM; `noProvider`) and the sandbox/launch helpers. |
| `apps/desktop/e2e/real-session-builder.ts` | Builds a real session against a real gateway over JSON-RPC (spawn + readline), with a 60 s default timeout. |
| `apps/desktop/e2e/electron-binary.ts` | Locates the dev Electron binary; the rules are extracted so they can be unit-tested without the Playwright runner. |
| `apps/desktop/e2e/electron-binary.unit.test.ts` | Pins the platform rules (workspace-local before hoisted, the platform binary name, `where` on Windows / `which` elsewhere) with **platform as a parameter** so the Windows rules run on the Linux CI runner. |
| `apps/desktop/e2e/fix-electron-tracing.ts` | Monkey-patches Playwright so Electron's internal BrowserContext is traced (Playwright's `_allContexts()` excludes it and the `runAfterCreateBrowserContext` hook does not exist on the Electron class). |
| `apps/desktop/e2e/run-tmp.ts` | One temp root per Playwright run, removed at exit — "a clean run of two specs left eight `playwright-tracing-*` dirs"; workers inherit `TMPDIR`. |
| `apps/desktop/e2e/window-input.unit.test.ts` | Pins the window-input/zoom handshake: does not finish when IPC reports 100 % before the window factor settles; reapplies zoom when startup overwrites the first request; awaits the zoom response instead of accepting a truthy Promise. |
| `apps/desktop/e2e/visual-snapshot.ts` | Wraps `toHaveScreenshot` so visual diffs are **reported, not fatal**; the screenshot is always written so CI artifacts include every one, and expected/diff images are written when it differs. |
| `apps/desktop/e2e/boot.spec.ts` | The dev-mode smoke: the preload bridge reaches the renderer, the backend boots and the app becomes ready. |
| `apps/desktop/e2e/boot-failure.spec.ts` | A fake boot error makes the app show the `BootFailureOverlay` with retry/repair actions. |
| `apps/desktop/e2e/onboarding.spec.ts` | With no provider configured, the onboarding overlay appears on first boot. |
| `apps/desktop/e2e/chat.spec.ts` | Send a message → the canned reply appears in the transcript; and the busy state offers **stop, steer and queue**. |
| `apps/desktop/e2e/at-rest-connection-token.spec.ts` | The at-rest contract for a remote gateway token: **never written to userData in plaintext** when keychain encryption is on; owner-only on disk otherwise; a pre-existing or corrupt `connection.json` is tightened **on read**. |
| `apps/desktop/e2e/batch-clarify.spec.ts` | A multi-question clarify card mounts **exactly once** (the correlation key comes from the question list) and completes via per-question locks. |
| `apps/desktop/e2e/bot-screen-stale-status-reply.spec.ts` | A stale `display.status` reply does not roll back a newer stopped state; pushed status/lease events update the shipped listeners without a page error. |
| `apps/desktop/e2e/completed-reply-refresh.spec.ts` | A **delayed history read** cannot remove the latest completed reply (real Electron, backend, SQLite and stream). |
| `apps/desktop/e2e/correction-session-switch.spec.ts` | A correction accepted during a live response survives a warm session switch and is not duplicated. |
| `apps/desktop/e2e/fleet-profile-rail.spec.ts` | Two registered gateways (local + a real second `hermes serve`): the rail lays both on one strip, clicking an at-rest square re-homes onto that exact gateway/profile, editing SOUL.md reads the **owning** gateway, and switching back keeps the order. |
| `apps/desktop/e2e/group-approval-click-submits.spec.ts` | #91706: clicking an approval choice in a group room **submits it** (the "Respond" footer was off-screen, so the member stayed blocked). |
| `apps/desktop/e2e/group-member-backend-failure.spec.ts` | #92760: a member whose backend fails the turn is reported at once, not read as busy; and pre-tool text from a failed member is not its reply. |
| `apps/desktop/e2e/group-turn-integrity.spec.ts` | Group follow-ups wait for their active member and retain the reply; a quiet group still harvests a late answer after sixty observation ticks; a rejected member turn stays visible; Stop clears a queued follow-up and a direct mention resumes the held member. |
| `apps/desktop/e2e/hidden-history-messages.spec.ts` | Resume **hides agent-only transcript rows** (compaction handoffs are context, not chat content), and live verify-on-stop continuations stay out of the transcript. |
| `apps/desktop/e2e/image-attachment-resume.spec.ts` | A persisted image attachment renders as a **thumbnail** on first open and after a cold reload (it used to come back as vision-enrichment prose). |
| `apps/desktop/e2e/interim-messages.spec.ts` | Interim assistant text survives alongside the final response (flag on); with the flag off the settled transcript converges to a single turn message. |
| `apps/desktop/e2e/large-session-resume.spec.ts` | A cold resume of an unchanged session has one user row and bounded transcript paints; a warm resume keeps background inference attached without duplicate messages. |
| `apps/desktop/e2e/legacy-desktop-history.spec.ts` | Pre-cutover Desktop conversations stay visible and open across profiles. |
| `apps/desktop/e2e/markdown-overflow.spec.ts` | Long prose is constrained while tables and code scroll inside their own cards (read from the **built CSS**, not a mock). |
| `apps/desktop/e2e/messages-below-position.spec.ts` | `messages-below` reads stay bounded with real `content-visibility` groups (measured in native Chromium, built with esbuild). |
| `apps/desktop/e2e/new-bot-config-on-disk.spec.ts` | A fresh (non-clone) bot gets a **runnable `model:` block on disk** — verified against storage truth, not the toast. |
| `apps/desktop/e2e/peer-device-reset.spec.ts` | A generic peer window inherits its **initial** owner, not a permanent "new session" target; two real gateways. |
| `apps/desktop/e2e/profile-soul-missing.spec.ts` | Both SOUL editors explain a missing file and save it **without changing personality config**. |
| `apps/desktop/e2e/provider-setup-owner.spec.ts` | Settings provider setup stays on its gateway/profile across A → B → A (two real serve backends). |
| `apps/desktop/e2e/queue-turn-boundary.spec.ts` | A queued prompt is submitted **only after** the active turn completes, and a steer prompt is placed before the reply it redirects. |
| `apps/desktop/e2e/remote-oauth-recovery.spec.ts` | An unsigned/expired remote gateway leaves the recovery settings usable rather than bricking the app. |
| `apps/desktop/e2e/session-compression-and-queue-stop.spec.ts` | Compressing an existing session accepts a follow-up turn on its continuation; while compaction is active an Enter-submitted draft is **queued, not steered**. |
| `apps/desktop/e2e/sidebar-search-profile-scope.spec.ts` | Sidebar full-text search is keyed to the sidebar's profile — a shared word surfaces only that profile's marker across A → B → A. |
| `apps/desktop/e2e/sidebar-states.spec.ts` | The background-process dot appears/disappears, a subagent runs, the final answer is visible, and the dot transitions correctly when viewing another session. |
| `apps/desktop/e2e/submit-drift.spec.ts` | #69578: harmless route-token churn during a send must not make the desktop silently drop the prompt. |
| `apps/desktop/e2e/timeline-position.spec.ts` | Timeline reads stay **logarithmic** with real skipped tool-heavy groups (native Chromium geometry, no backend). |
| `apps/desktop/e2e/unread-dot-restart.spec.ts` | The green "Finished — unread" dot **survives an app restart** (the flag used to live only in an in-memory atom); two sessions so the app cannot reopen straight into one. |
| `apps/desktop/e2e/warm-resume-jitter.spec.ts` | Warm-route resume must not re-render the transcript more than once (no visual flicker on tab reactivation). |
| `apps/desktop/e2e/core/README.md` | The core lane's contract: one real app + one real `hermes serve`, only the LLM faked, and the **transcript oracle** asserted after every transition. |
| `apps/desktop/e2e/core/oracle.ts` | THE transcript oracle: every persisted user/assistant message rendered exactly once and in order; nothing unpersisted rendered; the persisted assistant rows are exactly what the provider streamed; the wire's concatenated deltas equal what was streamed. |
| `apps/desktop/e2e/core/transcript-integrity.spec.ts` | Runs the oracle across every transition that has shipped a duplicate/vanishing/reordered bug. |
| `apps/desktop/e2e/core/boot-lifecycle.spec.ts` | Boot handshake, supervised respawn (exactly one replacement after `kill -9`), zero orphans on quit, and one gateway across every relaunch of the same home. |
| `apps/desktop/e2e/core/behind-window-send.spec.ts` | A window behind its chat still sends, and the model sees the other window's turn (the pre-send "Chat out of date" refusal is gone — it misfired and protected nothing). |
| `apps/desktop/e2e/core/fleet-condensed-default.spec.ts` | The condensed fleet menu lists the **active** gateway's default on both sides of a switch (#131632). |
| `apps/desktop/e2e/core/interactive-prompts.spec.ts` | Clarify and approval prompts round-trip **exactly once** end to end: the choice the user clicks is exactly what the model receives in the tool result, and the gated command has not run before the click and has run after it. |
| `apps/desktop/e2e/core/interrupted-reply.spec.ts` | Stop mid-stream renders **exactly the partial reply the session persisted** (#121594) — the bubble extends to the interrupted `message.complete`. |
| `apps/desktop/e2e/core/known.ts` | The merge-order-safe expected-failure mechanism: only the final symptom assertion is wrapped, so an unrelated failure propagates and a clean pass stays a pass once the fix lands. |
| `apps/desktop/e2e/core/lineage-compaction-prompt.spec.ts` | #121088: an acknowledged redirect prompt renders **once** after an in-place compaction inside its turn. |
| `apps/desktop/e2e/core/lineage-rotation.spec.ts` | #121148: a real compression rotation is **one sidebar row per conversation** (verified from state.db before asserting anything about the sidebar). |
| `apps/desktop/e2e/core/lineage-sidebar.spec.ts` | #121062: a branch child is its own titled row, and switching between it and its parent never leaks turns or duplicates a part. |
| `apps/desktop/e2e/core/local-gateway-attach.spec.ts` | #134889 W3: Desktop attaches to a gateway that was **already running** (never starts a second), serves a turn on it, and quitting leaves the gateway it did not start running. |
| `apps/desktop/e2e/core/no-idle-reap.spec.ts` | An idle local profile stays attached to its gateway — a local profile's backend hosts cron jobs and bot chats, so it is never torn down for being idle. |
| `apps/desktop/e2e/core/onboarding-first-chat.spec.ts` | Onboarding (custom endpoint) then the first chat renders exactly once; the onboarding result is what the backend persisted. |
| `apps/desktop/e2e/core/packaged-smoke.spec.ts` | The artifact users actually run: every declared `asarUnpack` pattern is honoured, the main entry ships, and the packaged binary boots against a scripted provider and completes a first chat. |
| `apps/desktop/e2e/core/process-census.ts` | Per-platform process census (Linux reads `/proc` so an orphan reparented to init is still counted; elsewhere the tree is rooted at every gateway pid the sandbox lock ever recorded). |
| `apps/desktop/e2e/core/process-census.unit.test.ts` | Unit-tests the census's membership rules with injected process tables. |
| `apps/desktop/e2e/core/provider.ts` | The scripted **recording** provider: every reply is keyed by the unique marker in that turn's own user message, so two scenarios can never consume each other's script and a replay gets the same answer. |
| `apps/desktop/e2e/core/reconnect-turn-state.spec.ts` | #134889 NF2: after a socket drop mid-turn the finished reply shows once and a follow-up right after runs; after a gateway SIGKILL the lost turn is offered for Discard and a follow-up never hangs behind it. |
| `apps/desktop/e2e/core/relay-managed-steer.spec.ts` | Steer and queue stay live under Relay managed execution (a blocking provider read used to make the reply look stopped). |
| `apps/desktop/e2e/core/remote-helpers.ts` | Spawns a real remote `hermes serve` under its OWN home/root, reached only by URL + token — "the shape of a Desktop talking to a backend on another machine". |
| `apps/desktop/e2e/core/remote-secondary.spec.ts` | #120730: a bot on a remote secondary connection — a client-only image reaches it as **bytes**, not a client path. |
| `apps/desktop/e2e/core/remote-topology.spec.ts` | Remote backend: first chat, image bytes not client paths, and a rename that survives a backend restart. |
| `apps/desktop/e2e/core/reply-painted-once.spec.ts` | A reply already streamed before the last tool renders **once** inside its bubble (with the interim seal on and off). |
| `apps/desktop/e2e/core/reply-settle-paths.spec.ts` | The timings that turn one reply into two bubbles: an answer repeated as the final reply renders once, and a steer at every point of a tool turn then reload and switch back. |
| `apps/desktop/e2e/core/switch-back-race.spec.ts` | Switch back while the away session completes — both orderings (REST read vs live `message.complete`) are forced deterministically, **no sleeps**. |

| `apps/desktop/e2e/update/harness.ts` | The install/update harness: a real local install made by the real entry points, a local bare origin standing in for GitHub, and the packaged app that install built — "Nothing inside Hermes is mocked." |
| `apps/desktop/e2e/update/global-setup.ts` | **Refuses to run where an update could reach the developer's own Hermes** — the cells run `hermes update --gateway`, so locally the suite must run in its own PID namespace. |
| `apps/desktop/e2e/update/seed.py` | Seeds/resets the real install; restores the snapshot **into the same path** because the install bakes absolute paths into launchers. |
| `apps/desktop/e2e/update/gates.ts` | Message-gated expected failures: wrap ONLY a final assertion, after every wait has settled. |
| `apps/desktop/e2e/update/gates.spec.ts` | The gates' signatures must match their bug and **not** neighbouring failures, or a gate turns an unrelated regression into a silent expected-failure. |
| `apps/desktop/e2e/update/app-update.spec.ts` | Clicking "Update now" moves the backend to the new commit, relaunches the app, and chat works afterwards. |
| `apps/desktop/e2e/update/build-fail.spec.ts` | #124040: a Desktop build failure during Update now tells the user the app was not rebuilt **and how to fix it** (the update succeeds with an owed follow-up). |
| `apps/desktop/e2e/update/first-run.spec.ts` | #123888/#123800: a healthy local install opens **straight to chat** on every launch — never the setup chooser, never the bootstrap installer. |
| `apps/desktop/e2e/update/update-concurrency.spec.ts` | #123117: "Update now" while a terminal update runs is **refused**, and the About panel is truthful once that update lands. |
| `apps/desktop/e2e/update/github-edge.ts` | A local stand-in for the two `api.github.com` resources the source update check reads, behind an HTTPS forward proxy with a CA bundle that trusts this run's own root. |



### `apps/desktop/scripts` — the packaging, signing and diagnostics harness

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/scripts/.gitignore` | Ignores the generated `share-codes.txt`. |
| `apps/desktop/scripts/after-extract.mjs` | electron-builder `afterExtract` hook: stamps the Hermes icon + identity onto the pristine Windows `electron.exe` **before** electron-builder renames it and injects the ASAR integrity resource (#105629 — rcedit cannot commit to the rewritten PE). |
| `apps/desktop/scripts/after-extract.test.mjs` | Pins that the identity stamp is wired to `afterExtract` with ASAR integrity kept on, and stamps the stock `electron.exe` on win32 only. |
| `apps/desktop/scripts/after-pack.mjs` | electron-builder `afterPack` hook: per-platform payload relocation, nested Chromium + wheel signing on macOS, PE signature sanitizing and batch signing on Windows. |
| `apps/desktop/scripts/after-pack.test.mjs` | Pins the Linux afterPack path: restores app localizations without copying locale data, puts the full-resolution `.icns` back after the layered icon was packaged, and reports a missing framework **without failing packaging**. |
| `apps/desktop/scripts/after-pack-digests.test.mjs` | Pins that payload digests are refreshed after packaging, and that a payload-free build is skipped. |
| `apps/desktop/scripts/after-pack-toolchain.test.mjs` | The Linux toolchain path on a **real Linux host**, not a fake host flag. |
| `apps/desktop/scripts/assert-dist-built.mjs` | Build-time guard: refuse to hand a half-built renderer to electron-builder ("the result launches but blank-pages with `ERR_FILE_NOT_FOUND`"). |
| `apps/desktop/scripts/assert-dist-built.test.mjs` | Pins that the guard passes on a complete `dist/`, fails when it is absent/empty/no-JS-bundle, and passes when the Router context invariant is in one asset. |
| `apps/desktop/scripts/assert-root-install.mjs` | Build-time guard: refuse to start a build the installed tree cannot finish, turning a hoisting problem into one actionable line ("run npm ci from the repo root") instead of a failure deep inside vite. |
| `apps/desktop/scripts/assert-root-install.test.mjs` | Pins that every missing critical package is reported **at once**, and that a react/react-dom version split is rejected. |
| `apps/desktop/scripts/audit-bundle-arch.mjs` | Proves every native binary inside a packed bundle was built for the target architecture — "wrong-arch binaries run FINE on the build runner (Windows-on-ARM and Rosetta emulate x64 silently)". |
| `apps/desktop/scripts/audit-bundle-arch.test.mjs` | Pins the header classifier (PE/ELF/Mach-O, universal slices, arm64ec), the unpacked-dir matcher, and that the CLI **fails closed** on an absent artifact. |
| `apps/desktop/scripts/backend-ready-artifact.mjs` | Guards the packaged backend-readiness parser against artifact skew: the shipped bundle must accept BOTH ready tokens, or a healthy backend is killed after the port-announcement timeout (#60772). |
| `apps/desktop/scripts/backend-ready-artifact.test.mjs` | Pins the asar path resolution per platform (including the branded macOS bundle), the rejection of the stale dashboard-only matcher, and that the **current source-tree parser itself passes**. |
| `apps/desktop/scripts/batch-sign-binaries.mjs` | Authenticode-signs every standalone binary in the packed Windows tree — "an MSIX whose payload carries unsigned PEs trips SmartScreen / enterprise WDAC policies". |
| `apps/desktop/scripts/batch-sign-binaries.test.mjs` | Pins binary collection (case-insensitive, sorted, symlinks skipped), the ~100-file chunking, and that the Store-submission package is skipped (Partner Center signs). |
| `apps/desktop/scripts/before-build.mjs` | electron-builder `beforeBuild`: skips the node_modules collector (deterministic packaging) and stages the MSIX build-time assets and the execution-alias extension. |
| `apps/desktop/scripts/before-pack.mjs` | electron-builder `beforePack`: removes any stale unpacked app directory and preserves a rollback backup of a working build. |
| `apps/desktop/scripts/before-pack.test.mjs` | Pins the stale-dir cleanup (populated/absent/invalid), that the hook **resolves even when cleanup throws**, and the `.bak` rollback behaviour. |
| `apps/desktop/scripts/build.mjs` | The source-development build composition; the compiler consumes prepared inputs. |
| `apps/desktop/scripts/build.test.mjs` | Pins that the install stamp is written while the committed assets are still in place. |
| `apps/desktop/scripts/build-command-screenshot-monitor.mjs` | Builds the native command-screenshot helper with the paired macOS sysroot (build-time only; the shipped app never needs clang). |
| `apps/desktop/scripts/build-command-screenshot-monitor.test.mjs` | Pins the argv (paired sysroot vs `xcrun` delegation) and that it is a no-op off macOS. |
| `apps/desktop/scripts/build-hud-modifier-monitor.mjs` | Builds the HUD modifier monitor (Windows uses its in-box .NET compiler; no SDK download). |
| `apps/desktop/scripts/bundle-electron-main.mjs` | Bundles the Electron main entry with esbuild. |
| `apps/desktop/scripts/bundle-electron-main.test.mjs` | Pins the Wayland/ozone relaunch behaviour and that `desktop.electron_flags` is read through a suffixed home and from the parent of a `profiles/`-rooted `HERMES_HOME`. |
| `apps/desktop/scripts/bundle-env.d.mts` | The type surface for `validateBundleEnvironment` / `applyBundleEnvironment`. |
| `apps/desktop/scripts/bundle-env.mjs` | Applies the baked bundle defaults **before** modules resolve paths — "An esbuild define would replace reads, not populate the child process env." Only five keys are allowed; process-control variables such as `NODE_OPTIONS` and `PATH` are rejected. |
| `apps/desktop/scripts/bundle-env.test.mjs` | Pins that explicit clears beat inherited homes and prevent the Windows registry fallback, that the banner semantics replay for defaults/overrides/clears, and that baked defaults precede module init. |
| `apps/desktop/scripts/check-chunks-parse.mjs` | Parses every emitted renderer chunk as an ES module **in one node process** — "~1000 process creations, and on Windows a single spawn can stall for minutes under AV scanning". |
| `apps/desktop/scripts/cli-launchers.test.mjs` | Pins that one MSIX extension consumes the launchers the payload declares, and that every interpolated attribute value is escaped. |
| `apps/desktop/scripts/click-session-helpers.mjs` | Shared logic for the interactive CDP session-clicker (instant centered scroll + a polled composer-mount wait instead of a fixed sleep). |
| `apps/desktop/scripts/click-session-helpers.test.mjs` | Pins the find/click expression, the CDP envelope unwrapping (including a truncated envelope returning `null`, not `undefined`), and that `pollUntil` resolves as soon as the predicate is true and returns `false` at the bound. |
| `apps/desktop/scripts/click-session.mjs` | Clicks a sidebar session by partial title; the two flake sources (#97982) are fixed. |
| `apps/desktop/scripts/commit-bundles.windows.test.mjs` | Native proof that the Windows bundle job produces distinct flavor identities and ordered canary updates. |
| `apps/desktop/scripts/commit-stamp-identity.test.mjs` | Pins that the desktop stamp uses the **admitted checkout** rather than the dispatch SHA. |
| `apps/desktop/scripts/compiler-cache.d.mts` | The type surface for `withCompilerCache`. |
| `apps/desktop/scripts/compiler-cache.mjs` | On-disk memoization of the React Compiler babel pass (~85 % of a production renderer build). |
| `apps/desktop/scripts/compiler-cache.test.mjs` | Pins that a warm build serves the stored output identically, that a toolchain/`NODE_ENV` change starts a new generation, and that watch builds never prune or cache. |
| `apps/desktop/scripts/connector-rehearsal.mjs` | A real desktop + real backend rehearsal under an isolated identity ("no copied credentials"), on a fixed Vite port and CDP port so it can be driven from outside. |
| `apps/desktop/scripts/desktop-update-ui.test.mjs` | **Executes the shipped page** (including its inline script) rather than matching source strings or testing a second implementation of the progress client; pins that a healthy long update keeps displaying while progress remains reachable. |
| `apps/desktop/scripts/dev-no-hmr.mjs` | Launches the renderer with HMR disabled to sidestep a Vite 8 / plugin-react 6 bug where the preamble script is not injected ("$RefreshReg$ is not defined"). |
| `apps/desktop/scripts/diag-code-live.mjs` | Checks the served source (what vite compiled) to see whether the tree-split preview path is active, rather than guessing. |
| `apps/desktop/scripts/diag-drag-churn.mjs` | Records render attribution and every nanostore notification during a sash drag — names the store that publishes, not just the symptom. |
| `apps/desktop/scripts/diag-drag-trace.mjs` | Takes a real CDP trace of one sash drag and prints the category split (Recalculate Style / Layout / Paint / Scripting) so the next fix targets the actual cost. |
| `apps/desktop/scripts/diag-jump.mjs` | Wraps the thread scroller's properties and prints the pin/scroll/RO timeline during a submit. |
| `apps/desktop/scripts/diag-key-latency.mjs` | Isolates typing latency with and without an active stream — "distinguishes 'input is slow' from 'the frame budget is consumed by streaming flushes'". |
| `apps/desktop/scripts/diag-live-state.mjs` | A quick CDP state probe of the running instance. |
| `apps/desktop/scripts/diag-overlay-ab.mjs` | A robust A/B: measures each surface N times and reports the **median** wasted renders (reduces timing noise from stream ticks landing on different clicks). |
| `apps/desktop/scripts/diag-overlay-churn.mjs` | Read-only render-churn measurement on overlay surfaces against the live instance. |
| `apps/desktop/scripts/diag-overlay-full.mjs` | Comprehensive overlay churn measurement (cmdk, settings, command center, capabilities). |
| `apps/desktop/scripts/diag-overlay-sweep.mjs` | A full surface sweep: every overlay, every settings sub-page, every system overlay. |
| `apps/desktop/scripts/diag-real-loop.mjs` | The real-app perf loop: clicks REAL sidebar rows for session switch, sidebar drag and composer typing, and reports honest single-clock numbers. |
| `apps/desktop/scripts/diag-ro-storm.mjs` | Counts the ResizeObserver callbacks one sash drag actually fires and for how many distinct elements — "the fix differs completely" between a few expensive and many cheap calls. |
| `apps/desktop/scripts/diag-scroll-reset.mjs` | Reproduces and diagnoses the "scroll wheel resets position while reading" bug (the browser default `overflow-anchor`). |
| `apps/desktop/scripts/diag-sidebar-dom.mjs` | Dumps the sidebar's real DOM shape "so selectors stop being guesses". |
| `apps/desktop/scripts/diag-switch-autopsy.mjs` | Session-switch autopsy: settled ms, React commits and top rendered components per switch — "so slow switches name themselves". |
| `apps/desktop/scripts/diag-switch-trace.mjs` | Dumps the style/layout/script split plus top callsites for a slow session switch. |
| `apps/desktop/scripts/dmgbuild-diagnostics.cjs` | The `[dmg-detach]` snapshot shim: identifies the mounted filesystem, backing image, devices, and holder processes without stopping anything or changing detach results. |
| `apps/desktop/scripts/dmgbuild-diagnostics.test.mjs` | Pins that the resolved dmgbuild keeps its paired Python and preserves args/results/live diagnostics, and that other executables and explicit overrides pass through unchanged. |
| `apps/desktop/scripts/eval.mjs` | A simple in-page eval helper over CDP (`node scripts/eval.mjs "document.title"`). |
| `apps/desktop/scripts/gen-msix-manifest.mjs` | Generates the `AppxManifest.xml` off-Windows using the REAL app-builder-lib helpers — "makeappx reports every manifest problem as a bare 0x80080204, and this is the XML it is rejecting". |
| `apps/desktop/scripts/gen-share-codes.ts` | A throwaway generator for deterministic fake star-map graphs → real share codes (runs the actual encoder, so every string round-trips). |
| `apps/desktop/scripts/i18n-keys.mjs` | Emits the desktop catalog's key set for language-pack validation (every leaf's dotted path, sorted; function-valued entries are keys too). |
| `apps/desktop/scripts/i18n-keys.test.mjs` | Pins the flattening rules and that the committed `locales/_keys.desktop.json` **matches** the English catalog. |
| `apps/desktop/scripts/live-drive.mjs` | The live-drive harness for the real instance: status, fps, drag, type, switch. |
| `apps/desktop/scripts/local-pack-publish.test.mjs` | Pins that the pack script pins an explicit publish policy. |
| `apps/desktop/scripts/mac-icon.cjs` | Chooses which macOS icon resource electron-builder packages, per build host (the Icon Composer `.icon` needs `actool` ≥ Xcode 26). |
| `apps/desktop/scripts/mac-icon.test.mjs` | Pins that the layered icon is packaged only where `actool` can compile it, never from a non-mac host, and that any plist-read failure is treated as absent. |
| `apps/desktop/scripts/mac-sign-cache.mjs` | Reuses Developer ID signatures for loose Mach-O payload files across release builds — the cache stores the **signed bytes**, keyed by the unsigned bytes plus everything that shapes the signature. |
| `apps/desktop/scripts/mac-sign-cache.test.mjs` | Pins which files are "loose payload binaries" (not nested bundles, not the main executable), that an identical input restores the stored bytes, and that duplicate inputs are signed once. |
| `apps/desktop/scripts/mac-sign.mjs` | The custom macOS signer: retains the builder's entitlements and file selection, and refreshes digests after child signatures but **before** the outer app signature. |
| `apps/desktop/scripts/mac-sign.test.mjs` | Pins the digest-refresh ordering and that a corrupt/missing PM fact is rejected while a payload-free build is skipped. |
| `apps/desktop/scripts/macos-sysroot.mjs` | Resolves the macOS SDK the native helpers compile against (build-time only). |
| `apps/desktop/scripts/macos-sysroot.test.mjs` | Pins that an explicit `SDKROOT` wins, that a **stale** `SDKROOT` is reported and falls back to the toolchain default instead of failing the build, and that an empty `SDKROOT` is ignored. |
| `apps/desktop/scripts/macos-sysroot-native.test.mjs` | The native sysroot proof on a real toolchain. |
| `apps/desktop/scripts/msix-manifest-roundtrip.test.mjs` | Pins that the MSIX `BUILD_NUMBER` derived by `msix-shared` **equals** the `Version=` the built manifest ships (stable and canary), and that every component is 16-bit. |
| `apps/desktop/scripts/msix-shared.test.mjs` | Pins that an explicit stable tag owns the package version, independent of checkout metadata, and that stable and canary use their own native build-time quads. |
| `apps/desktop/scripts/msix-virtualization.test.mjs` | Pins that every MSIX the repo produces keeps write virtualisation **disabled** and that the builder requests `unvirtualizedResources` (Hermes shares `%LOCALAPPDATA%`/HKCU with the unpackaged CLI). |
| `apps/desktop/scripts/native-quad.test.mjs` | Pins the native version quad (stable keeps the store quad; canary uses `yy.mmdd.hh.mmss`), that historical release identities are rejected, and that a later canary sorts above an earlier one across a month boundary. |
| `apps/desktop/scripts/notarize-artifact.mjs` | Submits and staples a single notarization artifact. |
| `apps/desktop/scripts/notarize.mjs` | The `afterSign` hook that owns notarization, including keychain-profile builds. |
| `apps/desktop/scripts/osx-sign-inputs.test.mjs` | Pins that the signing walk stays bounded on a truncated protobuf-like resource. |
| `apps/desktop/scripts/patch-electron-builder-mac-binary.mjs` | Loaded in the builder child before `osx-sign`; owns each probe through `close` (the path API resolves too early). |
| `apps/desktop/scripts/payload-digests.mjs` | Refreshes the packaged payload's tool-fact digests through the real Python helper. |
| `apps/desktop/scripts/payload-sign-cache.mjs` | The Authenticode signature cache: the key binds input bytes, Azure policy, signing tools and timestamp policy — "Filenames and release versions do not determine identity". |
| `apps/desktop/scripts/payload-sign-cache.test.mjs` | Pins that input bytes select entries while policy and executable content stay binding, and that the batch cache publishes only after successful signing **and** timestamping. |
| `apps/desktop/scripts/prepare-dmgbuild.mjs` | Prepares the independently PM-owned DMG supplier for a source build. |
| `apps/desktop/scripts/prepare-dmgbuild.test.mjs` | Pins that the packager selects a same-OS payload architecture but refuses a foreign OS, and that a missing runtime fails **before** publication. |
| `apps/desktop/scripts/prepare-packaging-tools.mjs` | Prepares the packaging toolchain for the builder. |
| `apps/desktop/scripts/prepare_dmgbuild.py` | The source-build entrypoint for the DMG supplier. |
| `apps/desktop/scripts/prepared-native-deps.mjs` | Path/digest-bound admission of the prepared native dependencies. |
| `apps/desktop/scripts/prepared-native-deps.test.mjs` | Pins that `beforePack` refuses an **absent** native preparation rather than staging from npm, and that consumption rejects changed sources, targets or bytes. |
| `apps/desktop/scripts/prepared-packaging.mjs` | The prepared-inputs model (path + digest) that consumption is bound to. |
| `apps/desktop/scripts/prepared-packaging.test.mjs` | Pins that a failed preparation invalidates an earlier completion claim **before** loading suppliers, and that prepared inputs are path-bound and reject changed bytes without repair. |
| `apps/desktop/scripts/prepared-windows-tools.test.mjs` | Pins that signing validates once per packager (never process-wide) and that a prepared signing selection cannot fall through to a supplier. |
| `apps/desktop/scripts/probe-command-palette.mjs` | Measures ⌘K open latency **in-page** (no CDP round-trip in the number). |
| `apps/desktop/scripts/probe-model-picker.mjs` | Model-picker open latency probe. |
| `apps/desktop/scripts/probe-prepared-native.mjs` | The native admission probe. |
| `apps/desktop/scripts/probe-prepared-native.test.mjs` | Pins that the admission child **refuses ordinary Node** instead of certifying an Electron ABI. |
| `apps/desktop/scripts/probe-renderer.mjs` | A quick renderer state probe over CDP. |
| `apps/desktop/scripts/probe-thread.mjs` | Probes the thread state (message count, turn pairs, height, composer). |
| `apps/desktop/scripts/profile-model-picker.mjs` | CPU-profiles one model-picker open. |
| `apps/desktop/scripts/reload-renderer.mjs` | Reloads the renderer over CDP so it picks up the latest from Vite. |
| `apps/desktop/scripts/reload.mjs` | A hard reload of the Electron renderer (Vite-no-HMR mode). |
| `apps/desktop/scripts/run-electron-builder.mjs` | The builder entry: source mode prepares first, `--prepared` only admits and consumes files. |
| `apps/desktop/scripts/run-electron-builder.test.mjs` | Pins that `--validate-only` admits real prepared inputs **without launching tools** and rejects unsafe arguments, that multiarch prepares isolated inputs before each strict invocation, and that the strict builder refuses absent inputs before loading electron-builder. |
| `apps/desktop/scripts/run-short-session-hang-repro.mjs` | A standalone reproducer for the short-session hang (the repo's own `repro:short-session-hang` script). |
| `apps/desktop/scripts/sanitize-pe-signatures.mjs` | Repairs PE certificate tables that point past the end of their own file (python-build-standalone's `llvm-strip` leaves them dangling) before anything tries to sign the tree. |
| `apps/desktop/scripts/sanitize-pe-signatures.test.mjs` | Pins that tree sanitization preserves **all** bytes except the dangling PE certificate directories. |
| `apps/desktop/scripts/set-exe-identity.mjs` | Stamps the Hermes icon + version metadata onto the built `Hermes.exe` with `rcedit`, decoupled from electron-builder's signing path. |
| `apps/desktop/scripts/set-exe-identity.test.mjs` | Pins the bounded rcedit retry backoff and that a spawn failure (ENOENT/EACCES) is **not** retried. |
| `apps/desktop/scripts/side-by-side-launchers.test.mjs` | Pins that the Store bundler rejects non-stable selectors before touching platform tools, that non-stable MSIX CLI aliases each activate their own entrypoint (never the GUI), and that the payload exposes only identity-qualified launchers. |
| `apps/desktop/scripts/side-by-side.windows.test.mjs` | The **native SDK proof** (not desktop E2E): `makeappx` validates unmodified production manifests in a temporary tree; no package is registered and no profile data is changed. |
| `apps/desktop/scripts/sign-msix.mjs` | The electron-builder `custom win.sign` hook: Azure Trusted Signing for the MSIX package envelope only. |
| `apps/desktop/scripts/sign-msix.test.mjs` | Pins that only `.msix`/`.msixbundle` are signed, that the Store-submission variant is rejected (Partner Center re-signs), and that every non-package file is refused. |
| `apps/desktop/scripts/sign-nested-chromium.mjs` | Signs payload Chromium with the Developer ID before `osx-sign` seals the app — Google's leftover signatures have no timestamp and no hardened runtime, so Apple's notary rejects them. |
| `apps/desktop/scripts/sign-nested-chromium.test.mjs` | Pins the framework-link repair, the no-identity no-op, and that `--deep` signs the `.app` and file-signs loose Mach-O. |
| `apps/desktop/scripts/sign-wheel-zips.mjs` | Signs Mach-O members **inside** payload uv-cache wheel zips — "Apple's notary extracts every zip and validates each Mach-O". |
| `apps/desktop/scripts/sign-wheel-zips.test.mjs` | Pins the no-identity no-op, the zero count for a payload without a uv-cache, and the per-member signing. |
| `apps/desktop/scripts/signing-resources.test.mjs` | Pins the signing-resource selection rules. |
| `apps/desktop/scripts/stage-native-deps.mjs` | Stages node-pty's native runtime dependencies for the target platform/arch. |
| `apps/desktop/scripts/stage-native-deps.test.mjs` | Pins that a missing Linux HUD toolchain leaves **no empty package directories**, and the ELF/Mach-O classification. |
| `apps/desktop/scripts/store-package-version.test.mjs` | Pins that the Store manifest and envelope agree while the executable app semver and the sideload sequence stay unchanged, that calendar ordering survives minute/hour/day/year boundaries, and that a stable candidate identity uses the admitted claim epoch. |
| `apps/desktop/scripts/test-desktop.mjs` | The desktop test driver (`dmg`, `msix`, `existing`, `fresh`, `lifecycle`, `all`). |
| `apps/desktop/scripts/update-relaunch-waiter.ps1` | Waits outside the package until the original app exits and Windows publishes its update. |
| `apps/desktop/scripts/utils.mjs` | A tiny "is this file being invoked from node" helper. |
| `apps/desktop/scripts/verify-side-by-side-macos.mjs` | A native fixture proof (not signed-artifact E2E) over stable/canary/commit cases. |
| `apps/desktop/scripts/verify-signed-payloads.ps1` | Verifies the signed payload against a manifest with `signtool`. |
| `apps/desktop/scripts/windows-bundle-tools.mjs` | Standalone bundle jobs need the same tools as electron-builder, "even when GitHub evicts the build cache before the publishing job starts". |
| `apps/desktop/scripts/windows-bundle-tools.test.mjs` | Pins that both bundle modes provision **pinned** tools rather than searching a prefilled cache. |
| `apps/desktop/scripts/write-build-stamp.mjs` | Writes the desktop artifact stamp for source/bundled/Light builds; the packaged sidecar exists only to detect replacement of that artifact by an update. |
| `apps/desktop/scripts/write-build-stamp.test.mjs` | Pins `fromCI` (GITHUB_SHA / GITHUB_REF_NAME), `fromLocalGit` (HEAD + branch + dirty status) and the all-zero fallback commit. |

### `apps/desktop/scripts/perf` — the perf harness

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/scripts/perf/README.md` | The perf harness's contract: one systematized way to measure, diff against a **committed baseline**, and fail on regressions — replacing a dozen one-off scripts. |
| `apps/desktop/scripts/perf/baseline.json` | The committed baseline (median of 5 runs, darwin-arm64, production renderer) with the measurement conditions written into `_meta` — "Re-baseline per device with `--update-baseline`; tolerances loose for cross-machine/disk variance." |
| `apps/desktop/scripts/perf/run.mjs` | The harness entrypoint; with no scenarios it runs the CI suite (stream, keystroke, transcript). |
| `apps/desktop/scripts/perf/serve.mjs` | Launches a standalone, fully isolated perf instance on :9222 with a temp `HERMES_HOME` + user-data dir. |
| `apps/desktop/scripts/perf/lib/cdp.mjs` | THE one CDP client — before this, every script had its own copy-pasted class, its own `/json` vs `/json/list` discovery and its own Profiler ranking. |
| `apps/desktop/scripts/perf/lib/launch.mjs` | Attaches to a running debug instance or spawns a fully isolated one (unblocking measurement that the single-instance lock used to prevent). |
| `apps/desktop/scripts/perf/lib/baseline.mjs` | The baseline + regression gate: "a PR that regresses streaming/typing/mount cost fails loudly instead of silently drifting". |
| `apps/desktop/scripts/perf/lib/stats.mjs` | Shared numeric helpers (nearest-rank percentile over an unsorted array, etc.). |
| `apps/desktop/scripts/perf/gateway_attach_bench.py` | Measures the gateway's attach-RPC dispatch against the real dispatcher — every attach handler resolves its session through a deferred agent build. |
| `apps/desktop/scripts/perf/image-attach-bench.mjs` | Measures the desktop image-attach pipeline stage by stage on a real image, with no Electron and no LLM. |
| `apps/desktop/scripts/perf/scenarios/index.mjs` | The scenario registry: add a module and it is automatically available to the runner, the default suite and the baseline gate. |
| `apps/desktop/scripts/perf/scenarios/stream.mjs` | Streaming render cost: longtask count + max, frame p95/p99, slow-frame share. |
| `apps/desktop/scripts/perf/scenarios/stream-history.mjs` | Streaming into an already-long transcript — the per-delta cost that scales with transcript length (#69120). |
| `apps/desktop/scripts/perf/scenarios/keystroke.mjs` | Composer input latency (keystroke → next paint): "the most-felt latency in a chat app". |
| `apps/desktop/scripts/perf/scenarios/transcript.mjs` | Large-transcript mount cost — the "open a long session" first-impression latency. |
| `apps/desktop/scripts/perf/scenarios/idle-cost.mjs` | What the app costs while a turn runs but **nothing is arriving** — the app re-rendering on its own, competing with the user. |
| `apps/desktop/scripts/perf/scenarios/multitab.mjs` | N session tiles all mounted, all streaming — "the '5 tabs doing PR review' workload". |
| `apps/desktop/scripts/perf/scenarios/render-churn.mjs` | WHAT re-rendered and WHY, and which store published the update (frame pacing tells you the cost; this tells you the cause). |
| `apps/desktop/scripts/perf/scenarios/right-pane.mjs` | File-tree + terminal stress: the regression scene where opening the tree/terminal made the whole page hitch. |
| `apps/desktop/scripts/perf/scenarios/submit.mjs` | Enter latency + scroll stability (report-only: real round-trips are too environment-dependent to gate). |
| `apps/desktop/scripts/perf/scenarios/session-load.mjs` | Visual stability of a session LOAD (the prepend/settle path, not the append path). |
| `apps/desktop/scripts/perf/scenarios/session-switch.mjs` | Session-switch latency (report-only). |
| `apps/desktop/scripts/perf/scenarios/profile-switch.mjs` | Profile-switch latency (report-only). |
| `apps/desktop/scripts/perf/scenarios/first-token.mjs` | Time-to-first-token — "the latency an agent app is uniquely judged on". |
| `apps/desktop/scripts/perf/scenarios/cold-start.mjs` | Cold start — launch → renderer → interactive (the runner spawns a fresh isolated instance per run). |
| `apps/desktop/scripts/perf/scenarios/live-window.mjs` | Observes the existing workspace without seeding sessions or changing focus; timing is kept separate from attribution cost. |
| `apps/desktop/scripts/profile-typing-lag.md` | The workflow document for empirically measuring and fixing renderer typing/submit lag. |



### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `apps/bootstrap-installer/public/nous-girl.png` | Binary image asset (11.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/128x128.png` | Binary image asset (5.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/128x128@2x.png` | Binary image asset (11.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/32x32.png` | Binary image asset (1.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/icon.icns` | Binary image asset (247.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/icon.ico` | Binary image asset (34.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/icon.icon/Assets/art-dark.png` | Binary image asset (59.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/icon.icon/Assets/art-light.png` | Binary image asset (48.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/bootstrap-installer/src-tauri/icons/icon.icon/Assets/mono.png` | Binary image asset (73.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square150x150Logo.png` | Binary image asset (6.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square150x150Logo.scale-125.png` | Binary image asset (8.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square150x150Logo.scale-150.png` | Binary image asset (9.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square150x150Logo.scale-200.png` | Binary image asset (13.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square150x150Logo.scale-400.png` | Binary image asset (32.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.png` | Binary image asset (1.5 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.scale-125.png` | Binary image asset (1.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.scale-150.png` | Binary image asset (2.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.scale-200.png` | Binary image asset (3.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.scale-400.png` | Binary image asset (7.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-16.png` | Binary image asset (0.5 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-16_altform-lightunplated.png` | Binary image asset (0.5 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-16_altform-unplated.png` | Binary image asset (0.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-20.png` | Binary image asset (0.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-20_altform-lightunplated.png` | Binary image asset (0.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-20_altform-unplated.png` | Binary image asset (0.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-24.png` | Binary image asset (0.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-24_altform-lightunplated.png` | Binary image asset (0.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-24_altform-unplated.png` | Binary image asset (1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-256.png` | Binary image asset (11.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-256_altform-lightunplated.png` | Binary image asset (11.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-256_altform-unplated.png` | Binary image asset (18 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-30.png` | Binary image asset (1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-30_altform-lightunplated.png` | Binary image asset (1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-30_altform-unplated.png` | Binary image asset (1.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-32.png` | Binary image asset (1.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-32_altform-lightunplated.png` | Binary image asset (1.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-32_altform-unplated.png` | Binary image asset (1.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-36.png` | Binary image asset (1.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-36_altform-lightunplated.png` | Binary image asset (1.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-36_altform-unplated.png` | Binary image asset (1.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-40.png` | Binary image asset (1.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-40_altform-lightunplated.png` | Binary image asset (1.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-40_altform-unplated.png` | Binary image asset (1.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-48.png` | Binary image asset (1.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-48_altform-lightunplated.png` | Binary image asset (1.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-48_altform-unplated.png` | Binary image asset (2.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-60.png` | Binary image asset (2.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-60_altform-lightunplated.png` | Binary image asset (2.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-60_altform-unplated.png` | Binary image asset (3.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-64.png` | Binary image asset (2.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-64_altform-lightunplated.png` | Binary image asset (2.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-64_altform-unplated.png` | Binary image asset (3.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-72.png` | Binary image asset (2.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-72_altform-lightunplated.png` | Binary image asset (2.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-72_altform-unplated.png` | Binary image asset (4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-80.png` | Binary image asset (3.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-80_altform-lightunplated.png` | Binary image asset (3.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-80_altform-unplated.png` | Binary image asset (4.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-96.png` | Binary image asset (3.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-96_altform-lightunplated.png` | Binary image asset (3.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Square44x44Logo.targetsize-96_altform-unplated.png` | Binary image asset (6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/StoreLogo.png` | Binary image asset (1.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/StoreLogo.scale-125.png` | Binary image asset (2.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/StoreLogo.scale-150.png` | Binary image asset (2.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/StoreLogo.scale-200.png` | Binary image asset (3.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/StoreLogo.scale-400.png` | Binary image asset (8.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Wide310x150Logo.png` | Binary image asset (4.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Wide310x150Logo.scale-125.png` | Binary image asset (6.5 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Wide310x150Logo.scale-150.png` | Binary image asset (8.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Wide310x150Logo.scale-200.png` | Binary image asset (11.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/appx/Wide310x150Logo.scale-400.png` | Binary image asset (27.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon-dark.icns` | Binary image asset (361.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon-dark.ico` | Binary image asset (55.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon-dark.png` | Binary image asset (89.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon-mac.png` | Binary image asset (53.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.icns` | Binary image asset (247.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.ico` | Binary image asset (39.5 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.icon/Assets/art-dark.png` | Binary image asset (59.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.icon/Assets/art-light.png` | Binary image asset (48.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.icon/Assets/mono.png` | Binary image asset (73.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/assets/icon.png` | Binary image asset (63.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/packaging/dmg-volume.icns` | Binary image asset (592.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/packaging/nous-dmg-2b.tiff` | Binary image asset (1255.4 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/pr-assets/profile-launch-menu.png` | Binary image asset (52.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/pr-assets/session-source-folders.png` | Binary image asset (769.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/apple-touch-icon.png` | Binary image asset (63.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/ds-assets/filler-bg0.jpg` | Binary image asset (3781.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-0.png` | Binary image asset (132.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-1.png` | Binary image asset (114.8 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-2.png` | Binary image asset (109.2 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-3.png` | Binary image asset (76.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-4.png` | Binary image asset (116.6 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-5.png` | Binary image asset (96.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-6.png` | Binary image asset (97.1 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-frames/hermes-frame-7.png` | Binary image asset (91.9 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes-sprite.png` | Binary image asset (883 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/hermes.png` | Binary image asset (1346.3 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/nous-girl-dark.png` | Binary image asset (18 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/desktop/public/nous-girl.png` | Binary image asset (11.7 KB) — confirmed on disk by name, size and type; the file list already classifies it as ssets. |
| `apps/shared/src/gateway-contract.generated.ts` | **Generated** from `tui_gateway/contracts` by `scripts/gen_gateway_contracts.py` (the header says DO NOT EDIT, and a staleness test fails the build). Read the head (the type surface + the billing/subscription shapes) and the tail (the generated event-name list) to confirm what it carries; the 262 KB body is a mechanical expansion of the OpenRPC contract. |
| `apps/shared/src/gateway-contract.openrpc.json` | 1.16 MB **generated** OpenRPC document (the machine-readable twin of the same contract). Read the head (openrpc version, info, one method's params/result shape) and the on-disk size; not read line by line. |




### Tier 2 (continued) — the remaining files, spelled out

These files were read in full (or, for the e2e harness, structurally) and are listed here so every
path in the shard appears exactly once in section 1.

| File | What it is / what it pins |
| --- | --- |
| `apps/shared/src/catalog-browse.ts` | The plugin taxonomy (`PLUGIN_CATEGORIES`, `PLUGIN_CATEGORY_ORDER`) and the sort/group helpers: the `stars` sort **returns the published snapshot's order unchanged** ("Preserve its order, including ties"), and an unknown category is bucketed into `general` rather than dropped. |
| `apps/shared/src/catalog-install.ts` | The install-target contract shared by the docs galleries and the native catalog: `skillCatalogInstallIdentifier` handles three id regimes (explicit id, legacy local skill, `clawhub/`-prefixed), and the deep link is a `hermes://skill/install?identifier=…` URL; a built-in skill with no identifier is **not installable** (returns `null`). |
| `apps/shared/src/data-url-read-max.ts` | The shared cap for local files loaded as data URLs (16 MB default, 1–4096 MB bounds) with the honest note that it is a **memory guard, not a model limit** — "values well below it can still OOM the app." |
| `apps/shared/src/model-search-text.ts` | Search-only aliases for opaque model ids (`k3` → `kimi-k3 kimi`); the wire id is never changed, and the table has a documented Python twin. |
| `apps/shared/src/reasoning-effort.ts` | The reasoning ladder (`minimal…ultra`) with `none` modelled as "thinking disabled" rather than as a level; `isReasoningEffort` is case-insensitive; the default is `medium`. |
| `apps/shared/src/skin.ts` | The cross-surface skin contract: the canonical colour-token enum, the branding-token enum, and the resolved `HermesSkin` payload (every field optional, with `dark_colors`/`light_colors` overlays and a 32 KiB-clipped `customCSS`). |
| `apps/bootstrap-installer/.gitignore` | Ignores the Rust target, the Vite output, `*.tsbuildinfo` and the Tauri generated schemas. |
| `apps/bootstrap-installer/eslint.config.mjs` | Re-exports the repo-wide shared ESLint config. |
| `apps/bootstrap-installer/index.html` | The minimal renderer shell (Tailwind utility classes on `<html>`/`<body>`, `#root`, the module entry). |
| `apps/bootstrap-installer/package.json` | The installer workspace manifest: **every dependency pinned to an exact version**, and the `tauri:build` / `tauri:build:debug` scripts. |
| `apps/bootstrap-installer/tsconfig.json` | `strict` plus `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`, with the `@/*` path alias. |
| `apps/bootstrap-installer/tsconfig.node.json` | The composite project for `vite.config.ts` only. |
| `apps/bootstrap-installer/vite.config.ts` | The Tauri-targeted Vite config: port 5175 (chosen to stay clear of web 5173 and desktop 5174), `strictPort`, `clearScreen: false` ("the Tauri convention — they spawn vite as a child process and want our errors to stay visible"), and the Rust side excluded from the watcher. |
| `apps/bootstrap-installer/src-tauri/Cargo.toml` | The crate: the binary is **renamed to `Hermes-Setup`** ("Grandma sees what we hand her, period"), rustls instead of OpenSSL, and a release profile of `panic = "abort"` + LTO + `opt-level = "s"` + strip ("A 5-10MB signed installer is the goal"). |
| `apps/bootstrap-installer/src-tauri/tauri.conf.json` | The Tauri config: the window is created **hidden** (`visible: false`) and revealed only after the fast path decides to show the installer; the CSP is strict (`script-src 'self'`, no inline scripts) — which is why the theme follower cannot use an inline pre-paint script; `webviewInstallMode: embedBootstrapper`; hardened runtime on macOS. |
| `apps/bootstrap-installer/src-tauri/build.rs` | Bakes the install-script pin into the binary; **commit pinning is opt-in** (branch-follow by default), an unresolvable pin **panics**, and `rerun-if-changed` covers `.git/HEAD` **and the ref it points at**. |
| `apps/bootstrap-installer/src-tauri/hermes-setup.manifest` | The Windows application manifest declaring `asInvoker` (otherwise the product name trips the installer-detection heuristic and `CreateProcess` fails with `ERROR_ELEVATION_REQUIRED`), plus PerMonitorV2 DPI awareness, UTF-8 active code page and Common Controls v6. |
| `apps/bootstrap-installer/src-tauri/capabilities/default.json` | The narrowly-scoped Tauri permission set: "we don't write user files outside HERMES_HOME, we don't read arbitrary paths, and the only external network call goes through reqwest (Rust side, not exposed to the webview)." |
| `apps/bootstrap-installer/src-tauri/entitlements.plist` | The macOS hardened-runtime entitlements (JIT, unsigned executable memory, library validation, microphone). |
| `apps/bootstrap-installer/src-tauri/Info.plist` | `LSUIElement` (the launcher hand-off must stay out of the Dock) plus the microphone/camera usage strings. |
| `apps/bootstrap-installer/src-tauri/icons/icon.icon/icon.json` | The macOS Icon Composer package definition (light/dark art specialisations plus a glass `mono` layer for the tinted appearance). |
| `apps/bootstrap-installer/src-tauri/src/main.rs` | The process entrypoint — deliberately tiny, because the `windows_subsystem = "windows"` attribute **must live on the binary crate**: "placing it on the lib was the bug that left a stray cmd window behind Hermes-Setup.exe on release builds." |
| `apps/bootstrap-installer/src-tauri/src/marker_tests.rs` | The marker protocol's test suite (split out to keep the module under the size gate): the guard's write-then-remove-on-drop, a refused acquire leaving a live owner's marker intact, a no-`ct` claim naming our own pid being reclaimed, the exit-2 heal matrix (self-owned / foreign / garbage / other exit codes / held checkout lock), the delegate hand-over, the shared-corpus judge and release cases, the zombie probes, the tmp-litter sweep, and the second-claimant refusal. |
| `apps/bootstrap-installer/src/app.tsx` | The four-screen shell: a single `$route` atom (welcome / progress / success / failure) and **no react-router** ("4 screens, no react-router"). |
| `apps/bootstrap-installer/src/main.tsx` | Mounts the app in StrictMode and calls `watchTheme()` — the OS appearance follower. |
| `apps/bootstrap-installer/src/routes/welcome.tsx` | The welcome screen: the wordmark as the hero, and deliberately **no install path** ("Showing %LOCALAPPDATA% to grandma is developer-brain"). |
| `apps/bootstrap-installer/src/routes/progress.tsx` | The progress screen: a flat stage list where only the running step is opaque, a **neutral** terminal check/cross ("no celebratory green"), a 1 s live-elapsed ticker, and a collapsible live-output pane that auto-scrolls (stderr at 45 % opacity). |
| `apps/bootstrap-installer/src/routes/success.tsx` | The success screen: the launch action **catches the Tauri error and surfaces it inline** ("the previous version had `onClick={() => void launchHermesDesktop()}` which swallowed the rejection and left the user staring at an unresponsive button"). |
| `apps/bootstrap-installer/src/routes/failure.tsx` | The failure screen: Retry + "Open logs" + the exact log path, with the error as muted text under the wordmark. |
| `apps/bootstrap-installer/src/components/brand-mark.tsx` | The brand badge (the `nous-girl` mark in the light squircle), with the asset path resolved against `import.meta.env.BASE_URL`. |
| `apps/bootstrap-installer/src/components/hackery-button.tsx` | The bracketed `[ LABEL ]` onboarding CTA, lifted from the desktop overlay "sans the exit-scramble choreography, which is overlay-specific". |
| `apps/bootstrap-installer/src/components/loader.tsx` | A single Fourier-flow curve ported standalone — with the trade-off stated: "cross-app coupling + bundle bloat that defeats the point of a lightweight installer". |
| `apps/bootstrap-installer/src/lib/format.ts` | `formatDuration` and `formatElapsed` — the latter has an hour rollover because a stalled overnight stage read as "744:38", "which one user understandably reported as '744 hours'". |
| `apps/bootstrap-installer/src/lib/utils.ts` | The `cn` helper (`clsx` + `twMerge`), shared by the desktop and the dashboard. |
| `apps/bootstrap-installer/src/theme.ts` | The OS appearance follower: the **window's own theme** is authoritative in Tauri (`getCurrentWindow().theme()` + `onThemeChanged`), because `prefers-color-scheme` "is not reliable across WebView2 / WebKitGTK"; the media query is only the synchronous first paint and the non-Tauri fallback. |
| `apps/bootstrap-installer/src/styles.css` | **Imports the desktop's `styles.css` wholesale** rather than re-implementing the design system (with the Tailwind-v4 `@source` re-resolution caveat spelled out), plus the installer-only fade and the Nous dark seeds mirrored from `nousTheme.darkColors`. |
| `apps/bootstrap-installer/src/vite-env.d.ts` | The Vite client types reference. |
| `apps/desktop/e2e/core/harness.ts` | The lane-private core harness: an isolated sandbox (**HOME is faked too**, "a sandbox HERMES_HOME under the real ~/.hermes would read and write the real install's profiles"), a logged-out `gh` fake on `PATH` (a real `gh` "can block on the desktop keyring for ~60 s"), the app env/launch helpers, a per-socket WebSocket recorder, a TCP proxy for dropping the primary socket, the `/proc` process census, the SQLite-backed persisted-transcript reader and the rendered-transcript reader. Its synchronisation rule: "wait on an observable fact … with a deadline — never a fixed sleep." |
| `apps/desktop/product-identity.d.cts` | The type surface of the product identity (display name, app id, pascal names, CLI name, MSIX org id, the optional R2 token, the feed channel, and the Store publisher block). |
| `apps/desktop/update-feed.cjs` | The updater-feed layout contract: `darwinFeed` validates the channel slug (and rejects Windows reserved names), and `feedBaseUrl` demands a canonical https base because the origin is baked into `app-update.yml` and "trusted by every installed client for the life of the build". |
| `apps/desktop/update-feed.d.cts` | The type surface of the feed contract (directory key, channel, manifest filename, prerelease flag). |
| `apps/desktop/tsconfig.json` | The renderer project: `strict`, with path aliases for the shared package's **subpath** exports (`@hermes/shared/ansi`, `/billing`, `/color`, `/i18n`, `/translucency`) so a surface imports one module without pulling the generated gateway contract. |
| `apps/desktop/tsconfig.electron.json` | The electron project: relaxed strictness but `composite` + declarations, including the shared modules the main process needs (`ansi`, `data-url-read-max`, `translucency`) and the two `.cjs` contracts. |
| `apps/desktop/tsconfig.e2e.json` | The e2e project: includes `e2e/`, `playwright.config.ts` and the shared `tests-js/scripts` so the specs and the mock server type-check together. |
| `apps/desktop/vitest.setup.ts` | The jsdom setup: an inert `ResizeObserver` assigned (not stubbed) so a test's `vi.unstubAllGlobals()` cannot strip it; an in-memory `localStorage` because **Node 26's own accessor returns `undefined`** and in jsdom `globalThis` IS the window; `IntersectionObserver`, `requestIdleCallback` and `CSS.supports` stubs; `IS_REACT_ACT_ENVIRONMENT`; and a 12 s `asyncUtilTimeout`. |
| `apps/desktop/vitest.run-tmp.ts` | One temp root per vitest run, removed at teardown ("one run of the `electron` project left 54 dirs behind"). |
| `apps/desktop/vitest.hermes-python.ts` | Resolves `HERMES_PYTHON` for the contracts that drive the real Python code — "resolving it may sync the Python environment, which UI-only runs must not wait for." |

## 2. Ideas worth stealing

1. **A durable, byte-level update lock shared across three languages.** `apps/bootstrap-installer/src-tauri/src/marker.rs:20` defines a marker file whose *bytes are the protocol* (`<pid>\n<started_at>\nct:<creation-time>\n[delegate:…]\n[run:…]`), shared byte-for-byte with `hermes_cli/update_lock.py` and the Electron gate, and pinned by a **shared JSON corpus** the Rust, Python and TypeScript implementations all run against. The `ct:` line turns the pid into a **process identity** so a recycled pid is not mistaken for the owner and a live owner is never aged out. — **CONVERGENT** (the same contract exists in three languages in this repo; `deepseek-harness`'s approval/lock work is the other reference).
2. **Process creation time as the liveness primitive.** `marker.rs:640` (`process_creation_time` for Linux `/proc/<pid>/stat` btime+ticks, macOS `proc_pidinfo`, Windows `GetProcessTimes`) lets a lock distinguish "this exact process" from "a process that happens to have this pid", and lets a *zombie* be correctly called dead (`marker.rs:869`) — `kill(pid, 0)` succeeds for an unreaped zombie, so a crashed updater would otherwise hold the lock for the whole age ceiling (#77259). — **UNIQUE** to this repo.
3. **A per-session replay epoch so a backend restart cannot silently swallow events.** `apps/shared/src/json-rpc-gateway.ts:150` — seq counters are in-process, so a restart resets them while the client still holds high watermarks; without the epoch check `events_since(sid, 97)` returns `[]` forever and the client "silently believes nothing was missed". — **CONVERGENT** in spirit (session-scoped epochs also appear in the two other reference repos' session model).
4. **Park live frames while a replay is in flight.** `apps/shared/src/json-rpc-gateway.ts:139` — a live frame racing the replay response is held in `replayHold` and dispatched after the gap, because dispatching it early either double-dispatches it or advances the watermark so the gap events get skipped. — **UNIQUE**.
5. **A "ladder" resolver pattern for every cross-cutting decision.** `apps/desktop/AGENTS.md` §"Cross everything as an observable ladder" — precedence as data, a candidate trusted only after it is probed, a failed *read* falls to the next rung while a failed *authoritative write* surfaces or rolls back, a missing capability is not a transient failure, retries are bounded and end in a recovery affordance, and **one resolver owns each policy**. — **CONVERGENT** (the `pi` and `deepseek-harness` repos both centralise their fallbacks; this repo just names the shape and applies it to *every* seam).
6. **Server truth is cached, not owned — six reconciliation rules.** `apps/desktop/ENGINEERING.md` §"Server truth is cached, not owned": merge don't clobber; paint optimistically then roll back visibly; guard against the past with generation counters/request tokens; only the foreground surface publishes into the shared view; coalesce cosmetic updates but flush terminal transitions; preserve reference identity on no-ops. — **UNIQUE** as a *stated* rule set.
7. **A lint rule that makes the "atom-mirrored ref" bug impossible.** `apps/desktop/eslint.config.mjs:60` bans `useEffect(() => { someRef.current = value }, [value])` with the reason inline ("A ref synced from a nanostores atom via useEffect lags the atom by one render… cancelRun sent session.interrupt to the wrong session"). A second rule bans calling a plugin's `render()` inline in JSX because the callback's hooks become the host's (React #310). — **UNIQUE**, and directly applicable to August Trading's `useEffect` + ref patterns.
8. **The "transcript oracle" pattern: one invariant, asserted after every transition.** `apps/desktop/e2e/core/oracle.ts` — every persisted message rendered exactly once and in order, nothing unpersisted rendered, the persisted assistant rows equal what the provider streamed, and the wire's concatenated deltas equal the provider's stream. Every core spec drives a different transition and then calls the *same* oracle. — **CONVERGENT** (both other repos have similar invariants; the shape here — one shared assertion function used by every scenario — is the stealable part).
9. **A merge-order-safe expected-failure marker.** `apps/desktop/e2e/core/known.ts` — instead of `test.fail()` (which turns main red the moment the fix merges) or a table of expected messages, only the **final symptom assertion** is wrapped; it is marked expected-failing at run time *only* when the failure text matches the bug's own signature, and any other failure propagates. — **UNIQUE**; a very good pattern for a repo with many known-failing trading-calculation cases.
10. **Bounded, announced abandonment instead of a silent truncation.** `apps/bootstrap-installer/src-tauri/src/powershell.rs:170` (`DRAIN_GRACE`) — the exit status comes from waiting on the **process**, never from pipe EOF, and when a descendant keeps the pipe open the drain is abandoned *and said out loud*: "a silently truncated log is indistinguishable from one that was empty." — **CONVERGENT** (Go's `exec.Cmd.WaitDelay` is the same bound).
11. **"Reject the half-built artefact before the packer sees it."** `apps/desktop/scripts/assert-dist-built.mjs` — electron-builder will happily package an app with an empty `dist/` that then blank-pages with `ERR_FILE_NOT_FOUND`; a pre-build guard turns that into one actionable line. Paired with `assert-root-install.mjs` for the hoisted-workspace case. — **CONVERGENT** in effect (both other repos have build gates); the *placement* (in `prebuild`, before clean) is the stealable detail.
12. **The packaged-artifact skew guard.** `apps/desktop/scripts/backend-ready-artifact.mjs` — the *shipped bundle* must accept both ready tokens, and the guard reads the packaged `app.asar` (not the source), because a stale artifact is invisible to every source-level test (#60772). — **UNIQUE**.
13. **A perf harness with a committed baseline and a regression gate.** `apps/desktop/scripts/perf/README.md` + `baseline.json` — one CDP client, one scenario registry, and a committed baseline so "a PR that regresses streaming/typing/mount cost fails loudly instead of silently drifting". The baseline records its measurement conditions in `_meta` (median of 5 runs, production renderer, warm code cache). — **CONVERGENT** (the other repos also gate perf; the *committed JSON baseline with stated conditions* is the stealable form).
14. **Colour measured, not thresholded; and unreadable input returns `null`, never `0`.** `apps/shared/src/color.ts:16` and `:118` — a silent `0` makes `ansi256(245)` look like pure black and passes garbage through contrast checks as if it were a real measurement; and `readableOn` **measures** both candidate inks (GitHub's `#4f9e5e` is 3.29:1 with white and 5.50:1 with near-black — a luminance threshold gets exactly that wrong). — **CONVERGENT** (all three repos have a colour module; this one is the strictest).
15. **A dark-appearing setting that means a different amount in each appearance, as a three-rung inheritance ladder.** `apps/shared/src/translucency.ts:176` — appearance slot → base → default, per key, so "unset" keeps carrying over; and a v1 flat payload migrates into `base` so an already-tuned window keeps exactly what it had. — **UNIQUE**.
16. **A weekly-rotating curated pick with a deterministic fallback chain.** `apps/shared/src/catalog-featured.ts:60` — the rotation is indexed by the wall-clock week so slide one is the same entry everywhere the pick is shown; the fallback chain is newest pictured official (30 days) → official with art and most stars; and "Nothing here reads a download or install count; the feed has none." — **UNIQUE**.
17. **A refuse-don't-clobber update claim.** `marker.rs:1000` (`publish_claim`) — the claim is published by writing a fully-written, fsynced tmp file and **hard-linking** it onto the path, so a reader never sees a torn claim and a second claimant is refused rather than truncating the first's bytes; the fallback for filesystems without hard links is an exclusive create whose brief 0-byte window readers treat as live. — **UNIQUE**.
18. **A self-heal that is explicitly narrow.** `marker.rs:558` (`should_heal_self_marker_refusal`) — the updater may clear its *own* claim and retry exactly once, and only when ALL of: the child exited with the concurrent-refusal code, the on-disk marker names **this** process (pid *and* creation time), and nothing holds the checkout lock. Any other owner, exit code or held lock leaves the refusal standing. — **UNIQUE**; a very good template for "recover from a deadlock I caused, but never from a deadlock someone else owns".

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: not in this shard.** The cron surface lives in the repo's `cron/` package and `apps/shared/src/cron-trigger-controller.ts` — and that file is the interesting part: a renderer-local interaction guard that says in its own header that **it is not the execution lock** ("Cross-window and cross-process exclusion remains the backend's responsibility via its durable cron claim; a renderer-local Set must never be treated as the execution lock"). That separation of "don't double-click" from "don't run twice" is exactly the split August Trading's automation runner needs between a UI affordance and the durable claim. The durable claim itself, catch-up after a restart, and the breaker after repeated empty runs are **not in this shard**.
- **Human-in-the-loop approval: the plumbing is here, the policy is not.** `apps/shared/src/json-rpc-channel.ts:60` (`ServerRequest`) defines the whole approval channel — a server→client request with `respond` / `fail` / a `decline` that is only sent to a backend that advertised it counts declines, a handler that throws is answered `-32603` so the backend does not wait out its 3600 s clarify deadline, and a request re-delivered after a reconnect is answered idempotently ("the first `respond` wins"). `apps/shared/src/json-rpc-gateway.ts:44` sets the client's approval deadline to **exactly the backend's own 300 s** so the client only gives up when the backend has already failed the approval closed. What survives the decision (an approval record) is in the backend shard, not here.
- **Post-mortem / reflection loops: the closest thing in this shard is the update-debt receipt.** `apps/shared/src/update-debt.ts:30` reads the *owed* post-commit work of a completed action and refuses to phrase the user-action as "re-run the update" — "a rerun does not restore it." The shape (a committed run is `success` **or** `partial`; a receipt only belongs to an action if its `action_id` matches) is a good template for a trade-log reflection loop: name the follow-up that is still owed, and never promise that a retry undoes it.
- **Multi-agent: subagents over debate, and where the value is.** The e2e specs show the agent's own multi-agent machinery (subagent spawn/progress/complete events, Bot Mode group rooms with per-member deadlines, a member whose backend fails reported "at once, not read as busy"). The shard's *stance* is visible in the docs: the gateway owns the log and the work, the Desktop renders it, and "no failed canonical mutation falls back to hidden-session submission". Debate is not present anywhere in this shard — the only multi-agent shape here is **delegation with an observable per-member state**, which is the honest answer to "where does debate add value over one agent": nowhere in this codebase.
- **Structured logs the model can query: file-per-record with a replay ring, not a database.** The gateway's event model here is a **per-session monotonic `seq`** with a bounded ring (`REPLAY_CURSOR_MAX = 256`, mirroring the backend's own 64-session limit) and a synthetic `session.replay_gap` event when the ring evicted the window. On disk, the installer keeps a rolling `bootstrap-installer.log` plus a per-run forensic `bootstrap-<timestamp>.log`, and the desktop keeps `HERMES_HOME/logs/desktop.log`. That is "JSONL-ish, append-only, one file per concern" — exactly the shape a trade log wants, and the **seq + gap-event** idea is the stealable part: a queryable log that admits when it lost something rather than pretending.
- **Staying simple as features accumulate.** `apps/desktop/AGENTS.md` §"Keep the waist narrow, grow at the edges": "The shell's internal registries are composition seams, not a public plugin ABI; do not build a universal extension system, a manifest, or a plugin adapter for a single consumer. Design a shared contract only once more than one real consumer proves its shape." Plus the whole `apps/shared` package's shape: **runtime-free modules with per-module subpath exports**, so a surface imports `fuzzy` without pulling the generated 262 KB gateway contract. And the bootstrap installer, which is deliberately a *separate app* that imports the desktop's stylesheet wholesale rather than re-implementing the design system.

## 4. Non-obvious decisions and gotchas

1. **The marker file's third line is the whole trick.** `ct:<process creation time>` makes a pid a *process identity*. Without it, a recycled pid reads as the original owner and a long-running healthy update is aged out at 20 minutes (a v1 marker still has that ceiling; a v2 one does not).
2. **A dead marker is removed ON READ, not merely ignored** — otherwise the stale bytes keep failing every acquire until the age ceiling expires.
3. **A 0-byte marker younger than 5 seconds is a claim in flight** (live, pid 0, never deleted) — it is the window between an exclusive create and its first write.
4. **`ERROR_ACCESS_DENIED` on Windows means ALIVE**, not dead: the process exists but is elevated or owned by another user, and "racing an elevated updater is worse than postponing".
5. **The `hermes update` child is told its parent's pid** (`HERMES_UPDATE_HANDOFF_PID`) so it recognises the live holder as its own orchestrator — without it every GUI update refuses its own parent's lock with exit 2.
6. **The update marker is released BEFORE the relaunch**, not on exit: a native event loop can outlive `app.exit(0)`, and a live pid on a fresh marker makes a *successful* update look active forever (v2 markers have no age ceiling).
7. **The heartbeat deadline is measured against the last ping we *sent*, not the last frame received** — a hidden Chromium window spaces ticks 60 s apart, so the naive rule kills every idle hidden socket.
8. **`'response'` vs `'any-inbound'` heartbeat liveness is a mode, not a setting**: the TUI requires a pong, the desktop/web count a streamed delta as life.
9. **The client's approval timeout must equal the backend's approval window** (300 s). A shorter client timeout races it: the frontend shows "request timed out" on a card the backend already resolved.
10. **`skillInvocationText` exists on the client as a byte-for-byte twin of the server's markers** so a UI talking to an older gateway still renders `/work fix the leak` instead of the expanded skill body.
11. **`stripAnsi` must run at the event boundary, and the *raw* bytes must still reach the disk log** — the UI is plain text, the log is forensic.
12. **CP1252, not Latin-1** — `0x91`/`0x92` are curly quotes under Windows-1252 but C1 controls under Latin-1; `BufReader::lines()` also aborts the line at the first accented byte, which truncated a Portuguese PowerShell error to "No".
13. **`BufReader::lines()` is banned in the installer**, and the read buffer is *not* cleared on entry, because a dropped future inside `select!` has already appended consumed bytes.
14. **Windows resolves PowerShell by absolute path**, because Windows silently drops PATH entries once the variable grows past its length limit and the spawn then dies before `install.ps1` ever runs — the installer stalls at "0 of 0 steps".
15. **The bootstrapped `.ps1` is cached WITH a UTF-8 BOM** (the `.sh` without one — a BOM breaks `#!/usr/bin/env bash`): PowerShell 5.1 reads a BOM-less `.ps1` in the system ANSI code page.
16. **The install script is always re-downloaded** — a stale script drives a tree it predates.
17. **A build that cannot resolve an install-script pin panics** rather than shipping a binary that fails at runtime.
18. **The Windows app manifest must declare `asInvoker`**, or the product name "Hermes Setup" trips Windows's installer-detection heuristic and `CreateProcess` fails with `ERROR_ELEVATION_REQUIRED` (740).
19. **`HERMES_HOME` vs the profile-tree ROOT are different paths** — host-wide state (the update marker) lives at the root; a `profiles/<name>` home resolves back to it, so a profile-scoped home cannot split the lock.
20. **The macOS "already installed" fast path must run BEFORE AppKit** — entering the regular activation policy registers the bootstrap process as a Dock app, and since the real desktop is a different bundle id, that registration is a second Hermes icon.
21. **In macOS the relaunch target must be the `.app` bundle**, not `Contents/MacOS/Hermes` — `open` relaunches the bundle and the updater `ditto`s over it.
22. **A bundle swap must roll back**: the invariant is "on ANY failure path, `target` is left pointing at a working bundle".
23. **The app's colour is measured, not thresholded**, and the ladder's *float sequence* is load-bearing (the shipped `--dt-primary-solid` values are derived from an accumulating loop, and the tests pin byte-identical outputs).
24. **`ensureContrast` normalises a pathological `step`** (NaN, Infinity, ≤0, denormals) back to the default 0.2 ladder, and the loop terminates for every JavaScript number.
25. **The slash-command argument is `[\s\S]*`, not `.*`** — a `.*$` regex fails the whole match on any newline, so every multiline slash command parsed as an empty name and was swallowed.
26. **The renderer's i18n `unflatten` uses the base catalog as a guide** so a dotted leaf key round-trips, and a flat key that collides with an earlier branch is dropped rather than clobbering it.
27. **`compactNumber` puts the thresholds just under the unit boundary** (999_950, 999.5) so rounding can never produce "1000k".
28. **`(string & {})` on a refund-code union is fine; on an object union it is fatal** — it makes the discriminant non-literal and defeats narrowing for every arm. A compile-time-only test file exists solely to keep that honest.
29. **`vite.config.ts` pins an empty PostCSS plugin list** — otherwise `postcss-load-config` walks *up* the filesystem and picks up a stray Tailwind v3 config, failing the build with "`@layer base` is used but no matching `@tailwind base` directive is present."
30. **The React Compiler pass is filtered to React-bearing modules** — the default filter matches every TS module ("~1.5k source files" parsed instead of "~750").
31. **`@tanstack/react-query` is chunked WITH react** — it carries module-level context, and splitting it produced two react-query runtimes and a blank launch path (#95560).
32. **`react` and `react-dom` are resolved from the workspace, not the hoisted root** — a split pair throws "Minified React error #527" *before the first paint*.
33. **The exe identity stamp must run in `afterExtract`, not `afterPack`** — ASAR integrity rebuilds the PE with resedit afterwards and rcedit cannot commit to that.
34. **The MSIX version is baked into the manifest template and `setBuildNumber: false`** — the builder's own override would stamp a second, conflicting version.
35. **Windows MSIX must keep write virtualisation disabled** — Hermes state in `%LOCALAPPDATA%` is deliberately shared with the unpackaged CLI, and a package-private AppData view would split the user's state between the Store and sideloaded builds.
36. **`persist:` partition names must contain nothing Electron percent-escapes** — a `%3A` becomes a cookie store Windows can neither read nor write, so the session silently never persists.
37. **The install/update e2e lane refuses to run where an update could reach the developer's own Hermes** — `hermes update --gateway` stops gateways it can see, so locally the suite must run in its own PID namespace.
38. **The visual-snapshot lane reports diffs but does not fail on them**, with a 1 % pixel budget; the **core** lane has `retries: 0` and the general lane has `forbidOnly` in CI — "a stray `test.only` must never let CI report a partial green run".
39. **`reducedMotion: 'reduce'` is forced** in Playwright so a screenshot never catches an overlay mid-fade.
40. **`npm run typecheck` covers four projects** — the renderer, the electron main, the e2e project *and* `electron-builder.config.cjs` (via `--ignoreConfig --allowJs --checkJs`), because the packaging config is a plain CJS file in a TS repo and used to rot silently.

## 5. Weak spots

1. **The installer's complexity is enormous for what it does, and it is all in one place.** `marker.rs` + `update.rs` + `bootstrap.rs` + `powershell.rs` is ~1,900 lines of Rust for "download a script, run it, write a receipt" — the marker protocol alone re-implements process identity, cross-platform liveness probing, kernel locking on two platforms, hard-link publishing, tmp-litter sweeping and a CAS delete. It is *well* documented and *well* tested, but the reader has to hold a five-implementation contract (Rust + Python + TS) in their head to change it safely, and the failure mode of getting it wrong is "every future update is wedged" rather than a crash.
2. **`apps/shared/src/session-http-mutations.ts` is the least maintainable file in the shard.** ~70 lines of semicolon-free, deeply nested code with a 12-error-code regex deciding whether a precondition may be refreshed. It is the most valuable logic in the file (the CAS-on-revision protocol) and the hardest to read; a named error enum would serve better than a regex.
3. **The desktop's "one source per concern" rules are enforced by convention, not by tooling, in the places that matter most.** The eslint config fences the *plugin* boundary beautifully and bans two React antipatterns — but the same file has no rule against a second `Button`/`Loader`/`ErrorState`, and `DESIGN.md`'s own checklist ("Reuse a primitive… Fork one?") is a document, not a gate. `apps/bootstrap-installer/src/components/button.tsx` is literally a *copy* of the desktop's button, with the drift risk noted in a comment rather than prevented.
4. **The build/packaging surface is enormous and only partly specified.** ~120 scripts under `apps/desktop/scripts/`, many with paired `.test.mjs` files, but the *contract between them* (the ordering rules that matter — "sign after rcedit", "refresh digests before the outer seal, never in `afterSign`") lives in prose comments scattered across a dozen files. There is no single ordering table, and `BUILDING.md` explicitly says the release gate lives elsewhere.
5. **Two long-lived "TODO as policy" behaviours are enforced by prose, not code.** The `apps/desktop/AGENTS.md` rules about "never navigate because something happened in the background" and "one cancel gesture does one thing" are exactly the kind of rule that decays; nothing in the repo enforces them, and the `render-probe`-style gate that exists in August Trading has no counterpart here.
6. **The e2e lanes are heavy.** The core lane boots a real Electron app, a real `hermes serve` and a scripted provider per scenario; the install/update lane builds a real install once per run (minutes) and requires a PID namespace locally. The correctness payoff is real, but the feedback loop is long enough that contributors will skip it — which is why the "known failure" marker and the "gate signature" mechanism exist at all.





