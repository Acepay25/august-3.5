# deepseek-harness :: dsh-client-chat-conversation

**Files in shard:** 477 (read: 476, skipped with reason: 1)
**What this shard covers:** The harness's **rendering layer for a session log**. Four client
packages turn durable Session events into rows a trader can read: `ui-conversation` (target-neutral
assembly — event/view/group registries, the per-session assembler, the Lexical composer, the queue
dock, and the shell), `ui-chat` (the Chat target — node definitions, process grouping, whole-turn
folding, scroll ownership, turn navigation), `ui-tool` (tool-call tree + keyed per-tool cards), and
`ui-trajectory` (a turn-aware event ledger with a timing overview and a record inspector). Nothing
here talks to a provider or stores anything durable: every package is a pure projection of a Session
window that lives elsewhere. What it *does* contain is the harness's accumulated hard-won answers
about folding, counting, anchoring, and never lying to the reader about what happened.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/client/ui-conversation` — the target-neutral engine

##### `packages/client/ui-conversation/src/client/contract/conversation.ts`
- **Purpose:** The frozen vocabulary the whole assembly layer speaks: what a Definition is, what a
  match means, where a Turn/Step boundary lives.
- **Key abstractions:** `ConversationMatchResult` (with `exclusive?: true`), `ConversationNodeDefinition`,
  `ConversationLocation`, `TurnLocation` / `StepLocation`, `ConversationLocationDataStore`
  (per-key `get`/`source`), `conversationContextKey(kind, id)` (`:12`-style length-prefixed key so
  `a:b` can never collide with `ab`).
- **Data flow:** Session event → Definition `match` → Context → `start`/`update` → `buildViewNode` →
  a target-owned node.
- **Non-obvious design decisions:**
  - **An `exclusive` match claims an event *for one target only*.** Other Definitions of the same
    target never see it and that target's fallback does not run; Definitions of *other* targets still
    do (`contract/conversation.ts:20-27`). Two claims on one target throw during dispatch. This is
    how Chat and Trajectory both read the same `assistant/message` without either starving the other.
  - **Location data is keyed per Turn/Step and read through a store, never through a shared object.**
    `ConversationLocationDataStore.get(key)` returns only the caller's own key; `source(key)` gives
    an identity-stable observable. One owner per key is enforced at write time — a second owner for
    the same key throws.
- **Edge cases & failure handling:** A Context whose start was never seen has `state === undefined`
  but keeps its key, so later evidence can still claim it.
- **Surprising:** `conversationContextKey` is *not* a plain template — it prefixes the kind's length
  (`${kind.length}:${kind}${id}`) precisely so two different `(kind, id)` pairs cannot produce the
  same string.

##### `packages/client/ui-conversation/src/client/conversation/assembler.ts`
- **Purpose:** The engine that turns a stream of `SessionEventLikeEntry` into per-target nodes:
  matching, Context lifecycle, Turn/Step location resolution, incremental vs. full rebuild, and
  target activity.
- **Key abstractions:** `ConversationNodeAssembler`, `InternalContext`, `PendingMatch`, `ViewState`,
  `GroupState`, `PUBLICATION_RANK` (`none` < `animation-frame` < `immediate`).
- **Data flow:** `append`/`prepend`/`replace` of event entries → per-Context match lists → State
  updates coalesced between flushes → `buildViewNode` per Context → a `ConversationViewBuilder` per
  active target.
- **Non-obvious design decisions:**
  - **Publication is a per-match property, and the strongest wins.** A Definition can declare
    `publication: 'none' | 'animation-frame' | 'immediate'`; the assembler takes the maximum across
    the Context's matches. `animation-frame` exists so a streaming transcript repaints once per
    frame instead of once per token.
  - **A target becomes active on first subscriber or explicit selection, and never deactivates**
    (`assembler.ts:19` region — `isActive` is checked before a builder is created).
  - **Rebuild is incremental when revisions are contiguous.** A revision gap forces a full-window
    rebuild; contiguous append/prepend/settlement reuse the existing Contexts. Contexts are
    re-derived from their earliest remaining start.
- **Edge cases & failure handling:** A Context with no remaining start has no State, but its key and
  previously published nodes survive until a full window rebuild — the owning Definition may hide
  them.
- **Surprising:** `insertionIndex` is a binary search over Context start seqs, so a late-arriving
  match does not replay every Context.

##### `packages/client/ui-conversation/src/client/conversation/location-index.ts`
- **Purpose:** Maps event seq → Turn/Step coordinates and owns the per-Turn/per-Step boundary
  objects the rest of the UI reads.
- **Key abstractions:** `ConversationLocationIndex`, `MutableLocationDataStore`,
  `MutableLocationDataSource`, `ConversationLocationDataChange`.
- **Data flow:** boundary events (`turn/start|end`, `step/start|end`) build a timeline; ordinary
  events are located by an index lookup, not by scanning the Turn's step array.
- **Non-obvious design decisions:**
  - **Each input's coordinates and its resolved Location share one private index record**
    (`location-index.ts:127` region), so the two can never disagree.
  - **Location data ownership is exclusive.** `MutableLocationDataStore.set` throws if the key is
    already owned by a different owner; `remove` silently no-ops when the owner does not match.
  - **A `replace` publishes only the keys whose value or owner actually changed** — the dirty-key
    set is what drives notification.
- **Edge cases & failure handling:** `locationOf` returns the session-level location for an
  unindexed event rather than throwing.

##### `packages/client/ui-conversation/src/client/conversation/definition-registry.ts`
- **Purpose:** Shared lifetime + stable-entry storage for the three registries.
- **Key abstractions:** `ConversationDefinitionRegistry` (abstract), `registerDefinition` returning
  an idempotent disposer, `Service.tracker` property so Cordis can attribute effects.
- **Non-obvious design decisions:** **A duplicate key throws at registration** — the registries are
  small and fixed, so a collision is a programming error, not a runtime condition. Registration is
  a Cordis *effect*, so unloading the contributing fiber removes the contribution automatically.

##### `packages/client/ui-conversation/src/client/conversation/event-registry.ts`
- **Purpose:** The single registry for event Definitions, plus the per-target fallback.
- **Key abstractions:** `ConversationEventRegistry`, `ConversationEventRoute`.
- **Non-obvious design decisions:**
  - **A Definition may declare a table of `eventType → handler` instead of one callable.** The
    registry copies the table and precomputes ordered candidate Sets on registration change, so a
    table handler only sees the events it declared — a measurable win over calling every matcher.
  - **Table handlers are read at registration time** (`event-registry.ts:60` region): changing a table
    requires unregistering and registering again.
  - **The fallback is a separate registration** and only runs when *no ordinary Definition of its
    target* matched.
- **Edge cases & failure handling:** `assertDefinitionTarget` rejects a Definition that omits a
  target, and a State-only Definition is rejected as a fallback.

##### `packages/client/ui-conversation/src/client/conversation/group-registry.ts`
- **Purpose:** The registry of business Group Definitions — one optional grouping per target.
- **Key abstractions:** `ConversationGroupRegistry`.

##### `packages/client/ui-conversation/src/client/conversation/group-store.ts`
- **Purpose:** The store that publishes group snapshots and root entries.
- **Key abstractions:** `ConversationGroupStore`, `GroupSnapshot`, `GroupUpdate`.
- **Non-obvious design decisions:** **A group update is atomic.** The store validates and installs
  root references *and* keyed group snapshots together; a data-only update preserves the entry
  array and member-array identities. Group removal never deletes the source Nodes.

##### `packages/client/ui-conversation/src/client/conversation/historical-images.ts`
- **Purpose:** The per-session durable-image URL cache shared by every Conversation target.
- **Key abstractions:** `HistoricalImageCache` (`resolve`, `peek`, `seed`).
- **Non-obvious design decisions:**
  - **A submission preview is adopted, then replaced.** `seed()` shows a local preview URL
    *synchronously*, then the canonical bytes replace it and **both** URLs are revoked. If the
    canonical read fails, the seeded preview is revoked and the entry removed — a failed read never
    leaves a dangling blob URL.
  - **URLs are revoked with the Session binding**, not with the component, so a session switch frees
    the bytes.
- **Edge cases & failure handling:** An unknown session rejects rather than resolving to a broken
  URL; the cache rejects after disposal.

##### `packages/client/ui-conversation/src/client/conversation/user-text-document.ts`
- **Purpose:** The document half of the "UserText" subsystem — the node list a sent message becomes.
- **Key abstractions:** `UserTextNode`, `UserTextDocumentInput`.

##### `packages/client/ui-conversation/src/client/conversation/user-text-registry.ts`
- **Purpose:** The registry half of the "UserText" subsystem — rules, evaluators, and the
  candidate scheduler.
- **Key abstractions:** `UserTextRegistry`, `UserTextEvaluator`, `UserTextRule`, `UserTextNode`.
- **Non-obvious design decisions:**
  - **Rules are forward matchers with a caller-owned query cache.** Each rule offers one candidate
    at or after an offset; the scheduler advances only *consumed* heads and keeps future candidates
    so a match at position 5000 does not force a re-scan from 0.
  - **`Context.read(key)` records a dependency, including on an *absent* value.** A rule that asked
    for a flag that was not set is still invalidated when that flag appears. This is why a pending
    skill catalog does not block editing: the slash token stays plain text until a matching catalog
    entry arrives, and arrival rematches without touching chips, selection, or undo history.
  - **Same-start ties are broken by `order` then by stable ID** — never by plugin load order, so
    registration order cannot change what the reader sees.
- **Edge cases & failure handling:** A rule that throws does not publish partial output; the failure
  is reported once and the complete original text is retained. Re-entrant evaluation throws.

##### `packages/client/ui-conversation/src/client/contract/user-text.ts`
- **Purpose:** The read-only types of the UserText contract.
- **Non-obvious design decisions:** **`UserTextTransformContext.read()` throws after the call
  returns** — the reader is valid only during its owning synchronous query, and may never be
  retained. `JsonPayload<T>` recursively constrains payloads to JSON-shaped data.

##### `packages/client/ui-conversation/src/client/contract/groups.ts`
- **Purpose:** The grouping contract: `NodeKey`, `GroupKey`, `RenderEntry`, `GroupSnapshot`,
  `GroupUpdate`, `ConversationGroupInput`.
- **Non-obvious design decisions:** **`apply` input carries lifecycle changes without node upserts**,
  and `changedTurnOrders` names the Turns whose visible keys *or immediate neighbours* changed —
  including removal and cross-Turn moves. That is what lets business grouping stay inside the
  affected Turns instead of rebuilding the world.

##### `packages/client/ui-conversation/src/client/contract/input.ts`
- **Purpose:** The frozen input-machine contract — three tiers of visibility: business packages see
  `InputState`; the scoped events carry the mutation verbs; the wiring layer alone sees the full
  `SessionInput`.
- **Key abstractions:** `InputState`, `InputActions`, `InputEffect`, `InputTriggerController`,
  `CommandClaim`, `PickOutcome`, `SubmitOutcome`, `SubmitAttachment`.
- **Non-obvious design decisions:** **The draft text and its chips live in the shell's Lexical
  editor; the machine here is the submit plane (phase, claim, attempt) alone.** Separating "what the
  user sees" from "what the machine is doing" is what makes the state machine pure and testable.
- **Edge cases & failure handling:** `SubmitOutcome` is `kind: 'success' | 'error'` with optional
  text; the caller restores the draft on error.

##### `packages/client/ui-conversation/src/client/contract/draft-editor.ts`
- **Purpose:** Editor-facing ranges, reference projections, and the composer keyboard interface.
- **Key abstractions:** `TokenSpan`, `ReferenceInsert`, `Occurrence`, `ArbitrateKey` /
  `ArbitrateOutcome`, `ComposerKeyboard`, `DraftSnapshot`, `EditSelection`.
- **Non-obvious design decisions:** **A span carries `draftRev`** — the editor's revision — so an
  asynchronous result captured before a user edit is refused rather than applied to the wrong text.

##### `packages/client/ui-conversation/src/client/contract/records.ts`
- **Purpose:** The durable record shapes — `AssistantMessageNode`, `UserMessageNode`,
  `SteeringMessageNode`, `ContextMessageNode`, `ToolCallBlock` (`PreparingToolCall` /
  `StartedToolCall` / `ToolResultNode`), `CommandNode`, `CompactionSummaryNode`,
  `ModelRetryNode`, `TurnErrorNode`, `TurnMaxTokensNode`, `UnknownSurfaceNode`, `TodoItem`.
- **Key abstractions:** the `ToolArgs` lazy argument view, `AssistantBlock`, `AssistantTiming`.

##### `packages/client/ui-conversation/src/client/contract/system-prompt.ts`
- **Purpose:** The `SystemPromptState` / `SystemPromptInspector` surface — the shared, pure
  interpretation of the loaded `system/message` surface.

##### `packages/client/ui-conversation/src/client/contract/request-inspection.ts`
- **Purpose:** `RequestView` (assistant vs. compaction), `RequestPromptChange`,
  `RequestPromptSnapshot`, `RequestPromptInspector`, and `inspectRequestPrompt`.
- **Non-obvious design decisions:** The inspection classifies request changes against the
  *effective* prompt; an ordinary message or stream chunk needs no system-state work at all.

##### `packages/client/ui-conversation/src/client/contract/context-producer.ts`
- **Purpose:** `ContextRole`, `ContextProducerView`, `KnownContextForm`.
- **Non-obvious design decisions:**
  - **`ContextRole` is only `'inject' | 'recall'`.** Mid-turn steering is the third role the
    transcript distinguishes, but it has its own event and node kind and never reaches here
    (`contract/context-producer.ts:11-14`).
  - **`KnownContextForm` is a closed set** (`instructions | catalog | snapshot | notice | relay |
    recall`); unknown or absent forms map to the opaque presentation so a log written by an older,
    newer, or foreign producer still renders.
  - **`ComposerBlock` carries its own localized reason**, because the plugin that raised it owns
    that copy — the composer only knows how to render an inert textarea
    (`contract/composer-blocks.ts:5-8`).
  - **`BusyEnterBehavior` (`'queue' | 'steer'`) is a durable Host setting**; the browser scope reads
    it through the same schema the Host validates.

##### `packages/client/ui-conversation/src/client/service.ts`
- **Purpose:** The outward conversation face: scope-addressed `send`, `updateQueue`, `cancel`,
  `loadOlder`, plus the per-session input machine and composer-block registries.
- **Key abstractions:** `IConversation`, `ConversationController` (a Cordis `Service`),
  `UnsupportedImageMediaTypeError`, `isImageMediaType`.
- **Non-obvious design decisions:**
  - **Scope addressing rides the Cordis Service tracker.** Property access through `ctx.conversation`
    rebinds `this.ctx` to the caller's context, so methods read the session tag with `scopeOf`.
    Mutable state must remain reachable through *one* property read; assignment through the tracker
    proxy or `#` private fields bypasses that rebinding — this is stated in the module doc.
  - **Image drafts are browser-owned and never persisted.** Only the id enters input state; the
    bytes are base64-encoded into the prompt at send time.
  - **Files upload on pick, not on send**, through a FIFO background-upload queue bounded by
    `maxConcurrentFileUploads` (default 2). Removing a draft skips its queued transfer or aborts
    its active transport.
- **Edge cases & failure handling:** A failed send restores the draft and notifies; a disposed
  service awaits an aborted upload before disposal.

##### `packages/client/ui-conversation/src/client/input/machine.ts`
- **Purpose:** The pure submit machine: phase (`plain | adjudicating | claimed | submitting`),
  claim, attempt, and the effects each event produces.
- **Non-obvious design decisions:**
  - **Leading is judged after trimming, including newlines** — a draft of `"\n/goal"` is leading.
  - **A stale attempt is dropped, not applied.** An adjudicated result arriving after `release` is
    discarded ("anti-backwash"), so a slow trigger cannot resurrect a cancelled submission.
  - **An adjudication failure notices and stays `plain`** — there is no silent downgrade to the
    default sink.
- **Edge cases & failure handling:** Empty and whitespace-only drafts produce nothing at all.

##### `packages/client/ui-conversation/src/client/input/facade.ts`
- **Purpose:** `SessionInputShell` — owns the per-session Lexical editor (text + chips) and the
  pure `SubmitMachine`, and choreographs everything between them.
- **Key abstractions:** `SessionInputShell`, `SessionInputDeps`, `PopupDismissFace`.
- **Non-obvious design decisions:**
  - **Attachment-only sends are a first-class path** with their own in-flight record, so an
    attachment-only submission cannot be duplicated by an Enter during the round trip.
  - **A claim that does not declare attachment acceptance never submits while attachments are
    present** — one notice, everything retained.
  - **The draft revision (`rev`) guards every asynchronous edit.** `span.draftRev !== this.rev`
    refuses the edit.
- **Edge cases & failure handling:** A disposed shell never lets a pending serialization reach
  `claim.submit`; image removal is refused while a command submit is in flight.

##### `packages/client/ui-conversation/src/client/input/hub.ts`
- **Purpose:** The session-bound input registry and the default-send routing.
- **Non-obvious design decisions:** **Services are resolved lazily per call** so boot order stays
  free. Each retained Session binding owns exactly one shell; Session-scope disposal releases it.

##### `packages/client/ui-conversation/src/client/input/editor/keymap.ts`
- **Purpose:** The composer keymap over the Lexical command layer.
- **Non-obvious design decisions:**
  - **Registered at CRITICAL priority** so it decides before `@lexical/plain-text`'s own
    Enter/paste defaults; returning `false` falls through (Shift+Enter's line break, ordinary
    spaces).
  - **The IME guard is three-layered:** `event.isComposing`, the legacy `keyCode === 229`, and a
    root-element composition watch that holds the guard for **10 ms after `compositionend`** —
    because Safari delivers the closing keydown *after* compositionend.
- **Edge cases & failure handling:** The root's composition attribute suppresses placeholders until
  both the native composition and the editor's final text reconciliation finish.

##### `packages/client/ui-conversation/src/client/input/editor/chip-node.tsx`
- **Purpose:** `ReferenceChipNode` — one inline reference as an atomic Lexical decorator node.
- **Non-obvious design decisions:**
  - **The node IS the occurrence.** `ReferenceChipNode` carries the owner's insert-time
    projections (label, appearance, clipboardText) and answers `getTextContent()` so native copy
    and the draft mirror stay correct without expansion code
    (`input/editor/chip-node.tsx:1-8`). The *detect* projection counts each chip as one `U+FFFC`.

##### `packages/client/ui-conversation/src/client/input/editor/command-chip-node.tsx`
- **Purpose:** `CommandChipNode` — the leading `/command` chip, a separate node kind from the
  reference chip because it owns a claim rather than a reference.

##### `packages/client/ui-conversation/src/client/input/editor/command-chip-selection.ts`
- **Purpose:** The selection state machine for the command chip — which keypresses select it,
  which remove it, and which release the claim.

##### `packages/client/ui-conversation/src/client/input/editor/text-ref.ts`
- **Purpose:** `TextRefNode` — a *plain-text* reference (a slash or at-token whose owner never
  resolved), rendered as ordinary text that can still be opened.

##### `packages/client/ui-conversation/src/client/input/editor/span-map.ts`
- **Purpose:** The map between document offsets and detect-coordinate spans, so a chip's identity
  survives a text edit before it.

##### `packages/client/ui-conversation/src/client/input/editor/projection.ts`
- **Purpose:** `$projectComposer` — the detect-text and clipboard-text projections of the editor
  document.

##### `packages/client/ui-conversation/src/client/input/editor/runtime.ts`
- **Purpose:** `DraftEditorRuntime` — the shell-owned editor instance, its history, and the
  document import/export.

##### `packages/client/ui-conversation/src/client/input/editor/view-binding.ts`
- **Purpose:** The DOM bindings — focus retention, selection reveal, the file picker, the wheel
  handler, and the keymap installation.

##### `packages/client/ui-conversation/src/client/input/editor/ReferenceChip.tsx`
- **Purpose:** The chip's visual component — the domain icon, the label, and the invalid bit.

##### `packages/client/ui-conversation/src/client/input/editor/CommandChip.tsx`
- **Purpose:** The command chip's visual component.

##### `packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx`
- **Purpose:** The Lexical content-editable host the composer mounts.

##### `packages/client/ui-conversation/src/client/input/editor/DecoratorPortals.tsx`
- **Purpose:** The portal host that mounts decorator nodes (the chips) into the editor's DOM.

##### `packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx`
- **Purpose:** The React shell around the Lexical editor — the composer text surface.
- **Non-obvious design decisions:**
  - **A chip is atomic: the first Backspace at its edge selects the whole chip, the second removes
    it and releases the claim**, leaving the arguments as plain text. Any other key, a click, or a
    caret move clears the selection. Undo restores a deleted chip together with its claim.
  - **Background editor updates retain the draft selection without changing the document selection
    or reclaiming focus**; explicit composer focus restores its selection.
- **Edge cases & failure handling:** An invalid chip (owner resolution failed) renders invalid and
  **fails serialization** rather than silently persisting a broken reference.

##### `packages/client/ui-conversation/src/client/input/decorations.ts`
- **Purpose:** The plain-text reference scanner — a `/name` or `@name` token on the trigger's
  lexicon, and syntax-recognizable `@dir/` folder tokens.

##### `packages/client/ui-conversation/src/client/input/blocks.ts`
- **Purpose:** `ComposerBlockRegistry` — the one way another plugin stops a session's input.
- **Non-obvious design decisions:**
  - **The block registry is an affordance, not enforcement.** The module doc says so explicitly:
    "the Host refuses a prompt it cannot route regardless of what any client disables"
    (`input/blocks.ts:12-16`). The composer cannot import the plugins that would know, so a blocker
    pushes into a store the composer reads.

##### `packages/client/ui-conversation/src/client/input/submission-policy.ts`
- **Purpose:** The busy-Enter policy and `resolveSubmitMode` — plain Enter's delivery mode while
  the addressed agent is busy.
- **Non-obvious design decisions:**
  - **The busy-Enter policy publishes locally first, then writes through the scope.** Adoption of a
    Host value does not write back, and an identical write is skipped.

##### `packages/client/ui-conversation/src/client/input/submission-analytics.ts`
- **Purpose:** `reportMessageSubmission` — the product-analytics hook for a composer attempt.
- **Edge cases & failure handling:** `ComposerBlockRegistry.set` republishes only when the *copy*
  changes.

##### `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- **Purpose:** The default composer body — the `conversation.composer.bar` slot entry.
- **Key abstractions:** `InputBar` (memoized), `InputBarProps`.
- **Data flow:** Machine state via `useInput`; DOM/command face via the slot's own `inject`;
  session facts via `useSession`; layout-phase inputs (`variant`, `placeholder`) via owner props.
- **Non-obvious design decisions:**
  - **The model seat is the ONE control a block leaves live.** Every block this contract has is
    cleared by choosing a model, so locking the model too would leave the composer asking for the
    only thing it prevents (`skeleton/InputBar.tsx:150-156` region).
  - **The no-workspace state renders the SAME div inert** as the Workspace-picker trigger, rather
    than a parallel tree — one DOM node, so the surface survives a session switch.
  - **The Send button's label names the delivery mode only when the click would actually deliver a
    plain message right now.** A `/`-line, an empty draft, an idle session, or a pending upload all
    keep the plain Send label — the button never describes a delivery it cannot perform.
  - **The intake pre-check refuses the whole batch** before it enters the rail, and announces the
    *format* problem before any limit.
  - **Send waits for every picked file.** Uploading *and* failed drafts both hold the gate.
- **Edge cases & failure handling:** A failed upload is retried or removed, never silently dropped.
  A writer-contention error gets localized recovery guidance; other failures keep the diagnostic
  message and code.

##### `packages/client/ui-conversation/src/client/queue/QueueDock.tsx`
- **Purpose:** The queue strip — one item renders directly, multiple items default to a collapsible
  count header, an empty queue renders nothing.
- **Non-obvious design decisions:**
  - **Local transcript submissions are excluded from the durable queue rows** by `rpcId`, so the
    same message is never shown twice while the echo is still in flight.
  - **The collapsed dock keeps the "sending…" status in its header**, because a collapsed queue
    would otherwise hide a submission that has not been admitted.
  - **Queue rows use the UserText Factory** (whitespace collapsed, edges trimmed, emoji retained,
    CSS ellipsis) — and the *editable* text keeps its line breaks, because editing shows the literal
    sent text.
- **Edge cases & failure handling:** An action failure notifies and leaves the row intact; a
  mixed-content row (image + text) cannot be edited and says so.

##### `packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx`
- **Purpose:** The composer context-occupancy ring + percentage and its click-open breakdown panel.

##### `packages/client/ui-conversation/src/client/context-occupancy.ts`
- **Purpose:** `contextOccupancy` — resolves bounded display occupancy from the token-meter
  projection.
- **Non-obvious design decisions:**
  - **Occupancy is `null` until both a numerator and a capacity are known** — the meter renders
    nothing rather than a guess.
  - **The panel headline splits on a `U+0000` marker** so the reading keeps its own tone while each
    locale owns the word order (`45% of context used` / `上下文已用 45%`).
  - **The bar's overall length stays the provider-exact percent**; the heuristic breakdown only
    proportions its colours.
- **Edge cases & failure handling:** A model switch that temporarily removes capacity closes the
  now-unavailable panel instead of preserving stale UI.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx`
- **Purpose:** The shared Conversation body and its occurrence-selected local components.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationHeader.tsx`
- **Purpose:** The Conversation header slot entry.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx`
- **Purpose:** The main Conversation panel — the frame that holds the views and the composer.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationPanel.tsx`
- **Purpose:** The `main.conversation` slot entry — the outer panel.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- **Purpose:** The Conversation root frame and the view ring.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- **Purpose:** The strict Session body and its Session header — the two entries that receive the
  Session-scoped store and the View roster.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationWidthControls.tsx`
- **Purpose:** The optional width-gutter handles.

##### `packages/client/ui-conversation/src/client/skeleton/DefaultConversationViews.tsx`
- **Purpose:** The default View roster contributed by the shell.

##### `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`
- **Purpose:** The blank-session hero — the headline, the Workspace picker, and the hero dock.

##### `packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx`
- **Purpose:** The Todo panel and the Todo dock entry.

##### `packages/client/ui-conversation/src/client/skeleton/control-row-layout.ts`
- **Purpose:** `observeControlRow` — measures the composer's control row and decides the icon/text
  collapse.

##### `packages/client/ui-conversation/src/client/skeleton/safari.ts`
- **Purpose:** Safari detection and the stale-native-textarea layout repair.
- **Non-obvious design decisions:**
  - **The composer's live height is published as a CSS variable by a callback ref, not an effect**
    (`--dsh-composer-height`), so floating controls clear the composer as it grows without observer
    churn while the body outlet fills.
  - **The composer control row measures its expanded groups after size/content/visibility/font
    changes**; if they cannot share a line it sets `--dsh-composer-model-text-display: none` and
    `--dsh-composer-model-icon-display: block`. Wrapping remains available if even the icon cannot
    fit.
  - **Safari's stale native textarea layout is repaired by a forced reflow** (`safari.ts`): bump the
    height by 1px, read `offsetHeight`, restore, and do the same for the scrollport — because
    Safari's scrollport auto-height can contaminate the composer's own scroll.
  - **A blank Session keeps the header's leading and corner controls** (right-sidebar opener) while
    hiding title, actions, utilities, and View tabs.
- **Edge cases & failure handling:** The Todo panel renders nothing for an empty list and starts
  collapsed with a per-status count summary.

##### `packages/client/ui-conversation/src/client/stop-sequence.ts`
- **Purpose:** The "Esc Esc" double-press stop sequence — the state machine that decides whether
  a first press starts a sequence.

##### `packages/client/ui-conversation/src/client/stop-shortcut.ts`
- **Purpose:** `installStopShortcut` — the fixed Stop route and its chord display.
- **Non-obvious design decisions:** **Two independent presses inside the configured interval
  (500 ms default)** stop the turn and preserve queued messages. A menu, approval, modal, terminal,
  embedded page, composition, repeated key, changed input region, session break, or turn break
  *discards* the first press.

##### `packages/client/ui-conversation/src/client/apply.ts`
- **Purpose:** The plugin's composition root — registers the Conversation assembly, the shell
  slots, the composer, the docks, and the settings row.

##### `packages/client/ui-conversation/src/client/index.ts`
- **Purpose:** The package's public surface — the assembly, the registries, the contracts, and the
  `UserTextDataMap` / `UserTextFacts` merge points other packages extend.

##### `packages/client/ui-conversation/src/client/stores.ts`
- **Purpose:** `createConversationStore` — the per-Session store seat that owns the draft, the
  selected View, and the one-shot View request, plus the persisted preference reader.

##### `packages/client/ui-conversation/src/client/view-selection.ts`
- **Purpose:** `resolveActiveView` and `TRAJECTORY_VIEW_ID` — the deterministic View selection.

##### `packages/client/ui-conversation/src/client/draft.ts`
- **Purpose:** `resolveDraftInput` and `snapshotDraft` — the draft-document value helpers.

##### `packages/client/ui-conversation/src/client/image-labels.ts`
- **Purpose:** The attachment-rejection copy — `attachmentErrorText` and `imageSizeText`.

##### `packages/client/ui-conversation/src/client/locales.ts`
- **Purpose:** The `conversation` namespace dictionaries (zh is the key-set source of truth, en
  follows).

##### `packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx`
- **Purpose:** The General Settings row for the busy-Enter preference.
- **Non-obvious design decisions:**
  - **View selection is deterministic: a registered persisted selection wins, otherwise registered
    `chat` wins, otherwise no View renders. It never chooses the first registered View**
    (`view-selection.ts`).
  - **The shell reads the persisted View preference *before* rendering** when a Session first binds
    or a cached Session becomes current.
  - **The `conversation.content` Factory's `inject` moves the draft (text *and* structured
    references) between Sessions during Workspace navigation, synchronously and only while that
    request is current** — a later navigation leaves the original draft intact.
- **Edge cases & failure handling:** The persisted View preference is ignored when it is not a
  usable value.

#### `packages/client/ui-chat` — the Chat target

##### `packages/client/ui-chat/src/client/apply.ts`
- **Purpose:** The Chat target's composition root.
- **Non-obvious design decisions:**
  - **Quota notices are frame-wide, not panel-wide** (`apply.ts:96-140`): a notice outlives the
    Chat panel that raised it. Holds are per-token symbols, so a release can only drop the hold it
    was issued for.
  - **Only *live* quota failures publish a notice** — the event subscriber ignores anything that is
    not an `append` change, so history paging and replacement never re-raise a stale failure.
  - **Settings persistence failure is swallowed on purpose** — "the local choice remains usable
    when persistence is unavailable" (`apply.ts:150-152`).
- **Edge cases & failure handling:** A fork failure leaves the source view unchanged.

##### `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts`
- **Purpose:** The incremental snapshot builder for the Chat target — 1,242 lines and the single
  most intricate file in the shard.
- **Key abstractions:** `ChatSnapshotBuilder`, `MutableChatSource`, `MutableChatNodeStore`,
  `TurnKindNodes`, `ReferenceLabelProjector`, `SkillNameProjector`, `LegacySliceBuilder`,
  `MutableTurnNavigationIndex`, `orderedVisibleChatNodes` (`:522`).
- **Data flow:** `replace(nodes, timeline)` / `apply(upserts, timeline)` → store → location index →
  process presentations → navigation index → a `ChatSnapshot` of `{ order, nodes, locations,
  navigation, timeline, legacy }`.
- **Non-obvious design decisions:**
  - **A structural change is distinguished from a content-only change.** A node whose kind, anchor,
    visibility, groupTree, or Location identity changed is *structural* and re-orders the whole
    column; a node whose payload changed is content-only and only touches its own source.
  - **The navigation index is rebuilt on structural change and merely *touched* on content-only
    change**, so a streaming answer does not renumber the rail.
  - **Two orthogonal projectors rewrite message nodes**: `ReferenceLabelProjector` attaches the
    labels of a *following* recall event to the message before it; `SkillNameProjector` attaches
    the names of slash tokens the host actually resolved as skills.
  - **`MutableChatSource` keeps publication state inside the keyed Chat store** — marked with a
    `jscpd:ignore` block because it duplicates a store pattern elsewhere.
- **Edge cases & failure handling:** `apply` re-derives only the affected Turns for the process
  presentation; the bottom-membership source notifies only the Turns leaving or entering the latest
  exchange.

**The 20 Chat conversation-node Definitions** (each has its own entry in the supplementary list
below). One Definition per durable record kind — assistant steps, user/developer messages,
requests/prompts, tools, commands, compaction, retries, turn errors, max-tokens, turn tails,
inbox, and the unknown-event fallback. Each exports a `ConversationNodeDefinition` plus a
`registerXConversationNode(ctx)`.
- **Non-obvious design decisions:**
  - **`CHAT_SYNTHETIC_SEQ_OFFSETS`** (`conversation-nodes/common.ts:15`) places synthetic nodes
    *between* real events using fractional anchors (`interruptedAssistant: -0.9`,
    `maxTokensNotice: 0.05`, `finalizedFollowup: 0.1`). The max-tokens notice deliberately sits
    between a closing Assistant and the turn-tail, so the tail stays the turn's last node and keeps
    its branch action enabled.
  - **The tool Definition projects a *root* call plus recursively nested subcalls**, with
    `MAX_DEPTH = 256` (`conversation-nodes/tool.ts:19`) and a cycle guard.
  - **A retry chain renders as ONE row**, not N: the `RetryChatData` carries the whole attempt list
    plus the current attempt.
  - **A terminal turn failure is derived from the turn's end reason** — an error, a
    sign-out cancellation, or a turn that restart recovery closed because the DSH process exited
    mid-turn (`conversation-nodes/turn-error.ts:44-58`). Retries inside the failing turn never
    suppress this row; the model-retry node renders that history separately.
  - **An unknown event is not dropped.** The fallback Definition renders it as an
    `UnknownSurfaceNode` so a log written by a newer build still displays.
- **Edge cases & failure handling:** `coordinate(value)` accepts only a finite, non-negative
  safe integer; a malformed coordinate becomes `undefined` rather than a poisoned anchor.

##### `packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts`
- **Purpose:** The activity vocabulary and the counting/one-line-summary derivation for a group.
- **Non-obvious design decisions:**
  - **The activity vocabulary is seven categories** — `read | readImage | search | write | edit |
    commands | code` — and **reasoning adds no tool count**.
  - **A live detail is bounded at 160 grapheme clusters**, not characters, with a 512-unit decoded
    prefix; `Intl.Segmenter` does the clustering so a surrogate pair is never split
    (`conversation-nodes/process-activity.ts:24-46`).
  - **A closed group's published summary clears its live category and detail** while retaining its
    category counts.

##### `packages/client/ui-chat/src/client/conversation-nodes/process-groups.ts`
- **Purpose:** The Chat-owned segmentation and incremental summaries over materialized Node inputs.
- **Edge cases & failure handling:** `structureChanged` distinguishes a hidden→visible transition
  from a pure content change, so a group is not re-segmented for a text edit.

##### `packages/client/ui-chat/src/client/contract/process-groups.ts`
- **Purpose:** `ProcessActivity`, `ProcessActivitySummary`, `ProcessGroupData` — the group payload
  contract.

##### `packages/client/ui-chat/src/client/contract/group-tree.ts`
- **Purpose:** `ChatGroupTree` (the four nesting positions) and `isAtOrOutside`.
- **Non-obvious design decisions:**
  - **The group tree has four positions** — `exchange | input | turn | process` — and visibility
    applies from outside inward: whole Turn → secondary group → individual disclosure. Opening an
    inner layer cannot bypass a closed outer layer.

##### `packages/client/ui-chat/src/client/chat/flow-motion.ts`
- **Purpose:** Fold transitions owned by one Chat viewport.
- **Key abstractions:** `createFlowMotion`, `FlowMotionRows`, `InputFoldBox`, `InputFoldDriver`,
  `FlowMotion`.
- **Non-obvious design decisions:**
  - **Every batch containing a closing row moves its boxes and the scrollport on ONE frame clock.**
    A batch that only reveals rows, or a viewport without a reading policy, uses CSS transitions
    instead.
  - **`overflow-anchor: none` is toggled on the scroller while a fold is active** — native anchoring
    would fight the fold's own compensation.
  - **Motion is opt-in under `[data-chat-motion]` and respects reduced motion.**
  - **The driver may add boxes while the batch runs**, when a newer tail request takes it over.
- **Edge cases & failure handling:** A cancelled landing commits no obsolete target; `clear()` on
  detach cancels owned animations and pending work.

##### `packages/client/ui-chat/src/client/chat/use-chat-viewport.ts`
- **Purpose:** Turn-aware DOM scrolling and geometry, without history-loading or follow policy.

##### `packages/client/ui-chat/src/client/chat/use-chat-reading.ts`
- **Purpose:** Follow-tail ownership, saved-position restoration, and sampled reader movement.

##### `packages/client/ui-chat/src/client/chat/use-scroll-follow.ts`
- **Purpose:** `ScrollFollow` and the scroll metrics — the follow *intent* and the measured
  geometry.

##### `packages/client/ui-chat/src/client/chat/use-chat-scroll.ts`
- **Purpose:** The scrollport element bindings and the scroll-event plumbing.

##### `packages/client/ui-chat/src/client/chat/use-chat-navigation.ts`
- **Purpose:** `ChatNavigation` — turn navigation, history paging, and the busy-turn signal.

##### `packages/client/ui-chat/src/client/chat/use-process-scroll.ts`
- **Purpose:** The process-body scroll plumbing, kept separate from the outer transcript scroll.
- **Non-obvious design decisions:**
  - **The viewport owns DOM; reading owns policy; navigation owns history.** `ChatViewport` never
    decides whether to follow — it asks a `FoldReader`.
  - **A landing is the *actual* clamped scroll result**, including any known semantic anchor and
    turn — not the requested position.
  - **Reader movement is sampled, not instantaneous.** `FOLLOW_THRESHOLD = 24` px and a 500 ms
    sample interval: a reader's own scrolling during a fold is *added* to the position the fold
    keeps still.
  - **Scroll intent is detected from `wheel`, `touchstart`, `pointerdown`, `keydown`,
    `beforematch`** — and `beforematch` is the browser's find-in-page, which would otherwise be
    stolen by the transcript.
  - **Keys that scroll are whitelisted** (`ArrowUp/Down`, `PageUp/Down`, `Home`, `End`, `Space`); a
    keypress in the composer never moves the transcript.
- **Edge cases & failure handling:** A paging marker that is hidden or empty is skipped without
  reading its geometry; a removed paging row is released without navigating to unrelated content.

##### `packages/client/ui-chat/src/client/chat/turn-rail-items.ts`
- **Purpose:** The rail item derivation — the prompt/response previews and the loaded/unloaded
  anchor.

##### `packages/client/ui-chat/src/client/chat/TurnNavigator.tsx`
- **Purpose:** The fixed-pitch virtual turn rail with independent activation and scroll controls.

##### `packages/client/ui-chat/src/client/chat/use-calendar-day.ts`
- **Purpose:** The calendar-day formatting helper used by the timestamp chips.
- **Non-obvious design decisions:**
  - **The rail merges the loaded Turns with the host `turnOutline` projection**, so every started
    Turn gets a mark even when its history is not loaded; activating an unloaded mark pages history
    through the Turn's `turn/start` seq before landing.
  - **Fixed pitch: 10 px between marks**, 6 px rail inset, 24 px fade band; a ladder taller than
    the frame scrolls inside it.
  - **Previews are card-sized** — one prompt line (50 chars) and up to three response lines (120).
  - **The pointer must not move the rail under the hand** — `pointerInsideRef` suspends follow.
  - **Reduced motion turns smooth scrolling into `auto`.**
- **Edge cases & failure handling:** Without the `turnOutline` projection the rail falls back to
  loaded Turns only; an unknown turn number in the imperative handle is ignored.

##### `packages/client/ui-chat/src/client/chat/StatsPills.tsx`
- **Purpose:** The composer statistics pills — output speed, cache hit, and the session stats.

##### `packages/client/ui-chat/src/client/chat/token-format.ts`
- **Purpose:** The token-count and percentage formatting, including the cache-hit precision rule.

##### `packages/client/ui-chat/src/client/chat/TurnUsagePanel.tsx`
- **Purpose:** The completed-turn usage panel — provider/model, input, cache read/write, output,
  and reasoning.

##### `packages/client/ui-chat/src/client/chat/stat-dialog.ts`
- **Purpose:** The session-statistics dialog opened from the composer pills.

##### `packages/client/ui-chat/src/client/contract/turn-metrics.ts`
- **Purpose:** `assistantStepReading` — the per-step timing facts derived from the recorded
  assistant blocks.
- **Non-obvious design decisions:**
  - **The cache-hit percentage is computed so that 100% and "almost 100%" are distinguishable.**
    `roundedPercentUnits` computes the number of digits needed to distinguish the true value from
    100 and then renders `99.9…` with the right number of nines — a cache hit of 99.95% must not
    read as 100%.
  - **A completed turn shows a usage row only when the accounting is complete and self-consistent.**
    Incomplete or contradictory accounting hides the whole detail rather than presenting a partial
    total as a whole one.
  - **Optional usage buckets are omitted**, not zeroed.
- **Edge cases & failure handling:** Cache-read/cache-write buckets are present only when *every*
  attempt reported them.

##### `packages/client/ui-chat/src/client/chat/MessageItem.tsx`
- **Purpose:** The user and context message rows — the bubbles, their arms, and the pending/echo
  markers.

##### `packages/client/ui-chat/src/client/chat/message-chrome.ts`
- **Purpose:** The shared row chrome — the bubble styles, the timestamp, and the copy control.

##### `packages/client/ui-chat/src/client/chat/ContextInjectionRow.tsx`
- **Purpose:** The row that shows a producer-injected context message.

##### `packages/client/ui-chat/src/client/chat/ContextBody.tsx`
- **Purpose:** The expanded bodies for the context disclosure — one per durable context form.

##### `packages/client/ui-chat/src/client/chat/UserContent.tsx`
- **Purpose:** The user-content factory's component — text, extra blocks, and attachments.

##### `packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`
- **Purpose:** The reasoning row — the collapsed preview and its disclosure.

##### `packages/client/ui-chat/src/client/chat/ReasoningContent.tsx`
- **Purpose:** The reasoning body component.

##### `packages/client/ui-chat/src/client/chat/RunningStatus.tsx`
- **Purpose:** The running-status chip.

##### `packages/client/ui-chat/src/client/chat/RunningWhaleTail.tsx`
- **Purpose:** The running-turn whale tail — the animated indicator beside a streaming answer.

##### `packages/client/ui-chat/src/client/chat/SystemPromptRow.tsx`
- **Purpose:** The system-prompt row (present but not shown in the Chat surface).

##### `packages/client/ui-chat/src/client/chat/MessageIconActions.tsx`
- **Purpose:** The per-message action row — copy, branch, and inspect.

##### `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx`
- **Purpose:** The turn-level disclosure that controls the process rows before the final answer.

##### `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`
- **Purpose:** The completed-turn footer — the branch action and the usage summary.

##### `packages/client/ui-chat/src/client/chat/TurnTriggerNodeView.tsx`
- **Purpose:** The turn-trigger row — the per-source title and icon mapping.

##### `packages/client/ui-chat/src/client/chat/GenericCommandCard.tsx`
- **Purpose:** The ordinary command lifecycle card.

##### `packages/client/ui-chat/src/client/chat/CompactionCommandCard.tsx`
- **Purpose:** The integrated `/compact` command card.

##### `packages/client/ui-chat/src/client/chat/CompactionItem.tsx`
- **Purpose:** The compaction checkpoint marker.

##### `packages/client/ui-chat/src/client/chat/CommandNodeView.tsx`
- **Purpose:** The command node renderer, with a command-name keyed specialization.

##### `packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx`
- **Purpose:** The assistant-step node renderer.

##### `packages/client/ui-chat/src/client/chat/AssistantMarkdown.tsx`
- **Purpose:** The assistant's Markdown body — text, code, images, and file mentions.

##### `packages/client/ui-chat/src/client/chat/ChatView.tsx`
- **Purpose:** The transcript root — the scrollport, the column, and the Markdown delegate provider.

##### `packages/client/ui-chat/src/client/chat/ChatFlow.tsx`
- **Purpose:** The ordered flow slot — where the grouped rows are placed.

##### `packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx`
- **Purpose:** The per-node seat — the wrapper that owns a row's hooks and lifecycle.

##### `packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx`
- **Purpose:** The process-group seat — the group header plus its body.

##### `packages/client/ui-chat/src/client/chat/QuotaNoticeHost.tsx`
- **Purpose:** The frame-wide quota notice host.

##### `packages/client/ui-chat/src/client/chat/searchable-hidden.ts`
- **Purpose:** `useSearchableHidden` — the `hidden="until-found"` transition helper.

##### `packages/client/ui-chat/src/client/chat/step-process.ts`
- **Purpose:** The step-process marker helpers.

##### `packages/client/ui-chat/src/client/chat/turn-assistant.ts`
- **Purpose:** The turn-assistant marker helpers.

##### `packages/client/ui-chat/src/client/chat/turn-trigger.ts`
- **Purpose:** The turn-trigger title and icon mapping.

##### `packages/client/ui-chat/src/client/chat/use-disclosure.ts`
- **Purpose:** The disclosure hook — open state plus the enclosing-Turn collapse reset.

##### `packages/client/ui-chat/src/client/chat/use-turn-data.ts`
- **Purpose:** `useTurnDataValue` — subscribe to one keyed value from a Turn's data store.

##### `packages/client/ui-chat/src/client/chat/register-node-renderers.ts`
- **Purpose:** Registers the Chat node renderers into the keyed renderer registry.

##### `packages/client/ui-chat/src/client/chat/render-entry.ts`
- **Purpose:** The render entry point used by the registry.
- **Non-obvious design decisions:**
  - **`ContextBody` renders one body per *durable context form*, and every form falls back to
    `OpaqueBody`** — the documented default for an absent, unknown, or malformed form, so a
    resumed or foreign log renders even when this UI version has never seen its producer
    (`chat/ContextBody.tsx:1-7`).
  - **Adjacent text blocks join with NO separator**, matching how provider adapters flatten them;
    inserting a line break would show the reader a line the model never saw. An unknown block
    breaks the run and keeps its own fallback rather than being hoisted past the text around it.
  - **Model-facing text is bounded at 20,000 characters at the disclosure, not at the producer**, and
    a list body materializes at most 200 entries before summarizing the remainder.
  - **A retry countdown is anchored to the browser's first render of the retry node** — host event
    time and `Date.now()` may belong to different clocks.
  - **The copy control never claims success when the host rejects the write**, and falls back to
    `execCommand` when `clipboard.writeText` is unavailable.
  - **`hidden="until-found"` retains a searchable zero-height box**; the Assistant body cancels the
    one gap that box would otherwise leave.
- **Edge cases & failure handling:** A preparing tool call has no argument fields and renders as a
  single non-expandable row; a settled tool call keeps the same `callId` across all three stages.

##### `packages/client/ui-chat/src/client/contract/assistant-content.ts`
- **Purpose:** `hasAssistantReplyContent` — whether an assistant block set carries a user-facing
  reply rather than only reasoning or tool-call protocol material.

##### `packages/client/ui-chat/src/client/contract/chat-nodes.ts`
- **Purpose:** The Chat node contract — the render-unit shape, the `ChatNodeDataMap` merge point,
  the payload types, and the token-usage types.

##### `packages/client/ui-chat/src/client/contract/chat-visibility.ts`
- **Purpose:** `isVisibleChatNode` — the visibility predicate the grouping and assembly use.

##### `packages/client/ui-chat/src/client/contract/slots.ts`
- **Purpose:** The Chat slot declarations and the composed component props for every Chat seat.

##### `packages/client/ui-chat/src/client/contract/snapshot.ts`
- **Purpose:** The Chat snapshot shape — order, nodes, locations, navigation, timeline, and the
  legacy slice — plus `EMPTY_CHAT_SNAPSHOT`.

##### `packages/client/ui-chat/src/client/contract/store.ts`
- **Purpose:** The Chat store state shape and the `ToolCallId` brand.

##### `packages/client/ui-chat/src/client/contract/turn-process.ts`
- **Purpose:** `TurnProcessSpec`, `sameTurnProcessSpec`, and `isSubagentDelegationTool`.

##### `packages/client/ui-chat/src/client/presentation-policy.ts`
- **Purpose:** `derivePresentationPolicy` — the pure function of the two durable preferences that
  yields the live display policy.

##### `packages/client/ui-chat/src/client/transcript-view.ts`
- **Purpose:** `TranscriptViewPolicy` — the transcript-view mode's runtime policy.

##### `packages/client/ui-chat/src/client/performance-usage.ts`
- **Purpose:** `PerformanceUsagePolicy` — the compact/detailed usage preference's runtime policy.

##### `packages/client/ui-chat/src/client/stores.ts`
- **Purpose:** `createChatStore` — the Chat snapshot store.

##### `packages/client/ui-chat/src/client/model/conversation-context.ts`
- **Purpose:** The `ConversationContext` / `ConversationContextOriginKind` shapes the Chat
  projections carry.

##### `packages/client/ui-chat/src/client/model/steering-history.ts`
- **Purpose:** The steering-message history projector — it tracks which user messages were claimed
  from `next-step` so a consumed steering message renders as steering and not as a fresh input.

##### `packages/client/ui-chat/src/client/model/tool-call-tree.ts`
- **Purpose:** The tool-call tree model — the parent/child relation, the depth bound, and the
  cycle rejection.

##### `packages/client/ui-chat/src/client/settings/LinkOpeningRow.tsx`
- **Purpose:** The General Settings row for the Chat link-opening destination.

##### `packages/client/ui-chat/src/client/settings/PerformanceUsageRow.tsx`
- **Purpose:** The General Settings row for the compact/detailed usage presentation.

##### `packages/client/ui-chat/src/client/settings/PreferenceRow.tsx`
- **Purpose:** The shared preference-row shell.

##### `packages/client/ui-chat/src/client/settings/TranscriptViewRow.tsx`
- **Purpose:** The General Settings row for the work-details presentation mode.

##### `packages/client/ui-chat/src/client/locale.ts`
- **Purpose:** The `ui-chat` namespace dictionaries.

##### `packages/client/ui-chat/src/client/markdown-labels.ts`
- **Purpose:** The Markdown primitive's label set for the Chat surface.

##### `packages/client/ui-chat/src/client/index.ts`
- **Purpose:** The package's public surface, including the `ChatNodeDataMap` merge point other
  plugins extend.

##### `packages/client/ui-chat/src/chat-settings.ts`
- **Purpose:** The durable Host settings schema for the Chat target.

##### `packages/client/ui-chat/src/index.ts`
- **Purpose:** The Host loader entry — registers the durable Chat settings namespace.
- **Non-obvious design decisions:**
  - **The display-mode policy is a pure function of two durable preferences** — `transcriptView`
    (compact / standard / detailed / verbose) and `collapseTiming` (`completion` / `next-input`) —
    and it is derived once, so a mode change re-renders only components whose *selected field*
    changed.
  - **Legacy saved values remain accepted.** `normal` and `expanded` are read as `detailed`, never
    offered as a choice and never written back (`src/chat-settings.ts:30-46`).
  - **An unrecognized transcript-view mode defers to the client's default** rather than failing.
  - **`isSubagentDelegationTool` recognises `subagent` and `subagent_*`** — the shipped delegation
    name and its configured variants — while control tools such as `send_message` and `list_agents`
    are explicitly *not* counted as delegations
    (`contract/turn-process.ts:44`).
  - **The tool-call tree rejects a cycle and bounds depth** (`model/tool-call-tree.ts`).
- **Edge cases & failure handling:** `useTurnDataValue` returns `undefined` for a Node outside a
  Turn rather than throwing.

##### `packages/client/ui-chat/src/client/chat/AssistantMarkdown.module.css`
- **Purpose:** The assistant body styles, including the wide-table breakout.

##### `packages/client/ui-chat/src/client/chat/ChatGroupSeat.module.css`
- **Purpose:** The process-group seat styles.

##### `packages/client/ui-chat/src/client/chat/ChatView.module.css`
- **Purpose:** The transcript root styles — the scrollport, the column, the flow gaps, and the
  fold timing.

##### `packages/client/ui-chat/src/client/chat/ContextBody.module.css`
- **Purpose:** The context-body styles.

##### `packages/client/ui-chat/src/client/chat/ContextInjectionRow.module.css`
- **Purpose:** The context-injection row styles.

##### `packages/client/ui-chat/src/client/chat/GenericCommandCard.module.css`
- **Purpose:** The generic command card styles.

##### `packages/client/ui-chat/src/client/chat/MessageIconActions.module.css`
- **Purpose:** The per-message action row styles.

##### `packages/client/ui-chat/src/client/chat/MessageItem.module.css`
- **Purpose:** The user/context message row styles — the bubble, the arms, and the copy control.

##### `packages/client/ui-chat/src/client/chat/ReasoningRow.module.css`
- **Purpose:** The reasoning row styles.

##### `packages/client/ui-chat/src/client/chat/StatsPills.module.css`
- **Purpose:** The composer statistics pill styles.

##### `packages/client/ui-chat/src/client/chat/stat-dialog.module.css`
- **Purpose:** The session-statistics dialog styles.

##### `packages/client/ui-chat/src/client/chat/TurnNavigator.module.css`
- **Purpose:** The turn rail styles — the fixed-pitch marks, the fade bands, and the preview card.

##### `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.module.css`
- **Purpose:** The turn-level disclosure styles.

##### `packages/client/ui-chat/src/client/chat/TurnTailNodeView.module.css`
- **Purpose:** The completed-turn footer styles.

##### `packages/client/ui-chat/src/client/chat/TurnTriggerNodeView.module.css`
- **Purpose:** The turn-trigger row styles.

##### `packages/client/ui-chat/src/client/chat/TurnUsagePanel.module.css`
- **Purpose:** The per-turn usage panel styles.

##### `packages/client/ui-chat/src/client/chat/accessibility.module.css`
- **Purpose:** The visually-hidden / screen-reader-only utility.

##### `packages/client/ui-chat/src/client/settings/PreferenceRow.module.css`
- **Purpose:** The shared preference-row styles.
- **Non-obvious design decisions:**
  - **Wide markdown tables break out of the message column** using `100cqw` against the scroll
    container's inline size — the CSS stand-in for a JS-measured virtual-list width
    (`chat/AssistantMarkdown.module.css`).
  - **The flow's vertical gap is a CSS variable** (`--dsh-chat-flow-gap`), overridden to 12 px for
    response groups so an answer separates from its neighbours more than a process row does.
  - **The turn spacer is sized by the viewport owner** while rows above the reader close, and the
    room is given back only as later content grows into it.
  - **Spacing changes share the closing rows' timing** while a Turn folds (160 ms), and are
    disabled under `prefers-reduced-motion`.

#### `packages/client/ui-tool` — tool presentation

##### `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`
- **Purpose:** The pure row-model derivation for every tool summary row.
- **Key abstractions:** `toolRowModel`, `classifyTool`, `toolTitleKey`, `resultText`,
  `formatToolBody`, `ToolRowVariant`, `ToolRowState`.
- **Non-obvious design decisions:**
  - **`cordis_define` is deliberately ABSENT from the variant table.** `ui-cordis` registers a keyed
    `tool.call.toolview` entry for it, and a keyed hit *replaces* the generic row; an entry here
    would be unreachable and a second title for the same call would be a second answer to a
    question the card already owns (`models/tool-call-model.ts:38-52`).
  - **`pwsh` gets the `bash` variant** — the shell row family (icon, colours) with its own title.
  - **`read_image` is classified as `read`** because it is a single-file read; left unclassified it
    falls to `others`, which derives no `filePath` — so the path the row advertises as openable
    would never be openable.
  - **The file path shown is the operation-time absolute path, and the label is the authored
    argument.** `recordedAbsolutePath` prefers the recorded result location; the argument is only
    used when it is absolute, or when the call is settled, not an error, and not a child dispatch.
  - **A generic row shows `Tool call · <tool name>`; a tool-owned title omits the English name.**
  - **`NKB` is the decoded input's UTF-16 length rounded up in units of 1024, summing old and new
    text for an edit — it is not file bytes.**
- **Edge cases & failure handling:** Non-JSON args (mid-stream truncation, a rejected call kept
  verbatim) fall back to the raw string; an empty result falls back to the structured error's
  `name: code` line.

##### `packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts`
- **Purpose:** Terminal-card derivation, including the exit-status marker parser and the workdir
  normaliser.
- **Key abstractions:** `terminalCardModel`, `terminalFailed`, `terminalExitLabel`,
  `isBackgroundShellCall`, `isSettledPersistentShellCall`, `isSpilledShellCall`,
  `localizeTerminalCardModel`, `terminalBlockLabels`.
- **Non-obvious design decisions:**
  - **A failing command is result data, not a tool error.** The bash tool settles a failing command
    as a completed call (`isError` stays false) — so the row keeps its failure state *alongside* its
    exit capsule rather than losing one or the other.
  - **The exit-status marker is parsed out of the shell output by regex** (`[exit code: N]` /
    `[killed by signal: S]`), and the marker is *removed* from the output. The parser is a
    hand-written mirror of `@deepseek-ai/dsh-shell/render` so a Host-only package never enters the
    Client dependency graph.
  - **A spill-policy notice forces the generic path.** `hasSpillNotice` comes from the shared
    browser-safe entry, not from an independent UI pattern: "matching text cannot authenticate its
    source", so a displaced or omitted exit marker cannot establish success.
  - **A persistent shell's settled result stays generic** — reset and partial-output diagnostics do
    not always describe one process exit status — but it remains expandable.
  - **`normalizeSegments` collapses `.` and `..`** so the prompt label names the directory the
    command actually ran in, and it treats a UNC `\\server\share` as an unpoppable root because
    Windows cannot climb above a share.
- **Edge cases & failure handling:** A missing exit code is shown as an explicit "no exit code"
  status rather than being invented as 0.

##### `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`
- **Purpose:** The diff card derivation.

##### `packages/client/ui-tool/src/client/tool/models/read-card-model.ts`
- **Purpose:** The read card derivation and `readCallLine`.

##### `packages/client/ui-tool/src/client/tool/models/search-card-model.ts`
- **Purpose:** The grep/glob card derivation.

##### `packages/client/ui-tool/src/client/tool/models/web-card-model.ts`
- **Purpose:** The web search/fetch card derivation and `webFetchHref`.

##### `packages/client/ui-tool/src/client/tool/models/image-card-model.ts`
- **Purpose:** The image card derivation and the durable-reference narrowing.
- **Non-obvious design decisions:**
  - **The chat row caps tighter than the details panel** — diff 9 lines, read 8, search 8. A chat
    row is a *summary surface inside the message flow*; the details panel is the single-call
    reading surface.
  - **A diff card prefers the applied metadata over the intended diff**; the intended diff is used
    only when successful metadata reports no applied hunk, and only for `write`.
  - **The read card requires the model-facing `<path>/<type>/<content>` envelope** and validated
    metadata (strictly ascending line numbers, each ≤ `totalLines`); anything else is generic.
  - **The search card surfaces the "full result stored at …" recovery locator only when the result
    was actually capped**, and the locator is rendered *below* the card so the dropped rows survive.
  - **The image card treats the result's `content` as the single source of truth for the image
    references** and takes only the *path* from `meta` — reading the reference from `meta` too would
    keep two copies of one fact, and a post-execute hook that legitimately replaces the result
    content would leave a stale copy behind, showing an image the result no longer returns.
  - **Every malformed input declines to the generic card rather than throwing.**
- **Edge cases & failure handling:** A read card is *result-side only* — a running read shows the
  summary row alone.

##### `packages/client/ui-tool/src/client/tool/models/detail-model-shared.ts`
- **Purpose:** The shared recorded-value formatting — `detailRecord`, `nonempty`, `detailJson`,
  `detailBadge`, `detailLabel`, `detailList`.

##### `packages/client/ui-tool/src/client/tool/models/details-card-model.ts`
- **Purpose:** `detailsCardModel` — the entry point that picks the right detail adapter for a
  recorded result.

##### `packages/client/ui-tool/src/client/tool/models/control-details-model.ts`
- **Purpose:** The adapters for agent, job, terminal, and LSP control results.

##### `packages/client/ui-tool/src/client/tool/models/inspection-details-model.ts`
- **Purpose:** The adapters for Cordis, workflow, Ralph, and session-query inspection results.
- **Non-obvious design decisions:**
  - **A recorded status gets a *static* semantic colour** — "a badge that does not imply a live
    subscription".
  - **Unknown field names are preserved verbatim** — only known fields get a localized label.
  - **Inspection records are projected recursively to depth 4**, then preserved as raw JSON code;
    arrays are capped at 40 items with a "more in Inspect" count.
  - **A spilled inspection result stays generic** — same spill-policy rule as the terminal card.
  - **Dates are rendered in the viewer's time zone** and a malformed locale falls back to the raw
    string rather than throwing.
- **Edge cases & failure handling:** A malformed domain result is *kept generic* — a partially
  valid schedule or goal is never presented as applied.

##### `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`
- **Purpose:** The shared tool row — the disclosure chrome, the summary, and the card dispatch.

##### `packages/client/ui-tool/src/client/tool/components/ToolDetails.tsx`
- **Purpose:** The compact read-only fields and lists for recorded tool results.

##### `packages/client/ui-tool/src/client/tool/components/AskQuestionCard.tsx`
- **Purpose:** The paired question/answer transcript card.

##### `packages/client/ui-tool/src/client/tool/components/ExitCodeBadge.tsx`
- **Purpose:** The neutral exit-status capsule with its red dot.

##### `packages/client/ui-tool/src/client/tool/components/QuestionToolRow.tsx`
- **Purpose:** The question row's answer panel and its read-only record view.

##### `packages/client/ui-tool/src/client/tool/ToolCallTree.tsx`
- **Purpose:** The whole-call tree — the root call plus its recursively nested subcalls.
- **Non-obvious design decisions:**
  - **One card wins.** `askQuestion ?? terminal ?? diff ?? read ?? image ?? search ?? web ?? details`
    — the card fields are mutually exclusive and replace the text sections.
  - **A running atomic row shares ONE left-to-right highlight** across title, separator, summary,
    and suffix; settled rows stay static.
  - **The summary link's Enter/Space does not bubble** to the row's keydown handler, which would
    `preventDefault()` the key and toggle expand instead of activating the link — the keyboard
    analogue of the click handlers' `stopPropagation`.
  - **An Auto-review denial takes precedence over keyed specialized views.** The generic row
    preserves the call identity, omits raw arguments, and normalizes the stored reason only for
    display (trim, collapse line separators to spaces); the durable error keeps the raw reason.
  - **Each call branch memoizes its explicit phase props**, so changing one subcall leaves
    unchanged sibling branches unrendered.
  - **The `data-chat-anchor-key="call:<id>"` and `data-chat-call-id` DOM contract** is preserved on
    every root and child wrapper — it is what paging and selection key off.
- **Edge cases & failure handling:** A preparing call is never expandable. Error and stopped rows
  omit the size suffix and diff totals.

##### `packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx`
- **Purpose:** The generic fallback card — the row every unregistered tool name gets.

##### `packages/client/ui-tool/src/client/tool/toolviews/ask-question-row.tsx`
- **Purpose:** The `ask_user_question` row and its answer panel.

##### `packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx`
- **Purpose:** The `bash` row — the shell command and its streamed description.

##### `packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx`
- **Purpose:** The keyed recorded-result rows that share the compact detail body.

##### `packages/client/ui-tool/src/client/tool/toolviews/file-mutation-row.tsx`
- **Purpose:** The `write` / `edit` row with its diff card.

##### `packages/client/ui-tool/src/client/tool/toolviews/plan-summary.ts`
- **Purpose:** The todo plan summary — the counts and the extra-active count.

##### `packages/client/ui-tool/src/client/tool/toolviews/read-family-row.tsx`
- **Purpose:** The shared read-row body used by the read variants.

##### `packages/client/ui-tool/src/client/tool/toolviews/read-image-row.tsx`
- **Purpose:** The `read_image` row.

##### `packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx`
- **Purpose:** The `read` row and its openable path.

##### `packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx`
- **Purpose:** The `grep` / `glob` row.

##### `packages/client/ui-tool/src/client/tool/toolviews/todo-row.tsx`
- **Purpose:** The `todo_write` row with its plan strip.

##### `packages/client/ui-tool/src/client/tool/toolviews/web-row.tsx`
- **Purpose:** The `web_search` / `web_fetch` row.

##### `packages/client/ui-tool/src/client/tool/models/ask-question-card-model.ts`
- **Purpose:** The paired question/answer card model.

##### `packages/client/ui-tool/src/client/tool/models/auto-review-denial.ts`
- **Purpose:** `deriveAutoReviewDenial` and `localizeAutoReviewDenial` — the denial's detection and
  its display-only normalization.

##### `packages/client/ui-tool/src/client/tool/models/todo-diff-model.ts`
- **Purpose:** The todo diff — a write against its recorded predecessor.

##### `packages/client/ui-tool/src/client/tool/models/todo-history.ts`
- **Purpose:** The recorded todo write index and the call predecessor target.

##### `packages/client/ui-tool/src/client/tool/models/primitive-labels.ts`
- **Purpose:** The label sets the primitives need from the conversation locale seat.

##### `packages/client/ui-tool/src/client/tool/models/raw-tool-call.ts`
- **Purpose:** `parsedToolCall` and `singleResultText` — the shared narrowing of raw tool fields.

##### `packages/client/ui-tool/src/client/tool/models/recorded-path.ts`
- **Purpose:** `recordedAbsolutePath` — reads an operation-time path out of opaque result metadata.
- **Non-obvious design decisions:**
  - **Each view is a small plugin that registers a keyed slot entry** — a business package can
    register only its wire tool name and its view; it never pairs Session events or owns the
    root/subcall topology.
  - **The question row pairs questions with answers by stable id**, and a batch it cannot pair
    unambiguously gets *no panel at all* — "blank or dropped answers would read as choices the user
    made".
  - **A timed question's answerability comes from the `userQuestions` projection, not from the
    recorded result.** The result may be the timeout; the projection knows what can still take an
    answer.
  - **The todo row's parallel-active count lives OUTSIDE the ellipsized summary text**
    (`summarySuffix`), because a count concatenated onto the end of the task name is the first thing
    a narrow row clips — exactly when it carries information.
  - **The todo diff distinguishes a relative reorder from a position shifted by an insertion** — a
    status change is one kind of change, a move is another.
  - **`parsedToolCall` caches its parse in a `WeakMap`** keyed by the immutable block, so 100
    sibling calls parse their arguments once.
- **Edge cases & failure handling:** An Auto denial renders generically *before* keyed slot
  dispatch, so an external skill or Cordis keyed row cannot hide it.

#### `packages/client/ui-trajectory` — the event ledger

##### `packages/client/ui-trajectory/src/client/layout.ts`
- **Purpose:** The fold that turns a Trajectory snapshot into turn → group → cell rows.
- **Key abstractions:** `deriveTrajectoryLayout`, `appendTrajectoryPartialLayout`,
  `TrajectoryTurnModel`, `TrajectoryGroupModel`.
- **Non-obvious design decisions:**
  - **A `user/message` has no turn on the wire.** It is enclosed in the *next* assistant turn, else
    the in-flight partial, else the turn after the last finalized assistant, else turn 1
    (`layout.ts:1002` region, `enclosingUserTurn`).
  - **A group description is a wall span plus a tool histogram** — `1.5 s bash×6` — computed from
    absolute times, where a tool cell contributes both its start and its end so one tool still spans
    call→result for the group clock.
  - **The streaming partial is appended, never merged.** `appendTrajectoryPartialLayout` builds a
    separate partial layout and splices it into the matching turn, so a live stream does not
    rebuild the finalized turns.
  - **Orphan turn-0 cells (orphaned tools) fold into Turn 1.**
- **Edge cases & failure handling:** An in-flight record's duration is `null`, never a guess —
  "the em dash".

##### `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts`
- **Purpose:** The Trajectory target's snapshot builder.
- **Key abstractions:** `TrajectorySnapshotBuilder`, `trajectoryViewDefinition`, `interruptCompactions`,
  `applyTurnErrors`, `captureSchemas`.
- **Non-obvious design decisions:**
  - **One request header is inherited by later requests in the same step** until a new one arrives,
    and the prompt *change* is consumed once — "it inherits one request header across requests
    without repeating its prompt change".
  - **A compaction interrupted by a session boundary is closed as an error** with a stable,
    non-localized marker (`COMPACTION_INTERRUPTED_ERROR`), which the view localizes at render time.
  - **The tool schema is captured at call time from the tools that were live then** — `captureSchemas`
    walks the subcall tree and records the schema per `callId`.
  - **A turn error is applied to the *last* assistant request of that turn**, not to every one.
- **Edge cases & failure handling:** `apply` distinguishes a structural change (anchor moved) from
  a content-only change (same anchor) and only re-sorts on the former.

##### `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts`
- **Purpose:** The Trajectory Assistant Definition — live chunks, settled messages, usage, and the
  retry facts.

##### `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts`
- **Purpose:** The Trajectory Tool Definition — the root call plus its nested subcalls.

##### `packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts`
- **Purpose:** The Trajectory user/context/steering Definitions and the inbox classifier.

##### `packages/client/ui-trajectory/src/client/trajectory-compaction-definition.ts`
- **Purpose:** The Trajectory compaction and session-boundary Definitions.

##### `packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts`
- **Purpose:** The Trajectory request-header Definition — the prompt snapshot and change per step.
- **Non-obvious design decisions:**
  - **The Trajectory Assistant Definition keeps the first token time across live chunks AND settled
    retry attempts**, so TTFT is not reset by a retry (`trajectory-assistant-definition.ts:236`).
  - **A retry resets the block state but preserves `firstTokenTime` and accumulated usage.**
  - **Publication is tuned per event**: `step/start` and `assistant/attempt` publish `none`; a
    `live-chunk` publishes `animation-frame`; a settled message publishes `immediate`; a `usage` or
    `finish` chunk publishes `none`.
  - **Tool records begin at durable `tool/call` events** — Chat's transient *preparing* stage
    creates no Trajectory row and does not alter historical tool timing.
  - **An interrupted tool call is materialized as an error result** at the interruption boundary,
    with the raw error details preserved.
  - **The inbox classifier retains only next-step Inbox IDs through persistent splice state**, so a
    user message that was claimed by a steered batch renders as steering, not as a fresh input.
  - **`jscpd:ignore` blocks mark the deliberate duplication** between the Chat and Trajectory event
    projections — they are independent state machines on purpose.

##### `packages/client/ui-trajectory/src/client/timeline.ts`
- **Purpose:** The timeline derivation — the spans, the turn boundaries, and the focus index.

##### `packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx`
- **Purpose:** The Chrome-Network-style overview timeline.
- **Non-obvious design decisions:**
  - **Three lanes**: input (user/context), model (assistant), tools (tool/subtool).
  - **An assistant span divides recorded TTFT from decoding** and is drawn as a two-colour gradient.
  - **`compressIdle` removes the gaps between operations** for the `duration`/`time` modes while
    `actual` keeps the true wall clock; the compression offset is computed once per span so the
    projection stays consistent.
  - **Dragging an interval focuses the ledger on every record active at any point in that
    INCLUSIVE range**; a right-button click clears it, a right-button drag pans a zoomed viewport.
  - **Wheel zoom is anchored at the pointer** and clamped to a minimum of 4 operations in sequence
    mode.
- **Edge cases & failure handling:** An in-flight record has no duration, so the overview renders a
  start marker rather than inventing a live span.

##### `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` (3,538 lines)
- **Purpose:** The ledger table and the local record inspector.
- **Key abstractions:** `TrajectoryTable`, `TrajectoryRequestNumber`, `TrajectoryUsage`,
  `useStableVirtualRowStructure`, `groupTrajectoryVirtualRows`.
- **Non-obvious design decisions:**
  - **Virtualization turns on only when it is needed**: `hasOlderRecords || records.length > 100`.
    Below that the table is a plain table.
  - **The virtual row structure is cached by identity** (`useStableVirtualRowStructure`) so a
    content-only stream frame does not re-measure or re-key rows.
  - **Request-only separators share the next measurable virtual item** — the virtualizer never owns
    a zero-height item.
  - **The virtualizer owns bottom following for structural appends** (`followOnAppend: 'auto'`,
    `anchorTo: 'end'`); a non-virtual ledger uses a direct tail-position write.
  - **A search index is rebuilt on a 3-second throttle** and re-parses Markdown only when one
    record's source changed (`trajectory-search-index.ts`).
  - **A selection made outside the resident window grows the resident window** instead of failing —
    `setHistoryNodeLimit(limit => limit + historyStartIndex - inspectNodeIndex)`.
  - **A cross-view inspect handoff that cannot find its target leaves the request pending**; the
    effect re-runs as history pages in.
- **Edge cases & failure handling:** The table is `visibility: hidden` until the scroll is ready,
  so the reader never sees a half-positioned tail.

##### `packages/client/ui-trajectory/src/client/trajectory-record.ts`
- **Purpose:** The record contract — `TrajectoryCellKind`, `TrajectoryCellProps`,
  `AssistantMetricDetail`, `TrajectorySourceBlock`, and the formatting helpers.

##### `packages/client/ui-trajectory/src/client/trajectory-contract.ts`
- **Purpose:** The Trajectory target contract — `TrajectoryContribution`, `TrajectorySnapshot`,
  `UseTrajectory`, and the `conversation.trajectory.images` slot declaration.

##### `packages/client/ui-trajectory/src/client/trajectory-preview.ts`
- **Purpose:** `trajectoryPreviewText` — the bounded single-line preview.

##### `packages/client/ui-trajectory/src/client/code-program.ts`
- **Purpose:** `codeProgram` — the recorded program, its arguments, and its language hint.

##### `packages/client/ui-trajectory/src/client/trajectory-search-index.ts`
- **Purpose:** `TrajectorySearchIndex` — the incremental full-text index over the resident
  snapshot.

##### `packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts`
- **Purpose:** `groupTrajectoryVirtualRows` — the zero-height request boundaries folded into the
  following measurable row.

##### `packages/client/ui-trajectory/src/client/index.ts`
- **Purpose:** The plugin entry — registers the Trajectory view tab and its standard hook.

##### `packages/client/ui-trajectory/src/client/duration-store.ts`
- **Purpose:** `createTrajectoryDurationStore` — the browser-wide "use actual duration" preference.

##### `packages/client/ui-trajectory/src/client/string-wrapping-store.ts`
- **Purpose:** `createTrajectoryStringWrappingStore` — the shared wrapping preference.

##### `packages/client/ui-trajectory/src/client/copy-codes.ts`
- **Purpose:** The stable non-display markers (e.g. `COMPACTION_INTERRUPTED_ERROR`) that the view
  localizes at render time.
- **Non-obvious design decisions:**
  - **`trajectoryRecordId` is the identity that survives prepending older records**: an explicit
    `recordId`, else the call id, else the source seq, else the index.
  - **The preview is bounded twice** — 2,048 source characters in, 512 output characters out — and
    the truncation marker says so.
  - **The code language is read from the recorded tool schema, never guessed from the source.**
    `recordedLanguage` requires an *unambiguous* TypeScript-or-Python hint in the recorded schema's
    `code.description`; a missing or conflicting hint leaves plain source.
  - **`copy-codes.ts` holds stable non-display markers** so an error can be localized at render
    time instead of being baked into the data.
- **Edge cases & failure handling:** The JSON-string-wrapping preference is *sampled only when a
  string is expanded*, so a newly opened code view takes the last choice without changing other
  open views.

##### `packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
- **Purpose:** The view composition — the ledger, the toolbar, the timeline, and the record
  inspector's data preparation.

##### `packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx`
- **Purpose:** The ledger toolbar — the duration mode, the expand/collapse-all controls, and the
  search box.

##### `packages/client/ui-trajectory/src/client/TrajectoryCell.tsx`
- **Purpose:** The legacy standalone trajectory cell, retained for direct consumers and specs.

##### `packages/client/ui-trajectory/src/client/TrajectoryTurn.tsx`
- **Purpose:** The sticky Turn header plus the padded Message/Step body.

##### `packages/client/ui-trajectory/src/client/TrajectoryTurnHeader.tsx`
- **Purpose:** The Turn header — "Turn N" and the four metric column labels.

##### `packages/client/ui-trajectory/src/client/TrajectoryGroupHeader.tsx`
- **Purpose:** The Message/Step group header with its optional description.

##### `packages/client/ui-trajectory/src/client/TrajectoryCell.module.css`
- **Purpose:** The standalone cell styles.

##### `packages/client/ui-trajectory/src/client/TrajectoryGroupHeader.module.css`
- **Purpose:** The group header styles.

##### `packages/client/ui-trajectory/src/client/TrajectoryTable.module.css`
- **Purpose:** The ledger table and inspector styles — the sticky header, the columns, the detail
  pane, and the resize handles.

##### `packages/client/ui-trajectory/src/client/TrajectoryTimeline.module.css`
- **Purpose:** The timeline styles — the lanes, the spans, the turn boundaries, and the domain
  transform.

##### `packages/client/ui-trajectory/src/client/TrajectoryToolbar.module.css`
- **Purpose:** The toolbar styles.

##### `packages/client/ui-trajectory/src/client/TrajectoryTurn.module.css`
- **Purpose:** The turn body styles.

##### `packages/client/ui-trajectory/src/client/TrajectoryTurnHeader.module.css`
- **Purpose:** The turn header styles.

##### `packages/client/ui-trajectory/src/client/views.module.css`
- **Purpose:** The full-bleed ledger host and the composer's bottom clearance.
- **Non-obvious design decisions:**
  - **The ledger derives React data from 50 target Nodes ending at the mount-time tail**
    (`HISTORY_PAGE_NODES = 50`); later Nodes extend that anchored window without evicting its
    prefix.
  - **Request numbers and cumulative usage cover the complete resident snapshot**, while selection,
    timeline navigation, folding, and search cover only the React-visible window.
  - **The search index is updated on a 3-second throttle** so a streaming answer does not rebuild
    the index on every frame.
  - **The composer's live height is honoured by the ledger's bottom clearance**
    (`--dsh-trajectory-bottom-clearance`) so the final rows stay reachable under a floating
    composer.
- **Edge cases & failure handling:** The timeline's earlier-history control reports the loading
  state and stays inert while a page is in flight.

##### `packages/client/ui-chat/src/client/chat/ApprovalCommand.tsx`
- **Purpose:** The approval panel's detail renderer — it shows the correlated running tool's command.
- **Non-obvious design decisions:** **`commandOf` accepts only a string `command` from valid JSON
  arguments**; a preparing or settled call renders nothing, so the panel never shows a command
  that is not running.

##### `packages/client/ui-chat/src/client/conversation-nodes/common.ts`
- **Purpose:** The shared Chat node helpers — `CHAT_SYNTHETIC_SEQ_OFFSETS`, `contextLocation`,
  `locationCoordinates`, `chatNode`, and `coordinate`.

##### `packages/client/ui-chat/src/client/conversation-nodes/assistant.ts`
- **Purpose:** The assistant-step Definition — streaming, settled, and interrupted assistant
  blocks.

##### `packages/client/ui-chat/src/client/conversation-nodes/command.ts`
- **Purpose:** The command Definition and the compaction state helpers (`compactSource`,
  `compactSummary`, `updateCompactionState`).

##### `packages/client/ui-chat/src/client/conversation-nodes/compaction.ts`
- **Purpose:** The automatic-compaction checkpoint marker Definition.

##### `packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts`
- **Purpose:** The shared event → fact projections — `contextForm`, `contextProducer`,
  `sessionRecallLabels`, `skillInvocationName`, `toAssistantBlocks`, `displayFailure`,
  `isTokenDelta`.

##### `packages/client/ui-chat/src/client/conversation-nodes/fallback.ts`
- **Purpose:** The unknown-event fallback Definition — a log written by a newer build still
  renders.

##### `packages/client/ui-chat/src/client/conversation-nodes/group-tree-segments.ts`
- **Purpose:** `GroupTreeSegments` — the exchange segmentation and the "latest segment" tracking.

##### `packages/client/ui-chat/src/client/conversation-nodes/inbox.ts`
- **Purpose:** The next-step and next-turn inbox Definitions — the queued messages.

##### `packages/client/ui-chat/src/client/conversation-nodes/message.ts`
- **Purpose:** The user-message and developer-message Definitions.

##### `packages/client/ui-chat/src/client/conversation-nodes/register.ts`
- **Purpose:** `registerConversationNodes` — the one place every Chat Definition is registered.

##### `packages/client/ui-chat/src/client/conversation-nodes/request-prompt.ts`
- **Purpose:** The system-prompt and request-prompt Definitions.

##### `packages/client/ui-chat/src/client/conversation-nodes/retry.ts`
- **Purpose:** The model-retry Definition — one durable retry chain rendered as a single row.

##### `packages/client/ui-chat/src/client/conversation-nodes/tool.ts`
- **Purpose:** The root tool lifecycle Definition with recursively nested subcalls.

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts`
- **Purpose:** The terminal turn-failure Definition.

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-max-tokens.ts`
- **Purpose:** The output-token-limit notice Definition.

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-navigation.ts`
- **Purpose:** The rail item derivation — `turnNavigationItem` and `sameTurnNavigationItem`.

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-process-presentation.ts`
- **Purpose:** `ChatTurnProcessProjector` — the per-turn process presentation (what is foldable,
  what is the answer boundary).

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts`
- **Purpose:** The turn-level process disclosure Definition.

##### `packages/client/ui-chat/src/client/conversation-nodes/turn-tail.ts`
- **Purpose:** The completed-turn tail Definition — the footer that carries the branch action.

##### `packages/client/ui-chat/src/client/conversation-nodes/README.md`
- **Purpose:** The business rules for Chat process grouping and activity summaries — the closest
  thing in the shard to a specification. Decides: grouping, counts, display modes, and whole-turn
  folding are four *different* questions; every reply separates secondary groups; only the final
  answer is protected from whole-turn folding; visibility applies outside-in (whole Turn →
  secondary group → individual disclosure); category changes never open or close a layer; mode
  changes preserve membership and manual opening choices.
- **Tier note:** this is a `docs` file — read in full for the rules it decides.

##### `packages/client/ui-chat/src/client/conversation-nodes/README.zh.md`
- **Purpose:** The Chinese counterpart of the business rules above.

##### `packages/client/ui-chat/src/client/conversation-nodes/README.i18n.yaml`
- **Purpose:** The per-heading bilingual-pair hash record for the rules document.

##### `packages/client/ui-chat/src/css-modules.d.ts`
- **Purpose:** The ambient declaration for `*.module.css` imports.

##### `packages/client/ui-conversation/src/client/conversation/assembly.ts`
- **Purpose:** `UiConversation` — the per-Session Conversation binding, and the `ConversationBinding`
  face (`openTurn`, the group registry, the target accessors).

##### `packages/client/ui-conversation/src/client/conversation/view-registry.ts`
- **Purpose:** The registry of View Definitions — the target snapshot builders.

##### `packages/client/ui-conversation/src/client/queue/QueueDock.module.css`
- **Purpose:** The queue dock styles.

##### `packages/client/ui-conversation/src/client/user-text/UserText.tsx`
- **Purpose:** `UserText`, `PlainUserText`, and `SessionReference` — the row components the
  UserText projection renders.

##### `packages/client/ui-conversation/src/client/user-text/UserText.module.css`
- **Purpose:** The user-text row styles.

##### `packages/client/ui-conversation/src/client/user-text/session-reference-rule.ts`
- **Purpose:** The rule that recognises a Session reference in the sent text and folds the wire
  syntax to its JSON label data.

##### `packages/client/ui-conversation/src/client/user-text/whitespace-rules.ts`
- **Purpose:** `collapseWhitespaceRule` and `trimWhitespaceRule` — the two ordinary whitespace
  matchers.

##### `packages/client/ui-conversation/src/client/input/editor/reference-activation.ts`
- **Purpose:** `registerReferenceActivation` — clicking a chip (or a text reference) opens it.

##### `packages/client/ui-conversation/src/client/input/editor/ReferenceChip.module.css`
- **Purpose:** The reference chip styles.

##### `packages/client/ui-conversation/src/client/input/editor/composer-editor.module.css`
- **Purpose:** The shared inline-reference treatment — hover does not change text metrics.

##### `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- **Purpose:** The Conversation root styles — the frame, the shared chat width, the width handles,
  and the composer clearance.

##### `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- **Purpose:** The composer bar styles — the control row, the attachment rail, and the dock.

##### `packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`
- **Purpose:** The blank-session hero styles.

##### `packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css`
- **Purpose:** The Todo panel styles.

##### `packages/client/ui-conversation/src/client/skeleton/ContextMeter.module.css`
- **Purpose:** The context meter styles — the ring and the breakdown panel.

##### `packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.module.css`
- **Purpose:** The busy-Enter settings row styles.

##### `packages/client/ui-conversation/src/submission-settings.ts`
- **Purpose:** The durable Host settings schema for the conversation plugin (`busyEnter`).

##### `packages/client/ui-conversation/src/index.ts`
- **Purpose:** The Host loader entry — registers the durable `ui-conversation` settings namespace.

##### `packages/client/ui-conversation/src/css-modules.d.ts`
- **Purpose:** The ambient declaration for `*.module.css` imports.

##### `packages/client/ui-tool/src/client/apply.ts`
- **Purpose:** The Tool plugin's composition root — registers the whole-call tree and the built-in
  atomic views.
- **Non-obvious design decisions:** **The Host home used to resolve POSIX `~` arrives through the
  `remote` service's `$host` observable**, so the Tool layer never imports a Host package.

##### `packages/client/ui-tool/src/client/contract/slots.ts`
- **Purpose:** The Tool UI slot declarations and their composed component props — the keyed
  `tool.call.toolview` slot, the `tool.call.images` slot, and the owner payloads.
- **Non-obvious design decisions:**
  - **The keyed slot's owner payload is deliberately explicit.** `ToolCallOwnerProps` carries the
    `callId`, the `toolName`, the `phase` discriminant with its stage-specific `block`, an optional
    `cwd` and `home`, the session-authorized `loadImage`, and the plain `openFile` / `inspect`
    callbacks — so a business view never has to reach back into the Session.

##### `packages/client/ui-tool/src/client/index.ts`
- **Purpose:** The package's public surface.

##### `packages/client/ui-tool/src/client/locale.ts`
- **Purpose:** `CONVERSATION_NS` — the locale namespace the conversation owner supplies to the Tool
  renderers.

##### `packages/client/ui-tool/src/client/tool/ToolCallTree.module.css`
- **Purpose:** The call-tree styles.

##### `packages/client/ui-tool/src/client/tool/components/ToolRow.module.css`
- **Purpose:** The tool row styles — the summary, the non-shrinking suffix, the path link, and the
  diff totals.

##### `packages/client/ui-tool/src/client/tool/components/ToolDetails.module.css`
- **Purpose:** The detail body styles.

##### `packages/client/ui-tool/src/client/tool/components/AskQuestionCard.module.css`
- **Purpose:** The question card styles.

##### `packages/client/ui-tool/src/client/tool/components/ExitCodeBadge.module.css`
- **Purpose:** The exit-status capsule styles.

##### `packages/client/ui-tool/src/client/tool/components/QuestionToolRow.module.css`
- **Purpose:** The question row's answer-panel button styles.

##### `packages/client/ui-tool/src/client/tool/toolviews/bash-sample.module.css`
- **Purpose:** The bash row styles.

##### `packages/client/ui-tool/src/index.ts`
- **Purpose:** The Host loader entry — the browser-only Tool plugin has no host behaviour.

##### `packages/client/ui-tool/src/css-modules.d.ts`
- **Purpose:** The ambient declaration for `*.module.css` imports.

##### `packages/client/ui-trajectory/src/client/locales.ts`
- **Purpose:** The `trajectory` namespace dictionaries.

##### `packages/client/ui-trajectory/src/client/trajectory-definition-common.ts`
- **Purpose:** `trajectoryNode` — the shared builder for a Trajectory target node.

##### `packages/client/ui-trajectory/src/client/trajectory-event-projection.ts`
- **Purpose:** The Trajectory event → fact projections — `contextForm`, `contextProducer`, the
  assistant block projection, and the failure redaction.

##### `packages/client/ui-trajectory/src/index.ts`
- **Purpose:** The Host loader entry — the browser-only trajectory plugin has no host behaviour.

##### `packages/client/ui-trajectory/src/css-modules.d.ts`
- **Purpose:** The ambient declaration for `*.module.css` and `*.css` imports.

##### `packages/client/ui-conversation/src/client/contract/composer-blocks.ts`
- **Purpose:** `ComposerBlock` and the `ComposerBlocks` registry face.

##### `packages/client/ui-conversation/src/client/contract/composer-submission.ts`
- **Purpose:** `InputSubmitMode`, `ComposerSubmitGesture`, `MessageSubmission`,
  `MessageSubmissionState`.

##### `packages/client/ui-conversation/src/client/contract/slots.ts`
- **Purpose:** Every Conversation slot declaration and composed component prop.

##### `packages/client/ui-conversation/src/client/contract/snapshot.ts`
- **Purpose:** `ConversationSnapshot` and `conversationPhase`.

##### `packages/client/ui-conversation/src/client/contract/views.ts`
- **Purpose:** `ViewTab` and `ConversationViewRequest`.

### Tier 2 — bulk: a compact table, one row per file

#### `packages/client/ui-chat` — docs, config, tests

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-chat/README.md` | Decides: work-details modes never hide a final answer; Verbose keeps completed-turn process rows visible; local transcript/steering submissions appear immediately and vanish atomically when authoritative records arrive; queued submissions stay outside Chat; the quota notice is frame-wide. |
| `packages/client/ui-chat/README.zh.md` | The Chinese counterpart of the above; read as the translation pair. |
| `packages/client/ui-chat/README.i18n.yaml` | Per-heading bilingual-pair hash record; the hash of each EN/ZH block so a one-sided edit is detectable. |
| `packages/client/ui-chat/package.json` | Package manifest: `dsh.client.inject` lists the eleven services the Chat target requires; `platform: web`. |
| `packages/client/ui-chat/locale/en.json` | Package metadata title only (`ui-chat`). |
| `packages/client/ui-chat/locale/zh.json` | Chinese package metadata title + description. |
| `packages/client/ui-chat/tsconfig.json` | Project references only: host + client configs. |
| `packages/client/ui-chat/tsconfig.client.json` | Client build graph — 40 project references; `exclude: src/index.ts` (the Host entry is not in the browser build). |
| `packages/client/ui-chat/tsconfig.host.json` | Host build: only `src/chat-settings.ts` and `src/index.ts`. |
| `packages/client/ui-chat/tsdown.config.ts` | Bundler config; includes a custom plugin that inlines `running-whale@2x.png` as a base64 data URI and watches it. |
| `packages/client/ui-chat/tests/approval-command.client.spec.tsx` | Pins: `commandOf` accepts only a string `command` from valid JSON args; the approval row renders only the *correlated running* tool call. |
| `packages/client/ui-chat/tests/assistant-markdown-path-images.client.spec.tsx` | Pins: `localPathMediaUrl` maps local paths to media URLs and the Assistant markdown image slot receives the right sources. |
| `packages/client/ui-chat/tests/chat-font-axis-styles.client.spec.ts` | Pins: the CSS font-size axis keeps the summary/title typography on the shared token ladder. |
| `packages/client/ui-chat/tests/chat-node-bottom.client.spec.ts` | Pins: the bottom-membership source notifies only Turns leaving/entering the latest exchange, across 4,000 historical Nodes. |
| `packages/client/ui-chat/tests/chat-node-source.client.spec.ts` | Pins: the keyed Node sources hand grouping ordered nodes, previous values, and positions. |
| `packages/client/ui-chat/tests/chat-store.client.spec.ts` | Pins: the Chat store's snapshot identity and subscription behaviour. |
| `packages/client/ui-chat/tests/config.host.spec.ts` | Pins: the Host registers, validates, and disposes the durable `ui-chat` settings namespace. |
| `packages/client/ui-chat/tests/conversation.client.spec.ts` | Pins: the Chat conversation assembly wiring. |
| `packages/client/ui-chat/tests/coverage-tails.client.spec.tsx` | Pins: the tail render paths (stopped rows, icon slots) that other suites leave uncovered. |
| `packages/client/ui-chat/tests/event-projection.client.spec.ts` | Pins: `contextForm` / `contextProducer` / `displayFailure` / `isTokenDelta` behaviour for known and unknown producers. |
| `packages/client/ui-chat/tests/flow-motion-scope.client.spec.tsx` | Pins: fold motion is scoped to `[data-chat-motion]` and respects reduced motion. |
| `packages/client/ui-chat/tests/flow-motion.client.spec.tsx` | Pins: the fold driver's begin/prepare/frame/finish contract, the shared frame clock, and cancellation. |
| `packages/client/ui-chat/tests/fold-follow.client.spec.ts` | Pins: a following reader lands at the tail, content growth consumes the kept room, and manual off-bottom ownership is reclaimed only below the reader. |
| `packages/client/ui-chat/tests/gate-branch-tails.client.spec.tsx` | Pins: the reasoning row's ok/running states and the composer stats fallback when projections are absent. |
| `packages/client/ui-chat/tests/group-tree-segments.client.spec.ts` | Pins: the group tree orders positions outermost-inward, starts the latest segment at the last opening Turn, and reports only the Turns that moved. |
| `packages/client/ui-chat/tests/image-labels.client.spec.tsx` | Pins: consecutive image blocks merge into one group and split at text; one message loader updates without remounting its sibling gallery. |
| `packages/client/ui-chat/tests/performance-usage.client.spec.ts` | Pins: the `PerformanceUsagePolicy` publishes and disposes its Host subscription. |
| `packages/client/ui-chat/tests/presentation-fixture.client.ts` | Fixture: a fixed `detailed` presentation policy for isolated component tests. |
| `packages/client/ui-chat/tests/presentation-policy.client.spec.tsx` | Pins: all eight mode × timing policies stay distinct and stable, and a mode change re-renders only consumers whose selected field changed. |
| `packages/client/ui-chat/tests/process-groups.client.spec.ts` | Pins: the group counts, the 160-grapheme live-detail bound, regrouping on a position change, and resegmentation touching only the changed Turn. |
| `packages/client/ui-chat/tests/quota-notice.client.spec.tsx` | Pins: the frame-wide quota notice chain, the `keepOpen()` hold, and the release semantics. |
| `packages/client/ui-chat/tests/reasoning-component-fixture.tsx` | Fixture: renders the production reasoning child without emulating a registry. |
| `packages/client/ui-chat/tests/reasoning-content.client.spec.tsx` | Pins: the reasoning body content contract. |
| `packages/client/ui-chat/tests/reasoning-render-fixture.tsx` | Fixture: binds the shipped default Body and Content Factory through the real renderer. |
| `packages/client/ui-chat/tests/reasoning-row.client.spec.tsx` | Pins: the reasoning row's collapse/expand and streaming states. |
| `packages/client/ui-chat/tests/running-status.client.spec.tsx` | Pins: the running status label and its accessible text. |
| `packages/client/ui-chat/tests/running-whale-tail.client.spec.tsx` | Pins: the running-tail animation element. |
| `packages/client/ui-chat/tests/scroll-follow.client.spec.ts` | Pins: the follow policy's threshold and the follow/release transitions. |
| `packages/client/ui-chat/tests/skill-name-projector.client.spec.ts` | Pins: a slash token is a skill chip only when the host resolved it as a skill *in that step*. |
| `packages/client/ui-chat/tests/sticky-header-styles.client.spec.ts` | Pins: the sticky group-header CSS geometry. |
| `packages/client/ui-chat/tests/system-prompt-row.client.spec.tsx` | Pins: the (hidden-in-Chat) system-prompt row's rendering. |
| `packages/client/ui-chat/tests/tool-call-tree.client.spec.ts` | Pins: the tool-call tree's cycle rejection and depth bound. |
| `packages/client/ui-chat/tests/tool-preparation.client.spec.ts` | Pins: the preparing stage of a tool call. |
| `packages/client/ui-chat/tests/tool-updates.client.spec.tsx` | Pins: live tool-call updates (arguments growing in place). |
| `packages/client/ui-chat/tests/transcript-view-policy.client.spec.ts` | Pins: the transcript-view policy's mode derivation. |
| `packages/client/ui-chat/tests/transcript-view-row.client.spec.tsx` | Pins: the transcript-view settings row. |
| `packages/client/ui-chat/tests/turn-metrics.client.spec.ts` | Pins: `assistantStepReading` derives the per-step timing facts. |
| `packages/client/ui-chat/tests/turn-navigator-fixture.ts` | Fixture: builds rail items for the navigator tests. |
| `packages/client/ui-chat/tests/turn-navigator.client.spec.tsx` | Pins: the rail's fixed pitch, hover preview, and the imperative activate/scroll handle. |
| `packages/client/ui-chat/tests/turn-process-tail.client.spec.ts` | Pins: the turn-process / turn-tail relationship. |
| `packages/client/ui-chat/tests/turn-rail-items.client.spec.ts` | Pins: the rail item derivation and its preview truncation. |
| `packages/client/ui-chat/tests/turn-tail-spacing.client.spec.ts` | Pins: the turn-tail row's spacing rules. |
| `packages/client/ui-chat/tests/turn-trigger.client.spec.tsx` | Pins: the turn-trigger row's per-source title and icon mapping (including github vs generic webhook). |
| `packages/client/ui-chat/tests/turn-usage-panel.client.spec.tsx` | Pins: the per-turn usage panel's buckets and omissions. |
| `packages/client/ui-chat/tests/use-disclosure.client.spec.tsx` | Pins: the disclosure hook's open state and its reset on an enclosing Turn collapse. |
| `packages/client/ui-chat/tests/user-content-component-fixture.tsx` | Fixture: the user-content component harness. |
| `packages/client/ui-chat/tests/user-content.client.spec.tsx` | Pins: the user-content factory renders prepared text, keeps attachment order, binds live locale labels, and removes live content on owner disposal. |
| `packages/client/ui-chat/tests/views-type-chain.client.spec.tsx` | Pins: Chat injection and store props stay out of the target-neutral base (a compile-time negative). |
| `packages/client/ui-chat/tests/apply-inject.client.spec.tsx` | Pins: the Chat plugin's service declarations and the injected face. |
| `packages/client/ui-chat/tests/chat-apply.client.spec.tsx` | Pins: the Chat `apply()` wiring — slot registration, the quota chain, the file opener. |
| `packages/client/ui-chat/tests/chat-branch-tails.client.spec.tsx` | Pins: the message-row arms (session-mention chips, skill chips, copy buttons) and the whole-Turn folding behaviour across work-details modes. |
| `packages/client/ui-chat/tests/chat-scroll.client.spec.tsx` | Pins: fold/collapse timing — one viewport's submitted input is not deferred behind another's fold, a mode reset clears the reservation, and a process-body scrollend does not settle an outer native follow. |
| `packages/client/ui-chat/tests/chat-snapshot-fixture.client.ts` | Fixture: builds Chat nodes and timeline snapshots for the snapshot tests. |
| `packages/client/ui-chat/tests/chat-stats.client.spec.tsx` | Pins: the composer statistics pills and their fallbacks. |
| `packages/client/ui-chat/tests/chat-view.client.spec.tsx` | The largest Chat suite (208 KB): the full ChatView rendering, folding, disclosure, and streaming behaviour. |
| `packages/client/ui-chat/tests/chat-viewport.client.spec.ts` | Pins: the viewport's paging geometry, group membership capture, and the no-double-compensation rule. |
| `packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts` | Pins: every Chat Conversation Definition's match/start/update/build contract (122 KB). |

#### `packages/client/ui-conversation` — docs, config, tests

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-conversation/README.md` | Decides: the registries reject duplicates and rebuild on roster change; a Definition may claim an event exclusively for its target; View selection is deterministic (persisted → `chat` → nothing, never "the first"); the composer owns the busy-Enter setting; the queue dock excludes requestIds still owned by local submissions. |
| `packages/client/ui-conversation/README.zh.md` | The Chinese counterpart. |
| `packages/client/ui-conversation/README.i18n.yaml` | Per-heading bilingual-pair hash record. |
| `packages/client/ui-conversation/package.json` | Manifest: eight injected services; `platform: web`. |
| `packages/client/ui-conversation/locale/en.json` | Package metadata title only. |
| `packages/client/ui-conversation/locale/zh.json` | Chinese package metadata title + description. |
| `packages/client/ui-conversation/tsconfig.json` | Project references only: host + client configs. |
| `packages/client/ui-conversation/tsconfig.client.json` | Client build graph — the project references for the browser build. |
| `packages/client/ui-conversation/tsconfig.host.json` | Host build: only `src/submission-settings.ts` and `src/index.ts`. |
| `packages/client/ui-conversation/tsdown.config.ts` | Standard client bundle config. |
| `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` | Pins: the File action's ownership and unload, the Inspect callback's visibility rule, View activation before committing a selection, draft mirroring, `@path` reference citation, and the whole-batch rejection on an unrepresentable path. |
| `packages/client/ui-conversation/tests/apply-wiring.client.spec.tsx` | Pins: hiding only the Trajectory View when developer tools are off; waiting for the layout-owned declaration; per-fiber removal of services and entries. |
| `packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx` | Pins: the resident composer renders locked without a session, survives the blank→active conversion as the *same DOM node*, and shows the promptError strip. |
| `packages/client/ui-conversation/tests/async-insertion.client.spec.ts` | Pins: an async text insertion is refused if a user edit or disposal happened first. |
| `packages/client/ui-conversation/tests/composer-blocks.client.spec.ts` | Pins: the block registry republishes only when the copy changes. |
| `packages/client/ui-conversation/tests/config.host.spec.ts` | Pins: the durable busy-Enter preference registers, validates, and disposes. |
| `packages/client/ui-conversation/tests/context-meter.client.spec.tsx` | Pins: occupancy needs both a numerator and a capacity; the panel opens, closes on capacity loss, and each locale owns the headline word order. |
| `packages/client/ui-conversation/tests/control-row-dom.ts` | Fixture: a DOM shim for the control-row measurement tests. |
| `packages/client/ui-conversation/tests/control-row-layout.client.spec.ts` | Pins: the control row collapses on expanded demand, remeasures changed text, accounts for inserted/hidden controls, and remeasures after font loading. |
| `packages/client/ui-conversation/tests/conversation-assembler.client.spec.ts` | The largest suite (81 KB): the assembler's indexing, Location resolution, incremental vs. full rebuild, and per-target isolation. |
| `packages/client/ui-conversation/tests/conversation-group-store.client.spec.ts` | Pins: one changed group publishes without changing root or member identities; references move atomically; a complete replacement re-validates even when arrays are reused. |
| `packages/client/ui-conversation/tests/conversation-groups.client.spec.ts` | Pins: grouping is created on first activation without eagerly constructing a Builder; groups install before publication; a null `buildGroups` keeps the published grouping; grouping pauses when its View disappears. |
| `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts` | Pins: duplicate Definitions are rejected; open turns publish without an active View; frame-paced updates are preempted by immediate ones; a target activates once and never deactivates. |
| `packages/client/ui-conversation/tests/conversation-routing.client.spec.ts` | Pins: table handlers receive only their declared event types; the matcher receiver is preserved; only own table keys are indexed. |
| `packages/client/ui-conversation/tests/conversation-store.client.spec.ts` | Pins: the store owns draft, selected View, and one-shot requests; a legacy draft is read without rewriting the saved record. |
| `packages/client/ui-conversation/tests/draft-document.client.spec.ts` | The largest draft suite (37 KB): structured-draft copy/export/import, command-token round trips, and the chip-restore abort path. |
| `packages/client/ui-conversation/tests/draft-hub.client.spec.ts` | Pins: the hub's trigger subscription is lifecycle-bound, not construction-bound; a restored draft arrives before the first lookup returns; a replacement lexicon reconnects on refresh. |
| `packages/client/ui-conversation/tests/editor-focus.client.spec.ts` | Pins: background insertion and undo stay outside the editor until focus is explicitly restored. |
| `packages/client/ui-conversation/tests/enter-behavior-row.client.spec.tsx` | Pins: the busy-Enter row explains its busy-only scope and defaults to Queue. |
| `packages/client/ui-conversation/tests/historical-images.client.spec.ts` | Pins: a pending image load is invalidated when its Session binding is released; a seeded URL is shown synchronously then replaced and both revoked. |
| `packages/client/ui-conversation/tests/history-transport.perf.client.ts` | A *performance* probe (not a unit test): reports v2 embedded-stream compaction and exact replay costs. |
| `packages/client/ui-conversation/tests/image-labels.client.spec.ts` | Pins: attachment-rejection copy renders megabytes without a trailing fraction and maps reasons to limit-naming copy. |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | The largest composer suite (92 KB): focus handoff, placeholder visibility, the image draft rail, and the limit pre-check. |
| `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` | Pins the five machine rows (plain / claimed / claimed-with-attachments / submitting / …) and their submit, retention, and release rules. |
| `packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts` | Pins: reference submission retains the chip on Host failure, blocks on an unserializable owner, restores concurrent failures in submission order, and captures the gesture before async admission. |
| `packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx` | End-to-end scenarios A/C/D/H/I through the real pipeline: menu-pick `/goal`, pasted `/goal`, `/compact`, images through a command, and the two-press chip deletion. |
| `packages/client/ui-conversation/tests/keymap-routing.client.spec.tsx` | Pins: the keymap routes Enter to submit and Tab through arbitration, and clears composition presentation on root swaps. |
| `packages/client/ui-conversation/tests/lexical-editor-core.client.spec.tsx` | Pins the `ReferenceChipNode` JSON round trip and `$projectComposer`'s detect/clipboard projections and caret folding. |
| `packages/client/ui-conversation/tests/queue-dock.client.spec.tsx` | Pins: the dock renders null when empty, hands a local echo off by rpcId, portals tooltips out of the panel, and preserves line breaks when re-editing. |
| `packages/client/ui-conversation/tests/reference-activation.client.spec.ts` | Pins: a chip opens once in a double-click sequence and leaves selections to the editor. |
| `packages/client/ui-conversation/tests/reference-chip.client.spec.tsx` | Pins: the chip renders its icon, label fallback, and invalid styling bit. |
| `packages/client/ui-conversation/tests/request-inspection.client.spec.ts` | Pins: the request-prompt inspection classifies system/tool/combined changes against the effective prompt and suppresses a resume header whose earlier prompt is unloaded. |
| `packages/client/ui-conversation/tests/safari.client.spec.ts` | Pins: the Safari detection and the stale-textarea layout repair. |
| `packages/client/ui-conversation/tests/selection-survival.client.spec.tsx` | Pins: the store seat shares one instance between the Session body and header and restores persisted state after the scope ends. |
| `packages/client/ui-conversation/tests/service-orchestration.client.spec.ts` | The 41 KB service suite: upload-worker bounds, queue races treated as converged, draft-preview release, and image-MIME classification. |
| `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` | The 42 KB shell suite: hero chrome, the resident composer's blocker reason, subagent hierarchy crumbs, and the settling phase's conservative blank. |
| `packages/client/ui-conversation/tests/stop-sequence.client.spec.ts` | Pins: two presses inside the inclusive interval, with invalidation by local input, lifecycle, or focus. |
| `packages/client/ui-conversation/tests/stop-shortcut.client.spec.ts` | Pins: the fixed Stop route excludes terminals, iframes, approvals, and inert descendants; a press never combines with the next turn. |
| `packages/client/ui-conversation/tests/submission-policy.client.spec.ts` | Pins: the busy-Enter policy publishes locally first and adopts a Host value without writing it back. |
| `packages/client/ui-conversation/tests/submit-machine.client.spec.ts` | Pins the machine's phases: empty drafts, leading `/`, the claim path, adjudication failure, and the anti-backwash stale-attempt drop. |
| `packages/client/ui-conversation/tests/system-prompt.client.spec.ts` | Pins: the loaded system surface's replacement order, the uncertain-head withholding, and the shadowed-endpoint drop. |
| `packages/client/ui-conversation/tests/todo-panel.client.spec.tsx` | Pins: the Todo panel's collapse, per-status counts, parallel-active marking, and the projection-driven updates. |
| `packages/client/ui-conversation/tests/user-text-component-fixture.client.tsx` | Fixture: the UserText component harness. |
| `packages/client/ui-conversation/tests/user-text-reference-composition.client.spec.ts` | Pins: an earlier complete file wins over a Session label inside its path; same-start Session precedence is stable. |
| `packages/client/ui-conversation/tests/user-text-registry.client.spec.ts` | Pins: every matcher is queried for empty and non-empty text; duplicate/reserved IDs are rejected; removal is per contributing fiber. |
| `packages/client/ui-conversation/tests/user-text-scheduling.client.spec.ts` | The scheduling suite (21 KB): only consumed heads advance, a refreshed winner can be rejected against an unchanged earlier winner, and failed offsets are cached until a missing dependency appears. |
| `packages/client/ui-conversation/tests/user-text-whitespace.client.spec.ts` | Pins: trim wins the same-start edge collision and every Text candidate keeps the raw substring. |
| `packages/client/ui-conversation/tests/user-text.client.spec.tsx` | Pins the projection: a failure is reported once and recovers; a slash token is decorated only when the host resolved it; the wire session form folds to its label. |
| `packages/client/ui-conversation/tests/view-selection.client.spec.ts` | Pins: the preferred registered View wins, `chat` is the fallback, and no arbitrary View is chosen. |
| `packages/client/ui-conversation/tests/views-type-chain.client.spec.tsx` | Pins: the view ring's type negatives and the real slot-ledger registration/order/disposal. |
| `packages/client/ui-conversation/tests/width-handle-styles.client.spec.ts` | Pins: the gutter hit target stays narrow, the indicator stays compact, and it rides above the composer after a drag. |

#### `packages/client/ui-tool` — docs, config, tests

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-tool/README.md` | Decides: the Runtime stays authoritative for call/result pairing and subcall topology; a business package registers only a wire tool name and a view; a settled foreground command with a nonzero exit keeps its description and shows a neutral capsule; the Auto-review denial takes precedence over keyed views. |
| `packages/client/ui-tool/README.zh.md` | The Chinese counterpart. |
| `packages/client/ui-tool/README.i18n.yaml` | Per-heading bilingual-pair hash record. |
| `packages/client/ui-tool/package.json` | Manifest: five injected services (`slots`, `remote`, `locale`, `uiConversation`, `workspace`). |
| `packages/client/ui-tool/locale/en.json` | Package metadata title only (`ui-tool`). |
| `packages/client/ui-tool/locale/zh.json` | Chinese package metadata title + description. |
| `packages/client/ui-tool/tsconfig.json` | The client build graph. |
| `packages/client/ui-tool/tsdown.config.ts` | Standard client bundle config. |
| `packages/client/ui-tool/tests/ask-question-row.client.spec.tsx` | The 33 KB question suite: pending/answered/cancelled/interrupted verdicts, the queued-steer review, and the crash-repair path. |
| `packages/client/ui-tool/tests/assembly-surfaces.client.spec.tsx` | Pins: the keyed toolview row and the dock plan strip reach their registrations, and both the keyed bash row and the fallback reach the terminal card. |
| `packages/client/ui-tool/tests/chat-ptc-subcalls.client.spec.tsx` | Pins: nested sub-calls render under the parent, an `isError` sub-call renders like a failed native row, and a file sub-row opens in the Sidebar while a bash sub-row opens nothing. |
| `packages/client/ui-tool/tests/coverage-tails.client.spec.tsx` | Pins the tail render paths (stopped state, the sparkle icon, the Bash row's non-clickable summary). |
| `packages/client/ui-tool/tests/details-models.client.spec.ts` | Pins: the shared detail values, the control adapters (agents/jobs/terminals/LSP), the inspection adapters (Cordis/workflow/Ralph), and the generic fallback for malformed or spilled results. |
| `packages/client/ui-tool/tests/details-row.client.spec.tsx` | Pins: the goal/schedule detail derivation, the reminder set (Host vs. session-local), and the ~40 registered tool names. |
| `packages/client/ui-tool/tests/diff-card.client.spec.tsx` | Pins: the intended vs. applied diff, the empty-`old_string` whole-file diff, the `str_replace_editor` defaults, and the 9-line chat cap. |
| `packages/client/ui-tool/tests/image-card.client.spec.tsx` | Pins: the image card's source of truth (the result content), the preserved `originalDimensions`, and every decline path. |
| `packages/client/ui-tool/tests/preparing-rows.client.spec.tsx` | Pins: the file row through streamed arguments, the combined edit size before diff totals, and the streamed Bash description without expansion. |
| `packages/client/ui-tool/tests/read-card.client.spec.tsx` | Pins: the read card's derivation, the path relativization, `readCallLine`, and the result-side-only rule. |
| `packages/client/ui-tool/tests/search-card.client.spec.tsx` | Pins: the grep matches card, the glob paths card, the recovery footer, and the capped search's locator. |
| `packages/client/ui-tool/tests/spill-policy-terminal.client.spec.ts` | Pins: a notice-only result stays generic and a result that fits keeps its terminal card. |
| `packages/client/ui-tool/tests/terminal-card.client.spec.tsx` | The 39 KB terminal suite: exit capsules, signal names, the workdir resolution, the UNC root, `terminal_send`, and the persistent-shell rules. |
| `packages/client/ui-tool/tests/todo-history.client.spec.ts` | Pins: a missing predecessor is repaired on prepend, the diff separates added/updated/removed/unchanged, and the lookup snapshot is immutable. |
| `packages/client/ui-tool/tests/todo-row.client.spec.tsx` | Pins: the plan summary's counts and the extra-active count kept outside the ellipsized text. |
| `packages/client/ui-tool/tests/tool-call-tree.client.spec.tsx` | Pins: only the parent and the changed child dispatch among 100 siblings; the Auto denial renders generically before keyed dispatch. |
| `packages/client/ui-tool/tests/tool-fixtures.client.ts` | Fixture: the shared tool-call fixtures. |
| `packages/client/ui-tool/tests/tool-row-styles.client.spec.ts` | Pins the CSS: the summary suffix stays on one line and unshrunk; truncation belongs to the summary text alone. |
| `packages/client/ui-tool/tests/tool-row.client.spec.tsx` | The 33 KB row suite: classification, titles, states, summaries, and the path rules. |
| `packages/client/ui-tool/tests/toolview-slot.client.spec.tsx` | Pins: the keyed dispatch and the generic fallback, the Auto-denial precedence, the file-path click routing, a live registration taking over its row, and a duplicate key failing loudly at load. |
| `packages/client/ui-tool/tests/toolview-type-chain.client.spec.tsx` | Compile-time negative samples for the toolview slot types. |
| `packages/client/ui-tool/tests/web-card.client.spec.tsx` | Pins: the web search/fetch card derivation, the http(s)-only href, and the collapsed-row link opening a new tab without expanding. |

#### `packages/client/ui-trajectory` — docs, config, tests

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-trajectory/README.md` | Decides: the view is a pure projection that neither reads nor changes the Chat snapshot; in-flight records show a start marker without inventing elapsed time; TTFT measures from the Step start and includes output from an earlier retry attempt; selection/timeline/folding/search cover the React-visible window while request numbers and cumulative usage cover the whole resident snapshot. |
| `packages/client/ui-trajectory/README.zh.md` | The Chinese counterpart. |
| `packages/client/ui-trajectory/README.i18n.yaml` | Per-heading bilingual-pair hash record. |
| `packages/client/ui-trajectory/package.json` | Manifest: five injected services; `platform: web`. |
| `packages/client/ui-trajectory/locale/en.json` | Package metadata title only (`ui-trajectory`). |
| `packages/client/ui-trajectory/locale/zh.json` | Chinese package metadata title + description. |
| `packages/client/ui-trajectory/tsconfig.json` | The client build graph. |
| `packages/client/ui-trajectory/tsdown.config.ts` | Standard client bundle config. |
| `packages/client/ui-trajectory/tests/cell.client.spec.tsx` | Pins: `formatDurationMillis`/`formatElapsedSeconds` and the standalone cell's index/tag/text/metric columns. |
| `packages/client/ui-trajectory/tests/client-bundle.client.spec.ts` | Pins the built client artefact's shape (the tsdown output contract). |
| `packages/client/ui-trajectory/tests/code-inspector.client.spec.tsx` | Pins: the PTC inspector's description, numbered source, original arguments, verbatim output, and the wrapping-choice sampling on open. |
| `packages/client/ui-trajectory/tests/code-program.client.spec.ts` | Pins: the program and arguments stay verbatim; the language comes from recorded tool metadata, not display text. |
| `packages/client/ui-trajectory/tests/conversation-definitions.client.spec.ts` | The 43 KB Definition suite: waiting/retrying requests, interruption materialisation, tool-change content, and parallel PTC roots. |
| `packages/client/ui-trajectory/tests/event-projection.client.spec.ts` | Pins: known/unknown/unreadable context sources, only supported forms, and the AUTH-failure redaction. |
| `packages/client/ui-trajectory/tests/layout.client.spec.tsx` | The 32 KB layout suite: an interrupted assistant is marked failed while keeping its output; assistant blocks expand; call+result fold into a Tool row; running calls have blank time. |
| `packages/client/ui-trajectory/tests/locale.client.ts` | Fixture: the locale seat for the trajectory tests. |
| `packages/client/ui-trajectory/tests/snapshot-builder.client.spec.ts` | Pins: one request header inherited across requests without repeating its change, exact step-header indexing, session boundaries/turn errors applied with linear indexes. |
| `packages/client/ui-trajectory/tests/string-wrapping-store.client.spec.ts` | Pins: the wrapping preference survives a view recreation. |
| `packages/client/ui-trajectory/tests/table.client.spec.tsx` | The 48 KB table suite: standalone prompt text without a fabricated catalog, the tool-call-only placeholder, timing facts, the token breakdown, and the record inspector's tab switching. |
| `packages/client/ui-trajectory/tests/views.client.spec.tsx` | The 61 KB view suite: plugin registration order and disposal, the browser-wide duration preference, the two-tab ring, the local record inspector, and the streaming/running statuses. |
| `packages/client/ui-trajectory/tests/virtual-rows.client.spec.ts` | Pins: request boundaries group with the following content row, the terminal boundary keeps its clearance, and row keys stay stable across prepends. |

### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `packages/client/ui-chat/src/client/chat/running-whale@2x.png` | Binary PNG asset (21,631 bytes; confirmed by the PNG magic `89-50-4E-47-0D-0A-1A-0A`). It is the running-turn whale tail image, inlined as a base64 data URI by the bundler plugin in `packages/client/ui-chat/tsdown.config.ts`. |

---

## 2. Ideas worth stealing

1. **The transcript's *counting* is a pure function of the recorded nodes, and the categories are a
   closed vocabulary of seven.**
   `packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:134` +
   `packages/client/ui-chat/src/client/contract/process-groups.ts:2`.
   **Why it transfers:** August Trading's process summary (`utils/turnStatus.ts`) needs the same
   discipline — one place decides "read=1, commands=1", reasoning adds no tool count, and a count
   never decides folding. Making the vocabulary closed means a new tool must be classified once,
   loudly, instead of silently falling into "other".
   `UNIQUE` within this shard.

2. **Live detail is bounded at 160 *grapheme clusters*, not characters.**
   `packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:24-46`.
   **Why it transfers:** any summary line August Trading renders (a symbol, a broker name, a
   position note) must not split a surrogate pair or an emoji ZWJ sequence. `Intl.Segmenter` is the
   correct tool and costs one import. `UNIQUE`.

3. **A cache-hit percentage must be distinguishable from 100%.**
   `packages/client/ui-chat/src/client/chat/StatsPills.tsx` (the `roundedPercentUnits` logic).
   **Why it transfers:** August Trading shows provider cache-hit and cost ratios; a 99.95% cache hit
   displayed as "100%" is a false statement. Computing how many digits are needed to tell the true
   value from 100 is a five-line function that removes a whole class of misleading number.
   `UNIQUE`.

4. **"The accounting is incomplete, so show nothing" — a completed turn's usage row appears only
   when every attempt reported a consistent total.**
   `packages/client/ui-chat/src/client/chat/StatsPills.tsx` + `packages/client/ui-chat/src/client/contract/chat-nodes.ts:77-90`
   (`TurnTokenUsage` with optional cache buckets "present only when every attempt reported the
   bucket").
   **Why it transfers:** August Trading's `modelsUsed` / token accounting has the same shape. A
   partial total presented as a whole is worse than no total. `UNIQUE`.

5. **A fold moves the boxes and the scrollport on ONE frame clock.**
   `packages/client/ui-chat/src/client/chat/flow-motion.ts:1-8` and the
   `InputFoldDriver` begin/prepare/frame/finish protocol.
   **Why it transfers:** August Trading collapses a whole turn's process group when the answer
   lands. If the rows animate on CSS transitions and the scroll compensation runs on a JS frame
   clock, the two drift and the reader's position jumps. One clock, four phases, with cancellation
   as a first-class outcome. `UNIQUE`.

6. **A reader's own scrolling during a fold is *added* to the position the fold keeps still.**
   `packages/client/ui-chat/src/client/chat/use-chat-reading.ts` + `use-chat-scroll.ts`
   (`FOLLOW_THRESHOLD = 24`, 500 ms sample interval).
   **Why it transfers:** the same bug exists wherever a transcript auto-folds. `CONVERGENT` in
   spirit with the "in-flight record shows a start marker" rule below — both refuse to move the
   reader without telling them.

7. **In-flight work shows a *start marker*, never a fabricated duration.**
   `packages/client/ui-trajectory/src/client/timeline.ts` (`cellRange` returns `null` when
   `startedAt` is unknown) and `packages/client/ui-trajectory/README.md` ("In-flight Time stays
   blank").
   **Why it transfers:** August Trading shows elapsed times on running analyses. A growing
   "elapsed" counter that restarts on a re-render is a lie; a null that renders as "—" is honest.
   `CONVERGENT` (the same rule appears in the Chat turn-process and the Trajectory ledger).

8. **One Definition may claim an event *for its own target only*.**
   `packages/client/ui-conversation/src/client/contract/conversation.ts:20-27`.
   **Why it transfers:** August Trading has one transcript and several views over it (the answer
   row, the process row, the stats panel). A per-target exclusive claim lets each view own a
   record without the views fighting over it. `UNIQUE`.

9. **Deferred/old values stay readable but are never written back.**
   `packages/client/ui-chat/src/chat-settings.ts:30-46` (`normal` and `expanded` read as
   `detailed`), and the same pattern in
   `packages/client/ui-conversation/src/client/input/submission-policy.ts` (adopt a Host value
   without writing it back).
   **Why it transfers:** a durable preference in August Trading's Settings will outlive the code
   that wrote it. Reading the old value and never writing it forward is the cheapest migration
   there is. `UNIQUE`.

10. **A model may select a language for a stored program only from an *unambiguous recorded
    hint*, never by guessing from the source.**
    `packages/client/ui-trajectory/src/client/code-program.ts:26-35`.
    **Why it transfers:** if August Trading ever shows a stored backtest script or a saved
    PineScript, a wrong highlighter is worse than no highlighter. `UNIQUE`.

11. **A spilled-output check is a shared module, not a UI pattern.**
    `packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts` (the
    `hasSpillNotice` import) + `packages/client/ui-tool/README.md` ("matching text cannot
    authenticate its source").
    **Why it transfers:** whenever August Trading renders a truncated log or a partially written
    file, the *same* rule should decide "this is truncated" — in one module, not once per surface.
    `UNIQUE`.

12. **A percentage or a summary that the reader cannot act on is moved OUT of the ellipsized text
    into a non-shrinking slot.**
    `packages/client/ui-tool/src/client/tool/toolviews/plan-summary.ts:26-33` +
    `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` (`summarySuffix`).
    **Why it transfers:** August Trading's row summaries carry counts (positions open, warnings,
    R:R). A count at the end of an ellipsized line is the first thing clipped — exactly when it
    matters. `UNIQUE`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* The Trajectory ledger shows
  *that* a scheduled run happened (a compaction request appears chronologically in its own "Between
  turns" section, `packages/client/ui-trajectory/src/client/layout.ts:390-450`), and `ui-tool`
  renders a `schedule_create` / `schedule_list` / `schedule_delete` / `schedule_update` detail card
  from the recorded result (`packages/client/ui-tool/src/client/tool/models/details-card-model.ts:120-165`)
  — including the stored `deliveryMode` (`host` vs. `session-local`), the `state`
  (`scheduled` / `overdue`), the cron/weekly/daily rule, and the overdue copy "waiting for the
  session to recover". But the *scheduling engine*, its persistence, its catch-up, and its breaker
  live in other shards. What is here is the **presentation contract for an overdue schedule**, which
  is worth stealing: a schedule that has come due but whose session has not resumed is shown as
  explicitly *overdue*, not as silently pending.

- **Human-in-the-loop approval:** partially in this shard. The Chat target does not implement the
  approval panel, but `ui-tool`'s question row is the same idea in miniature: an
  `ask_user_question` call stays **answerable after its result is recorded**, and the transcript row
  is the way back to it (`packages/client/ui-tool/src/client/tool/toolviews/ask-question-row.tsx`,
  the `UserQuestionPanels.reveal` / `review` capability at
  `packages/client/ui-tool/src/client/contract/slots.ts:110-141`). Two details transfer directly to
  August Trading: (a) the answerability decision comes from the **live projection**, not from the
  recorded result — a recorded pending result stays "pending" after the reply, the skip, or the
  timeout lands; and (b) a batch that cannot be paired unambiguously by stable id gets **no panel at
  all**, because "blank or dropped answers would read as choices the user made".

- **Post-mortem / reflection loops:** *not in this shard.* The nearest thing is the compaction
  checkpoint and the todo-diff model, which compare a write against its recorded predecessor
  (`packages/client/ui-tool/src/client/tool/models/todo-diff-model.ts`) and distinguish a status
  change from a reorder from a removal. That is a *diff against the last recorded state*, which is
  the shape a reflection loop needs, but the accumulation and retirement rules live elsewhere.

- **Multi-agent:** partially in this shard, and it is a strong negative result. The harness counts
  subagent delegations as a distinct activity — `isSubagentDelegationTool` recognises `subagent`
  and `subagent_*` while explicitly **not** counting `send_message` and `list_agents`
  (`packages/client/ui-chat/src/client/contract/turn-process.ts:44`), and `TurnProcessChatData`
  carries a `subagentCount` alongside `messageCount` and `toolCallCount`
  (`packages/client/ui-chat/src/client/contract/chat-nodes.ts:107-116`). So the harness's own
  transcript distinguishes "the model delegated" from "the model called a tool" — a small but real
  modelling choice. The Trajectory ledger then shows nested sub-dispatches as indented `subtool`
  rows under their parent. **No debate engine appears anywhere in this shard**: there is no
  multi-agent debate code in the rendering layer at all, which suggests debate (if the harness has
  it) lives in the agent runtime, not in the UI.

- **Structured logs the model can query:** *not directly in this shard*, but two pieces are directly
  transferable. (a) The **queryable ledger** itself: `TrajectorySearchIndex`
  (`packages/client/ui-trajectory/src/client/trajectory-search-index.ts`) is an incremental
  full-text index over the resident snapshot — it re-parses Markdown only when one record's *source*
  changed, and it matches space-separated case-insensitive terms against a joined corpus of the
  record's text, args, output, schema, and block metadata. That is a `grep`-able trade log with no
  database. (b) The **bounded preview** (`packages/client/ui-trajectory/src/client/trajectory-preview.ts`)
  reads the first 2,048 characters and emits at most 512 — so indexing a 10 MB log costs a bounded
  amount per record. The Trajectory ledger is also a *view over the same durable Session event log*
  the Chat transcript reads, which is the key architectural move: one log, many projections.

- **Staying simple as features accumulate:** the strongest answer in this shard is the **pure
  projection** discipline. `ui-trajectory` is explicitly "a pure projection" that "neither reads
  nor changes the Chat conversation snapshot"
  (`packages/client/ui-trajectory/README.md`), and it says so in the code with `jscpd:ignore`
  blocks marking the *deliberate* duplication of the Chat and Trajectory event state machines
  (`packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts:8-10`). They
  duplicated ~200 lines of event-projection logic on purpose rather than share an abstraction that
  would have coupled two views with different needs. The same posture appears in
  `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:38-52`, where the comment
  explains that adding a `cordis_define` entry "would be unreachable, and a second title for the
  same call would be a second answer to a question the card already owns". **The rule they
  apply: a new feature may add a *registration*, never a second implementation of an existing
  fact.** The Trajectory README lists exactly two known limitations; the Chat README lists five.

---

## 4. Non-obvious decisions and gotchas

1. **`packages/client/ui-chat/src/client/conversation-nodes/common.ts:15` — synthetic rows use
   FRACTIONAL sequence anchors.** `interruptedAssistant: -0.9`, `maxTokensNotice: 0.05`,
   `finalizedFollowup: 0.1`. The max-tokens notice deliberately sits *between* a closing Assistant
   and the turn-tail so the tail stays the turn's last node and keeps its branch action enabled. A
   reader who assumes integer seqs will mis-order these rows.

2. **`packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:24-46` — the live
   detail is bounded at 160 *grapheme clusters* with a 512-unit decoded prefix, and the truncation
   pass reads at most 161 clusters.** A surrogate pair is never split. This is not "truncate at 160
   characters".

3. **`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:38-52` — `cordis_define`
   is deliberately absent from the variant table**, because a keyed `tool.call.toolview` hit
   *replaces* the generic row. Adding it would be dead code.

4. **`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` — the `NKB` size is the
   decoded input's UTF-16 length in 1024-unit blocks, summing old and new text for an edit.** It is
   NOT file bytes. A reader will get this wrong.

5. **`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts` — a failing shell
   command settles as a COMPLETED call.** The exit status is result data, so `isError` stays
   `false` and the row keeps the failure state *alongside* its exit capsule. A generic
   "tool failed" branch would lose the exit code.

6. **`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts` — a UNC
   `\\server\share` is an unpoppable root**, because Windows cannot climb above a share; the
   normaliser keeps the server and share and drops a `..` at the top rather than keeping it.

7. **`packages/client/ui-conversation/src/client/contract/conversation.ts` — `conversationContextKey`
   is length-prefixed** (`${kind.length}:${kind}${id}`), so `(kind: "a", id: "b:c")` and
   `(kind: "a:b", id: "c")` cannot collide.

8. **`packages/client/ui-conversation/src/client/input/editor/keymap.ts` — the IME guard holds for
   10 ms AFTER `compositionend`,** because Safari delivers the closing keydown later than the
   composition event. `event.isComposing` alone is not enough on Safari.

9. **`packages/client/ui-conversation/src/client/input/editor/chip-node.tsx:1-8` — the chip node IS
   the occurrence.** The *detect* projection counts each chip as one `U+FFFC`; the *clipboard*
   projection expands it to `/name`. Two projections of one node, not two copies of the chip.

10. **`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` — the model seat is the
    ONE control a composer block leaves live.** Every block this contract has is cleared by
    choosing a model; locking the model too would leave the composer asking for the only thing it
    prevents.

11. **`packages/client/ui-conversation/src/client/input/blocks.ts:12-16` — the composer block is an
    *affordance, not enforcement*.** The module doc says it outright: "the Host refuses a prompt it
    cannot route regardless of what any client disables."

12. **`packages/client/ui-chat/src/client/apply.ts:96-140` — the quota notice is frame-wide and
    its hold is a per-token symbol.** A release can only drop the hold *it* was issued for, and a
    later notice does not replay one that was dropped while held.

13. **`packages/client/ui-chat/src/client/contract/turn-process.ts:44` —
    `isSubagentDelegationTool` counts `subagent`/`subagent_*` and explicitly NOT `send_message` or
    `list_agents`.** Control verbs are not delegations.

14. **`packages/client/ui-trajectory/src/client/layout.ts` — a `user/message` has no turn on the
    wire.** It is enclosed in the *next* assistant turn, else the in-flight partial, else the turn
    after the last finalized assistant, else turn 1. A "current turn" computation that assumes the
    user message carries a turn will be wrong.

15. **`packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts` — one request header
    is inherited by later requests in the same step**, and the prompt *change* is consumed exactly
    once. A "latest prompt per request" implementation would double-report every change.

16. **`packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts` — the first
    token time survives a retry.** TTFT measures from the Step start to the first token, *including
    output from an earlier retry attempt*. A retry that resets the timing would report a shorter
    TTFT than the user experienced.

17. **`packages/client/ui-conversation/src/client/conversation/assembler.ts` — a target never
    deactivates.** Creating a source does not activate a target, but once active it stays active.

18. **`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts` — a
    structural change vs. a content-only change are different code paths**, and only the structural
    one re-orders the column. A streaming answer therefore does not renumber the turn rail.

### 4.1 Lens notes (the brief's twelve lenses, applied to this shard)

| Lens | What this shard shows |
| --- | --- |
| Agent loop and turn lifecycle | A **turn** is the unit of folding, counting, and navigation; it is bounded by `turn/start` / `turn/end` and contains *steps*. The Chat README separates four questions that are often conflated: grouping, counts, display modes, and whole-turn folding. The turn-tail is deliberately the turn's *last* node so its branch action stays enabled (`packages/client/ui-chat/src/client/conversation-nodes/common.ts:15`). |
| Tool design and validation | The Runtime owns call/result pairing; the UI only renders. A tool declares a **wire name** and registers a **keyed view**; a typo never renders. Tool arguments are *lazy* (`PartialArguments`) and the row shows a `preparing` phase with no fields until the arguments close. |
| Memory and learning loops | **Not in this shard.** The nearest thing is the compaction checkpoint marker and the todo history's diff against the recorded predecessor. |
| Skill / rule lifecycle | **Not in this shard.** The composer has a *skill* surface (a slash token decorates as a skill chip only when the host resolved that step's skill) but the lifecycle lives elsewhere. |
| Session storage and compaction | Compaction is a **first-class transcript record** (`CompactionSummaryNode`), rendered as an expandable checkpoint marker that does *not* replace the shadowed rows — and it is expandable only when the current window includes its cited summary (`packages/client/ui-chat/src/client/chat/CompactionItem.tsx:1-3`). |
| Context management | The composer's **ContextMeter** shows occupancy only when both a numerator and a capacity are known; the token-meter projection is the source and the UI never computes it (`packages/client/ui-conversation/src/client/context-occupancy.ts`). |
| Model routing and fallbacks | The retry chain is a **single row** with the whole attempt list; the countdown is anchored to the browser's first render because the host clock and `Date.now()` may differ. A failing turn produces a terminal error row derived from the turn's *end reason*, including "the DSH process exited before this turn finished" (`packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts:44-58`). |
| Prompt size and caching | The cache-hit percentage is computed to be **distinguishable from 100%**, and a usage panel is shown only when the accounting is complete and self-consistent. Optional buckets are omitted, not zeroed (`packages/client/ui-chat/src/client/contract/chat-nodes.ts:77-90`). |
| Error, timeout and abort handling | The `AUTH` provider failure is **redacted in the UI state** while the raw diagnostic stays in the Session log (`packages/client/ui-trajectory/src/client/trajectory-event-projection.ts`). The `ACCOUNT_SIGNED_OUT` cancellation gets its own localized message. A prompt that failed keeps the draft in the machine and shows a `promptError` strip. |
| UI/UX streaming and progress feedback | The **partial streaming row** is a separate layout appended to the finalized turns, so a live stream never rebuilds the settled history (`packages/client/ui-trajectory/src/client/layout.ts` — `appendTrajectoryPartialLayout`). The fold moves the boxes and the scrollport on ONE frame clock. An in-flight record shows a start marker and a blank duration. |
| Minimalism | The Chat target renders nothing it was not asked to: no implicit fallback target, no second title for a tool the card already names, no second implementation of a fact the content already carries (the image card takes only the *path* from `meta`). |
| Testing and evals | The suites are behavioural, not coverage-shaped: `tests/chat-view.client.spec.tsx` (208 KB) pins the whole Turn-folding matrix across the four work-details modes; `tests/conversation-assembler.client.spec.ts` (81 KB) pins the incremental-vs-full rebuild decision. `packages/client/ui-trajectory/tests/client-bundle.client.spec.ts` pins the *built artefact*, which catches bundler regressions no source test can. |

---

## 5. Weak spots

1. **`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts` is 1,242
   lines and `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` is 3,538.** Both mix
   projection, memoisation, and rendering policy in one file. The Trajectory file in particular
   holds the table, the inspector, the detail tabs, the virtualiser wiring, the resize drag, the
   scroll compensation, and the diff rendering in one component. It works because every piece has
   a comment explaining *why* it is that way — but a new contributor has no seam to add a feature
   behind.

2. **The Chat and Trajectory event projections are duplicated on purpose** (the `jscpd:ignore`
   blocks in `trajectory-assistant-definition.ts` and `trajectory-event-projection.ts`). The
   duplication is *justified* — the two views need different states — but the comment points at a
   design note, and the two copies will drift the moment a new event type appears. A shared
   *event→fact* layer with two *policy* layers above it would have been better.

3. **The `ui-conversation` composer is large and its state is spread across three machines** — the
   Lexical editor (text + chips), the pure `SubmitMachine` (phase/claim/attempt), and the
   `InputState` projection. The seams are documented but the coordination lives in
   `input/facade.ts` (40 KB), which is the single densest file in the shard and is where a bug in
   any one of the three layers shows up.

4. **`packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` renders seven card types
   through a nested ternary chain** (`askQuestion ?? terminal ?? diff ?? read ?? image ?? search ??
   web ?? details`) and a matching seven-branch JSX ladder. It is correct and it is one screen
   long, but a new card type means editing two parallel lists.

5. **The presentation-mode policy and the collapse-timing policy are separate user-facing
   settings that interact** — the Chat README documents eight mode × timing combinations, and
   `presentation-policy.client.spec.tsx` has to assert "all eight mode and timing policies stay
   distinct and stable". A user who changes one and gets the other is a support ticket waiting to
   happen.

6. **The Trajectory table's search index is a naive substring match over a joined corpus**
   (`trajectory-search-index.ts`) — every term must appear *somewhere*, so a multi-word query
   matches records that mention the words in unrelated places, and there is no ranking, no
   field-scoped search, and no snippet. It is fast enough at this scale and will not be at ten
   times it.

7. **The `running-whale@2x.png` asset is inlined as a base64 data URI by a custom bundler
   plugin** (`packages/client/ui-chat/tsdown.config.ts`). It works, and it means the image is
   re-encoded on every build and duplicated into the CSS bundle — a 21 KB PNG becoming ~29 KB of
   text in a stylesheet.
