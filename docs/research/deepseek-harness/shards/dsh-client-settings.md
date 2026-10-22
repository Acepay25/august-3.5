# deepseek-harness :: dsh-client-settings

**Repo:** `C:/Users/rober/AppData/Local/Temp/harness-research/deepseek-harness` (read-only)
**Shard:** `dsh-client-settings` — 393 files, ~4.1 MB
**Read:** 385 · **Skipped:** 8 (binary WebP illustrations, with reasons recorded in the status TSV)

---

## 0. What this shard actually is

The shard is the **entire settings surface** of the DeepSeek Harness web/desktop client, spread over eleven packages under `packages/client/`:

| Package | Files | What it owns |
| --- | --- | --- |
| `ui-settings` | 27 | **The domain base.** One shared mirror of the Host settings document, a per-namespace config form with an ordered write queue, a synchronous schema service, and the canonical slot-type contract every other package registers into. |
| `ui-settings-general` | 42 | The settings **shell** (modal panel, nav rail, sidebar trigger), the connection-recovery pill, the Desktop updater row, the Host-release-change dialog, the "Open configuration file" action, the General section, and the onboarding-step coordinator. |
| `ui-settings-models` | 51 | The **Models page**: provider directory join, per-provider editor cards, API-key writing, the model catalogue editor, per-model context window / max tokens / input types / reasoning levels, and two product-onboarding dialogs (versioned welcome notice + first-run DeepSeek key). |
| `ui-settings-account` | 147 | DeepSeek **login**, balance display, server-driven bonus notices, the frame-wide quota-notice take-over, the embedded native Platform page (usage / top-up), and a resumable four-step desktop first-run onboarding. |
| `ui-settings-subagent` | 24 | Delegation **depth + capacity** and the models an agent may choose for its subagents, on one page with one save. |
| `ui-settings-web-search` | 18 | The web-search provider switch, its key, endpoint, and per-search budget. |
| `ui-settings-agent-loop` | 17 | The parallel tool-call cap of one step. |
| `ui-settings-shell` | 17 | The command timeout and per-stream output cap of the terminal executor. |
| `ui-settings-plugins` | 16 | The "Built-in plugins" nav entry and its tab chrome. |
| `ui-settings-plugin-inventory` | 16 | The read-only plugin inventory tab (agent presets + global plane). |
| `ui-settings-session-log` | 18 | The "upload Session Log with the official API" switch in General. |

**The spine of the whole shard is `ui-settings`.** Almost every idea worth stealing lives in three files:

- `packages/client/ui-settings/src/client/settings-mirror.ts` — one `settings.describe` reader for the whole browser.
- `packages/client/ui-settings/src/client/config-form.ts` — the per-namespace write queue with revision fencing.
- `packages/client/ui-settings/src/client/contract/slots.ts` — the slot contract that lets eleven packages contribute to one panel without knowing about each other.

---

## 1. The domain base: `packages/client/ui-settings` (27 files)

### 1.1 `src/client/settings-mirror.ts` — the one reader
- **Purpose:** the browser's single mirror of the Host settings document. Every settings consumer derives from it.
- **Key abstractions:** `SettingsDescribeMirror` (implements `SettingsDescribeFace` = `getSnapshot` / `subscribe` / `ensure` / `acceptView`), `SettingsMirrorSnapshot` (`status: 'idle'|'loading'|'ready'`, `view`, `error`).
- **Data flow:** `apply()` subscribes to the forwarded `settings/document-updated` event and to the local `connection/reset` event, and calls `mirror.load()` on each; `ctx.configForms.describe()` exposes the read/fold face to cross-namespace surfaces.
- **Non-obvious decisions (all of them are the interesting part):**
  - **Reads are serialized and coalesced.** `load()` while a read is in flight sets `rerun = true` and returns the *same* promise; the run loop does `do { … } while (this.shouldRerun())`. An invalidation arriving mid-read is therefore never lost and never duplicated.
  - **The in-flight slot is cleared in the same synchronous segment that observes `rerun === false`** — deliberately *not* in a `.finally()`. The source comment records the bug this prevents: "a `.finally()` on the returned promise runs one microtask later, and a `load()` landing in that gap would mark a rerun nobody reads, losing the read." There is a dedicated regression test for it.
  - **A write answer folds into the held view without a wire read** (`acceptView`), and it *invalidates any read still in flight* (`generation += 1`), so a document fetched before the write committed can never publish.
  - **`acceptView` before any answer is a no-op** — "the answer is not published as a partial document."
  - **A failed refresh keeps the last good view.** `status` stays `ready`, `view` is unchanged, and the failure is recorded in `error`. Only a first read that never succeeded drops back to `idle` so `ensure()` retries.
  - `status: 'ready' persists across later failed refreshes` — the panel never blanks because the Host hiccuped.
- **Edge cases:** a reentrant `load()` issued from inside the `loading` publication folds into the first run rather than racing it; a write folded inside the loading publish is covered by that same first read.

### 1.2 `src/client/config-form.ts` — the write queue
- **Purpose:** one derived view per settings namespace plus that namespace's serialized writes.
- **Key abstractions:** `ConfigFormController<T>`, `ConfigForms` (the Cordis service, `ctx.configForms`), `ConfigFormSpec<T>` (`namespace` + optional `decode`).
- **Data flow:** `ConfigFormController` subscribes to the shared mirror and derives `{ status, value, base, user, revision, writable }`. `set` / `unset` / `mutate` queue onto a single promise chain (`this.tail`).
- **Non-obvious decisions:**
  - **Writes are serialized and only the LATEST settlement may publish.** `writeGeneration` increments per queued write; when a write settles, `generation === this.writeGeneration` decides whether its answer is folded into the mirror. A superseded write's revision becomes `pendingRevision`, so the *next* write is fenced by the newest known revision rather than the newest *published* one.
  - **Ops are deep-copied when queued** (`structuredClone`), so mutating the caller's array after `mutate()` cannot change what goes on the wire. There is a test for exactly that.
  - **An editor may supply its own revision fence** (`expectedRevision`), which wins over the queued/mirrored revision. "Staged editors pass the revision read before editing; conflicts preserve their drafts."
  - **A refused *latest* write triggers a recovery read** (`mirror.load()`), so the UI shows the Host's truth. A refused *superseded* write does **not** trigger a read — the newer write owns recovery.
  - **The queue survives a throwing subscriber.** The tail is kept fulfilled (`task.then(() => {}, () => {})`) so one failed publication listener cannot strand later operations.
  - **Dispose cancels queued and post-dispose writes but drains the in-flight mutation** — `dispose()` awaits `this.tail`, so an operation already crossing the wire is allowed to finish.
  - **The mirror's `acceptView` can throw** (a folded write). The rejection propagates to that write's caller, and the *next* write still runs — the queue is not poisoned.
  - **A schema envelope the client cannot rehydrate vouches for no section**: `decode()` catches the rehydrate failure and returns `undefined`, so a malformed envelope is treated exactly like a schema-invalid value rather than crashing.
  - **The default decoder validates the section against the namespace's own serialized wire schema**; a domain adds a decoder only to narrow beyond that schema.
- **The `ConfigForms` service:**
  - **One controller per Host entry**, memoized by `entryId`; repeated `get()` calls return the *same* form, so two consumers share one accepted value and one write queue.
  - **The service keeps the PROVIDING fiber**, not the consumer's: "a Service reads `ctx` as its *consumer's* fiber: letting a shared form write through the caller's context would make every caller declare `remote.settings` in its own `inject`."
  - **`whileServed(namespaces, register)`** — the single most reusable idea in the shard. `register` runs once any listed namespace is in the mirror and returns a disposer; the disposer runs when none is served any more, or when the returned disposer runs. A deployment that never composed the owner therefore shows **no trace** of the page.
  - The client bundle purity gate forbids cross-plugin *value* imports; collaboration goes through Cordis services. Every package repeats that rule in its header comment.

### 1.3 `src/client/config-form-types.ts`
- `ConfigFormSnapshot<T>` documents the **base / user / value** triple:
  - `value` — the last accepted, schema-resolved section.
  - `base` — the composition layer the Host resolved `value` over: "What a field reverts to once cleared."
  - `user` — the raw user layer as stored. **A field's PRESENCE here is what marks it overridden** — "an override whose value equals the composition default is still an override, and comparing values could not see it." This is a genuinely important idea.
- `mutate(ops, expectedRevision?)` documents the whole contract: one atomic list, one revision fence, one Host validation, one recovery read.

### 1.4 `src/client/schema.ts`
- **Purpose:** synchronous schema introspection + immutable draft edits.
- `SettingsSchemaService`: `rehydrate(serialized)`, `validate(schema, draft)` (returns the failure *text*, or `undefined`), `nodeAtPath`, `getPath`, `hasPath`, `setPath`, `deletePath`.
- **Non-obvious decisions:**
  - `hasPath` reports **key existence, not value truthiness** — `{ flag: false }` *has* `flag`; `{ nested: { key: undefined } }` *has* `nested.key`. This is the same "presence, not value" idea as the override detection.
  - `setPath` / `deletePath` are **immutable** and **materialize missing containers** (object vs array decided by the next path key being numeric). `deletePath` on an absent path returns the *same* root object.
  - `validate` stringifies a non-`Error` throw rather than crashing.

### 1.5 `src/client/contract/slots.ts` — the composition contract
- The canonical home of every settings slot type, owned by the domain base rather than the shell that renders it.
- The seats: `settings.launcher`, `settings.trigger`, `settings.header`, `settings.action`, `settings.close`, `settings.section`, `settings.plugins.tab`, `settings.onboarding`, `settings.general.item`.
- **The rule the file states:** the shell has **zero copy of its own** — ALL text (trigger label, panel title, header actions, close aria, section content) arrives from registrants. "A feature owns its own settings pages — adding a setting never means editing the shell."
- The onboarding seat's contract: "Registrants own readiness, copy, dialog behavior, AND visible chrome: a step wraps its visible content in its modal surface (including `#root` inert ownership) and renders null while private facts are still loading. The shell paints no chrome of its own, so a mounted-but-deciding step shows and blocks nothing."
- `SettingsLauncherOwnerProps.settingsOpen` — "a launcher may treat a false-to-true edge as one Settings entry."

### 1.6 `src/client/developer-tools.ts` + `src/developer-tools-settings.ts`
- `DeveloperToolsPreference` wraps one accepted preference: `enabled` is an `ObservableSnapshot<boolean>` over the namespace scope.
- **Two rules:** the observable publishes **only on a change of the boolean** (a Host revision that does not change enablement notifies nobody), and a refused write **throws** ("Developer tools preference was not saved") so the caller can show a failure.
- **Host-backed features stay disabled until an accepted value arrives** — a missing or failed initial read does not enable them; later refreshes retain the last accepted choice. This is a "fail closed" default applied to a feature flag.
- The Host half declares `enabled` as a `volatile()` field with `default(true)`, and `settings.configure({ auto: false })` keeps it off the generated Settings pages.

### 1.7 `src/client/index.ts` + `src/index.ts`
- `apply()` registers the mirror, wires the two invalidation sources, and mounts `ConfigForms`.
- The comment records the cost: "The first connection also emits `connection/reset`, so startup normally costs **two reads** (budgeted in `startup-rpc-budget.e2e.ts`). The in-flight fold does not merge them into one; it guarantees at most one pending read at a time and that no invalidation arriving mid-read is lost." — an explicit, budgeted, documented trade.
- A long type-only import comment explains why `@deepseek-ai/dsh-api-remotes/client` is *not* imported here: it would drag a Host-tsdown-generated `/remote` artifact into the Host's build graph and deadlock the Host tsc phase. The client/Host split has real, documented build constraints.

### 1.8 Tests and config
- `tests/config-form.client.spec.ts` (22 KB) — the write-queue contract, in detail: writes serialize and only the latest publishes; a superseded refused write does not recover; a refused latest write does; an editor-owned revision fence survives an earlier queued write; a sibling scope sees a write answer without a re-read; a revisionless first write landing during the initial read forces a re-read; a throwing subscriber keeps the queue usable; a throwing mirror fold rejects one write and lets the next through; dispose cancels queued writes and drains the in-flight one; a notification queued before disposal is ignored; `unset` is fenced by the held revision; a refused clear recovers the Host state.
- `tests/settings-mirror.client.spec.ts` (9 KB) — the coalescing rules, including the "never loses a load landing between a run settling and its slot clearing" regression and the two "re-reads after a folded write invalidates an in-flight document" cases.
- `tests/schema.client.spec.ts` — path operations, presence-vs-truthiness, immutability, node traversal.
- `tests/developer-tools.client.spec.ts` — a refused write recovers and still throws; features are withheld during a delayed read; a failed first read keeps them off; revisions that do not change enablement notify nobody.
- `tests/plugin.client.spec.ts` — the base plugin mounts `configForms` + `settingsSchema`, reads once eagerly, refreshes on `settings/document-updated` and `connection/reset`, and retires both on fiber disposal.
- `tests/while-served.client.spec.ts` — the watch registers once, withdraws when the namespace stops being served, re-registers, and ends cleanly.
- `tests/config.host.spec.ts` — the Host half defaults on, persists, refuses an invalid value, and removes its schema on disposal.
- `README.md` / `README.zh.md` / `README.i18n.yaml` — the package contract; the i18n file is a per-heading hash of the EN and ZH blocks so a one-sided edit fails the pairing check.
- `package.json`, `tsconfig.json` / `.client.json` / `.host.json`, `tsdown.config.ts`, `locale/en.json`, `locale/zh.json`, `src/css-modules.d.ts` — ordinary package plumbing.

---

## 2. The shell: `packages/client/ui-settings-general` (42 files)

### 2.1 `src/client/index.ts` — the shell's `apply()`
- Occupies the sidebar's `sidebar.settings` seat and declares the seven settings child slots.
- **Ledger projections:** the nav rows and the onboarding steps are projections of slot ledgers, cached by `ctx.slots.getVersion(...)` **and** the locale revision. "Labels may be locale-following thunks, so the cache key includes the locale revision and subscribers ride both sources." The projection returns a cached array until the ledger version *or* the locale moves — this is the uSES "stable reference" contract.
- **The Settings shortcut is registered per platform** (`desktop:macos` `Mod+,`; `web:*` `Mod+Alt+,`) with a `resolve` that refuses while another modal is in front, and a `regions` list that includes `page`, `editable`, `terminal`.
- **The "Open configuration file" action is loopback-only.** `ctx.remote.$host.isLoopback` decides whether the `SettingsDocumentStore` is created at all; a remote browser never registers the seat.
- **The developer-tools row and the current-version row are contributed by the shell**; every other General row belongs to a feature.

### 2.2 `src/client/SettingsRoot.tsx`
- The modal panel: a full-viewport mask + a centered panel, portalled **beside `#root`** rather than inside it — "a covering surface mounted inside the root would precede the columns' chrome in document order, so a chrome row that declares window drag after it would override its subtraction."
- `useModalLayer(panel, true, onClose)` owns Escape + the focus trap; the mask click closes; the close paths are header button, mask click, document Escape.
- `const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id` — a render-time fallback, because "entries can unmount underneath the requested id."
- **The connecting pill has a minimum visible time** (`CONNECTING_MIN_VISIBLE_MS = 800`) so brief retries do not flicker; the recovered state is held for 2 s from when the green pill becomes visible.
- The onboarding step renders through the `settings.onboarding` slot with `{ only: onboardingStep.id }` — exactly one step mounted at a time.

### 2.3 `src/client/shell-store.ts`
- A tiny `defineStore` with `open` / `close` / `select` / `openSection`. `close` also clears `activeId`; `openSection` sets the id *and* opens.

### 2.4 `src/client/settings-document-store.ts`
- Derives "can a local settings document be opened" from the shared mirror's `hasDocument`.
- `load()` is idempotent (`this.following ??= ...`); `open()` collapses concurrent gestures behind the in-flight action; a failed open keeps the action available and records the message.

### 2.5 `src/client/DesktopUpdateIndicator.tsx` + `desktop-update-source.ts` + `src/types.ts`
- One `DesktopUpdateSource` owns **one** preload subscription shared by **both** sidebar locations (the account row and the collapsed-sidebar badge) — "Both controls share one carrier subscription."
- The bridge is deliberately thin: `status()` / `open()` / `subscribe()`. "Browser code cannot choose packages or authorize installation."
- The failure kind is a **closed union** (`check`, `check-network`, `download`, `install`, `stop-failed`, `tasks-changed`, `tasks-unavailable`) so the UI never renders a raw updater diagnostic.
- Connection feedback takes priority over update status **except** during a shell-reported installation, "when the expected backend disconnect must not hide update status."
- Tooltips show only the supplied version; a version with no `v` prefix keeps its exact form (prerelease suffixes included).

### 2.6 `src/client/HostReleasePrompt.tsx`
- Draws the two-ended transition: **Service** (Host's previous → Host's current, a solid green arrow because the Host already switched) and **Page** (the page's boot release → the Host's release, a dashed gray arrow because only a reload completes it).
- "A line shows versions when its two versions differ and commits otherwise."
- The dialog opens without a user gesture, so focus lands on **keeping the page**: "a pending Enter must not reload it."

### 2.7 `src/client/GeneralSection.tsx`, `chrome.tsx`, `CurrentVersionRow.tsx`, `DeveloperToolsRow.tsx`, `SettingsDocumentAction.tsx`
- `GeneralSection` is a one-line component: `renderSlot('settings.general.item', {})`. "The section column only stacks rows, so a row draws its own internals, including its label."
- `CurrentVersionRow` **renders nothing** when the build carries no `DSH_CLIENT_VERSION` — a partial build omits the row rather than printing "undefined".
- `DeveloperToolsRow` disables duplicate input while a write settles and shows a localized retry message on failure.
- `SettingsDocumentAction` renders `null` until the Host confirms availability.

### 2.8 Tests and docs
- `tests/apply.client.spec.ts` — the five seats, the locale-following nav label, the loopback-only document action over the *real* settings mirror, and recovery across Loader rebuilds.
- `tests/shell.client.spec.ts` — the shell occupies the sidebar hole, its ledger projections read the product's real sections, it survives a Loader rebuild, and it shares one update carrier subscription between both sidebar locations (released on unload).
- `tests/settings-root.client.spec.tsx` — the shortcut binding passed to the launcher, the fallback button's `aria-keyshortcuts`, the focus placement, and the modal behaviours.
- `tests/components.client.spec.tsx` — the collapsed update badge yielding to connection feedback, the Host-release transition lines (including the "Unknown" fallbacks), and the document store's recovery after a failed first read.
- `tests/desktop-update.client.spec.tsx` — phase labels, the "version only during checking/verifying/installing" rule, and the state label retained when there is no version.
- `tests/settings-document-store.client.spec.ts` — the availability derivation, the in-flight collapse, and the recovery via a mirror refresh.
- `README.md` — the shell's contract in detail, including the connection-pill timings, the release-change dialog, the loopback-only document action, and the two known limitations (additional General rows require their feature plugins; the Windows caption badge keeps a side-opening bubble, issue #4688).

---

## 3. The Models page: `packages/client/ui-settings-models` (51 files)

This is the richest package in the shard for August Trading.

### 3.1 `src/client/store.ts` — the page store
- **Purpose:** one snapshot joining three sources: `llm/listProviders` + `llm/listConfigurableProviders` (the provider directory), the settings namespaces (via the shared mirror), and `credentials/describe`.
- **Key abstractions:** `ModelsSettingsStore`, `ProviderDirectoryEntry`, `ProviderRow`, `joinProviderDirectory()`, `deriveKeyRef()`, `providerUsable()`, `protocolChoices()`, `reasoningLevelChoices()`.
- **Non-obvious decisions:**
  - **The join is order-stable and account-first**: `rows.toSorted(...)` puts `deepseek-account` then `deepseek-official` first, and everything else in its original order. The sort is a *stable* sort so the input order is not scrambled.
  - **The account route is hidden when its model catalogue is empty** — before sign-in and after sign-out it disappears entirely, and it returns when account models become available.
  - **A route registered without a configurable-provider declaration has no settings address** and therefore cannot be edited; it stays visible in the pickers but renders nowhere on the page (a documented limitation).
  - `deriveKeyRef(route)` derives `<ROUTE>_API_KEY` from the route id, uppercased with non-word characters folded to `_`.
  - **The store keeps the last good rows on failure** and the account row disappears and reappears on sign-out / sign-in.

### 3.2 `src/client/operations.ts`
- The Host operations the page invokes: `providers()`, `discoverModels()`, `writeCredential()`, `removeProvider()`, `initializeDefaultModel()`.
- **The credential write is verified by re-reading**: "Refusals surface through the re-read below: the Host is the only authority on whether the key now exists." `writeKey` writes, then reads, then returns `credential.configured`.

### 3.3 `src/client/ProviderEditor.tsx` (29 KB)
- **Purpose:** one provider's editor card, hand-written per adapter family.
- **The API key field is write-only.** "The page never asks for an environment-variable name — a typed key stores through `credentials/set` under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile has none." The page learns only *configured / not configured*.
- **The credential hint is a four-way classification**, each with its own colour and copy: `keyFallbackMissing` (env var not detected), `keyFallbackDetected` (env var detected, name shown), `keyFallbackDetectedHidden` (detected, but the reference is hidden — the name stays hidden), `keyFallbackUnchecked` (the environment credential status has not been confirmed). "Hidden authentication references still participate in detection."
- **The endpoint placeholder is the effective value, not the stored override.** Clearing the display-name field restores "the layer beneath the one this field edits" — the source comment spells this out: reading the *effective* value instead would echo the stored override back as the thing clearing restores.
- **Profile edits land as minimal path ops** — "the card names only the fields it can see instead of rebuilding the whole subtree from a partial descriptor." A `set` per changed field, an `unset` per cleared one.
- **There is deliberately no provider-scoped reasoning-effort control:** "it is a per-MODEL capability, and the models under one provider disagree about it, so a provider-scoped control can only be set to a value some of them reject."
- **Credential cleanup is intentionally narrow:** a removed provider's key is deleted only when the reference is the exact `<ROUTE>_API_KEY` target the page derives. "Custom references, environment credentials, and unidentifiable targets are retained because the row cannot prove ownership of them."
- The **Advanced / "Customized settings"** fold is a native `<details>`, and the key field is `autoFocus`ed only in the credential-only onboarding mode.

### 3.4 `src/client/ModelListEditor.tsx` (20 KB) + `ModelRow.tsx`
- **The model list is the profile's `models` array as the card holds it.** "An empty list means 'serve this route's built-in catalog', and any entry replaces that catalog, so a row is only ever added deliberately."
- **The endpoint interrogation asks the endpoint the form currently shows**, including a key typed but not yet saved — "so adding a provider is one pass instead of save-then-return."
- **The reply is candidates the user picks from, never configuration written behind them.** The picker supports search, select-all (visible results only) and deselect-all (the entire selection, "so hidden results cannot be adopted accidentally").
- **A row the user already tuned wins over the provider's own numbers.** Adoption is keyed by id; a half-typed row whose id is empty is not a match, "since a row without an id is not yet a model and the create/apply gates refuse it."
- **A provider that cannot be interrogated is not a dead end:** the failure is shown next to the rows the user can still fill in by hand.

### 3.5 `src/client/DeepSeekModelsEditor.tsx`
- `parseCapacity` / `formatCapacity` — the user may write `256K` or `1M`; the stored value stays a plain token count.
  - **`1M` is 1000K**, matching how model capacities are quoted.
  - **A decimal multiple snaps back**: "2.3 * 1e6 lands a few ULPs high", so an integral intent is rounded back within `1e-6`.
  - `formatCapacity` spells a stored count back in the *shortest form that survives a round trip*; a count that is not a whole number of thousands stays written out.
- `modelDrafts(value)` converts a schema-validated catalog into records **without dropping hidden or future fields** — every row is `Record<string, unknown>`, structurally open.
- `validateDeepSeekModels(value)` mirrors the adapter constraints the serialized schema cannot express: empty id, duplicate id, empty explicit name, unreadable / non-positive / fractional capacity.

### 3.6 `src/client/ModelReasoningEfforts.tsx`
- Per-model reasoning-level declarations for a hand-declared pi-ai route.
- `readEfforts` returns `undefined` when the field is absent or `false` (the model does not reason), `[]` when it is `null` (pi-ai refuses an empty value map), and the entries otherwise — "including a key the offered levels do not name, so an edit never drops it."
- `validateReasoningEfforts` mirrors pi-ai's refusals: a value must be a non-empty string, or `null` for Off; at least one level besides Off must exist.
- **Turning the switch on always starts from off/low/medium/high** — "it does not restore levels removed earlier, and **Cancel** discards the edit instead."
- **Changing a row's level resets a value still spelled as the old level; a custom value carries over only between two thinking levels**, so changing a row to or from Off resets it.
- **A stored key the schema does not list keeps its row and stays selectable there.**

### 3.7 `src/client/ModelsSection.tsx` (35 KB)
- **One editor card at a time.** Each card kind owns its own open state, "so closing one never discards a draft in another."
- **The add flow is one card behind one button** with a mode switch (catalog vs custom). "A panel mounts the first time its mode is shown and stays mounted, hidden, while the card is open and its mode stays offered, so switching modes discards neither draft and an unvisited mode costs nothing."
- **The switch holds still while either panel has a write or an endpoint interrogation in flight**, "since a switch underneath one would orphan the answer."
- **A whole-section provider without a configured key renders as its open setup card instead of a row** — but *only in the first-run posture* (no provider on the page can serve requests yet) and only until the user closes that card.
- **The credential dot is only drawn on a confirmed state**: solid for configured, muted for missing, and **nothing** for a native/unknown state. "Rows expose only confirmed API-key state."
- **A removal needs confirmation** and the confirmation names the provider, with a different description when a credential is involved.
- **The editor opens only when the page is `ready`** — `disabled={!open && state.status !== 'ready'}` and a guard inside the click handler.

### 3.8 `src/client/CustomProviderCard.tsx`
- The create form for a route pi-ai does not ship. It asks for a unique **Provider ID**, an endpoint, a protocol, and at least one uniquely-identified model, "because nothing can default those."
- **The endpoint placeholder follows the selected protocol** (OpenAI Chat Completions / Responses → `https://gateway.example/v1`; Anthropic Messages → `https://gateway.example`, "because its SDK appends `/v1/messages`"). **Changing the protocol preserves any address already entered.**
- **The API-key field's validation is its own rule**: after trimming, non-empty and every character printable ASCII (`[\x21-\x7E]`) — "which is exactly what an HTTP header value can carry." A pasted `NAME=value` line or a wrapped-in-quotes value is refused as the same format failure. A padded key is trimmed before storing.
- **The interrogation is blocked too**, "rather than spending a round trip on a refused key."

### 3.9 `src/client/ApiKeyInput.tsx`, `EditorFooter.tsx`, `ModelInputTypes.tsx`, `OnboardingModal.tsx`, `WelcomeNotice.tsx`, `welcome-store.ts`, `index.ts`, `locales.ts`, `slot-contract.ts`, `apiKey.ts`, `protocol-label.ts`, `schema-operations.ts`
- `apiKey.ts` — `apiKeyFailure(text)`: the field-level validation used by both the provider editor and the create card.
- `protocol-label.ts` — the protocol picker's *display* names; "the stored value stays the schema identifier."
- `schema-operations.ts` — `SettingsSchemaOperations` (the rehydrate / validate / getPath / setPath / deletePath surface the editors use).
- `slot-contract.ts` — the two **extension seats** for out-of-repo plugins: `settings.models.provider-card` (keyed by the owning settings namespace) and `settings.models.footer` (list). "Without registrants both seats render nothing."
- `welcome-store.ts` — the versioned welcome notice: the acknowledgement is compared for **exact equality** against `WELCOME_NOTICE_VERSION`; only an explicit Continue records it; an unavailable namespace or a refused write leaves the notice unacknowledged; "Users who acknowledged an earlier version see the current notice again."
- `onboarding-copy.ts` — the durable namespace (`ui-settings-general`), the acknowledgement field, and the version constant (`2026-09-28.1`).
- `onboarding-config.ts` — the page-global bootstrap `__DSH_MODELS_ONBOARDING__` with `credentialOnboarding` (default true). "It is page initialization data, not a durable completion marker."

### 3.10 Tests and docs
- `tests/components.client.spec.tsx` (119 KB, 2425 lines) — the page's behaviour in detail: credential state unconfirmed on a failed redacted read; waiting for the current snapshot before remounting setup; preserving a mounted draft during a pending refresh; readiness checks before opening an editor / adding / removing; waiting for saved credential confirmation before removing a managed key; the first-run setup-card posture; the provider-card seat dispatch; the credential dot's three states; the DeepSeek path ops; the capacity round-trip; the typed-text re-keying across a row removal; the whitespace-only key; the `NAME=value` paste refusal; the section reload after creating a hand-declared provider.
- `tests/provider-form.client.spec.tsx` (80 KB) — the create/edit form in detail (the tail of the title listing covers the API-key field rules: blank submit writes no credential; whitespace-only base URL is cleared rather than written; whitespace-only key blocks submit; non-header characters block submit; a pasted `NAME=value` line is refused; a padded key is trimmed; the interrogation is blocked on a refused key).
- `tests/store.client.spec.ts` — the directory × namespaces × credentials join, the account-first ordering, the key-reference derivation, and "the account row appears after sign-in and disappears after sign-out."
- `tests/apply.client.spec.ts` — registration, the locale-following label thunk, `credentialOnboarding: false` on the Electron marker, and HMR recovery.
- `tests/onboarding-dialog.client.spec.tsx` — the first-run DeepSeek prompt over the shared Models join, and that an explicit account-menu setup reuses the editor without another login choice.
- `tests/welcome-notice.client.spec.tsx`, `tests/welcome-store.client.spec.ts` — the versioned acknowledgement.
- `tests/model-reasoning-efforts.client.spec.tsx`, `tests/model-list-catalog.client.spec.tsx`, `tests/model-input-types.client.spec.tsx`, `tests/readiness.client.spec.ts`, `tests/styles.client.spec.ts` — the reasoning-level editor, the catalogue picker, the input-type checkboxes (including "removes DeepSeek image limits when images are unchecked" — unchecking Image also removes `imagePixelBudget` and `imageMaxBytes`), the readiness gate, and a CSS-text guard that **no `<select>` in the package is unstyled** and **no CSS rule falls back to a literal colour**.
- `README.md` / `README.zh.md` — the package contract, including a candid "Known Limitations" list (only the API key and curated fold fields are editable; credential cleanup is narrow; only pi-ai routes can be hand-declared; the catalogue select lists raw route ids; interrogation covers OpenAI-compatible and Anthropic Messages only; undeclared live routes render nowhere).

---

## 4. The account package: `packages/client/ui-settings-account` (147 files)

Full detail is in the package section below; the load-bearing ideas are:

- **`bonus-notices.ts`** — a notice lifecycle where **acknowledgement is gated on a presented frame**, reads are **event-driven and never polled**, a newer read supersedes one in flight, a refusal settles without retry while a protocol failure backs off exponentially, and the queue is per-account so a failure in account A cannot schedule a retry into account B.
- **`onboarding-state.ts`** — a resumable first-run flow with **preview-then-persist**, a **fixed write order** with the durable "done" marker written **last**, **every write verified by re-reading**, a rejected write **retained** so `retry()` re-applies the exact rejected value, and the credit-funded decision **frozen at first entry** and never persisted.
- **`platform-pages.ts`** — one shared native-view channel with an **identity-safe release**: a stale owner's release is a no-op, and the newer request is installed before the previous owner is retired.
- **`overlay-inert.ts`** — reference-counted `inert` ownership that remembers the element's original value.
- **`account-refresh.ts`** — `refreshAfterReturn` swallows a failed pre-return read so the post-operation refresh still runs.
- **`index.ts`** — a **generation guard** on the profile read, **coalesced refreshes** (two concurrent calls issue one pair of reads), **independent reads** (a failed profile read does not cancel the balance read), and a **narrowed page-opener** so each caller gets its own post-return read policy (Settings re-reads profile+balance+bonus; onboarding recharge re-reads profile+balance only).
- **`AccountQuotaNotice.tsx`** — `keepOpen()` is called **before** the page is requested, "because a later failure that replaced the notice would otherwise republish it and remount this entry and drop the page."
- **`formatBalance.ts`** — `big.js` throughout; sub-cent positives render `<¥0.01`, negatives clamp to a minimum magnitude of `0.01`, positives truncate toward zero.

---

## 5. The four official configuration pages

All four (agent-loop, shell, subagent, web-search) share one template, which is itself worth stealing:

1. **The Host half is an empty `apply()`** — the package exists only to hold a Loader row so the client module system can serve the browser half. "This package registers no namespace of its own."
2. **The browser half binds its namespace(s) through `ctx.configForms.get(ns)`** and keeps one shared `SettingsFormModel` per namespace.
3. **The page registers into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed([...])`** — so a deployment that does not compose the owner shows no trace of the page.
4. **Nothing is written until Save.** Leaving the page drops the draft. An empty field saves as a reset (the `unset` op, restoring inheritance). Text that is not a number blocks the save and says so under the field.
5. **The effective value is always shown**, with an **Overridden** badge and a **Reset to default** beside it once the user has overridden it.

### 5.1 `ui-settings-agent-loop` (17 files)
- The **parallel tool-call cap** of one step (`maxParallelToolCalls`), one numeric field, one namespace.
- The controller is a thin bridge over `SettingsFormModel` + `settingsNumberField`.
- `tests/apply.client.spec.ts` — "registers the page while the Host serves the namespace, titled in the active locale"; "registers nothing while the namespace is not served, and withdraws the page when the Host stops serving it"; "collapses the page on teardown."

### 5.2 `ui-settings-shell` (17 files)
- Two fields: the **command timeout (ms)** and the **per-stream output cap (bytes)** — "Output beyond this spills to a temporary file rather than being lost."
- **The page binds the served executor**: `BASH_NS = 'bash-sandbox'` and `PWSH_NS = 'pwsh-sandbox'`, and the injected face picks `served.has(PWSH_NS) ? pwsh : bash`. "The base bundle composes exactly one shell executor per platform."

### 5.3 `ui-settings-subagent` (24 files)
- **Two namespaces, one page, one save.** `subagent` (recursion depth + parallelism limit) and `subagent-model-selection` (which models an agent may choose).
- **`subagentCardShell(limits, models)`** derives one shared `SettingsFormShell` from two forms — availability, writability, dirtiness, invalidity, saving, failed — "without duplicating either form's subscriptions."
- **The save writes the dirty sections independently**: "a section the Host refuses keeps its draft with the failure reported while the other lands, and a model draft a newer Host revision superseded is reported as a conflict to discard rather than overwriting the newer routes." The test pins that a rejected model draft is **retained** after the limits save and retried alone.
- **The catalogue is not part of any settings section** — it is re-read on `llm/adapters-updated`, `settings/document-updated`, and a connection reset (which also drops the draft).
- **Routes the Host stored but no adapter advertises stay listed** under "Saved but currently unavailable" and remain removable; "a provider that failed to load is reported without hiding the others."
- The two help texts are unusually good: depth explains what 0 and 1 mean and that "if a tool defines its own maximum recursion depth, that setting takes precedence"; capacity explains that it counts every live subagent under one main agent across all levels, the main agent excluded, and that new start requests are rejected at the limit.

### 5.4 `ui-settings-web-search` (18 files)
- The **API switch** (Messages search vs the Search/Fetch APIs), the **key**, the **endpoint**, and the **per-search limit**.
- **The key is written through the credentials domain, never into the settings section**, "so its literal never rides a response." Its success is read back from `credentials.describe`.
- **The controller re-reads the credential** when a scope changes, when the switch selects a section naming another reference, and when the Host reports `credentials/reference-updated` "since a key written on the Models page changes no settings section."
- **The key field starts blank on every load** and reports only whether a key is configured. Without one it says that only conversations using a DeepSeek Account model can search, "because those searches authenticate with the account sign-in."
- **One save writes the provider settings before the selection, so a refused section leaves the switch unsaved.**
- **Each mode keeps its own API base when switching.** The switch is disabled while an invalid edit or a failed save is staged, "so a field it would hide stays visible."
- `countHint` states a boundary in the copy itself: "Results returned per query: an integer from 1 to 50, default 10. This controls result count, not search calls."

### 5.5 `ui-settings-plugins` (16 files) + `ui-settings-plugin-inventory` (16 files)
- The Plugins section is a **shell**: it owns the nav entry and the tab row; every tab is registered by another package.
- **A tab mounts on its first selection and then stays mounted while hidden**, "so local drafts, disclosure state, search, and the inventory snapshot survive switching between the two views." A lone contribution renders as the page itself, with no tab row.
- The inventory tab is a **read-only projection** of a Host-owned snapshot; it reads **no Remote during plugin activation** and takes the snapshot on first selection.
- **Scope-qualified row keys** (`global:`, `preset:<id>:<index>`), so one module appearing in both scopes keeps distinct disclosure state.
- **The preset-provided marking is derived client-side and conservatively**: a global entry carries it only when it is disabled there *and* at least one preset row for the same module is actually enabled — "so a module every preset gates off (or declares only conditionally) stays plainly disabled rather than over-claiming provision."
- **The status dot vocabulary is explicit**: `pending` → idle, `loading` and `unloading` → ongoing (both are live transitions; "an async disposer can hold `unloading` for a while"), `active` and `failed` carry **no** dot. The reasoning is written down: "a settled enabled row needs no marker, and a failed row has the failure tag."
- **Names are shortened for the Settings surface only**: the npm scope and the `cordis:`, `cordis-plugin-`, `dsh-`/`dsh-host-`/`dsh-client-` prefixes are removed from a *literal* fallback, but "locale titles remain unchanged" and the full module specifier stays in the details and in search.
- The preset names resolve through the shared `presetDisplayText` fold over the agent-preset dictionaries, "so an English surface never echoes the preset declarations' Chinese names."

### 5.6 `ui-settings-session-log` (18 files)
- A single switch in General: "Upload Session Log when using the official model API."
- **The switch shows the accepted Host setting** and saves each change immediately — not staged.
- **A save failure keeps the accepted value** and shows a toast that **survives closing Settings** (the toast is a `shell.overlay` entry, not a row-local one). The `UploadPreference` class publishes `{ busy, notice, sequence }`; the sequence is the toast's `key`, so a second identical notice still re-renders.
- The row appears only while the Host exposes the `session-log-deepseek` namespace.

---

## 6. Ideas worth stealing (for August Trading)

1. **One mirror, many derived views.** `SettingsDescribeMirror` is the only reader of the settings document; every surface derives from it. August Trading reads Preferences from `PreferenceService`, `ProviderConfigService`, `ExportService`, and the UI independently. A single mirrored snapshot with a "last good value + separate error" would kill a whole class of "the panel shows stale/nothing" bugs.
2. **Presence, not value, marks an override.** A field is overridden iff it is *present* in the user layer — an override whose value equals the default is still an override. August's "Is this provider custom?" checks compare values and therefore miss a user who re-selected the default.
3. **Revision-fenced writes with a preserved draft.** Every write carries the revision the editor read; a conflicting Host write is *refused* and the draft survives. August's provider config writes have no such fence.
4. **An ordered write queue where only the latest settlement publishes.** Rapid writes serialize; a superseded answer is dropped but its revision becomes the next write's fence. This is exactly the shape August needs for rapid provider toggles.
5. **`whileServed` — a settings surface exists only while its backing capability is served.** The page disappears rather than showing a dead "unavailable" form.
6. **Preview-then-persist with the "done" marker written last, and every write verified by re-reading.** August's onboarding / first-run flows should re-read after writing and only then record completion.
7. **Write-only secrets.** The settings page never learns an API key's value — only *configured / not configured* — and the write path never puts the literal into a response. August's `ProviderConfigService` encrypts at rest but the UI holds plaintext in memory; DSH's separation is stricter and worth copying.
8. **Staged forms that never write until Save, with "empty saves as a reset" and "an empty field restores the inherited layer".** `unset` is a first-class op next to `set`.
9. **"Overridden" badge + "Reset to default"** on every effective value. The trader always sees both the effective number and whether they changed it.
10. **The `K`/`M` capacity grammar with a round-trip-safe formatter.** `256K` / `1M` in the UI, a plain token count on disk, and a formatter that picks the shortest form that round-trips. August's context-window resolution could use the same "user-typed shorthand, canonical storage" split.
11. **Reasoning effort is a per-MODEL capability.** DSH explicitly refuses a provider-scoped effort control because "the models under one provider disagree about it." August's provider-level reasoning tier has exactly this hazard.
12. **Model discovery against the endpoint as the form currently shows it, including the unsaved key** — one pass instead of save-then-return; and the reply is *candidates*, never configuration written behind the user's back.
13. **Reference-counted `inert` for overlapping overlays** that restores the element's original value.
14. **A classified failure vocabulary.** `check` / `check-network` / `download` / `install` / `stop-failed` — a closed union so the UI never renders a raw error string.
15. **Analytics de-duplication via "shown" refs** so a re-render cannot double-count a page view.
16. **A deliberate, documented, budgeted cost.** "Startup normally costs two reads (budgeted in `startup-rpc-budget.e2e.ts`) … it guarantees at most one pending read at a time and that no invalidation arriving mid-read is lost."
17. **A source-level CSS/text guard as a test.** `tests/styles.client.spec.ts` greps the package's own sources to assert no unstyled `<select>` and no literal colour fallback. Cheap, and it catches a class of visual regression a jsdom suite cannot.
18. **A bilingual-pairing hash file** (`README.i18n.yaml`) that fails CI when one side of a translation is edited alone.

---

## 7. Trading-relevant findings

1. **The Models page is the closest analogue to August's provider settings**, and its join (`llm/listProviders` × `llm/listConfigurableProviders` × settings namespaces × `credentials/describe`) is a template for August's `getFirstReadyProvider` / `buildModelIdToName` resolution: one snapshot joining four sources, with the account route ordered first and the last-good rows kept on failure.
2. **API-key handling is stricter than August's.** DSH keeps keys in a separate credentials domain addressed by *reference* (`<ROUTE>_API_KEY`); the page is write-only, never reads the value back, and deletes a key on provider removal **only** when the reference is the exact target the page derives. August encrypts at rest on desktop but leaves plaintext in the renderer and in Preferences on web; the reference-addressed seam would let the UI, the exporter, and the log all talk about a key without holding it.
3. **Per-model context window and max-output-token editing** is exactly what August's `utils/contextWindow.ts` computes. DSH's treatment — the user writes `256K`, the store holds `256000`, and the *effective* value falls back to the provider default when the field is unset — is a cleaner model than August's `resolveContextWindow()` chain (user override → provider-stated limit → `/models` → 1 M default), because it makes the *override* explicit in storage rather than inferred at read time.
4. **Reasoning effort must be per-model, not per-provider.** Direct, quotable warning from a shipped product.
5. **The endpoint-interrogation pattern (fetch models before saving)** applies to August's provider onboarding: query the endpoint with the key as typed, let the trader pick candidates, never write configuration behind their back.
6. **Session-log upload is an explicit, opt-in General switch** with a survive-the-panel toast — August's journal/telemetry export could use the same "accepted setting, one toast, failure keeps the accepted value" contract.
7. **Subagent depth + capacity are settings the user can see** ("maximum recursion depth", "parallelism limit", with the count that capacity bounds). August's `subagent`/delegation surface has no such user-visible bound today.
8. **The shell's connection pill** (800 ms minimum visible, 2 s recovered hold) and the **Host-release-change dialog** (two-ended transition, versions when they differ and commits otherwise) are reusable patterns for any "the backend changed under you" moment.

---

## 8. Weak spots (do not copy these)

1. **The scale.** Nine packages, ~400 files, four separate slot contracts, three build configs per package, an empty host half in every plugin, and a `tsdown` bundle per package — for what is conceptually one settings panel. August Trading's Settings surface is one directory; the transferable part is the *mirror + form + contract* trio, not the packaging.
2. **The hand-written provider editor traded away schema-generic coverage.** The Models README admits it: "the hand-written editor traded schema-generic field coverage for the mockup layout. Retry policy, timeouts, DeepSeek model descriptions, and other advanced fields remain in `cordis.patch.yml`." A schema-driven form (which August already has via zod) would have covered them.
3. **`whileServed` hides settings.** A surface whose namespace is not served simply does not exist, so the trader cannot find the setting at all — a discoverability failure the package itself does not acknowledge as a limitation.
4. **Raw identifiers leak into the UI.** The catalogue select shows `moonshotai` and `zai` with "no product names, aliases, or search" — acknowledged as a limitation in the README, still shipped.
5. **The plugin inventory is stale by construction.** "One snapshot per Settings mount or retry — the tab does not subscribe to Loader changes or automatically refetch after reconnect." Switching tabs preserves a possibly-stale snapshot.
6. **Duplicate read on startup** (the eager `ensure()` plus the `connection/reset` that the first connection also emits) — mitigated by the in-flight fold, but it is a real cost, paid by every browser session.
7. **The account package is 147 files for what is mostly presentation**, and the bonus-notice lifecycle in particular carries a lot of machinery (exponential backoff, per-scope queues, frame-presentation gating) for a "you were credited 5.00" message.
8. **The account `refresh()` coalescing means entering Settings issues a profile + balance + bonus read** — a settings panel that costs three RPCs on every entry is a smell.

---

## 9. File-by-file ledger (summary by package)

| Package | Read | Skipped | Notes |
| --- | --- | --- | --- |
| `ui-settings` | 27 | 0 | Fully read: mirror, config form, schema service, slot contract, developer-tools preference, 7 test files, 3 README files, 12 config files. |
| `ui-settings-general` | 42 | 0 | Fully read: shell root, store, chrome, General section, update indicator, release prompt, document store, 6 CSS modules, 5 test files, 3 README files, 9 config files. |
| `ui-settings-models` | 51 | 0 | Fully read: 12 source modules + 28 component modules, 13 test files (the two largest — 119 KB and 80 KB — catalogued by their case titles), 3 README files, 15 config files. |
| `ui-settings-account` | 139 | 8 | 8 binary WebP illustrations skipped (180–415 KB each); every source, test, fixture, README and config file read. |
| `ui-settings-subagent` | 24 | 0 | Fully read. |
| `ui-settings-web-search` | 18 | 0 | Fully read. |
| `ui-settings-agent-loop` | 17 | 0 | Fully read. |
| `ui-settings-shell` | 17 | 0 | Fully read. |
| `ui-settings-plugins` | 16 | 0 | Fully read. |
| `ui-settings-plugin-inventory` | 16 | 0 | Fully read. |
| `ui-settings-session-log` | 18 | 0 | Fully read. |
| **Total** | **385** | **8** | 393 files. |

---

## 10. Report path

`C:\Dev\august-3.5\docs\research\deepseek-harness\shards\dsh-client-settings.md`
