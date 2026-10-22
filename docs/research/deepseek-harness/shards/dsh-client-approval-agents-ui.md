# deepseek-harness :: dsh-client-approval-agents-ui

**Files in shard:** 283 — **read: 273, skipped: 10** (every skip is a `generated-vendored` bilingual-hash record; see §1 Tier 3)
**What this shard covers:** eleven client-side UI plugin packages of the DeepSeek Harness monorepo — `ui-agent-preset`, `ui-approval`, `ui-goal`, `ui-jobs`, `ui-plan`, `ui-schedule`, `ui-skill`, `ui-subagent`, `ui-user-questions`, `ui-workflow-run` — i.e. the browser half of the harness: the surfaces a person sees, the small controller stores behind them, and their registration wiring. Everything here is a *view* over host state reached through `ctx.remote.*`; the packages themselves own no agent runtime, no tool dispatch and no persistence. The two themes that recur are (a) a strict separation between a **choice** (offered before something exists) and a **label** (reporting what already exists), and (b) human-in-the-loop gating implemented as a refusal-shaped error value rather than an exception.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/client/ui-agent-preset/src/client/seat-store.ts`
- **Purpose:** the controller behind the "new-session" agent-preset chip: it decides which preset the **next** session will run, and stages a pick until a session exists to receive it.
- **Key abstractions:** `AgentPresetSeatState` (snapshot: `options`, `current`, `error`, `busy`, `introduce`), `AgentPresetStage` (the mutable one-shot pick), `AgentPresetSeatController` (`seat-store.ts:54`) with `load()` `:92`, `select()` `:129`, `stage()` `:146`, `dismissRefusal()` `:155`, `blankSessionId()` `:165`, `syncBlankSession()` `:177`, `introduced()` `:189`, `apply()` `:203`.
- **Data flow:** `ctx.remote.agentPresets.list` → roster → `presetOptions()` (broken entries filtered out) → snapshot; a pick calls `ctx.remote.agentPresets.select(session.id, staged)` → `{ok}` or a refusal object.
- **Non-obvious design decisions:**
  - The chip **stages** rather than applies: `select()` writes nothing when no session exists yet (`seat-store.ts:129` → `apply()` returns early at `:212`). The stage is *consumed exactly once* by `apply()` (`clearStage()` at `:216`), because every later session-list movement calls `apply()` again.
  - A pick is dropped (not sent) when the session is no longer `blank` or already runs that preset (`seat-store.ts:214`) — the host refuses mid-conversation swaps, so the client never even asks.
  - A refusal keeps the **preset** alongside the reason (`error: {preset, reason}`, `:25`), so the banner can name the preset it refused; `dismissRefusal()` (`:155`) downgrades the object to a bare string, and only if it is *still* the current error — a newer attempt is not dismissed by an older toast.
  - `load()` uses a **generation counter** (`loadGeneration`, `:81`) so only the newest overlapping roster read may publish; an older reply is dropped.
  - `apply()` sets `busy` for the whole round trip and uses `Promise.withResolvers` (`pendingSelection`) so `syncBlankSession()` can wait for a pending Settings write before deciding.
- **Edge cases & failure handling:** a failed roster read keeps the previous options and only sets `error`; a failed switch restores the session's real preset rather than leaving the optimistic one (`refuse()` at `:220`); a thrown error is stringified; `apply()` is a no-op when `busy` is set, so a double click cannot double-switch.
- **Surprising:** the *load* path also calls `apply()` (`:126`) — a roster refresh can discover a blank session that can absorb an already-staged pick.

#### `packages/client/ui-agent-preset/src/client/section-store.ts`
- **Purpose:** the Settings-side roster controller: list presets, set the default, and read one preset's declared composition for a read-only viewer.
- **Key abstractions:** `AgentPresetSectionController` (`section-store.ts:30`), `AgentPresetSectionState`, `PresetView` (`{id, title, content}`).
- **Data flow:** `ctx.remote.agentPresets.list` → `rows`; `ctx.remote.agentPresets.read(id)` → `view.content`; `ctx.remote.settings.update('agent-preset-registry', {selectedDefault})` → default change.
- **Non-obvious design decisions:**
  - `load()` is **coalesced**: `this.loading ??= this.readRoster().finally(...)` (`:43`) so two mounts share one read.
  - The viewer read is **generation-guarded** (`viewRequest`, `:34`): a read that settles after `closeView()` or after a newer read is ignored (`:58-68`). This is why "a late read does not reopen the viewer".
  - `reconcileCodingTools(shouldReset)` (`:85`) is a **conditional correction**: it is handed a *predicate* rather than a value, and re-evaluates the predicate after every await, so a toggle that flips back while the correction waits aborts the write (`:87`, `:93`).
  - The correction is fenced by the host's `revision` (`:101`) and refuses to write when the settings form is not `ready`/`writable` (`:100`).
- **Edge cases & failure handling:** a failed roster read sets `status:'error'` and keeps the last rows visible; a failed `view` leaves the viewer closed and puts the message in `error`; `save()` is guarded by `saving` so a second write cannot start (`:107`); a failed blank-session sync is reported as the section error (`:114`).
- **Surprising:** the correction only ever falls back to `standard`, and only when `standard` itself is healthy; if `standard` is broken the default is left alone and an error is shown (`:104-108`).

#### `packages/client/ui-agent-preset/src/client/settings-store.ts`
- **Purpose:** the shared roster store used by every *display-only* surface, plus the single writer for the "new task default" setting.
- **Key abstractions:** `readRoster()` (`:70`), `beginRosterRead()` (`:91`), `presetOptions()` (`:119`), `writeDefaultPreset()` (`:30`), `requiresCodingTools()` (`:53`), `AgentPresetSettingsController` (`:143`), `AGENT_PRESET_SETTINGS_NS` (`:17`).
- **Data flow:** `ctx.remote.agentPresets.list` → `RosterRead`; `ctx.remote.settings.update` → default.
- **Non-obvious design decisions:**
  - An **unavailable optional namespace** (`gateway/invocation-unavailable`) is translated into an *empty roster*, not an error (`settings-store.ts:74`) — "this deployment composes no presets" is a valid deployment.
  - `presetOptions()` drops broken presets from the *pickers* but the Settings section shows them from its own store — the rationale is in the comment at `:104-112`: offering a broken preset would defer the discovery of that fact to a failed session start.
  - `exactOptionalPropertyTypes` is why the mapping uses the spread dance (`...preset.name === undefined ? {} : {name: preset.name}`) so "absent" and "present as undefined" stay different shapes (`:120-123`).
- **Edge cases & failure handling:** `beginRosterRead` refuses a read while one is in flight and returns `undefined` so the caller returns without touching its snapshot (`:91-100`); a roster failure sets `status:'error'` with the host message.
- **Surprising:** `AgentPresetSettingsController.load()` maps an *empty* roster to `status:'unavailable'` (not `'ready'` with zero options) — the surfaces then render nothing at all (`:166-170`).

#### `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx`
- **Purpose:** the chip on the new-session screen that names and picks the preset the next session will run.
- **Key abstractions:** `AgentPresetSeatInjected` (`:29`), `AgentPresetSeatProps` (`:71`), the four intro-timing constants (`:52-55`), `REFUSAL_HOLD_MS = 8000` (`:58`), `introStaggerMs()` (`:62`).
- **Data flow:** `useAgentPresetSeat` snapshot → options/current/busy/error; `select(id)` → host; host refusal → `state.error` object → `Toast`.
- **Non-obvious design decisions:**
  - The control lives on the **new-session** screen, not in the composer, because the choice is only valid before the first turn (header comment `:1-12`) — "a control that spends most of its life disabled belongs on the screen where it still works".
  - Options that require the Coding Tools preference are filtered out of the menu (`:107-109`), and the menu **closes** when the preference flips (`:110-112`).
  - The "introduce" cue is a per-character staggered fade with **two caps**: a per-tick cap (`40ms`) and a shared reveal window (`200ms`) so a long Latin name takes the same time as its CJK counterpart (`introStaggerMs`, `:62`). `prefers-reduced-motion` skips the run entirely and acknowledges immediately (`:127-131`).
  - The refusal banner is anchored by **page query** to `[data-composer-card]` rather than `closest()` — the chip sits *above* the composer card, not inside it (`:194-199`).
  - The toast is keyed by an incrementing `seq` so picking the same broken preset twice **replays** the banner instead of leaving the first one silently in place (`:88-92`).
- **Edge cases & failure handling:** the chip renders nothing until the roster arrives (`ready` requires `options.length > 0 && current !== ''`, `:118`); it renders nothing at all outside the main view (`retainedBy.mainView > 0`, `:100`); a refused switch falls back to the session's real preset.
- **Surprising:** `state.current` is set *optimistically* to the picked id before the host answers — so the label shows the intent immediately and reverts on refusal.

#### `packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx`
- **Purpose:** the Settings section: built-in vs custom card groups, set-as-default, a read-only composition viewer, and the entry into Creator mode.
- **Key abstractions:** `AgentPresetSectionInjected` (`:16`), `AgentPresetSectionProps` (`:32`), `CardDescription` (`:34`, a clipping-aware tooltip).
- **Data flow:** `useAgentPresetSection` snapshot → `rows`/`view`/`saving`; `makeDefault(id)` → host write; `view(id)` → YAML.
- **Non-obvious design decisions:**
  - The **card body** is the control that picks the preset, and it is `aria-pressed`-style (`:114`); the default card's button is *disabled* but a broken card's is `aria-disabled` (not disabled) so a keyboard user can still focus it and read the diagnostic (`:113-115`, `:127-130`).
  - A broken preset's reason is exposed **three ways**: a hover/focus tooltip (`.brokenTip`, in CSS), a visually-hidden `role="alert"` node (`:135-137`), and the card's accessible name — because a pointer and a screen reader each need a different route.
  - The description is clamped to 4 lines with `-webkit-line-clamp` and the *full* text stays in the DOM; a tooltip is offered **only when the text is actually clipped**, measured with a `ResizeObserver` (`:37-52`).
  - The viewer is a `<pre>` of the declared YAML — no editor — and the section's `Modal` handles `Escape` itself so it closes only the viewer, not the Settings dialog behind it (`:151-158`).
  - The group loop is `([true, false] as const).map(builtIn => …)` and an empty group is **omitted entirely**, except the custom group, which keeps its Creator entry on screen (`:104-113`).
- **Edge cases & failure handling:** `closeView()` is called on unmount through a ref (`closeViewOnUnmount`, `:77-78`) so the viewer never outlives the section; a roster error is shown *above* the roster, not instead of it (`:85`); the Creator button is disabled while `saving` (`:95`).
- **Surprising:** the section shows presets the pickers hide (broken ones), and it is the only surface that writes the default — General settings deliberately carries no duplicate control (see `index.ts:1-18`).

#### `packages/client/ui-agent-preset/src/client/PresetGuideDialog.tsx`
- **Purpose:** a read-only two-tab help reader for the four *shipped* presets.
- **Key abstractions:** `PresetGuidePage` (`:9`), the `guides` Map (`:19`), `presetGuide(id, trust)` (`:32`), `trapPresetReaderTab(event)` (`:39`), `PresetGuideDialog` (`:87`), `GuideUsage` (`:51`).
- **Data flow:** locale key → markdown → `MarkdownText`; the usage page is split on `^### ` headings into per-example sections (`:58-70`).
- **Non-obvious design decisions:**
  - `presetGuide()` returns a guide **only for `trust === 'system'`** (`:32-36`): a custom preset owns its own capability claims, so the shipped copy must not be attached to it.
  - The dialog traps Tab itself (`:39-50`) rather than relying on the modal, because it sits *above* Settings and "Escape must dismiss only this layer" (`:99-107`).
  - Both tab panels are rendered and the inactive one is `hidden` (`:115-125`), so each page keeps its own scroll position.
- **Edge cases & failure handling:** the initial focus lands on the selected tab (`:97-99`); the close button returns focus to the trigger that opened the dialog (the caller keeps the ref).
- **Surprising:** the guide copy is *bilingual markdown in source*, not a locale JSON — it is prose with headings and blockquotes, so it lives in `guide-locales.ts`.

#### `packages/client/ui-agent-preset/src/client/index.ts`
- **Purpose:** the browser-half registration: wires the three surfaces, the Add-plugin menu item, the Settings row, and the roster refresh loop.
- **Key abstractions:** `inject` (`:64`), `apply(ctx)` (`:72`), plus the re-exported types (`:55-60`).
- **Data flow:** `ctx.remote` / `ctx.configForms` / `ctx.sessions` / `ctx.locale` / `ctx.slots` → three snapshot stores → three React surfaces.
- **Non-obvious design decisions:**
  - One `apply` registers four surfaces; each *defers* until the slot it fills has been declared (slot registry semantics).
  - Seats are keyed by **Provider binding** in a `WeakMapWithValues<SessionBinding, AgentPresetSeatController>` (`:80`) and each binding subscribes to the session list to re-`apply()` (`:92`).
  - A shared mutable `staged` object (`AgentPresetStage`) is passed to every seat controller, so a pick staged on one screen lands on whichever seat becomes current (`:79`, `:83`).
  - The refresh effect is a **request counter + coalescing promise** (`:127-141`): an invalidation arriving while a correction is pending re-runs the correction with the newest values instead of queueing a stale one.
  - `refresh()` is wired to both `settings/document-updated` for the preset namespace and `connection/reset` (`:146-151`).
  - The section is registered with `order: 20` — "after Models: choosing a model is routine, and composing an agent is the deployment-shaping act behind it" (`:239-243`).
- **Edge cases & failure handling:** on disposal all bound seat subscriptions are disposed (`:76-78`); the Developer-tools subscription clears the shared stage before any apply can compose a hidden preset (`:112-119`).
- **Surprising:** `startCreatorDraft()` calls `scope.uiWorkspace.startSession(undefined, {clearPreviousDraft: false, agentPreset: 'cordis'})` — the *host* composes the session; the client only stages the chip display (`:176-180`).

#### `packages/client/ui-agent-preset/src/client/AgentPresetLabel.tsx`
- **Purpose:** the session header's read-only badge naming the preset the session actually runs.
- **Key abstractions:** `AgentPresetLabelInjected` (`:24`), `AgentPresetLabelProps` (`:31`).
- **Data flow:** `useSessions` → `projectionValues.agentPreset` (the authoritative id); `useAgentPresets` → the roster (display name only).
- **Non-obvious design decisions:**
  - It is **read-only by construction** (header comment `:1-9`): "a control here would promise a switch the host refuses".
  - The roster is only fetched once the session reports a preset (`:48-52`) — a deployment with no presets pays nothing.
  - The label shows the **id** until the roster resolves the name (`:56-60`), because the session summary is the authority on *which* preset, and the roster only supplies *what it is called*.
- **Edge cases & failure handling:** a session with no recorded preset renders `null` and triggers no roster read (`:53`).
- **Surprising:** the CSS hides the whole label below a 540px container width — "the preset is passive chrome, so it yields before any interactive header action loses its label" (`AgentPresetLabel.module.css:26-31`).

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-agent-preset/src/client/locales.ts` | EN/ZH copy for the three surfaces + the locale-key union; re-exports the shared `isBuiltInPreset`/`presetDisplayText` fold so all surfaces read one path. |
| `packages/client/ui-agent-preset/src/client/guide-locales.ts` | The long-form bilingual help (mode explanation + usage examples) for `standard`, `ptc`, `minimal`, `cordis`, kept apart from the short picker copy. |
| `packages/client/ui-agent-preset/src/client/CreatePluginMenuItem.tsx` | Adds "let the agent create a plugin" to the Plugins page's Add-plugin menu; disabled with a *reason* while the roster loads or Creator is missing. |
| `packages/client/ui-agent-preset/src/client/AgentPresetLabel.module.css` | Header badge; a container query drops the label below 540px so it yields before interactive actions. |
| `packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css` | Chip geometry, the introduce-cue keyframes, `prefers-reduced-motion` fallbacks, and the menu row's name-over-description layout. |
| `packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css` | Card grid, the broken-preset border/badge/tooltip, the 4-line description clamp, the dashed Creator entry. |
| `packages/client/ui-agent-preset/src/client/CreatePluginMenuItem.module.css` | Two-line clamped description under the menu item's label. |
| `packages/client/ui-agent-preset/src/client/PresetGuideDialog.module.css` | Fixed-height guide layout with independently scrolling tab panels. |
| `packages/client/ui-agent-preset/src/index.ts` | The node half: an empty `apply()` so the package appears in the host Loader. |
| `packages/client/ui-agent-preset/src/css-modules.d.ts` | `*.module.css` declaration. |
| `packages/client/ui-agent-preset/package.json` | `dsh.client.inject` lists the nine services this plugin requires; exports `./client` for the browser half. |
| `packages/client/ui-agent-preset/tsconfig.json` | Project references to every sibling package it imports (the monorepo's type-level dependency graph). |
| `packages/client/ui-agent-preset/tsdown.config.ts` | One-line bundle config shared by all client packages. |
| `packages/client/ui-agent-preset/locale/en.json` | Package title only. |
| `packages/client/ui-agent-preset/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-agent-preset/README.md` | The behavioural spec of the package in prose: what the settings row, the Creator entry, the Coding-Tools gate and the viewer's Escape/focus rules actually do. |
| `packages/client/ui-agent-preset/README.zh.md` | The Chinese mirror of the same spec. |
| `packages/client/ui-agent-preset/tests/apply.client.spec.ts` | 1387-line registration spec: slot deferral, roster refresh on settings-push and reconnect, blank-session sync, the Coding-Tools default correction (once, never restored), the Creator flow, and the seat controller's reconciliation matrix. Read as head + full `describe/it` inventory. |
| `packages/client/ui-agent-preset/tests/components.client.spec.tsx` | The chip and the header label: menu contents under Developer-tools on/off, the refuse-banner lifetime, the introduce-cue stagger math (150/200/400ms), and the header label's id-before-name fallback. |
| `packages/client/ui-agent-preset/tests/create-plugin-menu-item.client.spec.tsx` | The Add-plugin entry: dismiss-before-navigate ordering, disabled reasons per roster status, and DOM-node identity preserved across ready→loading→ready. |
| `packages/client/ui-agent-preset/tests/locales.client.spec.ts` | The display fold: shipped presets get localized copy, named/unknown presets keep their declared metadata untranslated. |
| `packages/client/ui-agent-preset/tests/section-store.client.spec.ts` | Roster reads coalesced to one call; late reads ignored; the Coding-Tools correction matrix (which defaults are preserved, which are reset, what happens when `standard` is broken). |
| `packages/client/ui-agent-preset/tests/section.client.spec.tsx` | The settings section: group omission, Creator-entry rules, the broken card's `aria-disabled` focusability, the Escape-inside-the-viewer trap, the guide dialog's focus return, and the clipped-description tooltip. |
| `packages/client/ui-agent-preset/tests/settings-store.client.spec.ts` | The roster store (empty ≠ error, unavailable namespace ≠ error) and the seat controller's stage lifecycle (spent once, dropped against a started session, restored after a refusal). |

### Tier 3 — skipped with a reason
- `packages/client/ui-agent-preset/README.i18n.yaml` — generated bilingual-parity hash record (one hash per heading section); peeked the head to confirm its shape, not read line by line.


---

### `packages/client/ui-approval` — the human-in-the-loop approval surface

#### `packages/client/ui-approval/src/client/contract/slots.ts`
- **Purpose:** the contract layer of the approval surface: what a Host approval request looks like on the wire, and the one class (`PendingApproval`) that represents a pending decision to the UI.
- **Key abstractions:** `ApprovalPresentationRequest` (`:52`), `ApprovalDecision = 'allowed-once' | 'rejected'` (`:66`), `PendingApproval` (`:74`), `ApprovalDetailOwnerProps` (`:46`), `ApprovalComposerProps` (`:189`).
- **Data flow:** Host `approval/request` Remote Event → `PendingApproval` → the session's pending-interaction registry → the composer slot's `select()` → the panel → `pending.answer(outcome)` → resolves the promise the Host listener is awaiting.
- **Non-obvious design decisions:**
  - The **decision is a promise, not a callback**: `result: Promise<ApprovalDecision>` (`:95`) is the value the Host's waterfall listener awaits. The UI never calls the Host directly.
  - `delegate()` (`:145`) rejects with a private `Symbol` (`:92`) rather than a value; `isDelegation(reason)` (`:155`) lets the *next* listener in the chain take the request instead of this one erroring. This is a **middleware chain**, not a single consumer.
  - The class is **one-shot**: `finish()` (`:168`) throws `pending approval … is already settled` on a second settle, and `answerable` (`:128`) is the flag the panel reads.
  - `settlePendingComposer()` (`:10`) wraps a non-`Error` settlement failure into `new Error(failureMessage, {cause: error})` so the caller always sees a stack.
  - The `AbortSignal` is consumed in the constructor (`:112-124`), including the already-aborted case, and its listener is removed on settle (`:169-171`).
- **Edge cases & failure handling:** an aborted request rejects the result with the signal's reason or a stable fallback message; `abort()` after settling is a no-op; the abort listener is removed so a long-lived request does not leak a listener.
- **Surprising:** `reason` and `displayReason` are **separate fields** — `reason` is the audit reason and `displayReason` is the localized presentation copy. The README says the audit reason is never rewritten by the UI language.

#### `packages/client/ui-approval/src/client/index.ts`
- **Purpose:** the browser-half registration: install the dictionary, register the composer takeover, and consume the Host's `approval/request` waterfall.
- **Key abstractions:** `inject = ['sessions','remote','uiSession','slots','locale']` (`:25`), `answerApproval()` (`:41`), `apply(ctx)` (`:77`).
- **Data flow:** `ctx.remote.$on('approval/request', handler)` → `ctx.sessions.scopeOf(owner)` → `new PendingApproval(...)` → `ctx.uiSession.registerPendingInteraction(pending, delegate)` → the composer's `select()` picks it up → the panel renders.
- **Non-obvious design decisions:**
  - The composer slot is registered with **`priority: 1`** and a `select` predicate that matches only a `PendingApproval` instance (`:88-91`) — the approval surface *takes over* the composer, it does not add a widget next to it.
  - The plugin registers **two fixed shortcuts** (`Enter` → allow-once, `Esc` → reject) while it is mounted (`:81-90`), so the keys cannot be re-bound to an editable shortcut while an approval is pending.
  - A request with **no agent scope** is delegated straight to `next()` (`:43-44`) — an unscoped request is not this consumer's business.
  - The optional-detail slot is declared as a **child** of the composer slot (`:94`), so the detail renderer is scoped to the session and can correlate on `callId`.
- **Edge cases & failure handling:** the pending interaction is removed in a `finally` (`:73-76`); a delegation rejection re-throws to the next listener; the plugin's registrations are released with the fiber (HMR safety).
- **Surprising:** the file carries a `jscpd:ignore` band around `answerApproval` — a deliberate copy of the Question package's identical lifecycle, with a comment saying the duplication is intentional ("Approval and Question intentionally own independent pending-settlement lifecycles", `contract/slots.ts:9`).

#### `packages/client/ui-approval/src/client/ApprovalPanel.tsx`
- **Purpose:** the composer takeover UI: a warning-strip card with the reason, optional Tool detail, and Reject / Allow-once buttons.
- **Key abstractions:** `ApprovalPanel` (`:12`), the inner `ApprovalFlow` (`:21`).
- **Data flow:** `props.matched` (the `PendingApproval`) → `props.renderSlot('conversation.approval.detail', {callId})` → the card; `props.resolveReason(props.matched.displayReason)` → the localized headline.
- **Non-obvious design decisions:**
  - **Enter/Escape are keyboard answers** on the focused detail region (`:44-58`) — but only when the focus is *inside the approval region*, not in an input, and not on a button (so Enter on the Reject button keeps its native meaning).
  - IME is handled explicitly: `event.nativeEvent.isComposing`, `keyCode === 229`, `composing.current` and `compositionEnded.current` (`:52-56`) — a CJK user typing a confirmation never accidentally approves.
  - The keyboard and the buttons share **one lock**: `waiting.current` (`:30`) plus `pending.answerable` (`:31`), so a click and a keypress cannot both submit.
  - A failed answer **unlocks** the buttons (`:36-40`) — but only if the request is still answerable, so a late failure cannot unlock a *replacement* request.
- **Edge cases & failure handling:** `aria-busy` marks the answered state; both buttons are disabled after an answer; the detail slot is skipped entirely when the request carries no `callId`.
- **Surprising:** the reason shown is `displayReason` when present and the raw `reason` otherwise — but the raw `reason` is the *audit* string, and the panel prefers the localized copy.

### `packages/client/ui-goal` — the goal strip (long-running work, surfaced)

#### `packages/client/ui-goal/src/client/GoalBar.tsx`
- **Purpose:** the composer-docked strip that shows the session's current goal (glyph, phase label, truncated objective) and offers pause / resume / edit / clear.
- **Key abstractions:** `GoalBarProps` (`:22`), `PHASE_LABELS` (`:30`), `activeLabel()` (`:37`), `GoalBar` (`:42`), `GoalDock` (`:184`).
- **Data flow:** `useProjection('goal')` → the durable goal; `useGoalActivation` → the process-local activation; the four verbs → `ctx.remote.goals.*`.
- **Non-obvious design decisions:**
  - Three distinct absences are rendered the same way — **loading (`undefined`), no goal (`null`), and complete** all render nothing (`:73`) — and a *locally cleared* goal is suppressed until the projection catches up (`:73`, `clearedGoalId`).
  - The strip **single-flights mutations with a ref**, not just disabled state (`:58-60`): "React state disables the controls on the next render; the ref closes the same-render window so rapid clicks cannot submit the same CAS twice."
  - A **new goal identity invalidates the local edit draft** (`:52-56`) — otherwise a surviving draft's Enter would write over the *new* goal.
  - The edit form saves only on a non-empty trimmed draft (`:63-65`); a blank Enter neither saves nor closes the form.
  - `armed` vs `disarmed` activation decides which action is offered: an active-but-disarmed goal offers **resume**, not pause (`:139-141`).
- **Edge cases & failure handling:** a rejected mutation is shown inline as `message (code)` (`:63`) and the draft survives so the user can retry (`:66`); a failed clear does **not** hide the goal.
- **Surprising:** the strip owns no store and no cross-plugin cache — the durable value arrives from the session projection and the live activation from a registrant-private hook, so two different transports meet in one 36px strip.

#### `packages/client/ui-goal/src/client/activation-source.ts`
- **Purpose:** the private observable that reconciles a *durable* goal projection with a *process-local* activation state, over three asynchronous sources.
- **Key abstractions:** `GoalActivationDeps` (`:11`), `sameSnapshot()` (`:25`), `activeRef()` (`:30`), `createGoalActivationSource()` (`:41`).
- **Data flow:** projection subscription + session-running subscription + `goal/activation-changed` event + `connection/reset` → epoch counters → `getGoal()` → `publish()` → subscribers.
- **Non-obvious design decisions:**
  - **Three epochs** (`eventEpoch`, `projectionEpoch`, `readEpoch`) invalidate in-flight reads (`:47-49`, `:66-70`): a stale HTTP read cannot overwrite a newer activation edge.
  - A running-state change **refreshes without clearing** the last known activation (`:104-106`) — the strip keeps showing "paused" until the authoritative read lands.
  - A failed read is logged and leaves the projection and the last activation untouched (`:74-79`, `:114-116`).
  - The source **subscribes only while somebody observes it** (`subscriptions` counter, `:120-133`) — unmount releases the Remote event, projection, running-snapshot and reset listeners.
  - `publish()` is value-compared (`:25-27`), so an unchanged snapshot never notifies.
- **Edge cases & failure handling:** an `undefined` goal from the read clears the activation only if the projection also says there is no active goal (`:71-74`); a connection reset restarts the read.
- **Surprising:** `goal/activation-changed` bumps `readEpoch` *before* publishing, so a read that was already in flight is discarded rather than racing the event.

#### `packages/client/ui-goal/src/client/index.ts`
- **Purpose:** the plugin registration: the dock entry, the command-input projection, the command reference rule, and the four mutation verbs.
- **Key abstractions:** `inject` (`:64`), `apply(ctx)` (`:70`), `refOf()` (`:88`), `noCurrentGoal` (`:96`).
- **Data flow:** slot inject → `createGoalActivationSource` → the four verbs → `ctx.remote.goals.edit/pause/resume/clear(sessionId, ref, …)`.
- **Non-obvious design decisions:**
  - The CAS ref is read **at call time** from the session's current projected value (`:88-95`), with **no client-side staleness fence** — the RPC's compare-and-set is the guard (comment at `:87`).
  - A missing projection short-circuits to a local failure `{code:'no-current-goal'}` **without touching the wire** (`:96-99`, `:129-135`).
  - The activation read **waits for the session's initial history to open** and holds a temporary `goalActivation` client reference for its duration (`:113-124`); a stale binding sends no RPC at all.
  - The verbs read the Remote namespace **lazily** through getters, so a remounted namespace is picked up at action time (the test `remountGoals` proves it).
- **Edge cases & failure handling:** a session that is not open rejects the read with the session's own open error or a synthetic one (`:118-121`).
- **Surprising:** the plugin registers a `conversation.user.text.node` renderer with `priority: 100` and a **chat node** for the command echo — the `/goal` line is a first-class transcript node, rebuilt on reload from the durable run.

#### `packages/client/ui-goal/src/client/goal-command-input.ts`
- **Purpose:** the durable projection of a `/goal` run into a separate chat node, rendered before the generic command result row.
- **Key abstractions:** `GOAL_COMMAND` (`:9`), `GoalCommandInputData` (`:12`), `goalCommandText()` (`:34`), `goalCommandInputDefinition` (`:39`).
- **Data flow:** `command/run` event → `match` → `start` → `buildViewNode` → a `command-input` node with `anchorSeq = seq - 0.1` (so it sorts *before* the result row).
- **Non-obvious design decisions:**
  - It is a **separate projection** from the generic command definition — "the generic command Definition retains the result row" (`:38`). The command echo never creates a `user/message` or a model turn.
  - `goalCommandText()` re-derives the line as `/name` + trimmed args (`:34-36`), so the parser's trailing whitespace never shows.
  - `start()` throws if the matched event is not a `command/run` (`:47-49`) — the definition is total by construction.
- **Edge cases & failure handling:** `buildViewNode` returns `null` when there is no state (`:65`); a missing start location degrades to `{kind:'unresolved'}` (`:73`).
- **Surprising:** `anchorSeq` uses a fractional offset (`seq - 0.1`) to place the echo *before* the command's own result without renumbering the durable sequence.

#### `packages/client/ui-goal/src/client/user-text-rules.ts`
- **Purpose:** the rule that decorates a confirmed `/goal` token inside a user message as a command chip.
- **Key abstractions:** `goalCommandReferenceRule` (`:14`), the `command` fact map (`{start, end, name}`).
- **Data flow:** the conversation's user-text evaluator calls `match(text, from, context)` → the nearest *confirmed* command range → a `command` node.
- **Non-obvious design decisions:**
  - Only **confirmed execution ranges** are decorated (`:26-32`): a repeated `/goal` inside the prose stays plain text.
  - The rule checks the **original string** for boundary whitespace on both sides (`:27-29`), so `/goalx` and `x/goal` are not commands.
  - The rule **does not read the facts until it has found a slash token** (`:18-21`) — the test asserts `read` is never called for text without a slash.
  - Among unordered facts it returns the **nearest** match at the requested offset, preferring the longest at the same start (`:31-33`).
- **Edge cases & failure handling:** UTF-16 offsets are used as-is, so an emoji before the command does not shift the range (the test pins `start: 3` for `'🙂 /goal body /goal'`).
- **Surprising:** a rule with a *lower* `order` can win the same start offset, and the goal rule simply yields — the registry resolves precedence, not the rule.

### `packages/client/ui-jobs` — background jobs with a human kill

#### `packages/client/ui-jobs/src/client/JobListAction.tsx`
- **Purpose:** the session-header control listing this session's background jobs, with live output panels and a two-press stop button.
- **Key abstractions:** `JobListInjected` (`:16`), `JobListActionProps` (`:43`), `isLive()` (`:70`), `isObservable()` (`:78`), `jobDetail()` (`:83`), `dotState()` (`:97`), `ordered()` (`:170`), `JobItem` (`:189`), `JobListAction` (`:337`).
- **Data flow:** `ctx.jobs.state.rows[sessionId]` → rows; `watchRows(sessionId)` keeps the roster stream open; `observe(sessionId, jobId)` opens one job's output stream; `killJob(sessionId, id)` → `ctx.jobs.kill`.
- **Non-obvious design decisions:**
  - **Output flows only while someone is watching** (`:387-393`): the observation stream opens when a panel expands and closes on collapse, unmount or popover close.
  - The **roster follows the mount** (`:373-375`) — one `useEffect` keeps `job.list` open while the control lives.
  - The **clock only runs while something moves** (`:377-386`): the 1-second tick exists only while the popover is open and a live row is present.
  - The kill is a **two-press affordance** with a 3-second arm window (`KILL_ARM_MS`, `:64`) and a 4-second failure hint (`KILL_FAILED_MS`, `:67`); arming one row disarms any other (`:414-421`).
  - An **admitted kill stays pending** (`:436-449`): the unary HTTP reply and the jobs control stream have no cross-carrier ordering, so re-enabling the button could offer a duplicate kill; the authoritative jobs frame flips the row to `stopping` and clears the phase.
  - The armed press **widens into a labeled confirm pill** (`:310-312`) — "the armed press must be legible without hover: the button widens into a labeled confirm pill instead of a tint only."
  - `ordered()` (`:170`) sorts live rows by start and settled rows newest-first, with a **tie-break on start order** so the sort never depends on the host's map iteration.
  - The popover is **portaled to `document.body` with fixed positioning** (`:376-379`) because the session header sits in a clipping column.
  - Tab order is **bridged** across the portal (`:441-470`) so the in-place reading order survives.
- **Edge cases & failure handling:** a retention gap and a stream interruption render as notices above the panel; a settled row with no retained output is **static** (not a button); clearing the settled tail is a **client-side hide** only — "the registry keeps its records and a later settlement reappears normally" (`:346-349`); an expanded row that leaves the roster folds its panel (`:397-401`).
- **Surprising:** the panel **copies the command, not the output**; and the row above already carries the state dot, so the terminal block is told `runStateDot={false}`.

### Tier 2 — bulk: a compact table, one row per file (ui-approval, ui-goal, ui-jobs)

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-approval/src/client/locales.ts` | The six-key `approval` namespace; zh is the key-set source of truth and `en` is checked against it. |
| `packages/client/ui-approval/src/client/ApprovalPanel.module.css` | Warning-strip card; the reject button turns to the error token on hover. |
| `packages/client/ui-approval/src/index.ts` | Empty node half — "the Host capability is composed independently". |
| `packages/client/ui-approval/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-approval/package.json` | `dsh.client.inject` lists seven services; the browser half is discovered from the `dsh.client` block. |
| `packages/client/ui-approval/tsconfig.json` | Project references (llm, typert protocol, shortcuts, ui-session…). |
| `packages/client/ui-approval/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-approval/locale/en.json` | Package title only. |
| `packages/client/ui-approval/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-approval/README.md` | The behavioural spec: Enter/Esc answers, the key reservation, the shared pending lock, and the "transient decisions only" limit (no persistent policy in the browser). |
| `packages/client/ui-approval/README.zh.md` | Chinese mirror of the same spec. |
| `packages/client/ui-approval/tests/ui-approval.client.spec.tsx` | Pins the whole approval lifecycle: one-shot settlement, abort reasons, delegation vs abort, the scoped takeover, Enter/Escape answers, IME and modified-key immunity, the synchronous lock, and "an earlier failed answer cannot unlock its replacement". |
| `packages/client/ui-goal/src/client/GoalBar.module.css` | The 36px strip; its width is computed from the composer clearance + four dock insets. |
| `packages/client/ui-goal/src/client/GoalCommandInputView.tsx` | The right-aligned command echo bubble; renders the shared user-text factory with a `commands` fact. |
| `packages/client/ui-goal/src/client/GoalCommandInputView.module.css` | The bubble deliberately inherits the user bubble's face and size axis (no font-family override). |
| `packages/client/ui-goal/src/client/GoalCommandReference.tsx` | The display-only command chip (`ReferenceChip`, appearance `command`). |
| `packages/client/ui-goal/src/client/slots.ts` | The injected face: four verbs, the local `no-current-goal` failure, and the activation snapshot shape. |
| `packages/client/ui-goal/src/client/locales.ts` | The `goal` namespace; zh is the source of truth. |
| `packages/client/ui-goal/src/index.ts` | Empty node half. |
| `packages/client/ui-goal/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-goal/package.json` | `dsh.client.inject` for seven services. |
| `packages/client/ui-goal/tsconfig.json` | Project references (goal domain, commands, ui-chat…). |
| `packages/client/ui-goal/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-goal/locale/en.json` | Package title only. |
| `packages/client/ui-goal/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-goal/README.md` | The behavioural spec: the strip's place in the composer stack, the command-input bubble, inline failure rendering, and the epoch discipline ("a stale HTTP result cannot overwrite a newer activation edge"). |
| `packages/client/ui-goal/README.zh.md` | Chinese mirror of the same spec. |
| `packages/client/ui-goal/tests/goalbar.client.spec.tsx` | Pins the strip: nothing for loading/absent/complete, single-flighted clear, multi-line edit, Shift+Enter and IME not saving, Esc cancelling, portal-ed tooltips, the stale-draft drop on a new goal id, and inline `message (code)` failures. |
| `packages/client/ui-goal/tests/goal-command-input.client.spec.tsx` | Pins the projection: the input node precedes the generic command result, replay rebuilds it, only the leading token is decorated, and the facts object is stable across rerenders. |
| `packages/client/ui-goal/tests/goal-command-input-styles.client.spec.ts` | Reads the CSS *as text* and asserts the bubble sets no font family and uses the shared size axis — jsdom has no layout, so this is the only way to see it. |
| `packages/client/ui-goal/tests/user-text-rules.client.spec.ts` | Pins the command-reference rule: no facts read without a slash, boundary whitespace, confirmed ranges only, unordered facts, UTF-16 offsets. |
| `packages/client/ui-goal/tests/activation-source.client.spec.ts` | Pins the epoch discipline: a stale read cannot overwrite a newer event, a running refresh keeps the last activation, a failed read leaves the ref unarmed, and subscriptions are released with the last observer. |
| `packages/client/ui-goal/tests/browser-plugin.client.spec.tsx` | Pins the wiring: the read waits for the initial history open, a replaced binding sends no RPC, the verbs read the CAS ref at call time, a null projection short-circuits, and the fiber teardown removes the dock entry (HMR safety). |
| `packages/client/ui-jobs/src/client/JobListAction.module.css` | The portaled fixed menu (z-index 100), the live-row card fill, the two-press stop pill, and the terminal gutter override. |
| `packages/client/ui-jobs/src/client/index.ts` | Registers the header action (order 20) and the `job` dictionaries; the component holds no transport state. |
| `packages/client/ui-jobs/src/client/locales.ts` | The `job` namespace; zh is the key-set source of truth and en is asserted key-identical. |
| `packages/client/ui-jobs/src/index.ts` | Empty node half (Loader row only). |
| `packages/client/ui-jobs/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-jobs/package.json` | `dsh.client.inject` for four services. |
| `packages/client/ui-jobs/tsconfig.json` | Project references (job controller, ui-primitives…). |
| `packages/client/ui-jobs/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-jobs/locale/en.json` | Package title only. |
| `packages/client/ui-jobs/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-jobs/README.md` | The behavioural spec: one roster, the two-press kill that "claims nothing in the model's notice ledger" (the model is told the user stopped its task), and the visibility-gated observation stream. |
| `packages/client/ui-jobs/README.zh.md` | Chinese mirror of the same spec. |
| `packages/client/ui-jobs/tests/browser-plugin.client.spec.ts` | Pins the slot registration, the inject face (roster / observe / kill), the fiber teardown, and the en/zh key identity. |
| `packages/client/ui-jobs/tests/job-list-action.client.spec.tsx` | 592-line component spec; read via head + full `describe/it` inventory: visibility, row anatomy, the settled-tail fold and clear, ordering and tie-breaks, the portaled panel with viewport anchoring, retention-gap and stream-failure notices, the Tab bridge, and the whole human-kill state machine (arm, disarm, failure hint, cross-row arming, late resolution). |

### Tier 3 — skipped with a reason (ui-approval, ui-goal, ui-jobs)
- `packages/client/ui-approval/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.
- `packages/client/ui-goal/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.
- `packages/client/ui-jobs/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.



---

### `packages/client/ui-plan` — plan mode, plan cards, and a Markdown sidebar

#### `packages/client/ui-plan/src/client/plan.ts`
- **Purpose:** the pure derivation layer: how a submitted plan is read out of *untrusted logged tool arguments*, and how a plan's durable identity is encoded.
- **Key abstractions:** `PlanDocument` (`:7`), `SubmittedPlan` (`:13`), `PlanAddress` (`:18`), `submittedPlan()` (`:32`), `planAddress()` (`:55`), `parsePlanAddress()` (`:68`).
- **Data flow:** a logged `tool/call` / `tool/ptc-dispatch-start` / `tool/ptc-dispatch` event → `submittedPlan()` → `{callId, markdown, title}`; a session + callId → `dsh-resource://plan/…` address → `parsePlanAddress()`.
- **Non-obvious design decisions:**
  - The plan text is read out of **untrusted logged arguments** and every shape is validated: a non-record payload, a wrong tool name, a missing call id, or a non-string argument all return `undefined` (`:32-50`).
  - **Malformed model JSON is not an error** — `catch { return undefined }` with the comment "Malformed model JSON remains in the generic tool row" (`:44-45`): a broken plan does not break the transcript.
  - The title is the plan's **first Markdown heading**, and a plan without one is **not a plan** (`:49-50`) — the title is part of the identity, not decoration.
  - The address carries the *identity* only, never the text (`:51-53`) — "without retaining its text in layout storage".
  - Subagent addresses preserve the child's `mode`, including the literal `unknown` (`:60-64`, `:76-79`), so a history read can still resolve the child descriptor.
- **Edge cases & failure handling:** `parsePlanAddress` rejects empty segments, bad percent-encoding and unsupported shapes by returning `undefined` (`:68-86`).
- **Surprising:** the same `submittedPlan()` reader handles native tool calls *and* both PTC dispatch shapes — one reader for two very different wire forms.

#### `packages/client/ui-plan/src/client/plan-resource.ts`
- **Purpose:** the sidebar resource provider that **reconstructs a plan from Session history** — the document text is never stored in the sidebar layout.
- **Key abstractions:** `planResourceProvider(remote)` (`:37`), the `RemoteErrorDetailsMap` merge declaring `plan/invalid-address`, `plan/unavailable`, `plan/not-found`, `plan/read-failed`.
- **Data flow:** `remote.follow({address})` → the opening snapshot frame → scan its records for the callId → `remote.page({throughSeq: snapshot.cursor, beforeSeq})` for older pages → yield one `RemoteResult<SubmittedPlan>`.
- **Non-obvious design decisions:**
  - The **snapshot supplies the page API's fixed log cut**: `throughSeq: snapshot.cursor` (`:66`) so paging never changes the chat window.
  - The follow stream is **broken out of** as soon as the snapshot frame arrives (`:59-61`) — breaking closes the stream, and the test asserts `closed` was called once.
  - The provider is an **async generator** that yields at most one value, so cancellation is honoured at every await (`signal.aborted` checks at `:44`, `:62`, `:69`).
  - A Remote failure is **preserved verbatim** (`yield next`, `:70`) rather than being rewritten; a thrown non-Remote error becomes `plan/read-failed` (`:74-77`).
- **Edge cases & failure handling:** an empty stream → `plan/unavailable`; a plan that is not in the pages → `plan/not-found`; a page that settles after cancellation is discarded (the test pins both resolve and reject).
- **Surprising:** the provider reads the *host's* history rather than any client cache — the plan survives a browser reload because it was never in the browser.

#### `packages/client/ui-plan/src/client/PlanModeControl.tsx`
- **Purpose:** the composer chip that shows plan mode is on and turns it off.
- **Key abstractions:** `PlanChipProps` (`:11`), `PlanChip` (`:19`).
- **Data flow:** `useProjection('plan')` → the effective target; `exitPlanMode()` → `ctx.remote.commands.execute(sessionId, '/plan off', [])`.
- **Non-obvious design decisions:**
  - The effective target is `pending ? !active : active` (`:29`) — "a folded host value, not client optimism, so an arriving frame corrects the chip either way" (README). A *pending* transition counts as plan mode because the host is about to enter it.
  - The chip **stays visible through a failure** and only disappears when the projection confirms the exit (`:36-49`).
  - Two glyphs share one slot and CSS shows exactly one — the plan glyph at rest, the circled close on hover/focus — so the affordance "marking the pending click as turning plan mode off" needs no layout change (`:51-56`).
  - An `aliveRef` guards the async completion so a late resolve/reject after unmount cannot set state (`:25-30`, `:39-46`).
- **Edge cases & failure handling:** the exit verb is called **once** even on a double click (the `leaving` flag disables the button); admission failures, transport faults and non-`Error` rejections all become a single visible error line with the raw text in the `title`.
- **Surprising:** the failure strings stay **English** on purpose — "error-surface policy: not localized" (`index.ts:130-131`).

#### `packages/client/ui-plan/src/client/PlanCard.tsx`
- **Purpose:** the two plan entry points: the persistent transcript cards in a completed Turn's artifact area, and the automatic opener for a pending review.
- **Key abstractions:** `PlanOpenInjected` (`:15`), `PlanCardsInjected` (`:21`), `PlanReviewOpenInjected` (`:29`), `PlanCards` (`:43`), `PlanReviewOpen` (`:72`).
- **Data flow:** `usePlans(turn)` → the Turn's submitted plans in invocation order → a card per plan → `openPlan(callId)` → the sidebar resource; the review strip → `openReview(review, requestKey)`.
- **Non-obvious design decisions:**
  - The **automatic open is "once per submission"** and a *manual* closure survives a remount (`:74-81` + `review-store.ts:16`) — the store remembers which review identities were auto-opened so a remount does not re-open a tab the human closed.
  - The automatic open **waits for a Session on screen** (`:77`) because `ctx.sidebarRight` names the Session before the commit that renders it.
  - The review identity is `call:<callId>` for a logged plan and `review:<requestKey>` for a temporary one (`:73`).
  - The card is a `<button>` with `aria-label` naming the plan (`:50`), so the title is in the accessible name, not only in the text.
- **Edge cases & failure handling:** a Turn with no plans renders nothing (`:44`); a temporary review's text lives only in the tab's navigation memory, so a reload loses it and the preview reports "expired" pointing back at the pending card.
- **Surprising:** **review lifetime and document lifetime are deliberately separate** — a logged plan survives a reload (it is in history), a temporary one does not (README, "Understand the implementation").

#### `packages/client/ui-plan/src/client/plan-definition.ts`
- **Purpose:** the conversation projection that turns a logged plan submission into a chat node.
- **Key abstractions:** `planDefinition` (`:15`), the `ChatNodeDataMap` merge for `'submitted-plan'`.
- **Data flow:** `tool/call` or PTC dispatch event → `submittedPlan(event)` → a node with `anchorSeq = start.event.seq` and the **resolved** Turn location.
- **Non-obvious design decisions:**
  - A PTC dispatch matches with `role: 'update'` (`:19`) so "a later PTC settlement retains the original card position" — one card per *invocation*, not per dispatch frame.
  - The node's `visibility` is `'hidden'` (`:30`): the card is drawn by the *turn-tail* list, not by the node itself.
  - `update: context => context.state` (`:23`) — the definition is total by construction.
- **Edge cases & failure handling:** `buildViewNode` returns `null` when there is no state and no start match (`:26`).
- **Surprising:** the plan card is contributed to the **additive** `conversation.chat.turnTail` list *alongside file deliveries*, so plans and delivered files read as one artifact family.

#### `packages/client/ui-plan/src/client/review-store.ts` + `review-preview.ts` + `failure-line.ts`
- `review-store.ts:16` — `createPlanReviewStore()` is a `defineStore` with a single `markOpened` action; the store is **session-scoped**, so "manual sidebar closure effective across review component remounts" survives a remount without persisting anything.
- `review-preview.ts:18` — `reviewPreviewAddress()` builds `dsh-resource://plan-review/<sessionId>/<requestKey>`; the review text is passed as **navigation params**, explicitly "never persisted in sidebar layout" (`:5`).
- `review-preview.ts:27` — `isReviewPreviewAddress()` recognises it with a strict regex, so a temporary address can never be mistaken for logged history.
- `failure-line.ts:11` — `planFailureLine()` maps the four plan error codes to localized copy and **keeps the carrier's diagnostic for everything else** ("Transport failures, including plan/read-failed, retain the carrier's diagnostic", `:18-19`).

### Tier 2 — bulk: a compact table, one row per file (ui-plan)

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-plan/src/client/PlanPreview.tsx` | The read-only Markdown sidebar pane and its tab title; distinguishes a logged resource from a temporary review preview and reports "expired" for the latter. |
| `packages/client/ui-plan/src/client/PlanPreview.module.css` | The plan-card family (60px card, icon tile), the review link, the preview pane and the dark-theme token overrides. |
| `packages/client/ui-plan/src/client/PlanModeControl.module.css` | The chip's 28px geometry and the one-slot two-glyph swap. |
| `packages/client/ui-plan/src/client/index.ts` | Registration: the plan seat, the turn-tail cards, the review-action slot, the sidebar tab type, the resource provider, and the `/plan off` verb. |
| `packages/client/ui-plan/src/client/locales.ts` | The `plan` namespace; zh is the source of truth. |
| `packages/client/ui-plan/src/index.ts` | Empty node half (the plan domain is a separate host plugin). |
| `packages/client/ui-plan/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-plan/package.json` | `dsh.client.inject` for eight services. |
| `packages/client/ui-plan/tsconfig.json` | Project references (plan-mode domain, resources, sidebar-right, user-questions…). |
| `packages/client/ui-plan/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-plan/locale/en.json` | Package title only. |
| `packages/client/ui-plan/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-plan/README.md` | The behavioural spec: the chip's projection fold, the automatic-open-once rule, the separation of review lifetime and document lifetime, and "plan mode is guidance, not an execution sandbox". |
| `packages/client/ui-plan/README.zh.md` | Chinese mirror of the same spec (head 25 lines read). |
| `packages/client/ui-plan/tests/plan-mode-control.client.spec.tsx` | Pins the chip: nothing for absent/default target, the chip for active *and* pending-entry targets, one `/plan off` per click, the locked-owner disable, the three failure shapes, and no state update after unmount. |
| `packages/client/ui-plan/tests/plan-resource.client.spec.ts` | Pins the resource: exact-invocation restore, paging with the fixed cursor, the three subagent modes, not-found and invalid-address, cancellation before and during paging, and preservation of Remote failures. |
| `packages/client/ui-plan/tests/browser-plugin.client.spec.ts` | 253-line wiring spec (head + inventory read): Turn-keyed card binding, a child plan opened in the visible parent sidebar, seat declaration deferral, `/plan off` dispatch, and teardown removing the sidebar seats (HMR safety). |
| `packages/client/ui-plan/tests/plan-preview.client.spec.tsx` | 345-line spec (head + inventory read): plan identity across native/PTC calls, address round-trips, no duplicate cards, per-Turn card updates, open-once and manual-closure semantics, the wait-for-a-Session rule, and expired temporary previews. |

### Tier 3 — skipped with a reason (ui-plan)
- `packages/client/ui-plan/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.



---

### `packages/client/ui-schedule` — scheduled work, delivery history, and cron

This is the shard's most trading-relevant package: a whole cross-session **scheduled-task** surface (the "Automation tasks" page, a right-Sidebar task tab, a Session-header reminder popover, a transcript card for a created task, and ambient Sidebar row marks) plus the **cron dialect**, the **delivery-record history**, and the **time-zone** machinery.

#### `packages/client/ui-schedule/src/client/catalog-source.ts`
- **Purpose:** the one observable catalog behind every task surface: the authoritative read, the invalidation subscriptions, and the deletion with its own outcome.
- **Key abstractions:** `CatalogDeleteOutcome = 'deleted' | 'failed' | 'pending'` (`:8`), `CatalogSnapshot` (`:11`), `CatalogInjected` (`:54`), `createCatalogSource()` (`:86`).
- **Data flow:** `deps.list()` → `records`; `deps.remove(id)` → `deleted`/`failed`; `schedule/changed` + `connection/reset` → a superseding read.
- **Non-obvious design decisions — this is the interesting part:**
  - **Reconciliation is causal, never clock-based.** The snapshot carries `readRequest` (the ordinal of the newest *requested* read) and `readSettled` (the ordinal of the read that *produced* the records) (`:26`, `:38`). A consumer that appears with a record of its own (the created-task card) records the request ordinal at mount and may only conclude "deleted" from a read whose `readSettled` exceeds that anchor. "Comparing the browser's clock with the Host's would not establish that order" (`:33-37`).
  - **Requests made in one commit share one read** (`:124-140`): the source batches the mount effects of a commit into a single `list()`, so a conversation with N created-task cards sends one query.
  - A caller that has already observed a request passes that ordinal as `since`, and only a read requested *later* is shared (`:74-84`) — a read issued before the caller appeared cannot answer for it.
  - An **invalidation supersedes** the read in flight; only mount-time requests join one (`:142-144`).
  - The `epoch` counter means a read that settles after a disconnect, or after the last subscriber left, publishes nothing (`:103`, `:161-176`).
  - A **rejected** deletion does not establish that the durable record changed: the row is un-marked and the outcome is `'failed'` (`:146-155`).
  - After an acknowledged deletion the source **reads again** rather than joining a read that may predate the write (`:157-161`).
- **Edge cases & failure handling:** a transport rejection has the same visible retry path as a Remote failure (`:93-100`); `status` alone cannot separate a first read from a refresh, which is why `settled` exists (`:17-24`).
- **Surprising:** `readRequest` counts *requests*, not `list()` calls — "this counts the requests rather than the `list()` calls" (`:35-37`).

#### `packages/client/ui-schedule/src/client/task-cron.ts`
- **Purpose:** a browser-side parser, describer and *shape recognizer* for the five-field cron dialect the Host accepts — so the card can reject a bad expression locally and describe a good one without a round trip.
- **Key abstractions:** `CronField` (`:50`, with `values`/`starred`/`full`/`unrestricted`), `ParsedCron` (`:66`), `parseCronExpression()` (`:232`), `cronPreview()` (`:465`), `CronBuilderState` (`:472`), `recognizeCronShape()` (`:532`), `cronShapeExpression()` (`:584`).
- **Data flow:** expression text → `parseCronExpression` → `ParsedCron` → `cronPreview` (a sentence) or `recognizeCronShape` (structured rows) → `cronShapeExpression` (text back).
- **Non-obvious design decisions:**
  - The **star flag and full coverage are separate facts** (`:72-79`): `*/2` is a star field that still restricts, and `1-31` covers everything without being a star field — mirroring the Host's `parseCronField` exactly (`:247-252`).
  - Sunday is **folded onto 0** (`:194`), and `CRON_FIELDS` (`:92-98`) carries the `foldMax` that does it.
  - The day phrase follows the Host's **Vixie union rule**: when either day field is starred, the phrase narrows to the intersection; otherwise it is a union (`:329-352`).
  - `cronPreview` returns a **standalone** sentence for interval-shaped rules and a **joined** lower-case form after a day phrase (`:398-463`), so `Every 15 minutes` and `Mon–Fri every 15 minutes` both read correctly.
  - `recognizeCronShape` refuses to recognize a shape whose weekday set *and* day-of-month both restrict, because "each restriction matches independently under the Host's Vixie union rule" (`:519-528`).
  - A written-out full set (`0-6`, `1-31`) stays a weekly/monthly rule with every value selected — "toggling the last pill on never collapses its row" (`:516-518`).
  - `cronShapeExpression` is **round-trip safe**: "every expression this returns is recognized as the same shape, so a builder edit never falls back to the raw-expression row" (`:578-581`).
- **Edge cases & failure handling:** an expression with anything other than five fields is rejected (`:234`); an out-of-range element, a zero step, or a reversed range is rejected (`:155-186`).
- **Surprising:** `cronFullRangeStep` (`:376`) is how `*/15` becomes "every 15 minutes" — the parser *derives* the interval from the matched value set, so the description and the shape recognizer agree by construction.

#### `packages/client/ui-schedule/src/client/task-timing.ts`
- **Purpose:** the editable-timing layer: what a rule looks like to the Host, what the draft holds, and how a Host failure becomes a localized recovery instruction.
- **Key abstractions:** `TaskTimingInjected` (`:13`), `TimingDraft` (`:25`), `timingSnapshot()` (`:38`), `draftZone()` (`:89`), `zonedWallClock()` (`:103`), `timingDraft()` (`:132`), `slashDate()` (`:164`), `secondPrecision()` (`:176`), `timingError()` (`:187`).
- **Data flow:** a `ScheduleRecord` → `timingSnapshot` (the *complete expected rule* for compare-and-update) → a `TimingDraft` of native inputs → one `schedule.update` request.
- **Non-obvious design decisions:**
  - `timingSnapshot` projects **only the persisted rule fields**, excluding catalog metadata and the delivery receipt (`:38-63`) — the Host compares the complete expected rule, so the snapshot must be exactly the rule.
  - The weekly weekday set is **copied**, not aliased (`:57`) — the draft must not mutate the catalog row.
  - `zonedWallClock` reads the zone's fields **by name** from `formatToParts` and fixes the locale to `en-US` (`:103-130`): "the field order never follows the interface language, and each field is read by name rather than from a formatted string." Millisecond precision is preserved.
  - `draftZone` distinguishes a **stored** zone from the **device** fallback (`:89-92`) — a daily/weekly/cron rule keeps its own zone; an `at`/`after` one-shot starts in the device's zone.
  - `secondPrecision` drops fractional seconds **for display** while an untouched stored millisecond value survives in the draft for the submit (`:176-181`).
  - `timingError` maps every closed Host error code to a **dictionary key describing the recovery action**, never to the raw diagnostic (`:187-205`) — the switch is exhaustive over the closed union with an `assertNever` backstop.
- **Edge cases & failure handling:** an unusable zone returns `''` and the caller keeps the stored text (`:126-129`); a runtime that reports no zone falls back to `UTC` (`:66-71`).
- **Surprising:** `slashDate` exists so "no caller has to parse or re-format a date merely to show it" (`:158-162`) — the draft and the submitted text stay ISO; only the exposed text is slashed.

#### `packages/client/ui-schedule/src/client/schedule-format.ts`
- **Purpose:** every user-visible rendering of a rule and a target: frequency sentences, zone labels, next-run stamps, relative distances, and the overdue-first ordering.
- **Key abstractions:** `FrequencyTranslator` (`:31`), `zoneLabel()` (`:135`), `zoneName()` (`:156`), `zoneChoices()` (`:199`), `recordTimeZone()` (`:225`), `formatScheduleFrequency()` (`:249`), `formatScheduleNextRun()` (`:321`), `formatScheduleAbsolute()` (`:377`), `nextRunParts()` (`:405`), `formatScheduleRelative()` (`:424`), `orderScheduleRecords()` (`:447`).
- **Non-obvious design decisions:**
  - **Zone inventory is the browser's own ICU data**: `Intl.supportedValuesOf('timeZone')` (`:175-186`) and `Intl.DateTimeFormat(..., {timeZoneName:'longGeneric'})` (`:137-142`). "There is therefore no crawler or generated zone-name resource to refresh" (README). A third-party locale supplies `time.locale` and gets the matching ICU names for free.
  - `zoneChoices` orders by **current UTC offset then canonical id**, and computes each offset **once** per zone — "each `zoneOffset` builds a formatter, so resolving offsets inside the comparator would build O(n log n) of them" (`:206-216`).
  - A **stored zone outside the inventory is appended**, so "an accepted alias never disappears from the menu" (`:193-197`).
  - `formatScheduleFrequency` **omits the zone when it equals the host zone** and names it otherwise (`:249-320`); a cron expression this parser cannot read keeps the raw `Cron {expression}` form, "so the stored rule stays visible when the Host's dialect and this parser diverge" (`:239-243`).
  - `statesYear` (`:350-360`) states the year in English, omits it in Chinese, and **states it in every unlisted language**: "dropping it silently would hide the year of a target that can sit months or a year away."
  - `hourCycle: 'h23'` is used explicitly (`:395`) because "`hour12: false` leaves midnight's hour open in older engines, which may render `24:00`."
  - `orderScheduleRecords` sorts **overdue first, then by target time**, with a stable index tie-break (`:447-458`).
- **Edge cases & failure handling:** a zone the ICU cannot name falls back to the offset, then to the raw IANA id (`:135-153`); an unparseable instant is returned as stored (`:323`, `:378`).

#### `packages/client/ui-schedule/src/client/task-tab-bindings.ts`
- **Purpose:** durable recovery for a task tab that a browser reload restored without its navigation parameters.
- **Key abstractions:** `TaskTabPage` (`:25`), `TaskTabTarget` (`:35`), `TaskTabBindings` (`:110`), `PREFIX = 'dsh.schedule.task-tab.v1.'` (`:49`).
- **Non-obvious design decisions:**
  - The binding key is the **layout record's own id**, not the `contentId` — "every tab of one page kind records the same one" (`:11-14`).
  - The store holds **only the Session and task identity**: "its name, instruction, and deliveries are not" (`:19-20`).
  - A read that finds a **mismatched kind/contentId** reports no task and leaves the document untouched; the *drop* is a separate call the render effect makes, because "a render React discards must not rewrite what it read" (`:126-136`, `task-tab-target.ts:58-62`).
  - A write prunes entries whose tab is no longer in the committed tab list — but **only when that list is non-empty** (`:213-218`): "pruning against that answer would drop entries a restored tab still resolves through."
  - The in-memory map is **authoritative for this window's reads**, so the store still works when `localStorage` is absent or rejects writes (`:104-108`).
- **Edge cases & failure handling:** malformed stored documents are dropped and the well-formed entries beside them are kept; a storage write failure is logged, not thrown (`:220-224`).

#### `packages/client/ui-schedule/src/client/session-schedule-state.ts`
- **Purpose:** the projection of the *one shared* Host catalog onto one Session's active tasks, for the ambient Sidebar row mark and hover card.
- **Key abstractions:** `createSessionScheduleSource()` (`:31`), `SessionScheduleFacts` (`:50`), `selectSessionScheduleFacts()` (`:73`), `useSessionScheduleFacts()` (`:103`).
- **Non-obvious design decisions:**
  - **N visible rows cost one Host query** — the mark and the hover card both project the shared catalog instead of issuing one query per row (`:3-9`).
  - The projection answers "no active task" until the read has **settled** (`:75`) — following `status` would blank the mark on every round trip, because a refresh republishes `loading` over the retained records.
  - `sameSessionScheduleFacts` (`:91-100`) makes the selector **stable for this row** when *another* Session's tasks move, so a row does not re-render on someone else's change.
- **Edge cases & failure handling:** an ended-only Session lists nothing; a failed read answers no active task but does not blank the previous answer (`:78-84`).

#### `packages/client/ui-schedule/src/client/TaskDetail.tsx` (2231 lines — the package's load-bearing component)
- **Purpose:** one task's detail: the Rule card (name, instruction, repeat, weekday, date, time, zone, cron), the Records tab, confirmed deletion, and the linked original Session.
- **Key abstractions:** `TaskDetailInjected` (`:159`), `TaskDetailController` (`:221`), `useTaskDetail()` (`:250`), `TaskDetail` (`:291`), `mergeRuleDraft()` (`:1411`), `RuleCard` (`:1492`), `CronRows` (`:1934`), `CronStepper` (`:2189`).
- **Non-obvious design decisions:**
  - **`mergeRuleDraft(authoritative, draft, stored)`** (`:1411`) is the merge rule for a refresh under an unsaved draft: fields the draft left alone take the authoritative value; fields the draft edited keep the draft; the *stored* value is the third input so a "keep mine" decision can be distinguished from "never touched". The spec pins it in 12 cases (`task-detail.client.spec.ts:420-556`).
  - A **catalog refresh never clobbers an unsaved draft** (README), and a refresh is only allowed to change the shown values while the draft is clean.
  - The **local draft survives a failure** and the save bar appears *only* while the draft differs from the stored task (README).
  - A save submits the **complete expected record** plus the staged change — a compare-and-update, not a patch (README, "Understand the implementation").
  - "No failure rolls back a Host write already begun" (README).
  - The Repeat menu offers **eight** recurrence choices (`:45-48`) and a *stored* weekly rule whose weekday set is exactly Mon–Fri shows the "Monday to Friday" choice (`:147-149`).
  - `MIN_INTERVAL_SECONDS = 60` (`:108`) — every interval accepts at least 60 whole seconds, independent of the zone.
  - The cron builder recognizes a **structured shape** and edits it as rows; `CRON_SHAPE_CHOICES` (`:1886`) offers monthly/weekly/daily/hourly/minutely/raw, and an edit regenerates the expression so the row never falls back to raw text (`:1934`).
  - The cron rows are seeded from the **committed occurrence** in the rule's own zone, so an expression seeded from the occurrence's UTC clock with another zone would name a different instant (`:141-149`).
  - **Every save carries a generation number** (`submissions`, `:437-447`): "the same detail renders every task, and a save of task A can still be in flight when the reader leaves A, opens B, and comes back to A." A retired response reports **neither success nor failure** — its outcome reaches the reader only through the catalog refresh the save's own callback triggers.
  - The **day set is remembered across a detour** (`:498-512`): switching Mon–Fri → Daily → Weekly would otherwise collapse the rule to the one day the carried clock falls on. The memory is scoped to the task's identity, "because the same `TaskDetail` renders whichever task is selected."
  - A switch between two clock-time choices **carries the pair the card shows** (`:576-590`) instead of restating the instant in UTC and rewriting the zone the rule states.
  - A **rejected request cannot establish whether the Host committed the edit** (`:672-681`), so it reports `rule.error.unknown` — "Unable to confirm whether the rule was updated" — and never a false success.
  - The **linked-Session entry collapses to an icon button** when the strip cannot fit it (`:326-361`), and the measurement uses the tabs' *extent* rather than the list's width, because "the tab list grows into the strip's free width, so its own width cannot tell whether its tabs overflow."
  - A **timed rule's zone is the rule's own**, not the browser's: `zonedWallClock` (`:103` in `task-timing.ts`) reads the zone's fields *by name* from `formatToParts`, and `zonedWeekday` (`:1046`) fixes the locale to `en-US` "because the seeded weekday is part of the rule a save submits: it must not change with the interface language."
- **Edge cases & failure handling:** the local validation set (`:91-94`) names the messages a draft can produce; the interval floor and the 120-character title cap are local (`:1099`, `:1933-1946`); `validIsoDate` (`:1118-1122`) round-trips through `Date.UTC` so a shape-correct but impossible date such as `2026-02-31` is rejected; an **ended task's unsaved draft is replaced by the stored values** (`:474-481`), because an ended task offers no Cancel and the draft would otherwise read as saved.
- **Surprising:** the file is 2231 lines for one component — it holds the whole rule-editing grammar, the merge rule, the pickers' wiring, the menus, and the cron builder. Every one of its four dropdowns is wrapped in its own `guardMenuEscape` (`:1245-1259`) because the page's own Escape handler would otherwise close the whole detail along with the menu.

#### `packages/client/ui-schedule/src/client/DeliveryHistory.tsx`
- **Purpose:** the saved **delivery records** — the closest thing in this repo to a queryable run log.
- **Key abstractions:** `DeliveryHistoryInjected` (`:14`), `SavedPrompt` (`:40`), `DeliveryHistory` (`:70`).
- **Non-obvious design decisions:**
  - The newest page is **20 records** and older pages append in newest-first order (`:78`).
  - A **refresh supersedes** a pending older page, and unmount ignores both late outcomes — an `epoch` counter (`:71`, `:80-84`, `:117-119`).
  - An **older-page failure preserves the loaded records** and retries with the *right* cursor; an invalid cursor offers "Refresh" (reload the newest) instead (`:145-176`).
  - The saved prompt is **clamped to two lines with a toggle**, and the clamp is re-measured when the panel width changes — "a collapsed prompt rechecks its length when the panel width changes" (README; `SavedPrompt`, `:40-66`).
  - The **pruning notice** appears only when the history is nonempty, pruning is *confirmed*, and the last page has loaded (`:180-190`); empty history, legacy unavailability without confirmed pruning, incomplete pagination and failed reads show no notice.
  - The record's occurrence time is rendered **in the task's own zone** (`:121`, `:159-161`).
- **Edge cases & failure handling:** a transport exception uses the same localized retry as a Remote failure (`:88-96`); a legacy receipt without a prompt never substitutes the current instruction (README).
- **Surprising:** the retention rules the Host applies are surfaced to the user through an info button — "Earlier delivery records have been cleared" plus the configured bounds (`:181-190`).

#### `packages/client/ui-schedule/src/client/schedule-turn.ts` + `schedule-create-card.ts`
- **Purpose:** the transcript card for a task the model created, reconstructed from the *persisted result JSON* so old Session logs replay it.
- **Key abstractions:** `SCHEDULE_CREATE_TOOL` (`:20`), `scheduleTasksForClosing()` (`:71`), `selectScheduleTasks()` (`:89`), `scheduleTurnDefinition` (`:128`); `narrowScheduleRecord()` (`schedule-create-card.ts:79`), `scheduleCreateCardModel()` (`:140`).
- **Non-obvious design decisions:**
  - The Turn's **own end sequence** bounds the creations — "a Turn whose last text response precedes a `schedule_create` settlement still owns that creation when it ends on a failed request or a user stop" (`:80-86`).
  - A **failed** creation names no task, so its Turn renders no card (`:110-111`); a failed call does not hide a later successful one (spec `schedule-turn-card.client.spec.tsx:249`).
  - The task is **narrowed from replayed wire JSON** with every field checked; a result recorded before the stored `title` field existed falls back to the instruction's first line (`:85-92`).
  - A streaming call's **truncated JSON prefix** must not throw — `parseJson` returns undefined and the card falls back (`:31-39`).
- **Edge cases & failure handling:** a result that is not exactly one non-empty text block yields no result text; a result that is not a complete rule yields no task (`:53-58`, `:118`).
- **Surprising:** the card adds **no Host field and no Session-log format change**, so "Sessions recorded before the card existed render it too" (README).

#### `packages/client/ui-schedule/src/client/index.ts`
- **Purpose:** the registration: the Automation tasks panel, the task tab type, the transcript card, the Session-header entry, the Sidebar row seats, and the app-wide delete toast.
- **Key abstractions:** `inject` (`:77`), `apply(ctx)` (`:88`), `updateTask()` (`:141`), `reportedDelete()` (`:120`).
- **Non-obvious design decisions:**
  - **One catalog source is shared by four surfaces** — the page, the tab, the row mark and the hover card (`:100-110`); the Session header keeps its own per-Session `schedule/list` source (`:212-220`).
  - After an accepted or stale update the source is asked to read again by naming the *current* request ordinal, "the way the post-deletion readback supersedes" (`:141-152`).
  - Every deletion path reports into **one store** rendered by a single `shell.overlay` entry, so the outcome outlives the panel or tab that asked for it (`:113-126`).
  - The page's "New" action **starts a Session** rather than offering a creation form: "the page itself has no creation form" (`:178-181`).
  - The Session-header entry is registered at `order: -5` "immediately left of the overflow menu" (`:216-219`).
  - The shared delete callback and `onUpdateTiming` retain the selected record's **original Session binding** rather than the currently open conversation (README).
- **Edge cases & failure handling:** the open-Session action checks availability *again* at click time (`:161-166`).

#### `packages/client/ui-schedule/src/client/session-link.ts` / `relative-clock.ts` / `recent-time-zones.ts`
- `session-link.ts:21` — `sessionLinkState()` decides availability **without activating anything**: a workspace error → unavailable, a pending list → loading, an archived id → archived, a missing **Host-list** id → unavailable. The comment notes that `byId` carries local fallback rows, so membership must come from `ids` (`:11-16`).
- `session-link.ts:50` — `sessionLabel()` returns the catalog title or the Session id, so "the label is never empty", and every surface names a linked Session the same way.
- `relative-clock.ts:29` — a shared 30-second clock, because the page and its detail sit side by side "and must not disagree about how long remains"; two other surfaces deliberately keep their own beat (the header popover ticks every second while open, the hover card samples once per mount so it "must not drift while the pointer rests").
- `recent-time-zones.ts` — five most-recent exact IANA ids in `localStorage`; the first-run seed is the **device zone and UTC**, "rather than inferring a location from UI language"; a private or full browser store must not block editing the rule.

### Tier 2 — bulk: a compact table, one row per file (ui-schedule)

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-schedule/src/client/TaskManagerPage.tsx` | The Automation tasks page: search over title/instruction/session id, the All/Enabled/Inactive filter, the empty states, the row anatomy, and the focus return to the row that opened the detail. |
| `packages/client/ui-schedule/src/client/TaskMenu.tsx` | A schedule-local copy of the shared `Menu` (deliberately forked): arrow walk, Tab settles the row, Shift+Tab closes, the header-field handover for the zone search box, and the iframe-blur dismissal. |
| `packages/client/ui-schedule/src/client/ScheduleCatalogAction.tsx` | The Session-header reminder popover: icon-only entry, "no flash on first read", the sole-reminder shortcut straight to the detail, overdue-first rows, and the 1-second clock while open. |
| `packages/client/ui-schedule/src/client/ScheduleTaskTab.tsx` | The right-Sidebar task tab: the same `TaskDetail` as the page, the navigation-vs-restored-binding resolution, the baseline ordinal rule, and the confirmed deletion closing the tab. |
| `packages/client/ui-schedule/src/client/ScheduleTaskTabTitle.tsx` | The tab's chip: the shown task's stored title, or the detail label while the catalog holds no row. |
| `packages/client/ui-schedule/src/client/ScheduleTurnCard.tsx` | The Turn-tail card list, reconciled against the catalog through the mount ordinal. |
| `packages/client/ui-schedule/src/client/ScheduleCreateCard.tsx` | The created-task card: title, frequency, open action, the deleted state, and the raw-result fallback. |
| `packages/client/ui-schedule/src/client/CatalogFeedback.tsx` | The shared loading/error states: a centred spinner when empty, a compact notice when content is already on screen. |
| `packages/client/ui-schedule/src/client/DeleteToast.tsx` | The app-wide deletion outcome banner, keyed by its own sequence so a later notice restarts it. |
| `packages/client/ui-schedule/src/client/ClockPicker.tsx` | The three-column clock picker: roving tabindex, arrow walk, Home/End, Enter stages, and the seconds column hidden for cron rules. |
| `packages/client/ui-schedule/src/client/DatePicker.tsx` | The month calendar: localized weekday headings, month navigation, a marked today, arrow-key walking, and clamping the day when the month shortens. |
| `packages/client/ui-schedule/src/client/PickerPopover.tsx` | The portaled, outside-dismissed, anchored shell the two pickers share. |
| `packages/client/ui-schedule/src/client/CalendarIcon.tsx` | A hand-drawn 14px calendar glyph, because the shared icon set has none. |
| `packages/client/ui-schedule/src/client/TaskManagerIcon.tsx` | The decorative sidebar clock glyph (the sidebar owns the accessible label). |
| `packages/client/ui-schedule/src/client/SessionScheduleMark.tsx` | The 16px Sidebar-row clock mark; the click is stopped so the row's own activation target is untouched. |
| `packages/client/ui-schedule/src/client/SessionScheduleHover.tsx` | The hover-card task section: at most two tasks plus an omission line, sampled once per mount. |
| `packages/client/ui-schedule/src/client/definition.ts` | The task tab type's registry definition and its navigation-parameter narrowing. |
| `packages/client/ui-schedule/src/client/task-tab-target.ts` | Resolving the task a tab shows from its navigation *or* its stored binding, and the deferred drop of a mismatched entry. |
| `packages/client/ui-schedule/src/client/locales.ts` | The `schedule.catalog` namespace; zh is the source of truth. |
| `packages/client/ui-schedule/src/client/frequency-locales.ts` | The rule and duration copy shared by both namespaces — one source for the same cron sentence and the same relative durations. |
| `packages/client/ui-schedule/src/client/task-manager-locales.ts` | The `schedule.manager` namespace: ~200 keys, including every Host timing error's recovery instruction. |
| `packages/client/ui-schedule/src/client/TaskManagerPage.module.css` | The page frame (36.6 KB): the 960px content column, the scroll region, the detail pane, the rule card, the delivery records. Read in full. |
| `packages/client/ui-schedule/src/client/TaskMenu.module.css` | The schedule-local menu card, copied from the shared menu geometry. |
| `packages/client/ui-schedule/src/client/ScheduleCatalogAction.module.css` | The 336px portaled reminder popover, the overdue row fill, and the whole-row opener overlay. |
| `packages/client/ui-schedule/src/client/ScheduleCreateCard.module.css` | The created-task card in the file-card family, with the whole-row open overlay. |
| `packages/client/ui-schedule/src/client/ClockPicker.module.css` | The three scrolling clock columns. |
| `packages/client/ui-schedule/src/client/DatePicker.module.css` | The month grid, the today ring, and the selected-day chip fill. |
| `packages/client/ui-schedule/src/client/PickerPopover.module.css` | The shared picker card (fixed, z-index 1100, translucent menu surface). |
| `packages/client/ui-schedule/src/client/SessionScheduleMark.module.css` | The 16px mark cell and the hover-card task rows (literal light grays, because the hover surface is fixed in both themes). |
| `packages/client/ui-schedule/src/client/ScheduleTurnCard.module.css` | The 10px card stack. |
| `packages/client/ui-schedule/src/index.ts` | Empty node half. |
| `packages/client/ui-schedule/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-schedule/package.json` | `dsh.client.inject` for twelve services. |
| `packages/client/ui-schedule/tsconfig.json` | Project references (schedule domain, sidebar, workspace, tool…). |
| `packages/client/ui-schedule/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-schedule/locale/en.json` | Package title + description (en). |
| `packages/client/ui-schedule/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-schedule/README.md` | The behavioural spec — the single most valuable document in this shard for the trading questions: the delete semantics, the record-paging rules, the retention pruning, the catalog/deletion separation, and the causal (never clock-based) reconciliation. |
| `packages/client/ui-schedule/README.zh.md` | Chinese mirror (head 20 lines read). |
| `packages/client/ui-schedule/tests/catalog-source.client.spec.ts` | 544 lines; pins the whole catalog contract: settled-once, the request/settled counters, one read per commit, superseding on reconnect, no read reuse across ordinals, deletion retention and readback, and post-unsubscribe behaviour. |
| `packages/client/ui-schedule/tests/task-cron.client.spec.ts` | 277 lines; pins the Vixie star flags, the parser, `cronPreview`'s sentences, `recognizeCronShape`'s matrix and `cronShapeExpression`'s round trip. |
| `packages/client/ui-schedule/tests/task-timing.client.spec.tsx` | 189 lines; pins `timingSnapshot`'s literal expected rules, the native drafts, the device-zone fallback and every `timingError` mapping. |
| `packages/client/ui-schedule/tests/schedule-format.client.spec.ts` | 319 lines; pins the zone inventory and ordering, ICU zone naming, the year policy, the locale field pairs and the relative-time units. |
| `packages/client/ui-schedule/tests/delivery-history.client.spec.tsx` | 477 lines; pins the saved-prompt clamp, the pruning notice, the failure taxonomy (remote/throw/reject/missing/cursor), the zone of each occurrence, and the append/refresh/unmount races. |
| `packages/client/ui-schedule/tests/schedule-catalog-action.client.spec.tsx` | 638 lines; pins the entry's visibility rule, the sole-reminder shortcut, the row anatomy, every frequency label, the relative countdown, and the dismissal rules. |
| `packages/client/ui-schedule/tests/schedule-create-card.client.spec.tsx` | 296 lines; pins the narrowing of the created task out of replayed JSON and every card state (pending, failed, deleted, changed). |
| `packages/client/ui-schedule/tests/schedule-turn-card.client.spec.tsx` | 646 lines; pins the Turn projection and the *causal* deletion rule — "does not state a deletion without a read that succeeded after it appeared". |
| `packages/client/ui-schedule/tests/schedule-task-tab.client.spec.tsx` | 550 lines; pins the tab's task resolution, the baseline ordinal, the restored-binding lifecycle and the chip title. |
| `packages/client/ui-schedule/tests/task-manager-page.client.spec.tsx` | 4368 lines / 202 `it` blocks; read via head 20 + describe blocks + the first 90 titles: the page layout, search and filter, the Rules/Records tabs, the linked Session, the run-time card (one-shot, interval, zone, cron) and the timing pickers. |
| `packages/client/ui-schedule/tests/task-detail.client.spec.tsx` | 1002 lines / 43 `it` blocks; read via head 20 + describe blocks + all titles: the authoritative-refresh merge, `mergeRuleDraft`, the menu close paths, the weekday memory across a kind detour, the save identity, the interval stepper and the cron rows. |
| `packages/client/ui-schedule/tests/browser-plugin.client.spec.ts` | 678 lines; pins the registration order, the header ordering against Jobs, the delete notice, the task tab type/body/chip, the row seats, and the timing-Remote failure matrix. |
| `packages/client/ui-schedule/tests/task-menu.client.spec.tsx` | 403 lines; pins the menu's keyboard contract in detail (arrow walk with wrap, Tab settles, Shift+Tab closes, header-field handover, iframe blur). |
| `packages/client/ui-schedule/tests/task-tab-bindings.client.spec.ts` | 188 lines; pins the durable binding store: one entry per tab page, pruning against the committed layout, mismatched entries, unreadable documents, and a store that rejects writes. |
| `packages/client/ui-schedule/tests/session-schedule-state.client.spec.ts` | 129 lines; pins the per-Session source and the shared-catalog projection (active-only, settled-only, stable across refreshes). |
| `packages/client/ui-schedule/tests/session-schedule-mark.client.spec.tsx` | 131 lines; pins the mark's visibility, the count, the per-Session filtering and "answers many rows from one shared catalog read". |
| `packages/client/ui-schedule/tests/session-schedule-hover.client.spec.tsx` | 228 lines; pins the two-row cap, the omission count, the per-Session filtering and the bilingual labels. |
| `packages/client/ui-schedule/tests/session-schedule-shared.client.spec.tsx` | 106 lines; pins the selector's stability when another Session's tasks move. |
| `packages/client/ui-schedule/tests/session-link.client.spec.ts` | 40 lines; pins the availability decision against the Host list, archived and loading. |
| `packages/client/ui-schedule/tests/recent-time-zones.client.spec.ts` | 46 lines; pins the device-zone seed, the five-item bound, the invalid-data fallback and the no-storage path. |
| `packages/client/ui-schedule/tests/delete-toast.client.spec.tsx` | 71 lines; pins the sequence-keyed outcome banner. |
| `packages/client/ui-schedule/tests/definition.client.spec.ts` | 18 lines; pins the builtin task type registration. |
| `packages/client/ui-schedule/tests/zone-fixture.ts` | 65 lines; a fixture of time-zone rows for the format tests (not a test itself). |

### Tier 3 — skipped with a reason (ui-schedule)
- `packages/client/ui-schedule/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.



---

### `packages/client/ui-skill` — the `/` skill source and the skill tool row

#### `packages/client/ui-skill/src/client/index.ts`
- **Purpose:** the `/`-triggered skill source (candidates, ranking, prewarm, invalidation) plus the dedicated `skill` tool row registration.
- **Key abstractions:** `CatalogFetch` (`:74`), `inject` (`:80`), `apply(ctx)` (`:86`), the `source` object (`:161`).
- **Data flow:** `ctx.remote.skills.list({sessionId})` → a per-session cached catalog → `rankByName(skills, query)` → menu candidates; the pick lands the literal `/name ` text.
- **Non-obvious design decisions:**
  - **Text is the truth.** The pick lands plain text and the prompt ships the same literal; "determinism lives host-side — the host's pre-step boundary (`dsh-tool-skill`) recognizes the leading `/name` and injects the rendered body for every entry point" (`:14-19`, `:239-249`). The source implements **no reference codec and no adjudication hooks** (`:8-9`).
  - **Catalogs cache per session with a single-flight fetch** (`:98-152`); the per-keystroke candidates re-poll a settled snapshot locally, so one session costs one RPC.
  - **The shared in-flight fetch outlives any single menu interaction** (`:19-23`): it carries its own abort, fired only on invalidation/teardown; an aborted *caller* returns empty but leaves the fetch warm (`:313` in the spec).
  - **Four invalidation paths** (`:271-275`): `agent-preset/selected` drops that one session (the catalog belongs to the preset), `plugin-manager/changed` clears everything, `connection/reset` clears everything, and plugin disposal clears everything.
  - The fetch **requires a retained Session and waits for its initial history open** before contacting the Host (`:106-117`).
  - A **failed fetch does not poison the key** — the next consumer retries (`:145-150`).
  - A subagent-addressed child resolves **no skill candidates**: "the existing skill RPC requires an attached session; viewing their persisted history must not activate them" (`:169-170`).
- **Edge cases & failure handling:** a failed `skills/list` is logged and folded into a silent menu-group drop; a lexicon listener that throws is contained so "one faulty consumer must not starve the others" (`:92-104`).
- **Surprising:** `modelInvocable: false` skills (the `disable-model-invocation` kind) wear a **user-only marker as a description prefix**, because the menu's only secondary text is the description (`:186-190`).

#### `packages/client/ui-skill/src/client/SkillRow.tsx`
- **Purpose:** the dedicated, replay-stable row for a `skill` tool call.
- **Key abstractions:** `SkillRowState` (`:13`), `SkillRowModel` (`:19`), `skillName()` (`:29`), `resultText()` (`:45`), `skillRowModel()` (`:58`), `SkillRow` (`:102`), `StartedSkillRow` (`:113`).
- **Non-obvious design decisions:**
  - The row derives its name, lifecycle and body **only from the frozen call/result slice**, "never from the current catalog, so replay stays stable when installed skills or their descriptions change" (README).
  - A **truncated JSON prefix** from a streaming call does not break the name: the first line is still "more useful than replacing the call with an unrelated catalog lookup" (`:29-39`).
  - The `preparing` stage shows **no skill name and no expansion** — preparation does not consult the installed catalog (`:102-110`).
  - `resultText()` mirrors ui-tool's own `models/tool-call-model.ts` contract, and the comment says so — a deliberate duplication with a pointer to the original (`:44-46`).
  - A **stopped** call (`error.code === 'interrupted'`) gets its own state and its own status text rather than an error (`:59-65`).
- **Edge cases & failure handling:** an empty result with an error renders `name: code`; a missing call head falls back to the raw args and then to the call id (`:29-40`).

### `packages/client/ui-subagent` — the subagent catalog, its tree, and the read-only composer

#### `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- **Purpose:** the session-header lineage: the descendant-count trigger for a root session, the breadcrumb sibling-switcher for a child session, and the portaled tree of subagent conversations.
- **Key abstractions:** `SubagentCatalogInjected` (`:25`), `tokenTotal()` (`:67`), `activityDuration()` (`:77`), `formatDuration()` (`:117`), `isKnownLeaf()` (`:196`), `CatalogRows` (`:201`), `CatalogDropdown` (`:454`), `SubagentCatalogAction` (`:760`), `SubagentHeaderLineage` (`:785`).
- **Non-obvious design decisions:**
  - **A child becomes a known leaf only after its own authoritative catalog loads empty** (`:196-198`) — an absent, loading or failed catalog leaves the row expandable.
  - **Opening a catalog dropdown does not request its root catalog** (README, "Catalog derivation"); only child expansion and failed-read retries call `refreshProjection`.
  - Each visible level advances **its own clock** while it contains a running child, and the clock is released on collapse or close (`:207-212`).
  - The token total sums **four disjoint durable usage buckets** (`:67-74`); the duration sums completed-turn duration and advances only for an *open* turn on a *running* child (`:77-100`).
  - An interrupted open turn is bounded by its **same-cut `active.through`**, "never by newer session metadata" (README).
  - The tree is a **portaled `role="tree"`** with full keyboard support: ArrowRight/Left expand and collapse branches, ArrowUp/Down/Home/End move, Escape closes and restores focus (`:661-700`).
  - **Hover opens after 150ms and closes after 120ms**; a *click-opened* menu is **pinned** and ignores hover-out (`:612-640`).
  - A member row is a `<button>` only when it is **navigable**; otherwise it is a `<div>` that becomes a button on focus (`:245-291`).
  - The lineage is derived from three fallbacks in order: the session's own subagent address, the loaded parent catalogs, then the Session summary's `origin`/`parentId` (`:786-797`).
- **Edge cases & failure handling:** a `migration-required` row keeps its history-opening actions but loses descendant expansion and its mode label (README); a failed catalog read shows a Retry button (`:215-226`).
- **Surprising:** the "descendant count" trigger is **hidden entirely** when the catalog is empty and ready — "an empty loading catalog is not evidence of children" (`:616-620`).

#### `packages/client/ui-subagent/src/client/index.ts`
- **Purpose:** the registration of the catalog action, the lineage slot, and the read-only composer takeover.
- **Key abstractions:** `selectReadOnlySubagent(owner)` (`:37`), `apply(ctx)` (`:55`).
- **Non-obvious design decisions:**
  - The composer takeover is registered at **`priority: -10`** (`:88`) and its selector yields in four cases (`:37-53`): an unknown mode, a one-shot child, or a continuable child whose exact parent is offline.
  - A **running** continuable child with an offline parent keeps the *ordinary* composer: its input is disabled but "the same primary Stop stays available so the child can be interrupted" (`:47-52`).
  - Until a Host summary establishes parent availability, the normal disabled composer is kept — "instead of claiming that the parent is offline" (`:43-45`).
  - The header action is registered at `order: 10`, "between the preset label (-10) and background tasks (20)" (`:74-79`).
- **Edge cases & failure handling:** `openChild` uses the exact `{parentSessionId, childSessionId, mode}` address, so a child opens with its own routing facts.

#### `packages/client/ui-subagent/src/client/sidebar-chat/index.tsx`
- **Purpose:** a right-Sidebar tab that hosts an existing subagent conversation.
- **Key abstractions:** `SUBAGENT_CHAT_ID` (`:18`), `SUBAGENT_CHAT_ADDRESS` (`:21`), `subagentChatAddress()` (`:51`), `parseSubagentChatAddress()` (`:64`), `subagentChatResourceProvider()` (`:102`), `ConversationSlotPanel` (`:129`), `SidebarChatTab` (`:155`), `registerSidebarChat()` (`:176`).
- **Non-obvious design decisions:**
  - The address carries the **routing facts in the query**, not in the path: `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` (`:51-58`) — so the child identity alone never suffices.
  - The resource **retains the child Session reference directly from its address** without refreshing the parent catalog, and releases it when the tab closes (`:102-119`).
  - The tab renders the **shared `conversation.content` factory** with the local view fixed to Chat, omitting the main Conversation header and width controls (`:121-124`, `:129-148`).
  - The panel distinguishes four shell phases — `settling`, `hero`, `active`, and blank — from the session's own state plus a "parent availability pending" case (`:135-146`).
- **Edge cases & failure handling:** a malformed address throws with the address quoted (`:104`); a bad percent-encoding returns undefined rather than throwing (`:64-89`).

### `packages/client/ui-user-questions` — the ask-the-user card, the timed wait, and the plan-review gate

#### `packages/client/ui-user-questions/src/client/contract/slots.ts`
- **Purpose:** the domain carrier: `PendingQuestion` (the answerable card), the waterfall channel (the Host-side request), and the plan-review narrowing.
- **Key abstractions:** `PlanReview` (`:54`), `planReviewOf()` (`:81`), `QuestionRejectionCode` (`:110`), `QuestionWaterfallChannel` (`:127`), `QuestionRpcChannel` (`:139`), `createWaterfallRequest()` (`:172`), `QuestionCardSnapshot` (`:204`), `PendingQuestion` (`:226`).
- **Non-obvious design decisions:**
  - **The countdown lives on the carrier, not on the mounted component** (`:349-364`): "the user can close the panel and reopen it from the tool call row, and a timer that died with the mount would leave the tool call waiting past its deadline."
  - The wait has **four states**: counting, focused (frozen), editing (indefinite), waiting (indefinite), continued. `holdFocus()` / `releaseFocus()` / `engage()` / `takeTime()` (`:451-497`) each preserve the *remaining duration* across the transition, so a focus pause resumes the same remainder.
  - A submission is **sent, not confirmed**: "when another browser settled the same request first, the gateway drops the late outcome silently" (README) — hence the draft survives until the projection closes the card.
  - **Close is not an answer.** A tool-call-keyed card only leaves the composer seat (`dismissal: 'hide'`, `:271`); a card the Host never named ends its request (`dismissal: 'cancel'`, `:271`, `:548-556`).
  - The card key is `question:<sessionId>:<callId>` for a named call, and a **reload-unique random prefix** for an unnamed request, so "an unnamed legacy card cannot reuse a persisted draft" (`:105-108`).
  - The rejection codes are **wire-preserved** (`ASK_ABORTED` / `ASK_CANCELLED` / `ASK_TIMED_OUT`) and carried as an `Error` with a `name` and `code` property (`:110-124`).
  - `planReviewOf()` narrows a request to the plan-review presentation only when it is **one question, no multi-select, at most two options, and one option carries the intent's approve label** (`:81-101`) — everything else stays in the generic flow.
- **Edge cases & failure handling:** `finish()` throws on a second settlement; `delegate()` is a no-op after settlement; `answer()` rejects when no channel is attached yet (`:528-547`).

#### `packages/client/ui-user-questions/src/client/index.ts`
- **Purpose:** the browser registration and the card registry.
- **Key abstractions:** `QuestionCards` (`:82`), `answerQuestion()` (`:212`), `publishContinuedQuestions()` (`:286`), `apply(ctx)` (`:368`).
- **Non-obvious design decisions:**
  - **A card outlives its seat.** "Closing the panel only unpublishes it, which keeps the request answerable from its tool call row, so this registry — not the pending-interaction registry — decides when a request is over" (`:76-80`).
  - A **plan-review card gets precedence 2** over a plain question's 1 (`:376-378`).
  - The **foreground claim** (`attachWait`) is taken for a timed request and released only after the Host accepts the outcome: "Returning a local answer does not release its foreground claim: the Host closes that stream after accepting the waterfall outcome. The plugin owns the claim through this delivery interval" (README; `:229-247`).
  - A **continued** question is answered through the Remote `answer` path; a queued steer in the durable Inbox removes the editable card until the steer is admitted or discarded (`:287-296`, `:318-325`).
  - The plugin exposes an optional `userQuestionPanels` capability so the tool row can **reopen a hidden panel** or build a **read-only review card** from the transcript (`:374-378`).
  - `dispose()` hands every live waterfall back at teardown, because "the pending-interaction registry only drains what it currently holds, and a hidden card is not in it" (`:195-203`).
- **Edge cases & failure handling:** a cancelled claim between its first frame and the continuation never reaches the card (`:250-251`); a review of a call that still holds a live card shows the live one (`:182-192`).

#### `packages/client/ui-user-questions/src/client/QuestionComposer.tsx`
- **Purpose:** the composer takeover: the generic question flow, the pager, the drafts, and the timed wait's visible state.
- **Key abstractions:** `parseRecommendedLabel()` (`:35`), `recommendedFirstOption()` (`:43`), `isQuestionDraftProgress()` (`:49`), `isComposing()` (`:65`), `AnswerField` (`:106`), `QuestionComposer` (`:139`), `QuestionFlow` (`:159`).
- **Non-obvious design decisions:**
  - The **auto-growing textarea uses a hidden mirror** that owns the height (`:78-104`): "counting rows by '\n' cannot see soft wraps", and "Mirror and textarea MUST share font, line-height, padding and wrapping rules or the two heights diverge."
  - **Validation feedback is stored as a dictionary KEY** and translated at render, "so already-shown feedback follows a locale switch"; runtime wire failures pass through verbatim (`:17-21`).
  - A **"Recommended" first option is an implicit draft**, and it "remains an unsubmitted draft and does not pause a timed countdown" (`:43-46`, README).
  - The suffix `(recommended)` / `（推荐）` is **stripped for display but kept in the submitted value** (`:35-41`).
  - **Enter on a focused option attempts to submit the batch without selecting that option** (`:472-478`) — an unusual and deliberate shortcut.
  - A persisted draft is accepted only when it **still describes this question batch** (`:49-63`), so a stale draft cannot be restored into a different request.
  - The answer surface's focus/blur is tracked with `onFocusCapture`/`onBlurCapture` and a **containment check**, so a focus move *within* the surface does not freeze the countdown (`:238-246`).
  - A window blur releases the countdown; a window focus re-engages or re-freezes it (`:273-291`).
- **Edge cases & failure handling:** IME composition swallows Enter (`isComposing`, `:65-68`); a blank custom answer is treated as "not answered"; a skipped question emits `{selected: []}` and keeps other drafts (README).

#### `packages/client/ui-user-questions/src/client/draft-store.ts`
- **Purpose:** the Session-scoped, persisted draft store.
- **Key abstractions:** `QuestionDraftAnswer` (`:9`), `QuestionDraftProgress` (`:19`), `createQuestionDraftStore()` (`:43`).
- **Non-obvious design decisions:** the store is **persisted** under `dsh.user-questions.drafts.v1` (`:47`), so "leaving the Session or restarting the Client does not erase an unfinished answer"; `prune(keep)` drops drafts no live card owns (`:57-62`). The module exports only the *factory*, "so a plugin reload cannot reuse a module-global handle" (`:2-4`).

#### `packages/client/ui-user-questions/src/client/question-reply.ts`
- **Purpose:** the late-reply conversation node — a steered `user-question-reply` message projected as question/answer pairs.
- **Key abstractions:** `QuestionReplyData` (`:27`), `replyPairsOf()` (`:58`), `replyAnswerValues()` (`:106`), `replyClipboardText()` (`:120`), `questionReplyDefinition` (`:149`).
- **Non-obvious design decisions:**
  - The node is **`exclusive: true`** (`:153`): "It claims the reply message on the Chat target, so the generic message Definition never presents it" — one message, one node.
  - An **unreadable payload renders as its raw model-facing text** (`:66-70`, `:127-128`), never as an error.
  - The clipboard text is **the same whether the bubble is open or closed** (`:115-128`).
- **Edge cases & failure handling:** only well-formed options survive the narrowing (`:83-90`); a reply source without an `answered` outcome is rejected (`:168`).

### `packages/client/ui-workflow-run` — the durable workflow-run node

#### `packages/client/ui-workflow-run/src/client/workflow-definition.ts`
- **Purpose:** the deterministic replay of a durable workflow run into one keyed Chat node.
- **Key abstractions:** `WorkflowRunStatus` (`:12`), `WorkflowRunMemberData` (`:15`), `WorkflowRunPhaseData` (`:23`), `workflowPhaseKey()` (`:59`), `turnAbandoned()` (`:89`), `projectWorkflow()` (`:95`), `workflowRunDefinition` (`:154`).
- **Non-obvious design decisions:**
  - **A background run outlives its Tool Step**, so "an ordinary Step or Turn closure says nothing about liveness. Only a Turn closed after a crash or at a fork boundary proves that a run without run-end stopped" (`:89-93`).
  - The phase key **preserves absent versus empty identity**: `null` → `'missing'`, `''` → `'value:0:'` (`:59-61`).
  - **Settlement changes status without removing or reordering members** — a terminal member stays visible for review (README).
  - A **history tail containing only updates stays pending** until an older page supplies the unique start (README, "Understand the implementation").
- **Edge cases & failure handling:** a zero-member run is still its own completed node (spec `:220`).

#### `packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx`
- **Purpose:** the disclosure UI for a run → phases → members, with status-driven open/close behaviour.
- **Key abstractions:** `phaseDisclosureFacts()` (`:99`), `runDisclosureFacts()` (`:106`), `advanceDisclosureState()` (`:123`), `navigableMembers()` (`:185`), `MemberRow` (`:245`), `WorkflowRunPanel` (`:351`).
- **Non-obvious design decisions:**
  - The disclosure state machine has **three modes** — `clean`, `running`, `abnormal` — and a `pendingCleanCollapse` flag: a completion that arrives while focus is inside the content is **deferred** until the focus leaves (`:123-141`, README).
  - "The first abnormal edge opens once, normal completion closes once, and a completed phase plus the outer run open again when a new running member starts under the same phase key" (README).
  - A member is navigable only when it **and** its child are running, the current Session is its recorded parent, and the child has an available identity projection (`:185-204`).
  - The run's own state is **reconstructed from durable facts on a renderer remount**, not from the previous render's choices (README).
- **Edge cases & failure handling:** outer hiding unmounts the phase content "without a dependable blur event", so a `useLayoutEffect` settles the deferred close (`:373-397`).

### Tier 2 — bulk: a compact table, one row per file (ui-skill, ui-subagent, ui-user-questions, ui-workflow-run)

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-skill/src/client/SkillRow.tsx` | The dedicated skill tool row: preparing/running/ok/error/stopped states, the first-error-line summary, the bounded Instructions card, and the Inspect affordance. |
| `packages/client/ui-skill/src/client/SkillReference.tsx` | The `/name` chip; a preview omits activation even when the entry has an action. |
| `packages/client/ui-skill/src/client/user-text-rules.ts` | The skill-reference rule: only *confirmed* names are decorated, boundaries required, facts read lazily. |
| `packages/client/ui-skill/src/client/locales.ts` | The `skill` namespace; zh is the source of truth. |
| `packages/client/ui-skill/src/client/SkillRow.module.css` | The summary line on the shared ToolCall font-size axis, the hover chevron swap and the reduced-motion fallback. |
| `packages/client/ui-skill/src/index.ts` | Empty node half. |
| `packages/client/ui-skill/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-skill/package.json` | `dsh.client.inject` for eight services. |
| `packages/client/ui-skill/tsconfig.json` | Project references (skill domain, plugin-manager, ui-input-trigger…). |
| `packages/client/ui-skill/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-skill/locale/en.json` | Package title only. |
| `packages/client/ui-skill/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-skill/README.md` | The behavioural spec: the plain-text-reference decision, the four invalidation paths, the replay-stable row, and the four stated limitations (result-only history pages, text-is-the-truth, the prewarm window, catalog changes without an event). |
| `packages/client/ui-skill/README.zh.md` | Chinese mirror (head 18 lines read). |
| `packages/client/ui-skill/tests/skill-row.client.spec.tsx` | Pins the row: preparation without arguments, the compact summary, Enter/Space, the running announcement, the first error line, stopped/structured/error outcomes, and the durable-args fallbacks. |
| `packages/client/ui-skill/tests/user-text-rules.client.spec.ts` | Pins the rule: no facts read without a slash token, only confirmed names, boundary rules, and CJK/emoji offsets. |
| `packages/client/ui-skill/tests/skill-row-styles.client.spec.ts` | Reads the CSS *as text* and asserts the row rides the shared ToolCall font-size axis. |
| `packages/client/ui-skill/tests/browser-plugin.client.spec.ts` | 594 lines; pins the source contract: history gating, the session-keyed single-flight cache, the four invalidations, the lexicon, the plain-text pick, the user-only marker, and the reference preview's cancellation paths. |
| `packages/client/ui-subagent/src/client/locales.ts` | The `subagent` namespace: duration scales, token counts, modes, activity, and the read-only explanations. |
| `packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.tsx` | The read-only composer replacement and its three reasons. |
| `packages/client/ui-subagent/src/client/SubagentHeaderLineage.module.css` | The trigger, the switcher and the tree row geometry (read in full). |
| `packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.module.css` | The read-only notice frame. |
| `packages/client/ui-subagent/src/client/sidebar-chat/SidebarChat.module.css` | The tab body frame. |
| `packages/client/ui-subagent/src/index.ts` | Empty node half. |
| `packages/client/ui-subagent/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-subagent/package.json` | `dsh.client.inject` for nine services. |
| `packages/client/ui-subagent/tsconfig.json` | Project references (subagent domain, token-meter, resources…). |
| `packages/client/ui-subagent/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-subagent/locale/en.json` | Package title only. |
| `packages/client/ui-subagent/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-subagent/README.md` | The behavioural spec: the tree's visibility rule, hover/pin timings, the leaf rule, the continuation model (FIFO inbox + independent Stop), and the composer election. |
| `packages/client/ui-subagent/README.zh.md` | Chinese mirror (head 16 lines read). |
| `packages/client/ui-subagent/tests/browser-plugin.client.spec.ts` | 174 lines; pins the service list and the composer selection from session facts. |
| `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` | 1252 lines / ~50 `it` blocks; read via head 12 + full inventory: the catalog tree, hover/pin, keyboard traversal, migration-required rows, duration and token display, the ancestor switcher and the read-only composer. |
| `packages/client/ui-subagent/tests/sidebar-chat.client.spec.tsx` | 228 lines; pins the address round-trip, the registration, the reference lifetime and the fixed local view. |
| `packages/client/ui-user-questions/src/client/locales.ts` | The `question` namespace; zh is the source of truth. |
| `packages/client/ui-user-questions/src/client/PlanReviewPanel.tsx` | The plan-review approval card: the plan title and summary, Approve / Request changes, and the settled-state handling. |
| `packages/client/ui-user-questions/src/client/QuestionReplyView.tsx` | The late-reply bubble: the caret disclosure, the question/answer pairs, and the copy action. |
| `packages/client/ui-user-questions/src/client/PlanReviewPanel.module.css` | The review card frame (read in full). |
| `packages/client/ui-user-questions/src/client/QuestionComposer.module.css` | The takeover card frame, capped at `min(60vh, 520px)` with an internal scroll region (read in full). |
| `packages/client/ui-user-questions/src/client/QuestionReplyView.module.css` | The reply bubble geometry (read in full). |
| `packages/client/ui-user-questions/src/index.ts` | Empty node half — "the model-facing tool is composed per preset, not here". |
| `packages/client/ui-user-questions/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-user-questions/package.json` | `dsh.client.inject` for seven services. |
| `packages/client/ui-user-questions/tsconfig.json` | Project references (user-questions domain, store, ui-tool…). |
| `packages/client/ui-user-questions/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-user-questions/locale/en.json` | Package title only. |
| `packages/client/ui-user-questions/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-user-questions/README.md` | The behavioural spec: the timed card's focus/edit/take-time semantics, the two card sources, the claim lifetime, the draft's local-only scope, and the three stated limitations. |
| `packages/client/ui-user-questions/README.zh.md` | Chinese mirror (head 16 lines read). |
| `packages/client/ui-user-questions/tests/browser-plugin.client.spec.ts` | 764 lines / 31 `it` blocks; read via head 10 + full inventory: the claim lifecycle, the delegated wait, the timed card's deadline, the review card, the continued-question projection, the queued reply and the plan-review precedence. |
| `packages/client/ui-user-questions/tests/pending-question.client.spec.ts` | 161 lines / 11 `it` blocks; pins the waterfall's settle-once rule, the already-aborted request, and the four wait-state transitions. |
| `packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx` | 394 lines / 19 `it` blocks; pins the narrowing matrix and every panel state (approve, discuss, continued, failed, no-description). |
| `packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx` | 939 lines / 40 `it` blocks; read via head 10 + full inventory: the recommended default, Enter-as-submit, the batch answer, the IME Enter, the multi-line field, the timed card's focus/pause/resume, the resubmit hint, the RPC steer, and the review card. |
| `packages/client/ui-user-questions/tests/question-reply.client.spec.ts` | 176 lines / 16 `it` blocks; pins the payload narrowing, the clipboard text, and the node's exclusive claim on the reply message. |
| `packages/client/ui-user-questions/tests/QuestionReplyView.client.spec.tsx` | 148 lines / 7 `it` blocks; pins the bubble, the copy affordance and the raw-text fallback. |
| `packages/client/ui-user-questions/tests/question-draft-store.client.spec.ts` | 76 lines / 5 `it` blocks; pins the persisted drafts, the per-request isolation and the pruning. |
| `packages/client/ui-user-questions/tests/node-plugin.client.spec.ts` | 27 lines; pins that the node half mounts **no model-facing tool**. |
| `packages/client/ui-workflow-run/src/client/index.ts` | Registers the Definition, the dictionary and the keyed `workflow-run` Chat renderer. |
| `packages/client/ui-workflow-run/src/client/locales.ts` | The `workflowRun` namespace: status counts, phase and member placeholders. |
| `packages/client/ui-workflow-run/src/client/WorkflowRunPanel.module.css` | The run header, phase row and member row geometry (read in full). |
| `packages/client/ui-workflow-run/src/index.ts` | Empty node half — "the feature is entirely browser-side". |
| `packages/client/ui-workflow-run/src/css-modules.d.ts` | CSS module declaration. |
| `packages/client/ui-workflow-run/package.json` | `dsh.client.inject` for seven services. |
| `packages/client/ui-workflow-run/tsconfig.json` | Project references (workflow domain, tool-workflow…). |
| `packages/client/ui-workflow-run/tsdown.config.ts` | Shared client bundle config. |
| `packages/client/ui-workflow-run/locale/en.json` | Package title only. |
| `packages/client/ui-workflow-run/locale/zh.json` | Package title + description (zh). |
| `packages/client/ui-workflow-run/README.md` | The behavioural spec: the disclosure rules, the live-only navigation rule, the "a background run outlives its Tool Step" rule, and the four stated limitations. |
| `packages/client/ui-workflow-run/README.zh.md` | Chinese mirror (head 14 lines read). |
| `packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx` | 969 lines / ~28 `it` blocks; read via head 8 + full inventory: the definition's grouping and pending tail, the interruption fold, and the whole disclosure state machine including the deferred collapse. |
| `packages/client/ui-workflow-run/tests/panel-styles.client.spec.ts` | 50 lines; reads the CSS as text and asserts the font-size axis adoption. |

### Tier 3 — skipped with a reason (ui-skill, ui-subagent, ui-user-questions, ui-workflow-run)
- `packages/client/ui-skill/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.

- `packages/client/ui-subagent/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.

- `packages/client/ui-user-questions/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.

- `packages/client/ui-workflow-run/README.i18n.yaml` — generated bilingual-parity hash record; head peeked, not read line by line.


---

## 2. Ideas worth stealing

1. **Ordinal-based causal reconciliation instead of clock comparison** — `packages/client/ui-schedule/src/client/catalog-source.ts:11` carries `readRequest` (the newest *requested* read) and `readSettled` (the read that *produced* the records). A surface that appears with a record of its own may only conclude "it was deleted" from a read whose `readSettled` exceeds its mount anchor. "Comparing the browser's clock with the Host's would not establish that order" (`:33-37`). **Why it transfers:** August Trading's automation runs, trade log and journal all refresh from the host; a "the row vanished, so it was deleted" inference made from a *stale* read is exactly the bug this rule prevents. `UNIQUE`.
2. **The timeout owns the clock, not the component** — `packages/client/ui-user-questions/src/client/contract/slots.ts:349-364` and `packages/client/ui-schedule/src/client/TaskDetail.tsx` both keep a countdown on the *carrier*, because the panel can be hidden and remounted while the request stands. **Why it transfers:** August Trading's automation scheduler and any "waiting for the trader" approval card need the deadline to survive a re-render, a tab switch and a reload. `CONVERGENT` (same rule appears in the approval panel's one-shot lock and the question card's wait).
3. **A refusal is a *value*, not an exception** — `packages/client/ui-approval/src/client/contract/slots.ts:74` (`PendingApproval`) and `packages/client/ui-user-questions/src/client/contract/slots.ts:110` (`QuestionRejectionCode`) both carry the refusal as data (`{preset, reason}`, `ASK_CANCELLED`), and the client renders it as an ordinary outcome. The approval decision is a **promise the host awaits**, not a callback the UI fires. **Why it transfers:** August Trading's "approve this trade" gate wants an audit row, a timeout, and a delegation path — a promise is what lets all three exist. `CONVERGENT`.
4. **"Text is the truth" for the slash command** — `packages/client/ui-skill/src/client/index.ts:239-249`: the pick lands the literal `/name ` and the *host* decides what it means. "Determinism lives host-side." **Why it transfers:** August Trading's trade commands (`/log-trade BTCUSD …`) can be typed by hand or picked from a menu; resolving them once, on the host side, means the two paths cannot disagree. `UNIQUE`.
5. **The catalog is a per-session single-flight cache with four explicit invalidation paths** — `packages/client/ui-skill/src/client/index.ts:98-152, 271-275`: a preset switch drops one session, a plugin-manager change drops everything, a connection reset drops everything, and a failed fetch does not poison the key. **Why it transfers:** August Trading's model list, broker list and strategy list all need a cache that knows exactly which event invalidates it. `CONVERGENT` (the same shape appears in `ui-schedule`'s catalog source and `ui-goal`'s activation source).
6. **Derive the human sentence from the matched value set, not from the expression** — `packages/client/ui-schedule/src/client/task-cron.ts:376` (`cronFullRangeStep`) lets the parser *discover* "every 15 minutes" from `*/15`, so the description and the structured builder agree by construction and round-trip (`cronShapeExpression` `:584`). **Why it transfers:** August Trading can describe its own cron automations ("every 15 minutes during London hours") from the same values it will submit, instead of shipping a translation table. `UNIQUE`.
7. **A broken record is still readable, and the diagnostic is the document** — `packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx:135-137` and `packages/client/ui-plan/src/client/plan.ts:32-50`: a malformed record returns `undefined` (never throws), and the viewer still shows the raw YAML because "a broken preset's diagnostic points into that YAML". **Why it transfers:** August Trading's persisted trade plans and skill files should be readable even when the parser cannot read them. `CONVERGENT`.
8. **One shared catalog for N ambient surfaces** — `packages/client/ui-schedule/src/client/session-schedule-state.ts:73` and `packages/client/ui-schedule/src/client/index.ts:100-110`: the Sidebar row mark, the hover card, the page and the tab all project **one** Host read, so "N visible rows costs one read". The selector is also *stable for this row* when another Session's rows change (`:91-100`). **Why it transfers:** a trading app with a watchlist of N symbols showing per-symbol status must not issue N queries per render. `UNIQUE`.
9. **One shared clock for surfaces that sit side by side** — `packages/client/ui-schedule/src/client/relative-clock.ts:29`: the task page and its detail "must not disagree about how long remains", so they share a 30-second clock while two other surfaces deliberately keep their own beat. **Why it transfers:** August Trading's position card and its order ticket showing two different "time to target" values is a classic trust bug. `UNIQUE`.
10. **The zone list comes from the runtime, not from a table** — `packages/client/ui-schedule/src/client/schedule-format.ts:175-186`: `Intl.supportedValuesOf('timeZone')` plus `Intl.DateTimeFormat(..., {timeZoneName:'longGeneric'})`. "There is therefore no crawler or generated zone-name resource to refresh." **Why it transfers:** August Trading's broker session times and session-time labels can come from ICU with no translation table to maintain. `UNIQUE`.
11. **A "staged then applied" choice model** — `packages/client/ui-agent-preset/src/client/seat-store.ts:129-160`: a pick made before the target exists is **staged**, consumed exactly once, and dropped if the target turns out to be ineligible. **Why it transfers:** August Trading's "armed" trade setup (direction, size, stop) is naturally staged until the order is actually placed. `UNIQUE`.
12. **The host owns the zone interpretation; the browser only edits a draft** — `packages/client/ui-schedule/src/client/task-timing.ts:38` (`timingSnapshot` projects *only* the persisted rule fields for a compare-and-update), and the browser's own copy is a `TimingDraft` of native inputs. **Why it transfers:** an August Trading automation should be saved as one complete expected rule, so a concurrent edit is detected rather than silently merged. `CONVERGENT`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work** — the *dispatch* lives on the host (`packages/client/ui-schedule/README.md`), but the browser package contains the whole **authoring and observation** half: a five-field cron dialect parsed and described client-side (`task-cron.ts:232, 465`), a compare-and-update save carrying the **complete expected rule** (`task-timing.ts:38`), a durable **delivery-record history** with 20-record newest-first pages, pruning notices and retention bounds (`DeliveryHistory.tsx:70`), and a catalog that reconciles causally (`catalog-source.ts:11`). Idempotency and catch-up are host-side; the browser's contribution is the **audit-friendly record** of every delivery, including the prompt that was sent. **The breaker idea is absent here** — there is no "three empty runs and switch it off"; the README instead records that "saved records describe inbox delivery, not model execution results".
- **Human-in-the-loop approval** — `packages/client/ui-approval` is the reference answer. The approval is a **promise the host awaits** (`contract/slots.ts:74`), it is **one-shot** (`finish()` throws on a second settlement), it can be **delegated** to the next listener via a private symbol (`:145`), it is **cancelled by an AbortSignal** with a wire-preserved reason, and the panel's keyboard and pointer paths share **one lock** so a double submission is impossible (`ApprovalPanel.tsx:30`). The *audit* record stays on the host: the request carries both an immutable `reason` and a localized `displayReason`, and the UI never rewrites the audit reason (`contract/slots.ts:52-60`).
- **Post-mortem / reflection loops** — **not in this shard.** This shard is the browser half; there is no rule-learning or memory-write path here. The nearest thing is `ui-goal`'s CAS-protected goal mutation (`ui-goal/src/client/index.ts:88-99`), which is a *state* machine, not a reflection loop. The `dsh-agent-preset-registry` and `dsh-skill` domains (not in this shard) own the rules.
- **Multi-agent** — `packages/client/ui-subagent` is the whole multi-agent surface, and it is **a catalogue, not a debate**: a tree of child sessions with mode (`one-shot` / `continuable` / `external`), activity, token totals and active duration (`SubagentHeaderLineage.tsx:67-165`). There is **no debate mechanism** here at all. Two facts worth stealing: a child is a **known leaf only after its own catalog loads empty** (`:196`), and the completion rule is explicit — "a run or member without terminal events stays running after its Turn or Step ends normally, because a background run outlives its Tool Step", and is presented as *interrupted* only once its Turn closed after a crash or a fork boundary (`ui-workflow-run/src/client/workflow-definition.ts:89-93`).
- **Structured logs the model can query** — the delivery history (`ui-schedule/src/client/DeliveryHistory.tsx`) is the closest thing: immutable saved prompts + occurrence times, paginated newest-first, with **retention bounds surfaced to the user**. But it is a *UI read* of a host-owned store, not a model-queryable log. The one model-queryable artifact in this shard is the **plan document**, which is reconstructed from the session history on demand rather than stored in the UI (`ui-plan/src/client/plan-resource.ts:37`).
- **Staying simple as features accumulate** — the pattern here is **one package per surface, one controller per surface, and a shared host catalog**: every package's node half is an empty `apply()` (nine of the ten), the browser half is a registration function, and the domain logic lives in a host package (`dsh-schedule`, `dsh-goal`, `dsh-plan-mode`, `dsh-user-questions`). The deliberate forks (`ui-schedule`'s own `TaskMenu` copy of the shared `Menu`, `ui-user-questions`' copy of the approval settlement helper — both marked `jscpd:ignore` with the reason "the two owners change independently") show the cost of that independence being paid knowingly.

## 4. Non-obvious decisions and gotchas

1. **A "choice" and a "label" are different surfaces.** `ui-agent-preset` splits them: the chip on the new-session screen *picks* a preset (`AgentPresetSeat.tsx`), the session header only *names* the one the session already runs (`AgentPresetLabel.tsx`). The reason is a host rule — the host refuses to swap a session's composition after its first turn. Reading the header label as a control would promise something the host refuses.
2. **"Broken" is not "absent".** The preset roster keeps broken presets out of the *pickers* (`settings-store.ts:119`) but shows them in the *management* section, with the diagnostic, because "offering it would defer the discovery of that fact to a failed session start".
3. **`status` alone cannot tell a first read from a refresh.** `ui-schedule`'s catalog therefore carries a separate `settled` flag (`catalog-source.ts:17-24`): a refresh republishes `loading` over the *previous* records, so `status: 'loading'` is compatible with "the rows you see are stale but real".
4. **The clock is not a source of truth across a network boundary.** Two independent statements: the schedule catalog reconciles by *ordinal*, never by timestamp (`catalog-source.ts:33-37`); and the timed question's deadline is *anchored to the client clock* from a host-measured remaining duration (`ui-user-questions/src/client/index.ts:252-256`).
5. **A half-settled answer can be lost silently.** The gateway drops a waterfall outcome that arrives after another client settled the event, without telling anyone — so the client keeps its draft until the *projection* closes the card (`ui-user-questions/README.md`). A "sent" UI state is not a confirmation.
6. **`/name` in a message means the same thing whether it was typed or picked** (`ui-skill`), and **the same literal resolves to a command if a command owns the name**. The client does not adjudicate; the host does.
7. **The interrupted state is inferred, never announced.** A workflow run with no terminal events is presented as `interrupted` *only* when its Turn closed after a crash or a fork (`ui-workflow-run/src/client/workflow-definition.ts:89-93`).
8. **`jscpd:ignore` marks intentional duplication.** Both the approval and question packages carry a copy of the same settlement helper with a comment saying the lifecycles are deliberately independent.
9. **The browser owns no authority.** Every mutation in this shard is a **request to the host**: `agentPresets.select`, `schedule.update`, `goals.edit`, `userQuestions.answer`, `agentPresets.update`. The only client-side decisions are about *presentation* — which surface, which tab, which filter.
10. **A "no-op" read is still a read.** `ui-plan`'s resource provider opens the *session follow stream* and pages backwards through history until it finds the exact tool invocation (`plan-resource.ts:56-72`) — the document text is never stored in the sidebar layout, so the plan survives a reload because it was never in the browser.

## 5. Weak spots

1. **`TaskDetail.tsx` is 2,231 lines and `TaskManagerPage.module.css` is 36 KB** — one component holding the whole rule-editing grammar (eight recurrence choices, a cron builder, a merge rule, four menus, two pickers). The merge rule `mergeRuleDraft` is correct but only 12 test cases cover it, and the surrounding 1,900 lines of JSX are read once and never again.
2. **The schedule package forks shared primitives.** `TaskMenu.tsx` is an explicit copy of `ui-primitives`' `Menu` ("the two owners change independently"), and `ui-approval`/`ui-user-questions` both copy the same settlement helper. Each fork is a future divergence.
3. **Client-side cron parsing duplicates the Host's dialect and can drift.** `task-cron.ts` hand-mirrors `parseCronField`; when the two disagree the UI falls back to showing the raw expression (`schedule-format.ts:239-243`) — a safe fallback, but a symptom of the duplication.
4. **Several files are read-only-by-construction surfaces with no live feedback**: the plan preview, the plan card and the `ui-workflow-run` node are *views over durable history*, so a reader who wants "what just happened" must wait for a Host round trip.
5. **The catalog's `readRequest`/`readSettled` protocol is subtle and easy to misuse** — every consumer must record its mount anchor, and the tests show how many ways it can go wrong (a read that predates the anchor, a refresh that republishes `loading` over good records, a read that settles after unsubscribe). A simpler "fetch on demand and compare ids" would be less correct but easier to keep right.


