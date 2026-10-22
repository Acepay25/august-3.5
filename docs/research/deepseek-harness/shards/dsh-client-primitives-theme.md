# deepseek-harness :: dsh-client-primitives-theme

**Files in shard:** 624 (read: 606, skipped with reason: 18 — 15 generated `README.i18n.yaml` hash records and 3 binary WOFF2 font assets)
**What this shard covers:** The **browser-client half** of the DeepSeek Harness monorepo — fourteen `packages/client/*` UI plugin packages. Nothing here talks to a model or builds a prompt. Every package is a Cordis (`ctx.*`) plugin that contributes a component into a **slot registry**, owns one small piece of observable state, and exposes a narrow contract. The set covers (a) the **keyboard command registry** (`shortcuts`), (b) the **slash-command and trigger pipeline** (`ui-commands`, `ui-input-trigger`, `ui-reference`, `ui-shortcuts`), (c) the **shell frame and theming** (`ui-layout`, `ui-theme`, `ui-brand-official`), (d) **docking/pane layout** (`ui-dockkit`), (e) the **shared visual primitives** (`ui-primitives`), and (f) four focused business surfaces — **message feedback**, **model selection**, **permission presets**, **secret masking** — plus the **slot registry core** (`ui-slots`).

The through-line for August Trading is a *discipline of single ownership*: every piece of state has exactly one writer, every surface reachable twice reads one store, every failure path is **classified** rather than swallowed, and every "the display disagrees with the truth" case is prevented by construction (the display reads the persisted value, never the click echo).

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/client/shortcuts/src/binding.ts`
- **Purpose:** the physical-key protocol shared by browser commands and desktop adapters — no DOM, no runtime state.
- **Key abstractions:** `ShortcutBinding` (one or two physical `code`s + modifiers), `NormalizedBinding` (canonical, modifiers always sorted `control, alt, shift, meta`), `bindingKey()` (the exact-match index used for BOTH matching and conflict detection), `presentBinding()` (keycaps + ARIA), `isWebBindingAllowed()`.
- **Data flow:** a declared binding → `normalizeBinding()` (expands `primary` to `meta` on macOS and `control` elsewhere, sorts the two chord keys, validates the code against a whitelist) → `bindingKey()` for the conflict index → `presentBinding()` for display.
- **Non-obvious design decisions:** `bindingKey()` is *one* function for both lookup and conflict — so a conflict can never be computed differently from a match. The key list is sorted (`codes.sort()`), so `A+B` and `B+A` are literally the same binding, not two that happen to overlap.
- **Edge cases & failure handling:** an unsupported code throws at *registration*; two identical chord keys throw; a chord's ARIA is deliberately `undefined` (ARIA `keyshortcuts` cannot express two non-modifier keys) — `presentBinding` returns `keys` but no `aria` for chords.
- **Surprising:** `isWebBindingAllowed` encodes a browser-delivery reality, not a design choice — Windows/macOS browsers admit 3–4 modifier combos and a few single-modifier oddities, Linux admits only three. A binding that is "valid" in the model can still be undeliverable in a browser, and the registry refuses to register it.

#### `packages/client/shortcuts/src/configuration.ts`
- **Purpose:** validated preference documents and deterministic conflict resolution, with zero browser dependencies.
- **Key abstractions:** `ShortcutDocument` (schemaVersion 1|2, per-profile override maps), `ShortcutDefinition`, `EffectiveShortcut`, `ShortcutEdit` (`set` / `reset` / `reset-all`), `parseBinding`, `parseShortcutDocument`, `parseShortcutEdit`, `parseShortcutDefinitions`, `effectiveShortcuts`, `overlappingBindings`.
- **Data flow:** raw JSON → `parseShortcutDocument()` (rejects unknown top-level fields, a `schemaVersion > 2` returns the sentinel `'future'`, an unknown profile key is rejected) → `effectiveShortcuts()` merges defaults + overrides per `runtime:platform` profile → `EffectiveShortcut` rows carrying `modified`, `conflicts`, `issue`.
- **Non-obvious design decisions:** **unknown fields are rejected, not ignored** — "to prevent lossy rewrites". A document that arrives with extra keys is refused rather than partially applied, so a newer writer cannot silently drop an older writer's setting. `null` means *explicitly unbound* and is distinguished from *absent* (inherit).
- **Edge cases & failure handling:** three distinct read outcomes — `invalid` (a rejected document), `future` (a newer schema version, preserved rather than destroyed), and a valid document. Dormant command overrides for a profile the user is not on are **preserved**, so switching profiles does not lose them.
- **Surprising:** `overlappingBindings` treats a two-key chord and a single key with the same modifiers as overlapping only if the single key is *contained in* the chord — a chord does not conflict with every key it contains, only with those that could fire alone.

#### `packages/client/shortcuts/src/persistence.ts`
- **Purpose:** serialized preference transactions; the storage owner publishes only accepted writes or read diagnostics.
- **Key abstractions:** `ShortcutPersistence` — `setDefinitions()`, `readCurrent()`, `edit(edit, revision)`.
- **Data flow:** `edit()` takes an expected `revision`; the write is serialized through an internal queue; only after the write **completes durably** does the store publish a new snapshot with a bumped `revision`.
- **Non-obvious design decisions:** the write publishes **after** durability, not before — "publishes a save once and only after durable completion". A caller that optimistically flipped the UI would show a binding that a failed write then removed; this design makes the UI incapable of that lie.
- **Edge cases & failure handling:** a competing edit at the same revision returns `stale` and is **not** retried (the caller re-reads). A write failure returns `write-failed` and **keeps the previous configuration and revision**, so the same draft can be retried. A malformed or future document read retains the accepted bindings and the original bytes.

#### `packages/client/shortcuts/src/client/registry.ts`
- **Purpose:** command registration, normalized default bindings, and synchronous dispatch.
- **Key abstractions:** `ShortcutRegistry` — `register()`, `registerFixed()`, `dispatch()`, `invoke()`, `describeBinding()`-adjacent helpers, `definitions()`, `refreshLabels()`, and two observable stores (`catalog`, `config`).
- **Data flow:** a feature plugin calls `ctx.shortcuts.register()` inside `ctx.effect()`. The registry validates the declared default against **all six** `runtime:platform` profiles (desktop/web × macos/windows/linux), checking web-deliverability, reserved-binding, and pairwise overlap — then stores the command and recomputes the whole effective catalog. A keydown resolves to a `bindingKey` lookup, then a modal/region check, then `command.resolve(context)`, which returns `handled` / `blocked` / `pass`.
- **Non-obvious design decisions:** **registration is atomic** — a conflicting default throws *before* the command is added, and the catalogue snapshot reference is unchanged on failure (pinned by a test). `registerFixed()` reserves key combinations that no editable command may take, so a read-only action cannot be stolen.
- **Edge cases & failure handling:** a conflicting binding still **shows** the user's requested key in the catalogue but is marked `conflict` and **cannot execute** — "a conflicting row keeps its requested binding visible but cannot execute it". Dispatch of a conflicted key returns `blocked` with `reason: 'conflict'` and consumes the event.
- **Surprising:** on Windows/macOS **Desktop**, a binding overrides local regions and modal controls *independently of its configuration source* (`priority`), whereas Web honours the region and modal ownership. Desktop `Ctrl+W`/`Ctrl+R` are explicitly passed through when the region is `terminal`.

#### `packages/client/shortcuts/src/client/dom.ts`
- **Purpose:** the main-document keyboard adapter; local controls arbitrate before window bubbling.
- **Key abstractions:** `detectEnvironment()`, `installKeyboard()`.
- **Data flow:** a capture-phase `keydown` listener on `window` records the *pending* gesture; a bubble-phase listener then dispatches. A `MutationObserver` on `document.documentElement` watches `role` and `aria-modal` so the cached modal list is invalidated and any open fixed-sequence is reset when a dialog appears or disappears.
- **Non-obvious design decisions:** the capture/bubble split exists because a native listener can yield a microtask checkpoint before bubbling; the capture listener takes `observer.takeRecords()` **synchronously** so a modal that opened earlier in the same task is seen. The region is derived from the composed path: `.xterm` → `terminal`, an editable element → `editable`, else `page`.
- **Edge cases & failure handling:** IME composition (`compositionstart`/`end`), `focusin`, `pointerdown`, and window `blur` all reset the fixed-sequence state. A macOS-specific `Dead` key (`Option+Command+N`) is special-cased so it is not treated as composition on the Web runtime.
- **Surprising:** the `pending` flag plus a zero-timeout means the fixed-sequence consumer sees a *synthetic reset* at the end of every keypress that did not settle — the "double-Escape stop sequence" is implemented as a timed observation of two independent Escape presses, not as a state machine.

#### `packages/client/shortcuts/src/client/storage.ts`
- **Purpose:** explicit browser and Desktop preference adapters; Desktop never falls back to browser storage.
- **Key abstractions:** `SHORTCUT_STORAGE_KEY = 'dsh.keybindings.v1'`, `webShortcutStorage()`, `desktopShortcutStorage()`.
- **Data flow:** Web reads/writes `localStorage` under one key and listens for the `storage` event to re-read (cross-tab sync). Desktop goes through the `window.dshDesktop.shortcuts` preload bridge and **throws** if the bridge is absent.
- **Non-obvious design decisions:** the two adapters are separate types, not one with a fallback — "Desktop never falls back to browser storage", so a Desktop build can never read a stale Web preference written by a different origin profile.
- **Edge cases & failure handling:** a `storage` event with `key === null` (the whole store cleared) also triggers a re-read.
- **Surprising:** the Web adapter's `recording()` is a no-op — the recorder is a Desktop-only capability.

#### `packages/client/shortcuts/src/client/index.ts`
- **Purpose:** the browser command service (`ctx.shortcuts`), one keyboard adapter per plugin lifetime.
- **Key abstractions:** `ShortcutsService` — `register()`, `registerFixed()`, `observeFixedInput()`, `describeBinding()`, `edit()`, `recording()`, `closeWindow()`, plus the `catalog` / `config` / `fixedCatalog` observable faces.
- **Data flow:** the service detects the runtime, loads the Host-supplied `stopSequenceMs` config, builds a `ShortcutRegistry`, wires the storage adapter, and installs the DOM/native keyboard adapters in `ctx.effect()`s. `edit()` calls the adapter and only adopts a snapshot whose `sequence >=` the current one.
- **Non-obvious design decisions:** the **sequence check** on every publish means a late-arriving older snapshot cannot roll the UI backwards. The service throws at construction if Desktop is detected without a native keyboard bridge — a missing bridge is an explicit configuration failure, not a degraded mode.
- **Edge cases & failure handling:** a failed read configures the registry with `status: 'unreadable', error: 'read'` — visible in the catalogue rather than silently showing defaults. A failed write returns `write-failed`.
- **Surprising:** `fixedInput()` wraps each listener's gesture with a *cumulative* `defaultPrevented` and a `consume()` that marks the whole sequence consumed — one listener's consumption suppresses every later listener's action.

#### `packages/client/shortcuts/src/client/native.ts`
- **Purpose:** Desktop gestures use live focus, modal state, and verified embedding ownership.
- **Key abstractions:** `installNativeKeyboard()`.
- **Data flow:** a native IPC key event is matched against the registry only when the frame, the revision, and the focus owner all verify.
- **Non-obvious design decisions:** the native path **does not** trust the event: it checks the frame is the one marked `data-sidebar-browser-frame`, that the frame name matches, that the revision matches the accepted configuration, and that the target is a real element in the top frame — "the press would otherwise start a tab drag and capture the pointer".
- **Edge cases & failure handling:** a shadow-DOM `activeElement` (a webview guest) is rejected; a repeat event is ignored; an element removed mid-press is rejected.

#### `packages/client/shortcuts/src/client/types.ts` + `packages/client/shortcuts/src/config.ts` + `packages/client/shortcuts/src/index.ts` + `packages/client/shortcuts/src/native.ts` + `packages/client/shortcuts/src/protocol.ts`
- **Purpose:** the frozen contract surface — command/catalogue types, the `Config` schema (`stopSequenceMs`, default 500, range 1..2,147,483,646 so expiry stays inside the browser timer limit), the Host-side injection entry, the trusted preload protocol, and the protocol re-export barrel.
- **Note:** `src/protocol.ts` is the shared vocabulary between Client and Desktop main; every other module imports from it rather than from a sibling.

#### `packages/client/ui-dockkit/src/engine/operations.ts`
- **Purpose:** the operation engine — one pure `applyOp(state, op)` that returns the next state **and the operations that undo it**.
- **Key abstractions:** `applyOp`, `replay`, the `LayoutOp` union (`split`, `merge`, `openTab`, `closeTab`, `insertTab`, `insertPane`, `resize`, `focusTab`, `focusPane`, `restoreFocus`, …).
- **Data flow:** an op is applied to a `LayoutState` (a map of nodes keyed by id, a `rootId`, a `floats` list) and yields `{ state, inverse }`.
- **Non-obvious design decisions:** **inverses are captured when the operation runs**, "because by undo time the pre-operation state is gone". A split that joins an existing split of the same axis produces a two-step inverse (merge the new pane, then resize the parent back) — the inverse is a *plan*, not a mirror.
- **Edge cases & failure handling:** a merge of a pane that still holds tabs throws ("merge requires an empty pane"); merging the docked root pane throws; a two-child split collapses into its surviving child and the inverse is an `insertPane` with a `wrap` attachment.
- **Surprising:** `applySplit` halves the reference pane's share *in place* (`parent.sizes.flatMap(...)`) so the new pane's fraction and the reference pane's stay aligned whichever side the new pane took.

#### `packages/client/ui-dockkit/src/engine/planner.ts`
- **Purpose:** intent planning — each interaction as a pure function from state to the operations that carry it out.
- **Key abstractions:** `Mint` (the one place a string becomes an id), `planOpenContent`, `planPlaceTab`, `planSplit`, `planFloat`, `planSettle`, `planDropTab`, `findContentTab`.
- **Data flow:** a planner reads the state, mints the ids its ops need, and returns an op list. It **holds no state and applies nothing** — the caller applies and records.
- **Non-obvious design decisions:** the split between "plan" and "apply" is what lets the same intent vocabulary serve two embeddings — an in-process `DockController` and a host that keeps the layout in an external store. A planner returning **no** operations means the intent changes nothing; the caller records nothing and notifies nobody.
- **Edge cases & failure handling:** `planSettle` is **opt-in** — withholding the tab factory keeps the merge but leaves the root pane empty, so an embedder that wants empty panes simply does not call it, or calls it without a factory.
- **Surprising:** `revealIfOpened` defaults to true — opening the same `(kind, contentId)` twice **focuses** the existing tab instead of adding a second one.

#### `packages/client/ui-dockkit/src/engine/sequence.ts`
- **Purpose:** a linear operation history over `applyOp`.
- **Key abstractions:** `History` (`entries` + `cursor`), `HistoryEntry` (`ops` + ordered `inverse`), `record`, `stepBack`, `stepForward`, `Sequencer` (a mutable wrapper over exactly those functions).
- **Data flow:** `record(history, state, ops)` applies each op, collects its inverse, and appends one entry. `stepBack` applies the entry's inverses in reverse.
- **Non-obvious design decisions:** **one entry per intent** — the operations one gesture produced step back and forward together, so the user lands on a point they actually stopped at. A run of consecutive *focus-only* entries collapses into one undo step.
- **Edge cases & failure handling:** an intent with **no** operations records nothing. A new entry after stepping back **drops the redo branch**. An invalid op throws and **nothing is recorded** — the history is left untouched.

#### `packages/client/ui-dockkit/src/engine/constraints.ts` + `packages/client/ui-dockkit/src/engine/geometry.ts` + `packages/client/ui-dockkit/src/engine/initial.ts` + `packages/client/ui-dockkit/src/engine/tree.ts` + `packages/client/ui-dockkit/src/engine/controller.ts`
- **Purpose:** the pure rules and helpers around the operation engine.
- **Key abstractions:** `MAX_DOCK_PANES = 4`, `MIN_PANE_FRACTION = 0.12`, `FLOAT_DEFAULT_SIZE` (380×300), `FLOAT_MIN_SIZE` (220×140), `DOCK_EDGE_FRACTION = 0.25`, `zoneAt`, `zoneSplit`, `clampSizes`; `containsPoint`, `zoneInRect`, `insertionIndex`, `measurePaneFits`, `fitOf`; `createIdMinter`, `createInitialState`; `dockPaneIds`, `findParent`, `getPane`, `getTab`, `normalizeSizes`; `DockController` (the observable intent layer).
- **Non-obvious design decisions:** the model itself is **unbounded**; the caps are an *interaction-layer* rule kept pure so it can be asserted without a browser. `clampSizes` pins every share under the floor at the floor and hands the remainder to the others *in proportion*, iterating until stable — so a share that only drops under on a later pass joins the pinned set.
- **Edge cases & failure handling:** every tree reader throws on a dangling id, because the operation vocabulary is closed. Floating panes are a pane whose `host` is `'float'`, not a second concept — capacity one tab, drawn without a strip.
- **Surprising:** `geometry.ts`'s `PaneMeasure.splitControlWidth` is **optional and defaults to absent**, and the comment explains why: a half too narrow to split hides its own control, so including the control's footprint in the fixed part would make the reading flip with the control's visibility and re-render forever.

#### `packages/client/ui-dockkit/src/components/DockSurface.tsx` + `FloatLayer.tsx` + `PaneTree.tsx` + `TabLayout.tsx` + `TabMenu.tsx` + `TabPanel.tsx` + `TabTitle.tsx` + `measure.ts` + `pointer.ts` + `render.ts` + `dockkit.module.css`
- **Purpose:** the React half that renders a layout snapshot and reports **settled** intents.
- **Key abstractions:** `DockSurface`, `TabStrip`, `TabLayout`, `PaneTree`, `FloatLayer`, `TabMenu`, `useGesture`, `measurePaneFits`, `fitOf`, `halvesFit`.
- **Data flow:** a drag previews in **local component state**; the gesture's own facts stay in its closure; on release the net result leaves through exactly **one** `DockIntents` call. That is what lets the embedder record one history entry per gesture.
- **Non-obvious design decisions:** the strip follows the **WAI-ARIA tabs pattern with manual activation** — arrow keys move focus without selecting, Enter/Space select through the same intent as a click. Focus lands on **click, not on press**: a state change between `pointerdown` and the first `pointermove` rebuilds the subtree, and Chromium cancels the pointer when the pressed element is replaced — which would abandon every drag.
- **Edge cases & failure handling:** a pane's lone unclosable chip is a *label*, not a choice (`tabQuiet`); the window-drag claim is withdrawn while any pane floats, because a floating pane sorted earlier in the document would otherwise swallow the panel header; the context menu stops both `pointerdown` and `click` propagation so a press inside it does not start a tab drag.
- **Surprising:** the tab **context menu** is portalled to `document.body` and positioned against its chip by a later layout pass; the embedder's items come **last** so the kit's own item (close) is always in the same place.

#### `packages/client/ui-input-trigger/src/core/detect.ts` + `packages/client/ui-input-trigger/src/core/menu.ts` + `packages/client/ui-input-trigger/src/core/contract.ts` + `packages/client/ui-input-trigger/src/types.ts`
- **Purpose:** the pure trigger-detection and menu-reduction core — zero React, zero DOM, zero Cordis.
- **Key abstractions:** `detectTrigger()` → `TriggerHit` (`{ trigger, query, span, position }`), `menuReduce(state, event)` → `MenuState`, `exactMatch()`, `seedGroups()`.
- **Data flow:** a draft + caret position → a scan **backward** from the caret for a live trigger char → a hit carrying the span and the query. Menu groups are per-source; each settles independently and is **generation-gated**.
- **Non-obvious design decisions:** the reducer is **frozen** — `menuReduce` returns the *same reference* when nothing changed, which is what makes `useSyncExternalStore` cheap. A settlement from a stale generation is dropped **by reference**, not by a version number.
- **Edge cases & failure handling:** a failed source is **silently removed** from the menu (with a console record); the menu auto-closes when every group has settled ready-and-empty. The URL rule is explicit: `/` is dead when its predecessor is a word character, so `https://…` never opens the menu. Guard tiers: `plain` (both live), `claimed` (`/` suppressed, `@` live), `frozen` (neither).
- **Surprising:** the query is cut at a **mid-token** caret — the menu shows the text up to the caret, not the whole token.

#### `packages/client/ui-input-trigger/src/client/controller.ts` + `service.ts` + `MenuView.tsx` + `contract.ts` + `locales.ts` + `slots.ts`
- **Purpose:** the per-session half of the trigger pipeline and the root source registry.
- **Key abstractions:** `InputTriggerController` (owns the hit, the menu store, the launcher store, the headers store, the lexicon, the fetch lifecycle), `InputTriggerService` (`ctx.inputTriggers` — `registerSource()`, `sessionOf()`), `MenuView`.
- **Data flow:** the service keeps **only the source roster**; every mutable interaction state lives on the per-session controller, which is created lazily and dies with the session scope. A source is warmed into every session controller it can reach; a source whose lexicon rolls change after warm implements `subscribeLexicon` and the controller re-polls.
- **Non-obvious design decisions:** the **hit outlives the menu close** — it is kept for space adjudication, so Space can still settle a command after the menu closed. A **dismissal is sticky**: the same token re-tracked with the same query keeps its menu closed, so restoring the caret after a pointer dismissal (or after a settled command closes the surface it opened) cannot bring the menu back. Typing a new query or moving to another token re-arms it.
- **Edge cases & failure handling:** a duplicate `(trigger, name)` registration **throws**. A faulty source's `warm`/`subscribeLexicon` callback is contained — the registration still stands with a usable disposer and the remaining controllers are still notified. A failed candidate fetch drops that source's group silently with a console record.
- **Surprising:** Space/Enter adjudication **polls** the optional `matchSpace`/`matchEnter` hooks in registration order and the first non-`undefined` answer wins — a source can refuse a submission it cannot consume whole. `matchClaim` awaits the source's own warmup and answers only a *claim*, never opening a popup, running an action, or executing the command.

#### `packages/client/ui-commands/src/client/contract.ts` + `popup.ts` + `option-groups.ts` + `presentation.ts` + `resolution.ts` + `service.ts` + `directory.ts` + `index.ts` + `locales.ts` + `PopupSelectView.tsx`
- **Purpose:** the client command API — the `/` source, three dispatch kinds, the per-session command directory, and the `popupSelect` / `action` registration surface.
- **Key abstractions:** `PopupSelectSpec`, `ActionSpec`, `CommandUiSpec`, `SelectOption` (with `group`, `badge`, `detail`, `active`, `confirmation`), `PopupSearchMode` (`'substring' | 'fuzzy-label'`), `PopupSelectController`, `CommandDirectory`, `groupOptions()`, `rankByName()`, `TokenSegment` (`menu` span vs `enter` bare token).
- **Data flow:** a `/` keystroke → the input-trigger source → the session's `CommandDirectory` (a capability-keyed cache) → a candidate list → a pick → either a popupSelect shell, an action, or a host command. The popup shell loads its options **once** per open and filters locally.
- **Non-obvious design decisions:** the shell is a **transient layer**, never in the input state machine; draft consumption and composer focus are injected callbacks, so the controller never touches the input machine. **Settlement rights die with the binding identity** — a dismiss/dispose/reopen swaps the binding, so a settling options fetch or `onSelect` that no longer matches writes nothing and consumes nothing. A **directory pull requires the client to already hold the session** and waits for the first history open to succeed before sending `commands.list`, so a background refresh cannot reopen a closed session.
- **Edge cases & failure handling:** a client-contribution whose name collides with a host command fails **loud** at candidate synthesis and never shadows. A failed options fetch keeps the shell open with a `failed` status and a retry; the failed group is removed from the menu. A draft carrying attachments refuses any command path that does not declare `input.attachments`, with a localized `attachmentsUnsupported` refusal shown as a transient toast and the draft left in place.
- **Surprising:** the highlight parks on the option marked `active` — "the row the session already uses" — so **accepting without looking confirms the current value** rather than the topmost row. A business package that marks a row `active` for presentation alone silently makes that row the default pick. Group order is **first-occurrence order** and does not change when a query hides an earlier row.

#### `packages/client/ui-reference/src/client/index.ts` + `FileReference.tsx` + `user-text-rules.ts` + `locales.ts`
- **Purpose:** the unified `@` source for file, folder, and session mentions.
- **Key abstractions:** the `@file` / `@session` candidate groups, the atomic inline reference, `UserTextRule` (forward file/folder recognition in original text).
- **Data flow:** `@` → Remote-backed discovery → a completion menu (files first, then sessions) → a pick that inserts an **atomic reference** with a stable clipboard form. A directory row carries two verbs: settling resolves the folder as a reference; drilling keeps plain editable path text with the menu still open.
- **Non-obvious design decisions:** **one unavailable domain does not fail the other** — a failed file list still lists sessions. Session mentions are **validated before model context is captured**, but *browsing* candidates has no model effect.
- **Edge cases & failure handling:** a session-reference preparation failure occurs *after* prompt acceptance and terminates that agent turn — an explicit, visible failure rather than a dropped mention. Paths with whitespace use `@"path with spaces"`, and a quote the user opened explicitly stays quoted.
- **Surprising:** file rows omit redundant root locations, and a session row shows a workspace only when it differs from the current one — the label is a *difference*, not a state.

#### `packages/client/ui-secret-mask/src/client/credential-scanner.ts` + `credential-formats.ts` + `credential-masks.ts` + `secret-rule.ts` + `format-tables.ts` + `SecretText.tsx` + `index.ts`
- **Purpose:** display masking for recognized credentials in sent user text, with a per-value reveal control.
- **Key abstractions:** `CREDENTIAL_FORMATS` (the formats as **data**: literal, kind, shape, run, min, max), `credential-scanner.ts` (prefix-pruned linear scanning that allocates nothing until it returns a node), `formatTables()` (typed-array lookup tables built once), `credential-masks.ts` (every mark comes from a slice of a shared string), the `secret` `UserTextRule`.
- **Data flow:** sent user text → the `secret` rule → a keyed node renderer → `SecretText` draws the masked value with an eye control. **Masking changes only what is drawn**; the message text, the copy action, and the model input keep the original characters.
- **Non-obvious design decisions:** the formats are **data, not regular expressions**. The matcher is a hand-written prefix-pruned scanner with a literal-only alternation and typed-array character-class tables — because the regexes it replaced were a backtracking denial-of-service risk. `tests/regex-oracle.client.ts` keeps the old regexes as an **equivalence oracle**, and `secret-rule-equivalence.client.spec.ts` proves the new matcher produces the same nodes.
- **Edge cases & failure handling:** the credential is recognized by its **published format alone**; a value that merely *looks* like a key is not masked unless it matches. A key keeps its first eight characters and every remaining character becomes `*`.
- **Surprising:** the mask is drawn in a **monospace font** so revealing it does not move the surrounding text — a rendering detail that is a real correctness requirement for a masked UI.

#### `packages/client/ui-slots/src/index.ts` + `src/renderer.ts` + `src/store.ts`
- **Purpose:** the slot registry pure core — the composition model every plugin in this shard builds on.
- **Key abstractions:** `SlotMap` / `SlotFactoryMap` / `LocaleNamespaceMap` (all empty interfaces extended by `declare module` augmentation), `SlotEntryDef`, `ChildrenDecl`, `SlotSpec<E>`, `PropsRuntime<K>`, `PropsStore`, `PropsLocale`, `SlotRendererHost`, `SlotRenderer`, `StaleAuthorizationError`, `SlotOwnershipError`.
- **Data flow:** an owner declares a child slot; a registrant calls `register()` contributing a component, optionally declaring child slots, a store seat, and a business face. The renderer reads the ledger and materialises the props.
- **Non-obvious design decisions:** **declaring a slot is claiming it** — the registering entry becomes the only entry allowed to render that key, and registering into an undeclared slot, declaring an already-declared child, mounting one shared handle under two scopes, or registering a chain without `select` **throws at load**. The five framework props shares (runtime, child-render, factory-render, store, business) are derived from declaration-merged types; components reference the derived aliases and **never re-type a share locally**.
- **Edge cases & failure handling:** an entry's disposer collapses its declared child slots **recursively** — ledger rows, contributions, and store mounts die on one lifecycle axis. A `chain` entry that crashes reports **without abdicating**; a `single`/`keyed`/`list` entry that crashes **abdicates** (retires from its cell, one-shot) so the next survivor renders. A retained `renderSlot` binding invoked after its declarer was disposed throws `StaleAuthorizationError`.
- **Surprising:** `SlotMap` and the standard-kit interfaces live *directly in the entry module*, not in a re-export, because "consumer `declare module` augmentation merges with declarations lexically in the augmented module, not with re-exports".

#### `packages/client/ui-primitives/src/DisclosureRow.tsx` + `packages/client/ui-primitives/src/DisclosureRow.module.css`
- **Purpose:** the shared disclosure header — a 24px process row used by tool calls, thinking rows, and command rows.
- **Key abstractions:** `DisclosureRow` (memoised, controlled `open` / `expandable` / `onToggle`).
- **Data flow:** the row reads its title, optional accessory, and optional collapsed content; the chevron swaps the leading icon on hover.
- **Non-obvious design decisions:** the row height, the leading box, and the glyph edge all move by the **same** `--dsh-content-font-delta`, so the icon keeps its optical share of the line when the user changes the font size. The glyph override is `svg:not([data-state])` — `StateDot` carries `data-state` and stays at its fixed size, because a status mark is not text furniture.
- **Edge cases & failure handling:** the row can be click-expandable (`role="button"`, `tabIndex=0`, `aria-expanded`) or the leading button alone is the target; the two never both claim the click.
- **Surprising:** the whole component is `memo`ised, and the comment states the requirement plainly: "Shallow prop comparison requires stable callbacks and React nodes to skip unchanged renders."

#### `packages/client/ui-primitives/src/markdown/parse.ts` + `render.tsx` + `highlight.ts` + `incremental.ts` + `CodeBlock.tsx` + `katex.tsx` + `file-link.ts` + `plain-text.ts` + `MarkdownText.tsx` + `JsonBlock.tsx` + `cjkFriendlyStrong.ts` + `mathCompatibility.ts` + `local-image-syntax.ts` + `MarkdownDelegate.tsx` + `useViewportHighlighting.ts`
- **Purpose:** the untrusted assistant-Markdown renderer, replaced from a `react-markdown`/`remark-rehype` pipeline with a direct mdast→React switch.
- **Key abstractions:** `parseGfm` / `parseGfmWithMath` (two grammars, one per rendering arm), `MarkdownText`, `CodeBlock`, `StreamingHighlightSession`, `highlightToHtml`, `extractMarkdownPlainText`, `parseFileLink`.
- **Data flow:** markdown text → micromark → mdast → one switch over parsed nodes → React elements. Streaming re-tokenizes only *appended* text and keeps completed line groups (and the DOM) untouched, in groups of 32 lines.
- **Non-obvious design decisions:** the **streaming arm parses GFM without math**, so incomplete TeX never flashes KaTeX errors mid-stream; the settled arm adds math. Merge-extensible node unions **fall through to "render nothing"** rather than `assertNever`, because grammars registered elsewhere may add node types this renderer has no mapping for. Raw HTML renders as **literal text**; images require absolute HTTP(S); KaTeX runs without trusted commands; fragment-anchor URLs fail the allowlist, so footnote references render as plain text rather than in-page links.
- **Edge cases & failure handling:** `useViewportHighlighting` keeps offscreen blocks plain and **permanently** activates only intersecting blocks, releasing the shared observer when the last pending block unmounts; if `IntersectionObserver` is unavailable it highlights immediately. The highlighter is a synchronous fine-grained shiki core with a **JavaScript regex engine** (no oniguruma WASM, bundle-friendly); only TypeScript, shell, and JSON load at boot and every other language loads lazily, falling back to plain text until its grammar arrives.
- **Surprising:** the rendered DOM is **pinned byte-for-byte** by `tests/fixtures/markdown-dom/*.settled.txt` / `*.streaming.txt` — a fixture corpus that is a DOM compatibility baseline, reviewed as user-visible Markdown change.

#### `packages/client/ui-primitives/src/Modal.tsx` + `packages/client/ui-primitives/src/useModalLayer.ts` + `packages/client/ui-primitives/src/Modal.module.css`
- **Purpose:** the one full-detail modal — mask, card, Escape, focus trap.
- **Key abstractions:** `Modal` (headless or chrome variants), `useModalLayer`.
- **Data flow:** `useModalLayer` registers the dialog with a document-level layer stack; Escape and Tab go to the **top** layer only.
- **Non-obvious design decisions:** the layer stack is **one shared mechanism** across modals and the settings shell; a newer menu or an unregistered dialog **blocks dismissal of the modal behind it**, and a modal whose owner declines dismissal stays open. `data-modal-autofocus` marks the initial control, because React's `autoFocus` runs *before* the modal can capture its invoking control.
- **Edge cases & failure handling:** focus is restored to the real opener on close; a lower layer disappearing does not steal focus; a headless empty dialog keeps focus in the dialog.

#### `packages/client/ui-primitives/src/Menu.tsx` + `MenuGroup.tsx` + `MenuSurface.tsx` + `Menu.module.css` + `MenuGroup.module.css` + `MenuSurface.module.css`
- **Purpose:** the shared menu material, the accessible menu-group pattern, and the macOS backing.
- **Key abstractions:** `Menu`, `MenuGroup`, `observeStickyMenuGroups(viewport)`, `MenuSurface`.
- **Data flow:** `MenuGroup` renders a `role="group"` section with an instance-owned heading id; `observeStickyMenuGroups` watches each group's start sentinel and the sections themselves with `IntersectionObserver` + `ResizeObserver` and toggles a `data-stuck` attribute.
- **Non-obvious design decisions:** the `listbox` role and the sticky-heading machinery are **separate** — a listbox may not carry a header, so the crumb header rides its own snapshot store. The macOS **backing** is a separate `document.body` portal positioned with CSS anchors: Chromium needs opaque pixels behind the page content to blur it over native vibrancy, and the backing must be inserted *after* its anchor (nested React portals can insert it before).
- **Edge cases & failure handling:** without `IntersectionObserver`/`ResizeObserver` the headings simply stay transparent — a graceful degradation, not a broken state. The group's membership is captured at setup; dispose before observing changed groups.

#### `packages/client/ui-primitives/src/focus.ts` + `input-modality.ts` + `keyboard-composition.ts`
- **Purpose:** focus presentation, document-wide input-modality tracking, and composition lifetimes.
- **Key abstractions:** `focusWithoutRing(element, options?)`, the `data-dsh-automatic-focus` attribute, the `html[data-input-modality='pointer']` attribute, `observeComposition(document)`.
- **Data flow:** `focusWithoutRing` sets the attribute, focuses, and removes the attribute on the first Tab / arrow / Home / End / blur.
- **Non-obvious design decisions:** **only ring paint is suppressed** — elevation and selected borders remain. Editable controls keep their focus feedback on click; other controls reveal rings on keyboard navigation only (`input-modality`). A `WeakMap` of releases means calling `focusWithoutRing` twice on the same element releases the first.
- **Edge cases & failure handling:** a `keydown` that is a composition (`event.isComposing`) or carries a modifier does not release the ring.

#### `packages/client/ui-primitives/src/ansi.ts` + `TerminalBlock.tsx` + `SearchBlock.tsx` + `ReadBlock.tsx` + `DiffBlock.tsx` + `WebBlock.tsx` + `head-tail-cap.ts`
- **Purpose:** the agent-output renderers — terminal output, search results, file reads, diffs, and web retrieval.
- **Key abstractions:** `parseAnsiLines`, `TerminalBlock`, `SearchBlock`, `ReadBlock`, `DiffBlock`, `WebBlock`, `headTailCap(total, maxLines, expanded)`.
- **Data flow:** raw tool output → ANSI parsing → a flat row list → a head/tail slice under a height cap.
- **Non-obvious design decisions:** `headTailCap` is **one** function shared by every capped surface, so "a body's head and tail slices agree across the front ends" — the same arithmetic as the TUI transcript's collapsed card. The cap keeps the **head and tail** (not the first N) so the end of a long output stays visible. `DiffBlock` computes its own local patch with `structuredPatch` and a bounded `maxEditLength` (256), falling back to a whole-fragment replacement when the search exceeds the limit.
- **Edge cases & failure handling:** `contentLines` treats a single trailing newline as a **terminator**, not an extra empty line — "the same terminator rule TerminalBlock applies to command output" — while an interior blank line survives. ANSI handling honours SGR colours, CR, backspace, and erase-in-line; absolute cursor positioning, screen clearing, and alternate-screen sequences are **stripped**. `TerminalBlock` is explicitly **not** a terminal emulator.
- **Surprising:** the terminal card's left gutter is **padding, not margin**, because every consumer rewrites `margin` wholesale and silently cancelled the reservation, letting the run-state dot fall outside the card into a container that clips it.

#### `packages/client/ui-primitives/src/StateDot.tsx` + `Switch.tsx` + `Tag.tsx` + `Pill.tsx` + `Button.tsx` + `Checkbox.tsx` + `Input.tsx` + `InlineEditor.tsx` + `RiskConfirmation.tsx` + `Toast.tsx` + `Tooltip.tsx` + `HoverCard.tsx` + `HoverCardGroup.tsx` + `JsonTree.tsx` + `ConfigField.tsx` + `settings-form/*` + `relative-time.ts` + `file-size.ts` + `rank-by-name.ts` + `user-text.tsx` + `clipboard.ts` + `use-copy-feedback.ts` + `useAnchoredPosition.ts` + `useAnchoredMaxHeight.ts` + `useDismissOnOutsidePointer.ts` + `pointer-grace.ts` + `overlay-top-margin.ts` + `TextShimmer.tsx` + `SegmentedControl.tsx` + `SegmentedTabs.tsx` + `ShortcutKeys.tsx` + `PathLabel.tsx` + `CodeToolbar.tsx` + `CommandText.tsx` + `ConnectionIndicator.tsx` + `FileTypeIcon.tsx` + `CodeFileIcon.tsx` + `LinkIcon.tsx` + `SiteGlyph.tsx` + `PermissionIcon.tsx` + `ReferenceIcon.tsx` + `FishLogo.tsx` + `BrandWordmark.tsx` + `FoldToggle.tsx` + `ImageLightbox.tsx` + `ImagePreview.tsx` + `icons/*` + `code-file-types.ts` + `code-highlighting.ts` + `code-file-icon-artwork.ts` + `darwin-desktop.ts`
- **Purpose:** the rest of the shared atom set.
- **Key abstractions:** the individual components above, plus the shared helpers `relativeTime` (bucketed relative time, so two surfaces naming the same moment say the same word), `fileSizeText`, `rankByName` (case-insensitive ordered-subsequence matching; prefix first, then alignment score, then source order), `writeClipboard`, `useCopyFeedback`, `useAnchoredPosition`, `useAnchoredMaxHeight`, `useDismissOnOutsidePointer`, `pointer-grace`.
- **Non-obvious design decisions:**
  - `StateDot` **pins every CSS animation in the loader's subtree to document time zero** (`animation.startTime = 0`), so loaders started at different moments rotate *in step*. The element's own `animationstart` listener re-pins each restart.
  - `Switch` keys its appearance off `aria-checked` rather than a parallel class, "so the visual state cannot disagree with the state assistive technology reads".
  - `Button`, `Tag`, `Pill`, `Switch`, `Checkbox` are **controlled atoms with no state of their own** — the caller holds the truth.
  - `Tag` takes no `onClick` and no `active`; the selectable capsule is `Pill`. A tag is a read-only badge; conflating them is the mistake the file names.
  - `RiskConfirmation` is the shared in-page gate for a sensitive action: the owner supplies the copy, the acknowledgement is the owner's state.
  - `Toast` uses **one** `holdMs` for both the unmount timer and the stylesheet's fade delay (passed as a custom property), "so the two can no longer disagree and leave the banner unmounting mid-fade". The banner surface stays click-through; only the action text takes the pointer.
  - `Tooltip` portals its body to escape clipping containers and stacking contexts, and `prefers-reduced-motion` drops the slide-in but keeps the opacity fade.
  - `HoverCardGroup` keeps a group **warm** across the gap between a list row and its card (pointer grace), so the card does not flicker while the pointer crosses.
  - `relativeTime` bucketing is centralised so "two surfaces naming the same moment" agree.
  - `rankByName` is the one ranker for the `/` menu; a prefix hit outranks a stronger non-prefix alignment.
  - The icon set is **currentColor** and `size` is a prop, not part of the component name; `ICON_REGULAR_STROKE = 1`, `ICON_MEDIUM_STROKE = 1.3`. `CodeFileIcon` embeds full-colour per-language artwork with a **manifest of design-export digests** next to it, so the artwork's provenance is checkable.
- **Edge cases & failure handling:** `PathLabel` re-checks clipping on path change and on `ResizeObserver` (and falls back gracefully without it). `CommandText` stays selectable while overflowing horizontally. `useAnchoredMaxHeight` clamps a bottom-anchored overlay to the space above its bottom edge. `useDismissOnOutsidePointer` counts a portaled surface as *inside* while still closing on an outside press.

#### `packages/client/ui-theme/src/theme-settings.ts` + `packages/client/ui-theme/src/boot-theme.ts` + `packages/client/ui-theme/src/index.ts` + `packages/client/ui-theme/src/client/*` + `packages/client/ui-theme/src/styles/*`
- **Purpose:** the theme, font-size, and font-family preference system over the `--dsw-*` token sheets.
- **Key abstractions:** `THEME_PREFERENCES` (`light` | `dark` | `system`), `FONT_ROLES` (`text` | `code` | `terminal`), `FONT_SIZE_SPECS` (per-role field, body variable, min, max, default), `normalizeFontFamily`, `isThemePreference`, `bootThemeInjections()`, `ThemeRuntime`, `installThemeStyles()`, `ThemePresenter`.
- **Data flow:** the Host persists the preference in the `ui-theme` settings namespace; the Host injects a **synchronous bootstrap** into the index HTML (head CSS colours the canvas *before* any script runs; a body script installs the palette selector and the font variables before the shell mounts); the client service then owns the live preference, resolves `system` through `prefers-color-scheme`, and publishes immutable `ThemeSnapshot`s that `ui-layout`'s presenter projects onto `document.body`.
- **Non-obvious design decisions:** the **theme service never touches the DOM** — `ui-layout`'s presenter does. The rows read the **persisted preference**, never the resolved active theme, and the **displayed value follows the persisted setting, never the click echo**. Font lists are normalised by dropping quotes, backslashes, angle brackets, and control characters and double-quoting every name except CSS generic families; the user list **precedes** the built-in stack, so a missing font falls back. Font sizes are per role: text 10–22 px (default 14), code 10–16 px (default 11), terminal 10–20 px (default 13).
- **Edge cases & failure handling:** rapid changes **serialise in gesture order with namespace revisions**, and a rejected latest write reloads the durable values. An invalid preference crossing the settings wire is ignored. The boot bootstrap falls back to light when `matchMedia` is unavailable and uses a media query for `system`.
- **Surprising:** the token sheets are the **sole colour authority** — "values absent from the design system are deliberately not appended; the nearest semantic token wins". The code font stack **deliberately omits a bare `monospace` tail**, because Windows CJK falls back to SimSun otherwise. `scrollbar.css` uses `@supports not selector(::-webkit-scrollbar)` to split the two engines, because declaring `scrollbar-width` and `::-webkit-scrollbar` together makes Chromium drop every webkit rule *including* the hover thumb.

#### `packages/client/ui-layout/src/client/AppFrame.tsx` + `AppFrame.module.css` + `columns.ts` + `service.ts` + `stores.ts` + `theme-presenter.ts` + `DocumentTitle.tsx` + `shortcut-locales.ts` + `index.ts`
- **Purpose:** the three-column shell frame, the panel geometry service, and the theme presenter.
- **Key abstractions:** `AppFrame`, `computeColumns(viewport, sidebar, rightbar, collapsedWidth)`, `clampWidth`, `LayoutController` (`ctx.layout`), `createLayoutStore`, `ThemePresenter`, `DocumentTitle`.
- **Data flow:** the layout plugin's one `register()` call contributes `AppFrame` into the runtime's built-in `root` slot **and** declares the frame's child slots (`sidebar`, `main`, `shell.bottom`, `shell.overlay`), seats the layout store, and wires the panel-action service face. The document title follows the selected main panel without subscribing the frame.
- **Non-obvious design decisions:** the **squeeze order is fixed** — the right panel shrinks, then loses its track, and only then may the centre drop below its minimum. A drag has **no transition delay**; the right handle is hidden when the panel is closed or fullscreen. Only the discrete collapse/expand toggle eases the tracks (`data-animating`), because an eased track chases the live window edge and rubber-bands while the user resizes the window.
- **Edge cases & failure handling:** the sidebar's manual override is cleared only when the viewport crosses 1024px; a closed right track stays closed when the frame widens; dragged px preferences survive resize, close, and reopen but are clamped to 300px and 70% of the current frame; a fullscreen-open on a phone retains a minimum normal preference.
- **Surprising:** the `main` slot is **keyed**, and the reserved `conversation` key hosts the Conversation — other keys receive no Session binding. Registering into `sidebar` **replaces** the navigation column outright rather than adding to it, and the seats it declares disappear with it.

#### `packages/client/ui-model-selection/src/client/service.ts` + `catalog.ts` + `directory.ts` + `ModelSelect.tsx` + `provider-order.ts` + `slots.ts` + `locales.ts`
- **Purpose:** model selection over one per-session provider-grouped directory, shared by the `/model` popup and the composer seat.
- **Key abstractions:** `ModelDirectoryResolver` (`ctx.modelDirectories`), `ModelCatalogDirectory` (one Host-generation catalog), `ModelDirectory` (per-session), `ModelSelect`, `orderModelProviders`.
- **Data flow:** the resolver owns a `WeakMapWithValues<SessionBinding, ModelDirectory>`; each directory combines the shared catalog with the Session's own projection. Both selection entries resolve their session's directory through the resolver, "which is what makes the dual entry one shared state".
- **Non-obvious design decisions:** the resolver **fails loud** on an unknown session ("resolved no scope" / "resolved no binding") rather than returning an empty directory. `orderModelProviders` puts the account and official providers first, preserving every other relative order and the model order within each group.
- **Edge cases & failure handling:** `connection/reset` resets the catalog generation and every directory's connected state; the catalog refreshes on `llm/adapters-updated`, `settings/document-updated`, and credential record/reference updates.

#### `packages/client/ui-permission-presets/src/client/catalog.ts` + `index.ts` + `PermissionSelect.tsx` + `PermissionRow.tsx` + `presentation.ts` + `settings-store.ts` + `locales.ts`
- **Purpose:** the permission preset surfaces — a future-default row in Settings and a current-session `/permission` picker.
- **Key abstractions:** `PermissionCatalogDirectory` (one process-scoped directory), `PermissionRow`, `PermissionSelect`, the `RiskConfirmation` gate.
- **Data flow:** the directory subscribes to the **payload-free** catalog notification **before its first Remote read** (closing the install/read race) and publishes only the latest complete success for the active connection generation. The Settings row writes one `settings.mutate` path operation with the descriptor revision. The current-session picker is a `popupSelect` **decoration** on the host `/permission` command — the host command keeps its slash-menu row, its argument-bearing form, and its durable lifecycle logging; only the bare invocation is replaced.
- **Non-obvious design decisions:** the two observables are `{ value }` and `{ count }` (one tick per notification or generation change) — **invalidation and value are separate channels**, because "`store`'s publications also settle a read a displayed surface is waiting for". Every catalog invalidation closes an open picker or its confirmation **without consuming the draft**; publishing the result of a read the picker waits for leaves it open with its failure and retry state.
- **Edge cases & failure handling:** when the live catalog withdraws a preset, the composer closes its pending confirmation and shows the Session's **current** value instead of an unavailable optimistic pick. A winning failure or connection reset clears the old snapshot, hiding the composer seat until a later existing trigger retries, while the slash picker stays available and shows the failure with its retry. Stale-generation and disposed settlements are ignored.
- **Surprising:** `custom` is **display state, never a target**; and the Settings row's value applies only when a *later* session is created — changing it never switches or rewrites the current session.

#### `packages/client/ui-message-feedback/src/client/controller.ts` + `dialog.ts` + `surface.ts` + `index.ts` + `MessageFeedbackActions.tsx` + `FeedbackDialog.tsx` + `slots.ts` + `locales.ts`
- **Purpose:** the per-message Like/Dislike pair and the feedback dialog behind both ratings and `/feedback`.
- **Key abstractions:** `MessageFeedbackController` (the browser-local object layer over one Session's durable sidecar), `FeedbackDialogController` (one draft per open), `FeedbackSurface` (one per Session).
- **Data flow:** the Host owns per-item compare-and-swap; the browser layer mirrors it. A rating opens the dialog; submitting records the rating **with** the filled content and shows a thank-you toast; clicking an already-recorded rating **withdraws** it directly without opening the dialog. A bare `/feedback` opens the same dialog; `/feedback <text>` goes through the host command path.
- **Non-obvious design decisions:** only a **finalised** message can carry feedback — an interrupted frozen partial has no `messageId` and therefore no controls. The dialog draft is **preserved on a handler error** so the user can retry. A toast sequence number restarts a toast already on screen; a newer toast is left alone.
- **Edge cases & failure handling:** a rating or list load failure is shown **inline**; a submit failure is shown as a warning toast with the dialog **still open**. The controller does not consume the feedback log event, so another tab's rating appears only on reconnect or the next conflict response.
- **Surprising:** the controller uses a **generation counter** so in-flight work from a disposed surface is orphaned rather than written into a new surface's state.

#### `packages/client/ui-shortcuts/src/client/Reference.tsx` + `Editor.tsx` + `store.ts` + `fixed.ts` + `feedback.ts` + `locales.ts` + `Icons.tsx`
- **Purpose:** the searchable, editable keyboard-shortcut reference and its Settings row.
- **Key abstractions:** `ShortcutReference`, `ShortcutsRow`, `ShortcutEditor`, `createShortcutsStore`, `coreActionOrder` (a hard-coded product order independent of plugin registration).
- **Data flow:** the reference reads the effective catalog and the accepted config, and writes through `Shortcuts['edit']` (a revision-checked edit). Recording is a native capability; the draft is validated against `describeBinding` before it is saved.
- **Non-obvious design decisions:** **core actions follow a fixed product order, independent of plugin registration, unloading, or remounting** — `coreActionOrder` is a literal list, and extension commands follow in stable command-id order. Search matches an ordered subsequence within one label, English alias, or key combination, ignoring case; **search relevance takes precedence** and equal matches keep the display order. Commands that cannot execute **remain silent**.
- **Edge cases & failure handling:** a third key rejects the recording draft; a conflicting or invalid binding is still shown but cannot execute; a nested confirmation, a pending write, or an active recording **prevents the reference shortcut from closing the dialog**. Held-key repeats are ignored.
- **Surprising:** the Settings entry reads the *same* effective binding for its tooltip and its `aria-keyshortcuts`, and both are absent without a binding.

#### `packages/client/ui-brand-official/src/client/Brand.tsx` + `packages/client/ui-brand-official/src/client/index.ts` + `packages/client/ui-brand-official/src/index.ts`
- **Purpose:** the official DeepSeek Harness brand occupants for the sidebar, active only in official builds.
- **Key abstractions:** `OfficialBrandMark`, `OfficialBrandWordmark`.
- **Data flow:** a build-profile check decides whether the package's occupants are registered; the node half is an empty `apply` so the plugin still appears in the host's plugin list.
- **Non-obvious design decisions:** the package **has no runtime state and does not affect model requests**, and other build profiles keep the shell's fish mark and the local-build label while the conversation hero always uses the animated fish.
- **Surprising:** a *replacement brand package* is the intended path for another identity — the brand is a slot occupant, not a constant.

---

### Tier 2 — bulk: a compact table, one row per file

#### `packages/client/shortcuts/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Package contract: per-device defaults, six `runtime:platform` profiles, `registerFixed`/`observeFixedInput`, `stopSequenceMs` (default 500 ms), and the Windows `+` vs macOS chord keycap convention. |
| `README.zh.md` | The Chinese mirror of the above (the pair is hash-pinned by `README.i18n.yaml`). |
| `locale/en.json` | Locale namespace metadata: title only. |
| `locale/zh.json` | Locale namespace metadata with a Chinese description. |
| `package.json` | Package identity, `dsh.client` injection list, `files` allow-list, and the client/host export map. |
| `tests/config.host.spec.ts` | Host config row: `stopSequenceMs` is validated, injected into the index, and defaults correctly. |
| `tests/configuration.client.spec.ts` | Document parsing: schema versions 1/2, unknown-field rejection, `future` handling, edit parsing, and the definition validator rejecting null defaults, duplicate ids, and conflicting defaults. |
| `tests/desktop-chords.client.spec.ts` | Chord normalisation, canonical ordering, ARIA omission, macOS dead-key handling, and the property that a rejected conflicting registration leaves the **active** command working. |
| `tests/dom.client.spec.ts` | The DOM adapter: region detection, modal arbitration, composition, dead keys, and the capture/bubble ordering. |
| `tests/fixed-input.client.spec.ts` | The fixed double-Escape sequence: the timed observation, the reset on blur/focus/pointer, and the "one consumer suppresses the rest" rule. |
| `tests/native.client.spec.ts` | Native Desktop input: frame identity, revision, shadow-DOM/webview rejection, and the live-target rule. |
| `tests/persistence.client.spec.ts` | Preference transactions: publish-after-durable, `stale` on a competing revision, `write-failed` keeping the previous revision, malformed/future documents retaining accepted bindings. |
| `tests/registry.client.spec.ts` | Registration and dispatch: duplicate ids, conflicts across all six profiles, web-deliverability, `blocked` vs `pass`, modal and region ownership, repeat suppression. |
| `tests/service.client.spec.ts` | The service face: catalog/config observables, `describeBinding` conflict reporting, edit outcomes, and the `unreadable` status. |
| `tests/storage.client.spec.ts` | The two storage adapters: the Web localStorage key, cross-tab `storage` events, and the Desktop bridge. |
| `tsconfig.client.json` | Client half build config: `rootDir: src`, `outDir: lib/types`, project references. |
| `tsconfig.host.json` | Host half build config: the pre-plugin injection entry points. |
| `tsconfig.json` | Solution file referencing the client and host halves. |
| `tsdown.config.ts` | Bundle config (`clientBundle`) with the type-entry argument. |

#### `packages/client/ui-brand-official/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the official mark/name appear in the sidebar **only** in `official` builds; other profiles keep the fish mark and local-build label; the hero always uses the animated fish; a different identity ships a *replacement* brand package. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity and export map. |
| `tests/browser-plugin.client.spec.tsx` | The browser half registers its occupants and unwinds on teardown. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |

#### `packages/client/ui-commands/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the `/` command line is **never** silently downgraded to a prompt; three dispatch kinds (leadingInput / popupSelect / action); the menu's sections are ordered by usage frequency; a group's order is first-occurrence and does not change when a query hides earlier rows; `searchMode` defaults to substring and `/model` uses fuzzy-label. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/client/PopupSelectView.module.css` | The popup card: translucent menu material, elevation stroke rebinding, the 320px design cap, and the transparent search field. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/browser-plugin.client.spec.ts` | The browser half on a real Cordis context with fake slash/slot faces. |
| `tests/directory.client.spec.ts` | Per-key status transitions, the epoch guard, and key isolation across sessions. |
| `tests/popup-view.client.spec.tsx` | The view: focus on open, local filtering, keyboard navigation, the accept paths, and the dismissal paths. |
| `tests/popup.client.spec.ts` | The controller: one fetch per open, the retry path, the binding-identity drop, and the consume/focus contract. |
| `tests/service.client.spec.ts` | The runtime: the bare-token guard, the scoped consume-token dispatch, the disposer, and the directory invalidation events (`commands/change`, `agent-preset/selected`, `connection/reset`). |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-dockkit/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the engine is pure and the components are the only React half; `applyOp` returns its own inverses; `replay` reproduces the tree; `planSettle` is **opt-in**; a gesture leaves through exactly one intent so the embedder records one history entry; the strip follows WAI-ARIA tabs with manual activation. Names the package an **internal engine** whose exports may change in any release. |
| `README.zh.md` | Chinese mirror. |
| `package.json` | Package identity; deliberately depends on **no** Cordis at runtime ("zero cordis"). |
| `src/contract/adapter.ts` | The outward contracts: state in, intents out. Every host-specific thing arrives through these. |
| `src/contract/types.ts` | The layout model and operation vocabulary: branded `PaneId`/`SplitId`/`TabId`, `LayoutState`, `LayoutOp`, and the focus-op subset. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/app-region-styles.client.spec.ts` | The macOS app-region subtraction, asserted against the CSS on disk: the chip run, the strip-end chrome, the pane body, and the divider. |
| `tests/apply.client.spec.ts` | Each operation's effect on the tree **and** that applying its inverse returns the exact starting state. |
| `tests/components.client.spec.tsx` | The React surface driven by props alone — no Cordis. |
| `tests/constraints.client.spec.ts` | The four-pane cap, the five dock regions, and the divider clamping. |
| `tests/controller.client.spec.ts` | The interaction vocabulary the UI calls, including tab identity (focus an existing tab vs open a new one). |
| `tests/fixtures.client.ts` | Shared spec fixtures; the kit has no notion of a guide or a preview tab, so the suites supply their own content families. |
| `tests/geometry.client.spec.ts` | The drag geometry: point tests, zone resolution, insertion slots, and the drag threshold. |
| `tests/measure.client.spec.ts` | The DOM side of the room rule over a hand-built pane tree. |
| `tests/planner.client.spec.ts` | The two properties a refactor must not lose: **determinism** (a planner reads only the state it is given) and **closure** (the same intent on the same state yields the same ops). |
| `tests/sequence.client.spec.ts` | The linear history, exact inverses, the focus-run undo step, and the dropped redo branch. |
| `tests/tab-layout.client.spec.tsx` | Body retention across pane moves, floating, raising, and docking; focus hand-off to the newly selected strip. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config (`staticLinked`). |
| `src/index.ts` | The package entry: the engine and the components together. |

#### `packages/client/ui-input-trigger/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the composer keeps focus while the menu is open; the highlight rides `aria-activedescendant`; a dismissed menu stays dismissed for the same token and query; `matchSpace`/`matchEnter` are polled in registration order and the first non-undefined answer wins; the `listbox` role sits on the scrolling viewport, not the bounded shell. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/client/MenuView.module.css` | The menu card: the overlay anchor's width, the 400px cap, the elevation rebinding, the scrollbar rail, and the overflow fade that disappears at the final row. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/apply.client.spec.ts` | The wiring: the service mounts once `sessions` is up, the dictionaries are registered, and the overlay entry is removed on teardown. |
| `tests/core-detect.client.spec.ts` | Word boundaries, position, guard tiers, span and query behaviour, and the URL rule. |
| `tests/core-menu.client.spec.ts` | Every reducer transition: hit, settle, fail, move, hover, close, and exact match — including the stale-generation drops. |
| `tests/menu-view.client.spec.tsx` | The view rendering, props-direct. |
| `tests/service.client.spec.ts` | The split architecture: the roster on the service, the state on the controller, and the lexicon re-poll. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |
| `src/client/index.ts` | The plugin body: mounts the service and self-registers `MenuView` into `conversation.input.overlay`. |

#### `packages/client/ui-layout/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the squeeze order (right panel shrinks → loses its track → centre may fall below its minimum); the `main` slot is keyed and `conversation` is reserved; `shell.bottom` spans the row under all three columns; the window chrome seat; the panel and the conversation edge must move on the **same** curve during the animation. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/app-frame.client.spec.tsx` | Frame interactions with a real store and explicitly driven browser measurements. |
| `tests/apply.client.spec.ts` | The plugin declares its dependencies, provides `ctx.layout`, declares the root-scoped frame slots, and unwinds the service, the root registration, and the child declarations on teardown. |
| `tests/columns.client.spec.ts` | The squeeze: preferences, the 70% right-panel cap, the minimum centre, and the "does not reduce the wide sidebar to keep a normal right panel open" rule. |
| `tests/document-title.client.spec.tsx` | The title projection and the product-title restore. |
| `tests/layout-store.client.spec.ts` | The store: the 264–420px sidebar clamp, the 1024px override-clear rule, the main-panel selection, the right panel's track/fullscreen reports, and the instant-geometry markers. |
| `tests/service.client.spec.ts` | The controller: right-column transitions, panel selection without geometry change, and superseded asynchronous navigation. |
| `tests/theme-presenter.client.spec.ts` | The presenter's apply, follow, and unwind. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Host loader entry; the browser-only plugin provides no host-side behaviour. |

#### `packages/client/ui-message-feedback/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: both ratings open the dialog; the rating is recorded **only on submit**; clicking an already-recorded rating **withdraws** it; only a finalised message carries controls (an interrupted frozen partial has no `messageId`); the same dialog serves the message and the session target. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/client/FeedbackDialog.module.css` | The card width that leaves four categories on the first row and three on the second. |
| `src/client/MessageFeedbackActions.module.css` | The compact action-button geometry. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/browser-plugin.client.spec.tsx` | The browser half on a real Cordis context with fake slots/remote faces. |
| `tests/controller.client.spec.ts` | The object layer: the compare-and-swap, the generation guard, and the withdrawal. |
| `tests/dialog.client.spec.ts` | The dialog controller: one draft per open, submission by target, success and failure. |
| `tests/feedback-dialog.client.spec.tsx` | The rendered dialog: seven category chips, the detail box, and the acknowledgement. |
| `tests/message-feedback-actions.client.spec.tsx` | The action row rendering and gestures, and the shared state with the dialog. |
| `tests/styles.client.spec.ts` | The stylesheet contract asserted against the CSS text on disk. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-model-selection/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the `/model` popup and the composer seat are **two entries over one per-session directory**; the account and official providers sort first; the displayed value follows the persisted model, not the click. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/client/ModelSelect.module.css` | The composer's model seat: the 28px chip, the row-relative width cap, and the effort value beside the mode. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/browser-plugin.client.spec.ts` | The browser half on a real Cordis context with fake command/slots/connection faces. |
| `tests/catalog.client.spec.ts` | The catalog: the generation guard, the refresh triggers, and the error surface. |
| `tests/expected/account-first.txt` | The expected provider order: account first, then official. |
| `tests/expected/unselected-model.txt` | The expected unselected-model label (Chinese). |
| `tests/model-select.client.spec.tsx` | The seat's rendering and the two-level interaction. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/client/index.ts` | The plugin body: the two entries over the one directory, and the directory resolver. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-permission-presets/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the Settings row changes only the **future** default; the composer and `/permission` change the **current** session; Full access and Auto require their own risk acknowledgement; `custom` is display state, never a target; the host confirms every change through the Session projection. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity, `dsh.client` injection list, and the export map. |
| `src/client/PermissionRow.module.css` | The row geometry: title, description, and the preset pill. |
| `src/client/PermissionSelect.module.css` | The composer's permission trigger geometry. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/browser-plugin.client.spec.ts` | The browser half hangs the `/permission` decoration and unwinds. |
| `tests/catalog.client.spec.ts` | The directory: the generation change, the invalidation tick, and the failure. |
| `tests/permission-presets-row.client.spec.tsx` | The Settings row's behaviour. |
| `tests/permission-select.client.spec.tsx` | The composer's control: the value, the confirmation, and the withdrawn-preset path. |
| `tests/settings-store.client.spec.ts` | The settings controller. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-primitives/` — source

| File | What it is / what it pins |
| --- | --- |
| `src/Button.module.css` | The button geometry: 36px / 28px, the radius scale, and the variant fills. |
| `src/Checkbox.module.css` | The checkbox geometry and the focus ring. |
| `src/CodeCard.module.css` | The shared code/terminal/diff card surface. |
| `src/CommandText.module.css` | The horizontally scrollable command text. |
| `src/ConfigField.module.css` | The generated-form field geometry. |
| `src/ConnectionIndicator.module.css` | The indicator's two-column grid. |
| `src/DiffBlock.module.css` | The diff row colours, the `+`/`-` prefixes, and the expand control. |
| `src/FileTypeIcon.module.css` | The per-category palette, with a local violet for image/video because the design platform has no violet token. |
| `src/HoverCard.module.css` | The card is a block, not an inline-flex, so a full-width list row is not shrunk. |
| `src/ImageLightbox.module.css` | The full-viewport lightbox layer; the Windows caption stays unpainted. |
| `src/ImagePreview.module.css` | The passive preview frame. |
| `src/InlineEditor.module.css` | The multi-line editor geometry. |
| `src/Input.module.css` | The single-line input geometry. |
| `src/JsonTree.module.css` | The JSON token colours. |
| `src/PathLabel.module.css` | The auto-margin trick that keeps the filename suffix visible on overflow. |
| `src/Pill.module.css` | The capsule geometry. |
| `src/ReadBlock.module.css` | The gutter-numbered read rows. |
| `src/RiskConfirmation.module.css` | The acknowledgement dialog's geometry. |
| `src/SearchBlock.module.css` | The search-result card geometry. |
| `src/SegmentedControl.module.css` | The track and the sliding indicator. |
| `src/SegmentedTabs.module.css` | The pill-based tab strip. |
| `src/ShortcutKeys.module.css` | The keycap geometry, including the boxed variant for the settings reference. |
| `src/StateDot.module.css` | The dot and step appearances; the solid states keep the 10px slot but paint a 6px core. |
| `src/Switch.module.css` | The switch keys its appearance off `aria-checked`, not a parallel class. |
| `src/Tag.module.css` | The tag capsule; only the palette varies. |
| `src/TerminalBlock.module.css` | The terminal card, the run-state gutter, and the banner's clipped corners. |
| `src/TextShimmer.module.css` | The activity-shimmer geometry. |
| `src/Toast.module.css` | The toast surface; the fade delay comes from the component as a custom property. |
| `src/Tooltip.module.css` | The bubble geometry, the portal z-index, and the reduced-motion rule. |
| `src/WebBlock.module.css` | The web-retrieval card geometry. |
| `src/code-file-icon-artwork.manifest.json` | The design-export digests for the 48 embedded code icons, plus the excluded language. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `src/guide-artwork.tsx` | The fixed-palette sidebar guide artwork. |
| `src/icons/index.tsx` | The shared current-color product icon set: one component per glyph, `size` a prop, regular (1px) and medium (1.3px) weights. |
| `src/icons/props.ts` | The shared icon props. |
| `src/icons/shared-artwork.tsx` | The artwork shared by several icons. |
| `src/markdown/CodeBlock.module.css` | The code-block visual baseline. |
| `src/markdown/JsonBlock.module.css` | The JSON block margin. |
| `src/markdown/MarkdownText.module.css` | The Markdown visual baseline. |
| `src/plugin-artwork.tsx` | The fixed-palette plugin artwork for the plugin-management surfaces. |
| `src/settings-form/SettingsForm.module.css` | The settings form layout. |
| `src/settings-form/SettingsForm.tsx` | One plugin's settings page, including the read-only notice when the deployment stores nothing. |
| `src/settings-form/fields.module.css` | The field row: label, control, override badge, hint. |
| `src/settings-form/fields.tsx` | The controls of a settings form, including the override badge. |
| `src/settings-form/form-model.ts` | The staged form model: what a draft shows before it is written and which wire call a save reaches. |
| `src/user-text.module.css` | The inline projection of sent user text. |
| `package.json` | Package identity and the heavy dependency set (shiki, micromark, katex, anser, diff). |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config (`staticLinked`). |

#### `packages/client/ui-primitives/` — tests and fixtures

| File | What it is / what it pins |
| --- | --- |
| `tests/SegmentedTabs.client.spec.tsx` | The pill tab strip's selection and keyboard behaviour. |
| `tests/ansi.client.spec.ts` | The ANSI parser's SGR handling and the stripped sequences. |
| `tests/atoms.client.spec.tsx` | The shared atoms' ref forwarding and controlled behaviour. |
| `tests/checkbox.client.spec.tsx` | The checkbox keeps native label activation and controlled state. |
| `tests/code-block.client.spec.tsx` | The code block's two arms, the copy button, and the wrap toggle. |
| `tests/code-card-controls.client.spec.tsx` | The shared code-card toolbar controls. |
| `tests/code-file-icon.client.spec.tsx` | The per-language code glyph and the per-instance clip path. |
| `tests/code-highlighting.client.spec.tsx` | The lazy grammar load and the viewport activation. |
| `tests/command-text.client.spec.tsx` | The selectable overflowing command text. |
| `tests/config-field.client.spec.tsx` | The shared configuration input. |
| `tests/diff-block.client.spec.tsx` | The diff rows, the fold, the wrap, and the copy. |
| `tests/disclosure-row-styles.client.spec.ts` | The DisclosureRow font-size axis asserted as CSS text (jsdom has no layout). |
| `tests/file-size.client.spec.ts` | The byte-count formatting on both sides of every rounding threshold. |
| `tests/file-type-icon-styles.client.spec.ts` | The per-category palette asserted as CSS text. |
| `tests/file-type-icon.client.spec.tsx` | The file classification and the glyph. |
| `tests/fixtures/markdown-dom/blockquote-nested.settled.txt` | The settled-arm DOM baseline for a nested blockquote. |
| `tests/fixtures/markdown-dom/blockquote-nested.streaming.txt` | The streaming-arm DOM baseline for a nested blockquote. |
| `tests/fixtures/markdown-dom/cjk-strong-and-inline-code-url.settled.txt` | The settled-arm DOM baseline for CJK strong emphasis, inline code, and a URL. |
| `tests/fixtures/markdown-dom/cjk-strong-and-inline-code-url.streaming.txt` | The streaming-arm DOM baseline for CJK strong emphasis, inline code, and a URL. |
| `tests/fixtures/markdown-dom/code-fences.settled.txt` | The settled-arm DOM baseline for fenced code blocks with the toolbar. |
| `tests/fixtures/markdown-dom/code-fences.streaming.txt` | The streaming-arm DOM baseline for fenced code blocks with the toolbar. |
| `tests/fixtures/markdown-dom/definition-only.settled.txt` | The settled-arm DOM baseline for a definition with no reference. |
| `tests/fixtures/markdown-dom/definition-only.streaming.txt` | The streaming-arm DOM baseline for a definition with no reference. |
| `tests/fixtures/markdown-dom/entities-and-escapes.settled.txt` | The settled-arm DOM baseline for HTML entities and backslash escapes. |
| `tests/fixtures/markdown-dom/entities-and-escapes.streaming.txt` | The streaming-arm DOM baseline for HTML entities and backslash escapes. |
| `tests/fixtures/markdown-dom/fence-trailing-blank-lines.settled.txt` | The settled-arm DOM baseline for a fence with trailing blank lines. |
| `tests/fixtures/markdown-dom/fence-trailing-blank-lines.streaming.txt` | The streaming-arm DOM baseline for a fence with trailing blank lines. |
| `tests/fixtures/markdown-dom/footnotes.settled.txt` | The settled-arm DOM baseline for a footnote and its reference. |
| `tests/fixtures/markdown-dom/footnotes.streaming.txt` | The streaming-arm DOM baseline for a footnote and its reference. |
| `tests/fixtures/markdown-dom/gfm-strikethrough-and-literals.settled.txt` | The settled-arm DOM baseline for GFM strikethrough and literal text. |
| `tests/fixtures/markdown-dom/gfm-strikethrough-and-literals.streaming.txt` | The streaming-arm DOM baseline for GFM strikethrough and literal text. |
| `tests/fixtures/markdown-dom/hard-breaks-and-hr.settled.txt` | The settled-arm DOM baseline for a two-space hard break and a horizontal rule. |
| `tests/fixtures/markdown-dom/hard-breaks-and-hr.streaming.txt` | The streaming-arm DOM baseline for a two-space hard break and a horizontal rule. |
| `tests/fixtures/markdown-dom/heading-tight-against-list.settled.txt` | The settled-arm DOM baseline for a tight heading against a list. |
| `tests/fixtures/markdown-dom/heading-tight-against-list.streaming.txt` | The streaming-arm DOM baseline for a tight heading against a list. |
| `tests/fixtures/markdown-dom/headings-and-paragraphs.settled.txt` | The settled-arm DOM baseline for headings and paragraphs with inline code. |
| `tests/fixtures/markdown-dom/headings-and-paragraphs.streaming.txt` | The streaming-arm DOM baseline for headings and paragraphs with inline code. |
| `tests/fixtures/markdown-dom/images.settled.txt` | The settled-arm DOM baseline for an image with alt text and lazy loading. |
| `tests/fixtures/markdown-dom/images.streaming.txt` | The streaming-arm DOM baseline for an image with alt text and lazy loading. |
| `tests/fixtures/markdown-dom/inline-code-with-newline.settled.txt` | The settled-arm DOM baseline for inline code containing a newline. |
| `tests/fixtures/markdown-dom/inline-code-with-newline.streaming.txt` | The streaming-arm DOM baseline for inline code containing a newline. |
| `tests/fixtures/markdown-dom/links-and-autolinks.settled.txt` | The settled-arm DOM baseline for a link and an autolink. |
| `tests/fixtures/markdown-dom/links-and-autolinks.streaming.txt` | The streaming-arm DOM baseline for a link and an autolink. |
| `tests/fixtures/markdown-dom/lists-tight-loose-nested.settled.txt` | The settled-arm DOM baseline for tight, loose, and nested lists. |
| `tests/fixtures/markdown-dom/lists-tight-loose-nested.streaming.txt` | The streaming-arm DOM baseline for tight, loose, and nested lists. |
| `tests/fixtures/markdown-dom/math-edge-cases.settled.txt` | The settled-arm DOM baseline for the math edge cases (trusted commands stay off). |
| `tests/fixtures/markdown-dom/math-edge-cases.streaming.txt` | The streaming-arm DOM baseline for the math edge cases (trusted commands stay off). |
| `tests/fixtures/markdown-dom/math-inline-and-display.settled.txt` | The settled-arm DOM baseline for inline and display math. |
| `tests/fixtures/markdown-dom/math-inline-and-display.streaming.txt` | The streaming-arm DOM baseline for inline and display math. |
| `tests/fixtures/markdown-dom/raw-html-dropped.settled.txt` | The settled-arm DOM baseline for raw HTML dropped to literal text. |
| `tests/fixtures/markdown-dom/raw-html-dropped.streaming.txt` | The streaming-arm DOM baseline for raw HTML dropped to literal text. |
| `tests/fixtures/markdown-dom/reference-links-and-images.settled.txt` | The settled-arm DOM baseline for reference links and reference images. |
| `tests/fixtures/markdown-dom/reference-links-and-images.streaming.txt` | The streaming-arm DOM baseline for reference links and reference images. |
| `tests/fixtures/markdown-dom/streaming-typical-partial.settled.txt` | The settled-arm DOM baseline for a typical partial streaming document. |
| `tests/fixtures/markdown-dom/streaming-typical-partial.streaming.txt` | The streaming-arm DOM baseline for a typical partial streaming document. |
| `tests/fixtures/markdown-dom/table-header-only.settled.txt` | The settled-arm DOM baseline for a header-only table. |
| `tests/fixtures/markdown-dom/table-header-only.streaming.txt` | The streaming-arm DOM baseline for a header-only table. |
| `tests/fixtures/markdown-dom/table-wide-and-blockquote.settled.txt` | The settled-arm DOM baseline for a wide table and a blockquote. |
| `tests/fixtures/markdown-dom/table-wide-and-blockquote.streaming.txt` | The streaming-arm DOM baseline for a wide table and a blockquote. |
| `tests/fixtures/markdown-dom/table-with-alignment.settled.txt` | The settled-arm DOM baseline for a table with column alignment. |
| `tests/fixtures/markdown-dom/table-with-alignment.streaming.txt` | The streaming-arm DOM baseline for a table with column alignment. |
| `tests/fixtures/markdown-dom/task-lists.settled.txt` | The settled-arm DOM baseline for task-list checkboxes. |
| `tests/fixtures/markdown-dom/task-lists.streaming.txt` | The streaming-arm DOM baseline for task-list checkboxes. |
| `tests/highlight-viewport.client.spec.tsx` | Viewport-activated highlighting: offscreen blocks stay plain, an intersecting block stays plain until its grammar loads, and the observer is released. |
| `tests/hover-card-group.client.spec.tsx` | The group's warmth across the list-to-card gap, and the stale clipboard feedback after a handoff. |
| `tests/hover-card.client.spec.tsx` | The dwell delay, the dismissal grace, the re-entry rules, and the press behaviour. |
| `tests/icons.client.spec.tsx` | Every icon renders at its size and honours the class. |
| `tests/image-lightbox.client.spec.tsx` | The lightbox's dismissal paths and focus restoration. |
| `tests/image-preview.client.spec.tsx` | The passive preview. |
| `tests/inline-editor.client.spec.tsx` | The multi-line editor's save-on-Enter and its layout. |
| `tests/input-modality.client.spec.ts` | Pointer focus and keyboard navigation use distinct tooltip and ring policies. |
| `tests/json-tree.client.spec.tsx` | The JSON inspector's folding and selection. |
| `tests/labels.client.ts` | The shared label fixtures for the renderer suites. |
| `tests/link-icon.client.spec.tsx` | The category glyphs. |
| `tests/markdown-compact.client.spec.tsx` | The compact Markdown mode. |
| `tests/markdown-dom-parity.client.spec.tsx` | The fixture corpus is a DOM compatibility baseline; review diffs as user-visible Markdown change. |
| `tests/markdown-file-links.client.spec.tsx` | The file-link destinations and their line ranges. |
| `tests/markdown-image-entries.client.spec.tsx` | The image entries. |
| `tests/markdown-incremental.client.spec.tsx` | An append-only rerender must not re-parse or re-render the frozen blocks. |
| `tests/markdown-path-images.client.spec.tsx` | The local image paths. |
| `tests/markdown-plain-text.client.spec.ts` | The plain-text projection in its three modes. |
| `tests/markdown-render-units.client.spec.tsx` | Branch coverage for mdast node types a real parse cannot reach. |
| `tests/markdown-test-components.tsx` | The shared Markdown test components. |
| `tests/markdown.client.spec.tsx` | The Markdown renderer's behaviour. |
| `tests/menu-group.client.spec.tsx` | The group naming, the sticky transitions, and the viewport-observer ownership. |
| `tests/menu-surface.client.spec.tsx` | The menu backing's lifetime and placement identity. |
| `tests/modal-layer.client.spec.tsx` | The layer stack: only the top modal closes, a newer menu blocks the modal behind it, Tab stays in the top dialog, and the listeners are released on unmount. |
| `tests/path-label.client.spec.tsx` | The path label's full hover text and its clipping updates. |
| `tests/plugin-artwork.client.spec.tsx` | The plugin artwork renders at 36 by default and repeats without document-global ids. |
| `tests/rank-by-name.client.spec.ts` | The ranker's ordering: prefix, boundary, adjacency, gaps, then source order. |
| `tests/read-block.client.spec.tsx` | The read card's rows, the highlight, the banner, the cap, and the copy. |
| `tests/relative-time.client.spec.ts` | The relative-time buckets. |
| `tests/search-block.client.spec.tsx` | The search card's rows and cap. |
| `tests/segmented-control.client.spec.tsx` | The segmented control is a tablist whose selection the owner holds. |
| `tests/settings-fields.client.spec.tsx` | The settings form's fields. |
| `tests/settings-form-model.client.spec.ts` | The staged form model: what a draft shows before it is written, which wire call a save reaches, and what happens on failure. |
| `tests/settings-form.client.spec.tsx` | The settings form frame: what it says in each state, and that leaving it discards. |
| `tests/state-dot-styles.client.spec.ts` | The StateDot palette asserted as CSS text. |
| `tests/state-dot.client.spec.tsx` | The state dot's states and appearances. |
| `tests/streaming-code-block.client.spec.tsx` | The streaming arm's incremental tokenization equals the settled arm's. |
| `tests/switch.client.spec.tsx` | The switch's `aria-checked` driven appearance. |
| `tests/tag-styles.client.spec.ts` | The tag palette asserted as CSS text. |
| `tests/tag.client.spec.tsx` | The read-only badge. |
| `tests/terminal-block-styles.client.spec.ts` | The terminal status positioning relative to the command's first visual line. |
| `tests/terminal-block.client.spec.tsx` | The terminal card's banner, dot, and body. |
| `tests/text-shimmer.client.spec.tsx` | The activity animation. |
| `tests/toast.client.spec.tsx` | The toast's hold/fade cycle and the anchored placement. |
| `tests/tooltip-node.client.spec.ts` | The tooltip's node-environment behaviour. |
| `tests/tooltip.client.spec.tsx` | The tooltip's anchoring and dismissal. |
| `tests/use-anchored-max-height.client.spec.tsx` | The viewport-fit clamp for bottom-anchored overlays. |
| `tests/use-anchored-position.client.spec.tsx` | The floating panel's placement, its re-placement on resize, and the no-ResizeObserver fallback. |
| `tests/use-dismiss-on-outside-pointer.client.spec.tsx` | The outside-pointer dismissal and the portaled surface. |
| `tests/user-text-styles.client.spec.ts` | The UserText font-size axis asserted as CSS text. |
| `tests/web-block.client.spec.tsx` | The web-retrieval card, its truncated indicator, and its non-200 status carried verbatim. |
| `README.zh.md` | Chinese mirror. |
| `README.md` | Decides: the shared React atom set, the untrusted-output renderers, the modal layer stack, and the rule that every user-facing label arrives by typed prop (the package is Cordis-free). |
| `src/index.ts` | The package barrel: Cordis-free React primitives styled only through `--dsw-*` tokens. |

#### `packages/client/ui-reference/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: files are listed before sessions and either group stays available when the other cannot load; a directory row has two verbs (settle vs drill); session mentions are validated before model context is captured while browsing has no model effect. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity and the export map. |
| `tests/browser-plugin.client.spec.ts` | The Remote-backed discovery, the ordering and labels, and the quoted-path cases. |
| `tests/file-reference.client.spec.tsx` | The inline reference's rendering and navigation. |
| `tests/user-text-rules.client.spec.ts` | The forward-recognition rules. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-secret-mask/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: masking changes only what is **drawn** — the message text, the copy action, and the model input keep the original characters; each masked value is monospace so revealing it does not move the surrounding text; every mount starts masked. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata with a description. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity and the export map. |
| `src/client/SecretText.module.css` | The monospace box: the value and the control are flex items on one axis. |
| `src/client/locales.ts` | The `secretMask` dictionaries for the reveal control. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/browser-plugin.client.spec.ts` | The matcher and the keyed node renderer leave with the plugin fiber. |
| `tests/regex-oracle.client.ts` | The backtracking regexes the package replaced, kept as the equivalence oracle. |
| `tests/secret-rule-equivalence.client.spec.ts` | The prefix-pruned matcher produces the same nodes as the regex matcher it replaced. |
| `tests/secret-rule.client.spec.ts` | The credential recognition, the masking forms, and the forward-query behaviour. |
| `tests/secret-text.client.spec.tsx` | The masked renderer: the reveal control, the accessible names, and the reset. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Node half: an empty `apply` so the plugin appears in the host list. |

#### `packages/client/ui-shortcuts/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: core actions follow a **fixed product order** independent of plugin registration; search matches an ordered subsequence within one label, alias, or key; search relevance takes precedence and equal matches keep the display order; commands that cannot execute remain silent; fixed actions are read-only and cannot enter recording. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity and the export map. |
| `src/client/Reference.module.css` | The row, binding, and settings-button geometry. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations. |
| `tests/commands.client.spec.ts` | The registered commands and their bindings. |
| `tests/editor.client.spec.tsx` | The recorder: one or two keys, modifiers, the third-key rejection, and the draft's lifecycle. |
| `tests/reference.client.spec.tsx` | The reference: the search, the order, the recorder, and the reset confirmation. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config. |
| `src/index.ts` | Host loader entry; the keyboard commands execute in the browser half. |
| `src/client/index.ts` | The plugin body: the reference and its entry points share one declared store. |

#### `packages/client/ui-slots/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: the four slot kinds (`single`, `list`, `keyed`, `chain`); **declaring a slot is claiming it**; the five framework props shares; a store seat's `init` infers the state schema and `actions` is the complete write set; an entry's disposer collapses its child slots recursively. |
| `README.zh.md` | Chinese mirror. |
| `package.json` | Package identity; **zero** runtime dependencies (React types only). |
| `src/renderer.ts` | The React-free contracts between the slot host and an installed renderer, plus `StaleAuthorizationError` and `SlotOwnershipError`. |
| `src/store.ts` | The slot-facing re-exports of the React-free store contracts. |
| `tests/core.client.spec.ts` | The declaration gate, the lifecycle cascade, the four kind semantics, the store-scope pinning, and the subscription API's batching and epoch rules. |
| `tests/dynamic-keys.client.spec.ts` | The dynamic-key escape hatch and the untouched-key behaviour. |
| `tests/type-chain.client.spec.tsx` | The compile-time type chain: the positive chain and the compile-time negatives. |
| `tsconfig.json` | Client build config. |
| `tsdown.config.ts` | Bundle config (`staticLinked`). |

#### `packages/client/ui-theme/`

| File | What it is / what it pins |
| --- | --- |
| `README.md` | Decides: light/dark/system with `system` resolved through `prefers-color-scheme`; three independent font roles (text, code, terminal) with their own ranges; the desktop font-size shortcuts change all three by 1 px in **one** settings mutation; the token sheets are the **sole colour authority**. |
| `README.zh.md` | Chinese mirror. |
| `locale/en.json` | Locale namespace metadata. |
| `locale/zh.json` | Locale namespace metadata (Chinese). |
| `package.json` | Package identity; the `immediately: true` client tier makes the theme load before the other plugins. |
| `src/client/AppearanceRow.module.css` | The three-cube row geometry. |
| `src/client/AppearanceRow.tsx` | The Appearance row; selection follows the persisted preference, never the resolved active theme. |
| `src/client/FontFamilyRow.module.css` | The family field's basis, so the three rows align. |
| `src/client/FontFamilyRow.tsx` | The font-family row: blur or Enter commits the normalised list, an empty field restores the built-in stack, and the field shows the persisted list. |
| `src/client/FontSettingsGroup.module.css` | The group adds none of its own separators. |
| `src/client/FontSettingsGroup.tsx` | The font settings: the text size row whose disclosure expands the per-role rows; the region starts collapsed on every mount. |
| `src/client/FontSizeRow.module.css` | The stepper pill and the hover-revealed arrow column. |
| `src/client/FontSizeRow.tsx` | The size row: the value follows the persisted setting, never the click echo; the arrows disable at the bounds. |
| `src/client/locales.ts` | The `settings.theme` namespace dictionaries, with the Chinese key set as the source of truth. |
| `src/client/settings-store.ts` | The row stores: mirrors of the theme snapshot, with the revision guard so revision 0 lands as a change. |
| `src/client/styles.ts` | Mounts the global sheets in dependency order for exactly the owning plugin's lifetime. |
| `src/css-modules.d.ts` | Ambient CSS-module declarations, including `*.css?inline`. |
| `src/styles/Montserrat-OFL.txt` | The SIL Open Font License for the shipped brand font. |
| `src/styles/base.css` | The upstream base variables: the font stacks, the ease and duration tokens, and the radius scale. |
| `src/styles/brand-font.css` | The three Montserrat `@font-face` declarations. |
| `src/styles/corner-shape.css` | The superellipse corner treatment, inside a `@supports` guard, with the full-round opt-outs. |
| `src/styles/design-platform.css` | The 23 KB static colour scale and the semantic aliases; the nearest semantic token wins for anything the design system omits. |
| `src/styles/focus.css` | The focus-ring width and colour, and the pointer-modality suppression. |
| `src/styles/gradient-shadow-text.css` | The elevation triple (stroke + two soft glows) and the whole font-size ladder derived from the body size. |
| `src/styles/onboarding.css` | The onboarding palette. |
| `src/styles/scrollbar.css` | The scrollbar skin and the two-engine split via `@supports not selector(::-webkit-scrollbar)`. |
| `src/styles/shiki.css` | The syntax-highlight token palette, aliased to the markdown code-block tokens. |
| `tests/app-region-styles.client.spec.ts` | The window drag-region ownership, asserted against the CSS and the markup on disk. |
| `tests/appearance-row.client.spec.tsx` | The three cubes, the selected cube, and the "selection follows the store mirror, not the click echo" rule. |
| `tests/apply.client.spec.ts` | The apply wiring: one settings mutation and one snapshot for a font-size step, continuing past one role's limit, the desktop font shortcuts, and the HMR-collapse recovery. |
| `tests/boot-theme.client.spec.ts` | The bootstrap injection: the canvas colour before the body state, a durable light overriding a dark OS, the system media query, and the durable font sizes and lists. |
| `tests/brand-font.client.spec.ts` | The brand font ships locally with its redistribution license. |
| `tests/client-styles.client.spec.ts` | Every global sheet is mounted in dependency order and removed on dispose. |
| `tests/config.host.spec.ts` | The Host registers, validates, and disposes the durable theme namespace. |
| `tests/corner-shape-styles.client.spec.ts` | The corner-shape stylesheet contract asserted against the CSS on disk. |
| `tests/elevation-styles.client.spec.ts` | The elevation stylesheet contract asserted against the CSS on disk. |
| `tests/expected/radius-exceptions.expected.json` | The allow-list of radius declarations that are exempt from the shared radius scale. |
| `tests/focus-ring-styles.client.spec.ts` | The static ring declarations. |
| `tests/focus-styles.client.spec.ts` | The automatic-focus presentation and the subsequent keyboard navigation against the shipped sheet. |
| `tests/font-family-row.client.spec.tsx` | The family field shows the persisted list; blur and Enter commit the normalised value. |
| `tests/font-settings-group.client.spec.tsx` | The group starts collapsed and its disclosure expands the per-role rows. |
| `tests/font-size-row.client.spec.tsx` | The value display, the arrow clicks, and the bound-value arrows disabling. |
| `tests/menu-surfaces.client.spec.ts` | All menu renderers share the material ownership, including custom listbox containers. |
| `tests/radius-styles.client.spec.ts` | The shared radius choices cover controls and cards; small drawing details retain their geometry. |
| `tests/scrollbar-styles.client.spec.ts` | Every `--dsw-alias-scrollbar-*` token has a design-platform declaration. |
| `tests/settings-store.client.spec.ts` | The snapshot-mirror actions and the revision guards. |
| `tests/stylesheet-scan.ts` | The shared helper: flatten the CSS on disk into rules and enumerate the package stylesheets. |
| `tests/theme.client.spec.ts` | The theme service: the snapshots, the locale change, and the third-party token overrides. |
| `tsconfig.client.json` | Client half build config. |
| `tsconfig.host.json` | Host half build config. |
| `tsconfig.json` | Solution file referencing the client and host halves. |
| `tsdown.config.ts` | Bundle config plus the copy step for the brand font and its license. |
| `src/client/index.ts` | The browser theme registry: the service owns the live preference, resolves `system`, publishes immutable snapshots, and never touches the DOM. |

---

### Tier 3 — skipped with a reason

| File | Why it was not read line by line |
| --- | --- |
| `packages/client/ui-theme/src/styles/montserrat-light.woff2` | Binary WOFF2 font asset, 61,548 bytes on disk. The head bytes confirm the `wOF2` magic; the face's weight, source, and licence are declared in `src/styles/brand-font.css` and `src/styles/Montserrat-OFL.txt`, both of which were read in full. |
| `packages/client/ui-theme/src/styles/montserrat-medium.woff2` | Binary WOFF2 font asset, 62,148 bytes on disk. Same reasoning as the light face. |
| `packages/client/ui-theme/src/styles/montserrat-regular.woff2` | Binary WOFF2 font asset, 62,008 bytes on disk. Same reasoning as the light face. |
| `packages/client/shortcuts/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-brand-official/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-commands/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-dockkit/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-input-trigger/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-layout/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-message-feedback/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-model-selection/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-permission-presets/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-primitives/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-reference/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-secret-mask/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-shortcuts/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-slots/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |
| `packages/client/ui-theme/README.i18n.yaml` | Generated bilingual-pair consistency record: a per-heading hash of the English and Chinese README blocks, plus the pnpm run verify-translation-pairing --write command that regenerates it. Confirmed by reading its head and structure; not read line by line because it is a generated file. |

---

## 2. Ideas worth stealing

1. **Publish only after the write is durable, never optimistically.** The shortcut preference layer publishes a new snapshot *after* the write completes; a failed write keeps the previous configuration *and* revision so the same draft can be retried, and a competing edit at the same revision returns `stale` and is not retried. `packages/client/shortcuts/src/persistence.ts`; `packages/client/shortcuts/src/client/registry.ts`. **Why it transfers:** August Trading writes trade logs, skill drafts, and provider settings through several services; a revision-checked write with a classified `stale` / `write-failed` outcome removes an entire class of "the UI says it saved" bugs. **UNIQUE** to this repo's shape, but the pattern is cheap.
2. **One writer, one store, many readers — and the display reads the truth, never the click.** Every surface in this shard reads the persisted value, never the optimistic echo: the theme rows, the permission seat, the model seat, the shortcut reference. `packages/client/ui-theme/src/client/FontSizeRow.tsx` ("the displayed value follows the persisted setting, never the click echo"); `packages/client/ui-permission-presets/src/client/index.ts`. **Why it transfers:** August Trading has a ModelMenu, a plan toggle, an accuracy toggle, and several settings rows; this is the rule that keeps the two homes of each control honest. **CONVERGENT** — the same discipline appears in the shortcuts registry, the theme rows, and the permission catalog.
3. **Classify the failure instead of swallowing it.** Read failures become `status: 'unreadable'`, write failures become `write-failed`, a competing write becomes `stale`, a rejected default becomes a visible `issue` — and the *value* is still shown. `packages/client/shortcuts/src/client/index.ts`; `packages/client/shortcuts/src/configuration.ts`. **Why it transfers:** August Trading's provider calls, notebook writes, and export paths would all benefit from a closed vocabulary of failure kinds that the UI can render. **CONVERGENT** across the shortcuts, commands, and permission packages.
4. **The "one shot" acceptance trick: park the highlight on the value already in use.** A popup opens with its highlight on the option the session already uses, so an accept gesture made without looking confirms the current value instead of the topmost row. `packages/client/ui-commands/src/client/contract.ts` (`SelectOption.active`); `packages/client/ui-commands/src/client/popup.ts` (`currentIndex`). **Why it transfers:** the model picker, the permission picker, and the agent picker in August Trading all have this exact hazard — a keyboard user who hits Enter on an opened menu should keep what they had. **UNIQUE.**
5. **Make the conflict visible but not executable.** A conflicting shortcut keeps the user's requested key on screen, marked as a conflict, and simply refuses to run. `packages/client/shortcuts/src/configuration.ts` (`EffectiveShortcut.conflicts`); `packages/client/shortcuts/src/client/registry.ts` (`dispatch` returns `blocked` with `reason: 'conflict'`). **Why it transfers:** a permission gate, a stale plan, or a duplicate agent name should show the trader what they asked for and say plainly that it will not run. **UNIQUE.**
6. **A frozen reducer that returns the same reference when nothing changed.** `menuReduce` is pure and returns the *identical* `MenuState` object when nothing changed, which is what makes `useSyncExternalStore` cheap and makes a stale settlement droppable **by reference** instead of by a version counter. `packages/client/ui-input-trigger/src/core/menu.ts`. **Why it transfers:** August Trading's transcript reducer, tool-trail reducer, and turn-status reducer would all get the same "no change = same reference" property for free, and stale-settlement handling becomes a pointer comparison. **UNIQUE.**
7. **Distinguish "the display disagrees with the truth" and make it structurally impossible.** The `Switch` keys its appearance off `aria-checked` rather than a parallel class "so the visual state cannot disagree with the state assistive technology reads"; the theme rows render the *persisted* value; the permission seat shows the Session's current value when a preset is withdrawn. `packages/client/ui-primitives/src/Switch.module.css`; `packages/client/ui-theme/src/client/FontSizeRow.tsx`. **Why it transfers:** August Trading's "the row says running but the turn is done" class of bug disappears if the row reads the store, never a local mirror. **CONVERGENT.**
8. **Keep a whole-suite *fixture corpus* that pins the rendered DOM byte-for-byte.** The Markdown renderer has 48 `.settled.txt` / `.streaming.txt` fixtures that are a DOM compatibility baseline, reviewed as a *user-visible* change rather than a refactor. `packages/client/ui-primitives/tests/fixtures/markdown-dom/`. **Why it transfers:** the same trick would pin August Trading's transcript row markup — a rendered-row baseline is exactly what `render-probe` counts, and a fixture corpus makes a regression reviewable in a diff. **UNIQUE.**
9. **Split the engine from the components so the same intent vocabulary serves two embeddings.** The docking kit's `applyOp` returns its own inverses; planners are pure functions; `Sequencer` and the pure `record`/`stepBack`/`stepForward` are the same implementation. `packages/client/ui-dockkit/src/engine/operations.ts`; `packages/client/ui-dockkit/src/engine/sequence.ts`. **Why it transfers:** August Trading's agent roster, mailbox, and routine engine could be split the same way — a pure operation layer that returns inverses and a thin stateful wrapper. **UNIQUE.**
10. **A "dismissal sticks" rule for transient surfaces.** A dismissed trigger menu stays dismissed for the same token *and* the same query; only a new query or a different token re-arms it. `packages/client/ui-input-trigger/src/client/controller.ts` (`DismissedHit`). **Why it transfers:** August Trading's popovers, the plan drawer, and the tool-trail expander all suffer the "caret restored → menu reopens" bug. **UNIQUE.**
11. **Subscribe before the first read, or you have a race.** The permission catalog directory subscribes to the payload-free notification *before* its first Remote read, and the theme's boot script is injected into the index HTML so the palette applies before the first paint. `packages/client/ui-permission-presets/src/client/catalog.ts`; `packages/client/ui-theme/src/boot-theme.ts`. **Why it transfers:** August Trading's provider-config reads and its theme bootstrap both have exactly this shape. **CONVERGENT.**
12. **A pre-plugin bootstrap that applies the persisted theme before first paint.** The Host injects head CSS (canvas colour) plus a body script (palette selector + font variables) into the index HTML, so the app never flashes the wrong theme. `packages/client/ui-theme/src/boot-theme.ts`; `packages/client/ui-theme/src/index.ts`. **Why it transfers:** August Trading is dark-only by an owner ruling, but the same mechanism would apply a persisted density/scale or a "reduce motion" preference before first paint. **UNIQUE.**
13. **A "slot declared is slot claimed" registry.** Declaring a child slot makes the declaring entry the *only* entry allowed to render that key; registering into an undeclared slot, declaring an already-declared child, or mounting one shared handle under two scopes throws **at load**. `packages/client/ui-slots/src/index.ts`. **Why it transfers:** August Trading's `components/` tree has hand-rolled "who renders the composer" logic; a claim-at-load rule would make a second occupant a startup error rather than a silent overwrite. **CONVERGENT** with the shortcut registry's "duplicate id throws".
14. **Prove the new fast path against the old slow path.** The credential scanner's prefix-pruned matcher is proven equivalent to the backtracking regexes it replaced, with the old regexes kept as an oracle in the test tree. `packages/client/ui-secret-mask/tests/regex-oracle.client.ts`; `packages/client/ui-secret-mask/tests/secret-rule-equivalence.client.spec.ts`. **Why it transfers:** any time August Trading replaces a slow path (a regex over a transcript, a full re-parse), the oracle belongs in the repo. **UNIQUE.**
15. **A search that is a *ranked* subsequence, shared by every menu.** `rankByName` is the one ranker: case-insensitive ordered subsequence, prefix first, then alignment score, then source order. `packages/client/ui-primitives/src/rank-by-name.ts`. **Why it transfers:** the `/model` menu, the agent picker, and the skill picker should all rank identically. **CONVERGENT** — `ui-commands` and `ui-shortcuts` both reuse it.
16. **One head/tail split for every capped surface.** `headTailCap` is the single function behind the terminal card, the search card, the diff card, and the read card, so the slices agree across the front ends. `packages/client/ui-primitives/src/head-tail-cap.ts`. **Why it transfers:** August Trading's truncated log, tool output, and transcript summaries should use one cap. **UNIQUE.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* This shard is browser presentation only — every package here declares "it does not assemble or send model requests". The closest relatives are the **automations** and **bot routines** packages, which live in other shards. What *does* transfer is the mechanism: the `ui-commands` `commands/change` / `connection/reset` invalidation events and the permission catalog's **generation counter** — a background refresh that cannot reopen a closed session, and a stale-generation settlement that is dropped. August Trading's scheduled monitor and its price-alert poller need exactly this generation discipline when the app reconnects mid-poll.
- **Human-in-the-loop approval:** the `ui-permission-presets` package is the closest thing here. It decides three things that map directly onto a trading approval gate: (a) the *value* of a permission change is confirmed by the **Session projection**, not by the click — `packages/client/ui-permission-presets/README.md`; (b) a consequential selection (**Full access**, **Auto review**) requires its **own risk acknowledgement** through a shared `RiskConfirmation` component, and the acknowledgement is the owner's state, not the component's — `packages/client/ui-permission-presets/src/client/PermissionSelect.tsx`; (c) a change to the *default* applies only to **future** sessions and never rewrites the current one — so a "switch to live trading" toggle cannot silently arm an existing position. The audit trail for the decision lives in the Host's durable sidecar, not in the browser layer.
- **Post-mortem / reflection loops:** *not in this shard* — no outcomes, rules, or skills appear here. The transferable half is the **withdrawal** path: a recorded rating is withdrawn by clicking it again, and the withdrawal goes through the same compare-and-swap the original write used, so the record never contains a state that was never observed. `packages/client/ui-message-feedback/src/client/controller.ts`. A trade log that can be *un-recorded* with the same atomicity is the shape a reflection loop needs.
- **Multi-agent (subagents vs debate):** *not in this shard.* The nearest structural thing is `ui-slots`' **chain** slot: several entries are eligible, a `select` function elects one by ascending `priority`, the elected entry becomes the component's `matched` prop, and an all-null result falls back to the owner's renderer — `packages/client/ui-slots/src/index.ts`. That is a clean election primitive (priority order, ties by registration order, an explicit fallback) and it is exactly the shape a "which agent answers this turn" arbitration wants. Note also the shared rule that a chain entry that crashes **reports without abdicating** — a failing agent does not silently yield the turn.
- **Structured logs the model can query:** *not in this shard* — no storage, no transcript, no query layer. The nearest thing is the **feedback sidecar** pattern: a durable, per-item, compare-and-swap record owned by the Host, mirrored in the browser by a generation-guarded object layer — `packages/client/ui-message-feedback/src/client/controller.ts`. A trade log with the same shape (Host-owned CAS record, browser mirror with a generation counter, a withdrawal that is another CAS) would give August Trading a queryable log without a heavy database *if* the Host side stays file- or SQLite-backed.
- **Staying simple as features accumulate:** this shard is the strongest evidence in the whole reference set for that lens. The discipline is *subtraction by ownership*: the shortcuts registry has one binding table, one config store, one fixed catalog; the model picker has **two entries over one per-session directory**; the permission picker and the composer seat share **one process-scoped catalog**; the theme has **one** service and **one** presenter. The slot registry's `SlotMap` is an empty interface that every consumer extends by declaration merging, so a new surface adds a type, not a registry. The most striking move is `ui-primitives` being **Cordis-free**: it cannot reach `ctx.locale`, so every label arrives by typed prop, and the package's own README says "user-facing copy is required at the render site". That is what keeps a 14-package client layer from turning into a service mesh.

---

## 4. Non-obvious decisions and gotchas

1. **A conflicting keybinding stays on screen and still does nothing.** The catalogue row keeps the requested binding and marks `conflicts`; `dispatch` returns `blocked` and consumes the event. Reading the catalogue as "what will run" is wrong — it is "what was asked for". `packages/client/shortcuts/src/client/registry.ts`.
2. **`registerFixed` reserves key combinations that an editable command may never take.** A read-only action's keys are checked against the editable set, so the two never fight. `packages/client/shortcuts/src/client/registry.ts`.
3. **Web bindings are validated against what a browser can actually deliver**, not against what the model allows. Windows/macOS admit three- and four-modifier combinations; Linux admits only three specific ones. A binding can be model-valid and browser-undeliverable, and the registry refuses to register it. `packages/client/shortcuts/src/binding.ts`.
4. **A two-key chord has no `aria-keyshortcuts`** — ARIA cannot express two non-modifier keys, so `presentBinding` deliberately returns `aria: undefined` for chords. `packages/client/shortcuts/src/binding.ts`.
5. **The `active` flag on a popup option changes what Enter does.** It is not decoration: it moves the highlight to the session's current value, so an accept-without-looking keeps what you had. Marking a row `active` for presentation alone silently changes the default pick. `packages/client/ui-commands/src/client/contract.ts`.
6. **The popup shell *holds* focus; the slash menu does not.** The slash menu is a combobox (the textarea keeps focus, the highlight rides `aria-activedescendant`); the popupSelect shell takes focus into its own search input. Two different focus models in one package. `packages/client/ui-commands/src/client/PopupSelectView.tsx`; `packages/client/ui-input-trigger/src/client/MenuView.tsx`.
7. **The command directory only pulls for a session the client already holds**, and only after the first history open has succeeded. A background refresh therefore cannot reopen a closed session. `packages/client/ui-commands/src/client/directory.ts`.
8. **A command contributed by the client that collides with a host command fails loud** at candidate synthesis and never shadows. `packages/client/ui-commands/src/client/service.ts`.
9. **The docking kit's `applySplit` halves the reference pane's share in place**, so the new pane's fraction and the reference pane's stay aligned whichever side the new pane took. `packages/client/ui-dockkit/src/engine/operations.ts`.
10. **The docking kit's `planSettle` is opt-in and its factory is optional** — withholding the factory keeps the merge and leaves the root pane empty, so an embedder that wants empty panes simply does not call it. `packages/client/ui-dockkit/src/engine/planner.ts`.
11. **Focus lands on click, not on press, in the tab strip.** A state change between `pointerdown` and the first `pointermove` rebuilds the subtree, and Chromium cancels the pointer when the pressed element is replaced — which would abandon every drag. `packages/client/ui-dockkit/src/components/TabPanel.tsx`.
12. **The `listbox` role sits on the scrolling viewport, not on the bounded shell**, because a breadcrumb header is not an option and a listbox may not carry one; the crumbs therefore ride their own snapshot store. `packages/client/ui-input-trigger/src/client/MenuView.tsx`.
13. **The dismiss rule in the trigger pipeline is keyed on the token *and* the query.** The same token re-tracked with the same query keeps the menu closed; typing a new query or moving to another token re-arms it. `packages/client/ui-input-trigger/src/client/controller.ts`.
14. **`Space`/`Enter` adjudication polls `matchSpace`/`matchEnter` in registration order and the first non-`undefined` answer wins** — a source can refuse a submission it cannot consume whole. `packages/client/ui-input-trigger/README.md`.
15. **The permission catalog's two observables are separate on purpose**: `{ value }` carries the snapshot and `{ count }` carries one tick per invalidation. Publishing the value would also settle a read a displayed surface is waiting for, which is why invalidation needed its own channel. `packages/client/ui-permission-presets/src/client/catalog.ts`.
16. **`custom` is a display state, never a target** in the permission picker. `packages/client/ui-permission-presets/src/client/presentation.ts`.
17. **The masking rule is display-only.** The message text, the copy action, and the model input all keep the original characters; only the drawing is masked, and only in the sent-text surface — session titles, turn previews, search excerpts, the goal bar, tool cards, assistant replies, and the unsent composer draw credentials as written. `packages/client/ui-secret-mask/README.md`.
18. **The credential scanner is deliberately not a regex.** The formats are data; the matcher is a prefix-pruned linear scan with typed-array tables that allocates nothing until it returns a node, and the old backtracking regexes survive as an equivalence oracle. `packages/client/ui-secret-mask/src/client/credential-scanner.ts`.
19. **The terminal card's left gutter is padding, not margin**, because every consumer rewrites `margin` wholesale and silently cancelled the reservation, letting the run-state dot fall outside the card into a container that clips it. `packages/client/ui-primitives/src/TerminalBlock.module.css`.
20. **The streaming Markdown arm parses GFM *without* math**, so incomplete TeX never flashes KaTeX errors mid-stream. `packages/client/ui-primitives/src/markdown/parse.ts`.
21. **Unknown mdast node types render nothing rather than throwing** — grammars registered elsewhere may add node types this renderer has no mapping for. `packages/client/ui-primitives/src/markdown/render.tsx`.
22. **The loader's CSS animations are pinned to document time zero**, so two loaders started at different moments rotate in step. `packages/client/ui-primitives/src/StateDot.tsx`.
23. **The theme's code font stack omits a bare `monospace` tail** — Windows CJK otherwise falls back to SimSun. `packages/client/ui-theme/src/styles/base.css`.
24. **The scrollbar sheet uses `@supports not selector(::-webkit-scrollbar)`** to split the engines, because declaring `scrollbar-width` and `::-webkit-scrollbar` together makes Chromium drop every webkit rule *including* the hover thumb. `packages/client/ui-theme/src/styles/scrollbar.css`.
25. **The derived elevation values are declared per element, not on `body`** — an inherited value arrives already substituted, so a component rebinding `--dsw-elevation-stroke-color` could not reach the `var()`. `packages/client/ui-theme/src/styles/gradient-shadow-text.css`.
26. **The `SlotMap` lives in the entry module, not in a re-export**, because consumer `declare module` augmentation merges with declarations lexically in the augmented module. `packages/client/ui-slots/src/index.ts`.
27. **A crashed `single`/`keyed`/`list` slot entry abdicates** (retires from its cell, one-shot) so the next survivor renders; a crashed `chain` entry reports **without** abdicating, because in a chain the election consumes every entry. `packages/client/ui-slots/src/renderer.ts`.
28. **A font-size change moves the row height, the leading box, and the glyph edge by the same delta**, and `StateDot` is exempted from the glyph scale because a status mark is not text furniture. `packages/client/ui-primitives/src/DisclosureRow.module.css`.
29. **`ui-primitives` is Cordis-free and therefore cannot localize anything itself** — every label arrives by typed prop. This is the price of keeping the primitives installable in any plugin, and it is paid deliberately. `packages/client/ui-primitives/README.md`.

---

## 5. Weak spots

1. **The 23 KB `design-platform.css` and the 15 KB `gradient-shadow-text.css` are Figma exports with hand-maintained aliases.** The README admits the rule ("values absent from the design system are deliberately not appended; the nearest semantic token wins") but the mapping is done by hand in one enormous stylesheet, with the `--dsw-static-deepseek-700-delete` token as a visible scar of a removed step. A wrong alias is invisible until a surface renders wrong, and there is no generator check — only the `radius-exceptions.expected.json` allow-list for radii. `packages/client/ui-theme/src/styles/design-platform.css`.
2. **The layout geometry is encoded in two places at once.** `columns.ts` computes the ideal widths in pure arithmetic, `stores.ts` holds the preferences and the presentation reports, and `AppFrame.module.css` decides the transition. The test suite has to keep three notions of "instant" versus "animated" geometry in sync (`data-animating`, `data-dragging`, the instant-geometry markers), and the layout-store spec is 60+ cases of that bookkeeping. It is correct but it is a lot of surface for a three-column frame. `packages/client/ui-layout/src/client/columns.ts`; `packages/client/ui-layout/src/client/stores.ts`.
3. **The docking kit's own README calls the package an internal engine whose exports "may change in any release"** — and it is nevertheless published to a public registry because a sidebar links it statically. A published package with an explicitly unstable API is a real hazard for a consumer that imports it. `packages/client/ui-dockkit/README.md`.
4. **`ui-layout`'s own README lists "no scroll anchoring during a squeeze reflow"** as a known limitation: a layout change can move the reader's viewport. In a trading app, a reflow that moves the viewport under a live position is exactly the kind of thing that must be fixed, and it is knowingly left open here. `packages/client/ui-layout/README.md`.
5. **The `ui-primitives` package is enormous** — 252 files in this shard alone, with a 114 KB icon module, a 58 KB embedded artwork module, and a 70 KB slot core. The component count is justified by "a plugin cannot import another plugin's component", but the cost is that the primitives package has become a place where unrelated concerns (markdown rendering, settings forms, JSON inspection, ANSI parsing, image previews) all live together. `packages/client/ui-primitives/src/`.
6. **The `ui-theme` package is described as an "extension point, not a product"** — registering a third-party theme means overriding same-named alias variables, and "no validation exists that an override set is complete". A partial override produces a theme with unstyled surfaces rather than an error. `packages/client/ui-theme/README.md`.
