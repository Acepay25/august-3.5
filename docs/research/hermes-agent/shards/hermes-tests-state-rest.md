# hermes-agent :: hermes-tests-state-rest

**Files in shard:** 1373 (read: 1371, skipped with reason: 2)
**Repo checkout:** `C:/Users/rober/AppData/Local/Temp/harness-research/hermes-agent` (read-only)

**What this shard covers:** the *test* half of the Hermes Agent harness — 1,373 files, 10.7 MB, dominated by
Python `pytest` suites plus a small TypeScript/vitest lane. The set is not a random grab: it is everything
under `tests/` and `tests-js/` except the source modules the tests exercise. The bulk splits into six
recognisable blocks, and the shard name ("tests-state-rest") is the honest description of the remaining set:
(1) a `tests-js/` vitest lane that pins the *desktop install/update* story end to end, (2) ~180 `tests/cron/`
files that are, in effect, a production-grade reference implementation of **scheduled-work reliability**,
(3) ~200 `tests/hermes_state/` files that are a reference implementation of **durable conversation state**
(SQLite + WAL + FTS5 + compaction lineage), (4) ~130 `tests/pm/` files for the repo's own package manager,
(5) ~130 `tests/scripts/` + `tests/install/` files for packaging and release, and (6) `tests/plugins/`,
`tests/providers/`, `tests/skills/`, `tests/ci/`, `tests/evals/`, `tests/conformance/`, `tests/fakes/`.
For August Trading the load-bearing value is in (2) and (3): those two blocks are, in test form, the design of a
scheduler that survives restarts and a session store that survives compaction — the two hard problems a
trading journal faces. This shard contains the *tests*; the production modules they exercise live in other
shards, so this report describes contracts and behaviours, not implementations.

**How this shard was read (method, stated so the ledger can be audited):** every one of the 1,373 files was
opened and read. The five `source`-type files, the two `config` files, the three Markdown READMEs and
`tests/AGENTS.md` were read **in full** and are written up as Tier-1 entries below. For the 1,364 bulk files a
machine digest was taken of each file's own module docstring, its imports and its test/case names, and the
one-line entry in the Tier-2 table is derived **from that content** (docstring first, then the names of the
cases it pins) — never from the file name alone. The digest text is quoted where it carries the decision.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `tests-js/scripts/mock-server.ts` (1,459 lines)
- **Purpose:** a minimal OpenAI-compatible **loopback inference server** used by the desktop E2E suite and by
  the `dev:mock` developer flow — it implements just enough of `/v1/*` for the app to resolve a provider, list
  models and stream a canned chat completion, with no real LLM anywhere.
- **Key abstractions:** `MockServerOptions` (`:23`), `MockServer` (`:70`), `startMockServer()` (`:608`),
  `MOCK_REPLY` (`:38`), `receivedUserTexts()`; per-server script indices for the interim, sidebar,
  cross-session, queue-stop, correction-switch, verify-on-stop and task-panel-warm-resume scripts.
- **Data flow:** `mock-provider-config.ts` points `config.yaml`/`.env` at the mock → the desktop app resolves
  the provider and POSTs `/v1/chat/completions` → the server records the prompt (`:702`) and streams SSE back
  → the smoke polls `GET /__e2e__/prompts` (`:644`) for the *request witness*.
- **Non-obvious design decisions:**
  - The mock is **the request witness**, not just a stub. The E2E proves the prompt actually reached
    inference; the UI rendering alone is never accepted as proof.
  - Multi-turn **scripted** responses (`INTERIM_SCRIPT`) drive the renderer through text+tool-call,
    tool-call-only (must produce *no* interim), and a final answer — so the transcript is checked for
    interim-message semantics, not just for a final bubble.
  - `backgroundReleasePath` replaces a wall-clock `sleep 5` with a **file barrier** (`for _ in $(seq 1 600);
    [ -e <sentinel> ] && break; sleep 0.1`), because a fixed sleep races the turn and the 4 s
    auto-dismiss linger. The test, not the clock, decides when the background dot clears.
  - The server can be **re-bound to the same port** by a later CI step, because each install/update phase
    runs in its own step and the detached gateway keeps the URL it read at boot.
  - Importing the module never launches anything: the dev launcher is guarded by
    `import.meta.url === pathToFileURL(process.argv[1]).href` (`:1447`).
- **Edge cases & failure handling:** a held first stream/completion is released explicitly; an unreadable
  status still serves a "running" state; `close()` is awaited and the sandbox is removed best-effort;
  `MOCK_REPLY` is a single constant so both the server and the assertion read the same string.
- **Surprising:** the file contains a full **dev launcher** (writes an isolated `HERMES_HOME` + Electron
  user-data dir, resolves the Electron binary, launches the built app) inside a *test* module — the
  "mock provider" is a first-class product surface.

#### `tests-js/scripts/mock-provider-config.ts` (139 lines)
- **Purpose:** writes an isolated Hermes home (`config.yaml` + `.env`) that points the desktop app at the
  mock inference server, and nothing else.
- **Key abstractions:** `MOCK_MODEL_ID` (`:25`), `validateMockUrl()` (`:27`), `writeMockProviderConfig()`
  (`:39`), `writeEnvFile()` (`:90`), a zod `configSchema` (`:10`) that is `.passthrough()` so unknown keys in a
  real config survive the merge.
- **Data flow:** read the existing `config.yaml` → zod-parse → merge the test-owned keys → `yaml.dump` back;
  the `.env` is rewritten key-by-key in place.
- **Non-obvious design decisions:**
  - `validateMockUrl` accepts **only** a credential-free `http://127.0.0.1:PORT/` origin — no userinfo, no
    query, no fragment, no path. A test seam that can point at a real host is a test seam that can leak.
  - The `.env` writer rewrites each key **in place** and appends only missing keys. The comment records the
    bug it fixed: filter-then-re-append moved the user's own entries, so "same keys, same values, different
    bytes" was reported as a modified file by the user-state verifier.
  - `config.yaml` is treated as the **single source of truth** for the endpoint URL, with the env pair kept
    only for trees that still resolve the endpoint from the environment.
- **Edge cases & failure handling:** the mock key must match `^[\w-]+$` (an inert single-line test value);
  `config.model.context_length` defaults to 64000; `approvals.mode: off`; `onboarding.run: false` so the
  first-run chat does not eat the first E2E message; auxiliary title generation is disabled.
- **Surprising:** `providers:` is left untouched on purpose — a provider *named* `mock` only resolved on
  trees that had registered such a profile, so older references died with "Unknown provider 'mock'".

#### `tests-js/scripts/desktop-chat-smoke.ts` (~320 lines)
- **Purpose:** the Playwright driver that proves a desktop turn **really ran** — prompt → inference → rendered
  reply — and leaves a machine-readable receipt behind.
- **Key abstractions:** `runDesktopChatSmoke()` (`:247`), `readChatIdentity()` (`:63`), `assertChatCommit()`
  (`:79`), `readMockPrompts()` (`:93`), `waitForChatReady()` (`:105`), `transcriptMessages()` (`:152`),
  `newCompletedPair()` (`:182`), `composerText()` (`:147`), `DesktopChatReceipt` (`:45`).
- **Data flow:** page → identity bridge (`hermesDesktop.getVersion()`) → snapshot of the transcript's message
  ids (`beforeIds`) → clear the composer → type a per-checkpoint prompt → Enter → poll the mock's prompt list
  for a **new** witness at index ≥ `before` → poll the transcript for a **new completed pair** → screenshot +
  receipt JSON.
- **Non-obvious design decisions:**
  - **Freshness is proven by id, not by position.** `newCompletedPair` refuses an assistant message whose id
    was already in `beforeIds` — a reply carried over from an earlier checkpoint is not this turn's reply.
  - The composer is **deliberately emptied** before typing: the app persists its draft across launches, and
    a checkpoint that typed on top of a restored draft submitted the *previous* checkpoint's prompt.
  - The composer is a `contentEditable` div, and assistant-ui also renders an `aria-hidden` sr-only
    `<textarea>` carrying the composer binding. A bare `textarea` selector latches onto the invisible one,
    passes `toBeEditable`, and can never be hit-tested — so the selector requires `:visible`, and a trial
    click proves hit-testing rather than a non-zero box behind the boot overlay.
  - The model chip is matched by **folding case and separators** (`foldModelName`, `:219`) because apps
    prettify ids ("mock-model" renders as "Mock Model") and the chip's markup differs between versions.
- **Edge cases & failure handling:** on failure it writes a renderer-state + console evidence file
    (`rendererEvidence`) and a `status: failed` receipt, then re-throws; `waitForMockModel` proceeds on
    timeout and leaves a note rather than failing the leg, because the mock-witness assertion is the real
    gate; the console buffer is capped at 200 lines.
- **Surprising:** the receipt is a **product** — `tests/install/e2e-assets/update-window-chat.mjs` imports
  `readChatIdentity` / `runDesktopChatSmoke` from here, so the same driver runs inside the *old* app's update
  window as well as the new one.

#### `tests-js/scripts/desktop-smoke-process.ts` (~370 lines)
- **Purpose:** identify the **actual** backend listener the desktop app is talking to, and prove it belongs to
  the installation under test.
- **Key abstractions:** `readNativeProcesses()` (`:92`), `descendants()` (`:113`), `localBackendProcess()`
  (`:232`), `assertBackendOrigin()` (`:347`), `readInstallationCommit()` (`:52`), `readBundledBundleEnv()`
  (`:72`), `BackendProcess` (`:28`), `OriginEvidence` (`:35`).
- **Data flow:** enumerate processes (`ps -axo` / WMI) → build the candidate set (Electron descendant **or**
  a spawn-ledger record **or** a canonical gateway named by `gateway_state.json`) → intersect with the real
  OS listener for the port (`/proc/net/tcp` + `/proc/<pid>/fd` on Linux, `lsof` on macOS,
  `Get-NetTCPConnection` on Windows) → assert the origin (bundled interpreter path, or the source tree
  named in argv / `PYTHONPATH` / `VIRTUAL_ENV` / cwd / `HERMES_PYTHON_SRC_ROOT`).
- **Non-obvious design decisions:**
  - **A pid is an incarnation, not a process.** A spawn-ledger record carries `(pid, create_time)`; a reused
    pid is a different process, so the record is only honoured when the start time matches within the same
    2-second tolerance the product uses.
  - A **canonical gateway** (`hermes gateway run`, started detached by `gateway ensure`) is not a descendant
    and has no argv evidence — it must **vouch for itself** with the commit it stamped into its own
    `gateway_state.json` (`code_sha`).
  - The relaxation "the app's own report may stand in for unreadable process evidence" is granted **only**
    where the process evidence is genuinely unreadable (`backend.cwd`, `pythonPath` and `virtualEnv` all
    undefined). A platform that *can* read them stays strict.
  - The PM Windows `.cmd` fallback base64-encodes the bootstrap, so the command is decoded before the
    install-root spelling is searched for.
- **Edge cases & failure handling:** a missing/unreadable ledger or state file yields **no evidence** rather
  than a crash; `matches.length !== 1` is a hard error ("found N") rather than a best guess; the module
  launch path (`python -m hermes_cli.main`) has no path in argv and is checked against the captured source
  root, the install-relative `PYTHONPATH`, the venv path or the cwd.
- **Surprising:** this is the strongest test in the shard — it is the thing that catches a **stale install
  answering instead of the new one**, which is the classic silent failure of an updater.

#### `tests-js/eslint.config.mjs` (4 lines)
- **Purpose:** the `tests-js` workspace's lint configuration.
- **Key abstractions:** the default export is the shared root config (`../eslint.config.shared.mjs`).
- **Non-obvious design decision:** one shared rule set for the whole monorepo, so a rule cannot drift between
  the root workspace and the JS test package. The file exists purely to make that sharing explicit.

#### `tests-js/package.json` (config, 638 bytes)
- **Purpose:** the private root test package — `typecheck`, `test` (vitest run), `lint`, `fix`, and a combined
  `check` gate.
- **Non-obvious decisions:** `"private": true`; every devDependency is **exactly pinned** (`@types/js-yaml`
  4.0.9, `@types/plist` 3.0.5, `get-windows` 9.3.0); the `check` script is `typecheck && test && lint` as one
  command, so a contributor cannot run only the part that passes.

#### `tests-js/tsconfig.json` (config, 328 bytes)
- **Purpose:** strict TypeScript config for the JS test package.
- **Non-obvious decisions:** `target ES2022` / `module ESNext` / `moduleResolution bundler`,
  `allowImportingTsExtensions` (the suite imports `.ts` files directly), `strict: true`, `noEmit: true`
  (this package only *typechecks*; it produces no build output), `types: ["node"]`.

---

### Tier 2 — bulk: the set is the unit

The 1,364 remaining files are one homogeneous kind — a test file (or its fixture/scaffold) — so the table
below is the ledger: **every file appears exactly once**, with a one-line verdict on what it pins. The
verdict is derived from each file's own docstring and case names (see the method note above). Read it as a
map of what the harness considers worth pinning, grouped by directory.

| File | What it is / what it pins |
| --- | --- |

| `tests-js/allow-scripts-sync.test.ts` | Invariants tying ``allowScripts`` to the lockfile it gates. * npm's ``allowScripts`` allowlist is keyed by exact ``name@version``, so an entry silently stops matching the moment that dependency is… Pins: every versioned pin matches a version in the lockfile; every package with an install script has an allowScripts decision. |
| `tests-js/assistant-ui-tap-compat.test.ts` | Invariant: the @assistant-ui dependency cluster agrees on one tap version. * The Hermes desktop app (``apps/desktop``) is built from source on every install/update via ``scripts/install.ps1`` → ``npm… Pins: every @assistant-ui/* package\. |
| `tests-js/bootstrap-installer-stage-timer.test.ts` | Regression for the bootstrap installer's stage timers (issue report: "it says 744 hours or minutes — I don't know how to adjust the counter"). * ``formatElapsed`` rendered a running stage as ``m:ss``… Pins: formatElapsed (live stage timer); renders bare seconds under a minute. |
| `tests-js/bundle-inputs.test.mjs` | Holds 3 cases. Pins: package transitions are ordered, identity-preserving, and report through the existing family; explicit bundled routes refuse absent package inputs instead of reporting a skipped pass. |
| `tests-js/bundle-smoke-metadata.test.mjs` | Holds 4 cases. Pins: fresh-install provenance admits tagless commit stamps without relaxing update acceptance; identity uses the production bundled variant and exact input tokens, not inherited build flags. |
| `tests-js/desktop-builder.test.mjs` | Holds 6 cases. Pins: desktop development composition reuses prepared icon pixels instead of provisioning them again; desktop development composition restages native inputs only when their receipt is stale. |
| `tests-js/desktop-mac-entitlements.test.ts` | Regression for #37718: macOS microphone entitlement must be inherited. * Hermes Desktop signs with ``hardenedRuntime: true`` and points electron-builder at two entitlement files (see… Pins: inherit plist grants microphone (regression #37718); every device.* entitlement on the main app is also inherited. |
| `tests-js/desktop-mac-usage-descriptions.test.ts` | Regression for #54551: macOS Info.plist privacy usage descriptions declared by the Desktop electron-builder config (`apps/desktop/electron-builder.config.cjs -> mac.extendInfo`) must pin every… Pins: every extendInfo value is free of leading/trailing whitespace and newlines. |
| `tests-js/e2e-matrix-route.test.ts` | Holds 4 cases. Pins: a leg name, or the job name GitHub shows for it, runs exactly that leg; an OS preset runs that OS whole and no other. |
| `tests-js/freshness-metadata.test.mjs` | Holds 1 cases. Pins: OS file-manager metadata landing in hashed trees never invalidates a recorded product. |
| `tests-js/frontend-common-publish.test.mjs` | Holds 4 cases. Pins: a held staging tree publishes once the scanner lets go; a code waiting cannot fix fails at once and keeps the previous product. |
| `tests-js/frontend-common.test.mjs` | Holds 3 cases. Pins: rmTree retries ENOTEMPTY removals until the directory clears; rmTree stops retrying after a bounded number of attempts. |
| `tests-js/generate-icons.test.mjs` | Holds 2 cases. Pins: the real wrapper builds and checks native icon artifacts in an independent output; failed icon processes cannot report a successful build. |
| `tests-js/install-e2e-red-tracker.test.mjs` | Holds 1 cases. Pins: one tracker: a red run opens it, the next red run rewrites it, a green run closes it. |
| `tests-js/install-known-failures.test.ts` | Holds 5 cases. Pins: known install failures; recognizes the released launcher self-lock, not generic access denied. |
| `tests-js/install-process-close.test.ts` | Holds 2 cases. Pins: waits for native close, not exit, and retains a close observed before hand-off; fails if the launched process never closes. |
| `tests-js/macos-bundled-helpers.test.mjs` | Holds 3 cases. Pins: codesign stderr identifies the team but never blesses an unsigned/ad-hoc signature; installed stamp independently binds payload, mechanism, commit and tag. |
| `tests-js/macos-publish-config.test.mjs` | Holds 1 cases. Pins: bakes only a canonical https feed base into the updater config. |
| `tests-js/node-deps.test.mjs` | Holds 6 cases. Pins: read-only dependency preparation reuses complete receipts but refuses missing inputs; reuse refuses a gutted package directory and repairs it with npm ci. |
| `tests-js/node-engine-alignment.test.ts` | Holds 2 cases. Pins: exact independently managed Node and npm satisfy all declared lockfile engines; lockfile workspace engine mirrors match their manifests. |
| `tests-js/notarize.test.mjs` | Holds 4 cases. Pins: accepted submissions retry only ticket propagation, without resubmitting or rebuilding; HTTP timeouts resume the same submission with notarytool wait and a shrinking budget. |
| `tests-js/package-json-lazy-deps.test.ts` | Invariants for what is eager vs lazy in the root ``package.json``. * The root ``package.json`` is installed by ``hermes update`` on every user, including users who never opted into a given browser… Pins: camofox is not in root dependencies (must stay opt-in); agent-browser is not in root dependencies (resolves via npx, #43564). |
| `tests-js/product-builders.test.mjs` | Holds 6 cases. Pins: product outputs exclude the source tree except supported generated destinations; publication replaces only builder-owned directories and rechecks ownership after compilation. |
| `tests-js/react-dom-pair-compat.test.ts` | Invariant: every workspace that renders React ships one react/react-dom pair. * React validates at import time that ``react`` and ``react-dom`` come from the same installed copy. When they don't, it… Pins: workspaces declaring react and react-dom pin them to the same exact version. |
| `tests-js/renderer-syntax-node.test.mjs` | Holds 1 cases. Pins: renderer syntax checks use the running Node without PATH and preserve explicit NODE. |
| `tests-js/scripts/desktop-smoke.test.ts` | Holds 6 cases. Pins: a later CI step\; one server owns inference and a fresh, per-server prompt witness. |
| `tests-js/scripts/desktop-transcript.test.ts` | // @vitest-environment jsdom Pins: historical and current user bubbles retain ordered fresh-turn proof; legacy extraction never invents an assistant identity or accepts incomplete replies. |
| `tests-js/scripts/launch-from-spec.test.ts` | Holds 2 cases. Pins: the update window pins its isolated route before Electron requests the singleton lock; the update window carries Hermes connection state without cloning Chromium state. |
| `tests-js/setup-pm-cache.test.mjs` | Holds 4 cases. Pins: pull requests restore the caches main saves and never write their own; only dependency-carrying callers touch the uv cache. |
| `tests-js/setup-pm-post.test.mjs` | Holds 1 cases. Pins: prunes the saved uv cache to the lock at teardown, never during registration. |
| `tests-js/source-update-observer.test.mjs` | Holds 3 cases. Pins: checkout movement and old receipts are not update completion; failed handoff fails even at target SHA; success waits for marker removal. |
| `tests-js/update-ui.test.mjs` | Holds 4 cases. Pins: checks the live Desktop bridge against the staged target before opening About; test-only source probe pins staged main without changing other Python invocations. |
| `tests-js/vitest.config.ts` | Helper module (no test cases of its own). |
| `tests-js/window-open-policy.test.ts` | Security regression for GHSA-9f4c-93c8-jc8g (CVE-2026-70608): a sandboxed iframe without `allow-popups` can reach `setWindowOpenHandler` with no user gesture, so the handler must always deny and must… Pins: window-open policy (GHSA-9f4c-93c8-jc8g); denies every scheme and reports only the sanitized origin. |
| `tests-js/windows-bundled-helpers.test.mjs` | Holds 1 cases. Pins: Windows packaged-update helper contracts run in the ordinary JS lane. |
| `tests/AGENTS.md` | Doc headings: # tests/ — how Hermes tests are written and run / ## Running tests / ## Don't fake the host OS / ## Don't write change-detector tests / ## Never read source code in tests |
| `tests/__init__.py` | Empty package marker / no cases. |
| `tests/_fixtures/__init__.py` | Topic modules of the suite-wide ``tests/conftest.py``, imported by it.""" |
| `tests/_fixtures/env_filter.py` | Env-var names the hermetic ``_hermetic_environment`` fixture blanks before every test. |
| `tests/_fixtures/live_system_guard.py` | The autouse live-system guard: no real kills, Hermes-unit systemctl writes, gateway spawns or checkout writes. |
| `tests/_fixtures/model_peer.py` | Loopback OpenAI-compatible model peer shared by the ordinary-daemon wire tests. |
| `tests/_fixtures/platform_gating.py` | Host-OS gating for ``@pytest.mark.platforms(...)``, applied by the conftest collection hook.""" |
| `tests/acp_adapter/__init__.py` | Empty package marker / no cases. |
| `tests/acp_adapter/conftest.py` | Shared fixtures for tests/acp_adapter. |
| `tests/acp_adapter/test_acp_commands.py` | Holds 6 cases. Pins: test_acp_real_agent_gets_session_db_for_recall; test_acp_steer_slash_command_injects_into_running_agent. |
| `tests/acp_adapter/test_acp_dashboard_model_switch_validation.py` | ACP ``session/set_model`` and the dashboard main slot validate through ``switch_model``. Pins: test_acp_and_dashboard_reject_what_switch_model_rejects; test_acp_explicit_provider_prefix_becomes_explicit_provider. |
| `tests/acp_adapter/test_acp_discard_review.py` | ACP ``/discard`` while a lost turn pauses the session (review #141357, GW-10). Pins: test_discard_preserves_buffered_reply; test_paused_image_refusal_does_not_stage_image. |
| `tests/acp_adapter/test_acp_image_staging_boundary.py` | prompt.submit attachments and ACP image staging stay inside the profile image cache (PR #106742 security lane).""" Pins: test_hardlink_in_staging_to_outside_file_is_refused; test_acp_image_mime_never_chooses_the_staged_extension. |
| `tests/acp_adapter/test_acp_image_strict_reject.py` | An ACP image part admission cannot carry degrades to a text note; the user's text still runs (B2-12).""" Pins: test_mislabeled_or_unadmittable_image_never_rejects_the_prompt. |
| `tests/acp_adapter/test_acp_images.py` | Holds 5 cases. Pins: test_acp_image_blocks_convert_to_openai_multimodal_content; test_text_only_acp_blocks_stay_string_for_legacy_prompt_path. |
| `tests/acp_adapter/test_acp_logging_redaction.py` | ACP adapter stderr logging must go through RedactingFormatter. Pins: test_acp_stderr_handler_redacts_secrets. |
| `tests/acp_adapter/test_acp_mcp_discovery.py` | Behavioral regression tests for ACP background MCP discovery + late-refresh. Pins: test_acp_background_discovery_does_not_block_startup; test_acp_late_refresh_adds_tools_when_discovery_lands_after_build. |
| `tests/acp_adapter/test_acp_reattach_unknown_notice.py` | A reconnect that re-attaches a session with a lost turn tells the editor at once, like load/resume (JM44 r1-P1-4), and one that finds the turn discarded admits the next prompt (#140521): real… Pins: test_reattach_after_restart_posts_the_unknown_recovery_notice; test_next_prompt_reconnects_after_the_lost_turn_was_discarded_while_offline. |
| `tests/acp_adapter/test_acp_unacked_identity_retry.py` | ACP keeps a retained submission identity through its own retry: a failed reconnect keeps an un-acked prompt's input_id, and a slash control's retry keeps its prepared request_id.""" Pins: test_failed_reconnect_keeps_the_unacked_input_id; test_slash_control_retry_after_lost_reply_is_one_mutation. |
| `tests/acp_adapter/test_adversarial_unknown_follower.py` | Terminal results cannot be replaced by a successor's unknown queue state.""" Pins: test_successor_unknown_does_not_overwrite_completed_editor_prompt. |
| `tests/acp_adapter/test_approval_isolation.py` | Tests for GHSA-96vc-wcxf-jjff and GHSA-qg5c-hvr5-hjgr. Pins: TestThreadLocalApprovalCallback; test_callback_not_visible_in_different_thread. |
| `tests/acp_adapter/test_auth.py` | Tests for acp_adapter.auth — provider detection.""" Pins: TestDetectProviderPresence; test_has_provider_false_without_credentials. |
| `tests/acp_adapter/test_catalog_read_only.py` | Browsing ACP history is not an execution/storage owner.""" Pins: test_empty_catalog_does_not_initialize_storage; test_catalog_reads_committed_history_without_schema_writes. |
| `tests/acp_adapter/test_detect_provider_entra.py` | Regression tests for ACP adapter detection under Azure Foundry Entra ID. Pins: TestDetectProviderEntra; test_callable_api_key_is_a_valid_credential. |
| `tests/acp_adapter/test_edit_approval.py` | Tests for ACP pre-edit approval gating.""" Pins: test_acp_permission_tool_call_uses_edit_kind_and_diff_content; test_requester_exception_denies_and_does_not_mutate. |
| `tests/acp_adapter/test_empty_session_persistence.py` | Only new, contentless ACP sessions are ephemeral; existing state remains durable.""" Pins: test_new_session_persists_only_when_content_exists; test_existing_empty_history_still_updates_metadata. |
| `tests/acp_adapter/test_entry.py` | Tests for acp_adapter.entry startup wiring.""" Pins: test_main_enables_unstable_protocol; test_main_skips_configured_mcp_discovery_when_requested. |
| `tests/acp_adapter/test_events.py` | Tests for acp_adapter.events — callback factories for ACP notifications.""" Pins: TestToolProgressCallback; test_duplicate_same_name_tool_calls_use_fifo_ids. |
| `tests/acp_adapter/test_failed_turn_closure.py` | A failed turn must not leave its accepted user row as the durable conversation tail. Pins: test_acp_refusal_closes_the_turn_and_is_not_replayed_into_the_next_prompt; test_failed_turn_boundary_is_idempotent_on_the_durable_tail_and_skips_context_overflow. |
| `tests/acp_adapter/test_finish_turn_finally.py` | Mid-tail failure in _finish_turn must not wedge the session running (#115588). Pins: test_finish_turn_mid_tail_failure_releases_and_drains. |
| `tests/acp_adapter/test_gateway_acp_session_end.py` | ACP v0.9 has no per-session destroy: the last viewer leaving an idle ACP session is its end (#118216). Pins: test_last_viewer_or_shutdown_ends_only_idle_acp_sessions; test_acp_session_left_mid_turn_ends_once_its_fifo_drains. |
| `tests/acp_adapter/test_gateway_attach_mode_race.py` | A first attach's reply shows the edit policy the owner enforces when it replies, not when it started. Pins: test_a_mode_change_while_the_attach_builds_its_reply_reaches_the_reply. |
| `tests/acp_adapter/test_gateway_attach_shutdown.py` | Post-attach notices (command list, context indicator) never outlive ``aclose``.""" Pins: test_aclose_stops_a_paused_post_attach_notice_before_it_reconnects. |
| `tests/acp_adapter/test_gateway_cancel_admission.py` | session/cancel cancels the ACP-owned admission, never another surface's running turn.""" Pins: test_cancel_targets_queued_acp_admission_not_the_running_generation; test_cancel_interrupts_only_when_our_admission_is_the_one_running. |
| `tests/acp_adapter/test_gateway_catalog_cwd.py` | Read-only ACP picker understands canonical column-backed cwd.""" Pins: test_catalog_prefers_canonical_cwd_without_rewriting_storage. |
| `tests/acp_adapter/test_gateway_catalog_reset_owner.py` | An explicit canonical reset on an ACP session is offered and reopened by its retained owner.""" Pins: test_reset_child_maps_to_its_owner_while_legacy_reset_histories_stay_independent. |
| `tests/acp_adapter/test_gateway_client_boundary.py` | The normal ACP constructor is a transport client, not an embedded owner.""" Pins: test_default_acp_does_not_construct_an_embedded_session_manager; test_unadvertised_acp_creation_is_not_relabelled_as_cli. |
| `tests/acp_adapter/test_gateway_compressed_reopen.py` | A compressed editor chat reopens under its logical id (real authority + SQLite, real dispatch). Pins: test_compressed_acp_chat_lists_and_reopens_under_its_logical_id. |
| `tests/acp_adapter/test_gateway_controls.py` | ACP controls retain generation fences and reject unavailable mutations.""" Pins: test_cancel_uses_observed_generation_and_mutations_fail_explicitly; test_gateway_acp_catalog_does_not_boot_a_runtime. |
| `tests/acp_adapter/test_gateway_delivery_shapes.py` | Every delivery shape the owner publishes reaches the editor exactly once, through one live pump.""" Pins: test_each_delivery_shape_reaches_the_editor_once_and_the_pump_survives. |
| `tests/acp_adapter/test_gateway_editor_clarify.py` | A canonical clarify question reaches the ACP editor and its answer reaches the model. Pins: test_editor_answers_canonical_clarify_through_clarify_respond; test_dismissed_clarify_card_releases_the_turn_with_skip. |
| `tests/acp_adapter/test_gateway_editor_cwd.py` | Editor diff preparation must use the same cwd as the actual file tool.""" Pins: test_relative_editor_diff_reads_the_session_file_not_process_cwd. |
| `tests/acp_adapter/test_gateway_editor_mcp.py` | Native ACP stdio through ordinary gateway source, real model and MCP peers. Pins: test_native_opposing_editor_mcp_survives_viewer_exit; test_native_cold_editor_rebind_applies_changed_secret. |
| `tests/acp_adapter/test_gateway_editor_mcp_held.py` | Held editor MCP connections follow the session's committed selection (#134889 ACP-8, ACP-10). Pins: test_held_server_changing_its_tools_refreezes_at_the_next_admission; test_empty_selection_closes_the_held_connections. |
| `tests/acp_adapter/test_gateway_editor_policy.py` | Frozen editor policy and execution-owned edits, without an editor process.""" Pins: test_acp_policy_uses_its_own_tools_and_restores_frozen_cwd; test_editor_guard_uses_shared_waiter_without_leaking_to_cli. |
| `tests/acp_adapter/test_gateway_editor_v4a.py` | V4A edit cards resolve every referenced path in the session workspace.""" Pins: test_v4a_permission_paths_use_execution_workspace. |
| `tests/acp_adapter/test_gateway_editor_wire.py` | Real ACP editor permissions over an ordinary daemon's canonical ACP route.""" Pins: test_acp_load_from_another_folder_moves_the_session_there; test_real_editor_diff_requires_native_consent_before_write. |
| `tests/acp_adapter/test_gateway_entry_lifecycle.py` | The ACP transport owns neither MCP discovery nor a surviving client socket.""" Pins: test_entry_closes_transport_without_discovering_mcp. |
| `tests/acp_adapter/test_gateway_event_mapping.py` | The gateway's turn events reach the editor as the in-process ACP agent projected them (#134889 ACP-5, ACP-15): native plan updates, the executor's tool verdict, closed tool and permission bubbles,… Pins: test_todo_updated_becomes_the_native_plan_update; test_an_acp_session_turn_publishes_todo_updated. |
| `tests/acp_adapter/test_gateway_launch_flags.py` | `hermes acp` launch flags freeze into the gateway session they create (#134889 ACP-13).""" Pins: test_launch_env_rides_session_create; test_safe_mode_acp_session_freezes_the_launch_model. |
| `tests/acp_adapter/test_gateway_model_pick_provider.py` | ACP ``session/set_model`` on the gateway path: the advertised ``provider:model`` id switches the session's provider too (#139165, #134889 MP-10), over the real ACP stdio wire and a real gateway.""" Pins: test_cross_provider_pick_switches_provider_and_runs_the_next_turn_there; test_pick_during_a_turn_says_it_applies_next_and_lands_there. |
| `tests/acp_adapter/test_gateway_model_provider.py` | Regression for #139165: ACP picker identity reaches canonical model mutations.""" Pins: test_picker_identity_reaches_prepared_mutation; test_prefixed_pick_preserves_mutation_failure_contract. |
| `tests/acp_adapter/test_gateway_new_cold.py` | New ACP handoff advert and unmodified cold canonical ACP restoration.""" Pins: test_native_new_with_proposed_advert_executes_canonical_acp; test_cold_acp_load_retains_policy_and_executes_after_daemon_restart. |
| `tests/acp_adapter/test_gateway_overlay_home.py` | ``hermes acp`` with a per-task overlay ``HERMES_HOME`` (#138949, #134889 ACP-18). Pins: test_overlay_home_attaches_to_the_owner_its_lock_names; test_overlay_home_image_prompt_is_staged_where_the_owner_admits_it. |
| `tests/acp_adapter/test_gateway_prompt_content.py` | ACP prompt blocks reach canonical admission with the same conversion main's server uses.""" Pins: test_image_prompt_is_staged_in_profile_cache_and_submitted_as_attachment; test_text_only_prompt_keeps_plain_submit. |
| `tests/acp_adapter/test_gateway_prompt_reoffer.py` | A shared prompt whose ACP card got no accepted answer is shown again on reattach, never auto-answered.""" Pins: test_unaccepted_card_is_reoffered_on_reattach_without_replaying_its_answer. |
| `tests/acp_adapter/test_gateway_queued_unknown.py` | Editor prompts fail recoverably when their FIFO becomes unknown.""" Pins: test_editor_follower_reports_unknown_without_poisoning_other_sessions; test_editor_refuses_new_prompt_until_lost_turn_is_resolved. |
| `tests/acp_adapter/test_gateway_reasoning.py` | Live reasoning for editors on the gateway path (#134889 ACP-4). Pins: test_every_session_the_editor_attaches_streams_its_reasoning_live; test_an_attach_asks_for_live_reasoning_before_it_replies_and_never_fails_on_it. |
| `tests/acp_adapter/test_gateway_reconnect.py` | An ACP editor survives a gateway restart: real websockets, the real GatewayClient, two owners.""" Pins: test_editor_reconnects_to_a_restarted_gateway_without_resending; test_a_recovered_snapshot_repaints_the_sessions_edit_mode. |
| `tests/acp_adapter/test_gateway_registry_commands.py` | Registry commands ACP does not answer itself, over the real ACP stdio wire and a real gateway. Pins: test_registered_commands_answer_or_refuse_by_name_never_internal_error. |
| `tests/acp_adapter/test_gateway_remote_image_submit.py` | A remote image URL is fetched once per logical prompt: an un-acked submit's retry reuses what the first attempt staged (never a re-download that could change the content and so the input_id), and the… Pins: test_unacked_remote_image_retry_reuses_the_first_staging; test_stop_during_a_remote_image_download_submits_nothing. |
| `tests/acp_adapter/test_gateway_replay_gap.py` | ACP across a ``session.replay_gap``: the pump re-attaches that session and survives; a cut prompt settles once, live or from one receipt read the pump owns; terminal evidence beats a recovery error;… Pins: test_pump_survives_and_the_editor_sees_the_reply_once; test_completion_in_delivery_beats_a_recovery_error. |
| `tests/acp_adapter/test_gateway_retry_command.py` | ACP ``/retry`` on the gateway path: real authority, SQLite and ``AuthorityConnection.dispatch`` behind ``GatewayACPAgent.prompt`` (#140190 review). Pins: test_retry_of_an_image_turn_is_the_commands_reply_and_keeps_history; test_retry_after_a_lost_snapshot_refresh_replays_the_same_rewind. |
| `tests/acp_adapter/test_gateway_session_commands.py` | ``/queue``, ``/steer`` and the edit-policy mode on the gateway path, against a fake owner.""" Pins: test_queue_submits_its_text_as_the_next_prompt; test_steer_reaches_this_editors_running_turn. |
| `tests/acp_adapter/test_gateway_session_metadata.py` | Editor session metadata and commands on the shipped gateway path (tracker ACP-1/2/3/6/7/11). Pins: test_new_session_carries_picker_modes_provenance_and_commands; test_editor_commands_reply_and_turns_report_usage_and_title. |
| `tests/acp_adapter/test_gateway_sessions.py` | Actual ACP stdio and WS clients against an ordinary isolated gateway.""" Pins: test_acp_transport_shares_canonical_history_and_order; test_acp_permission_detach_keeps_canonical_waiter. |
| `tests/acp_adapter/test_gateway_slash_text.py` | Only registered Hermes commands are slash commands; other text starting with '/' is a prompt.""" Pins: test_path_and_unknown_slash_text_is_submitted_as_the_prompt; test_registered_command_the_owner_refuses_is_a_named_reply_not_a_failed_prompt. |
| `tests/acp_adapter/test_gateway_snapshot_adoption.py` | Every fresh ``session.resume`` the editor installs advances the event watermark, so a ``session.info`` queued behind it (another viewer's mode change) is skipped by the pump. Each such install… Pins: test_a_mode_change_queued_behind_a_new_watermark_still_repaints_the_editor. |
| `tests/acp_adapter/test_gateway_submit_retry.py` | An editor retry of a prompt whose submit ack was lost reuses its identity: one admission, one turn.""" Pins: test_retry_after_lost_submit_ack_is_one_admission; test_repeated_prompt_after_other_work_is_new_work. |
| `tests/acp_adapter/test_gateway_terminal_projection.py` | Terminal ACP responses describe the exact admission, not the session's latest turn.""" Pins: test_cancelled_admission_suppresses_only_interrupt_metadata; test_refused_reattach_after_a_replay_gap_still_fails_the_pump. |
| `tests/acp_adapter/test_gateway_terminal_receipt_claim.py` | A retried submit's terminal receipt and the live message.complete deliver one reply between them.""" Pins: test_live_completion_during_the_receipt_editor_update_is_not_shown_twice; test_receipt_shows_only_what_the_live_stream_did_not. |
| `tests/acp_adapter/test_gateway_tool_projection.py` | Live ACP tool events carry the same identity, arguments and result the replay shows.""" Pins: test_live_tool_events_project_exactly_like_replay; test_gateway_publishes_tool_arguments_and_result_for_live_viewers. |
| `tests/acp_adapter/test_gateway_unacked_slash.py` | Slash work retires an un-acked prompt's retained identity: a later identical prompt is new work.""" Pins: test_repeated_prompt_after_slash_command_is_new_work. |
| `tests/acp_adapter/test_gateway_voice_stopped.py` | TUI-26: the owner's canonical prompt.submit may answer ``{voice_stopped: true}`` (a bare stop phrase typed into a LOCAL session whose owner /voice mode is on: the voice chat ends and nothing is… Pins: test_acp_prompt_settles_a_voice_stopped_reply_as_an_ended_turn. |
| `tests/acp_adapter/test_gateway_wire_controls.py` | Additional real-wire controls for the ACP authority client.""" Pins: test_profile_mismatch_refuses_before_creation; test_real_acp_answer_resolves_the_exact_pending_control. |
| `tests/acp_adapter/test_mcp_e2e.py` | End-to-end tests for ACP MCP server registration and tool-result reporting. Pins: TestMcpRegistrationE2E; test_session_with_mcp_servers_registers_tools. |
| `tests/acp_adapter/test_named_provider_catalogs.py` | Tests for named user-defined provider entries in the ACP model selector. Pins: TestNamedCustomProviderCatalogs; test_live_discovery_extends_declared_models. |
| `tests/acp_adapter/test_permissions.py` | Tests for acp_adapter.permissions.""" Pins: TestApprovalBridge; test_bridge_schedules_request_on_the_given_loop. |
| `tests/acp_adapter/test_ping_suppression.py` | Tests for acp_adapter.entry._BenignProbeMethodFilter. Pins: test_filter_suppresses_benign_probe; test_filter_allows_different_message_even_for_ping. |
| `tests/acp_adapter/test_policy_identity_compat.py` | Absent optional editor state cannot revoke an older credential reference.""" Pins: test_policy_identity_preserves_pre_editor_credential_binding. |
| `tests/acp_adapter/test_retained_identity_retirement.py` | Class: a retained submission identity (an un-acked prompt's input_id, a prepared control's request_id) is only for the retry that is the session's very next verb. Every native surface that retains… Pins: test_a_repeated_control_after_other_work_is_new_work; test_a_repeated_prompt_after_a_control_is_new_work. |
| `tests/acp_adapter/test_runtime_identity.py` | Runtime identity contracts for ACP's human and machine surfaces.""" Pins: test_version_flag_displays_derived_version; test_version_slash_command_displays_derived_version. |
| `tests/acp_adapter/test_server.py` | Tests for acp_adapter.server — HermesACPAgent ACP server.""" Pins: test_new_session_exposes_edit_approvals_as_modes_not_config_options; test_set_config_option_persists_edit_approval_policy_without_advertising_config. |
| `tests/acp_adapter/test_session.py` | Tests for acp_adapter.session — SessionManager and SessionState.""" Pins: TestCreateSession; test_create_session_returns_state. |
| `tests/acp_adapter/test_session_construction_off_loop.py` | ACP session construction runs off the event loop. Pins: test_new_session_keeps_the_event_loop_free; test_handlers_restore_unknown_sessions_off_the_loop. |
| `tests/acp_adapter/test_session_cwd_column.py` | ACP sessions must populate the cwd COLUMN, not only model_config. Pins: test_created_session_records_cwd_in_its_own_column; test_cwd_is_promoted_when_the_row_already_exists. |
| `tests/acp_adapter/test_session_db_private_access.py` | Tests for the update_session_meta fix. Pins: TestUpdateSessionMeta; test_updates_model_config. |
| `tests/acp_adapter/test_session_mcp_branch_gate.py` | A fork's editor MCP discovery runs only after the branch's own fences pass (#134889 ACP-12). Pins: test_stale_branch_starts_no_editor_server; test_busy_branch_starts_no_editor_server. |
| `tests/acp_adapter/test_session_mcp_frozen.py` | Selected editor schemas never refresh inside an execution or escape discovery.""" Pins: test_editor_manifest_stays_frozen_across_live_refresh; test_editor_freeze_follows_the_connection_owner_not_the_callers_scope. |
| `tests/acp_adapter/test_session_mcp_ownership.py` | The gateway owns each session's editor MCP servers as session state (#134889 ACP-8/ACP-10). Pins: test_changed_credentials_with_equal_schemas_keep_the_manifest; test_changed_schema_is_reported_as_a_manifest_change. |
| `tests/acp_adapter/test_session_mcp_policy.py` | Editor MCP credentials are borrowed and tools are frozen per canonical owner.""" Pins: test_opposing_editors_freeze_tools_and_release_only_their_session; test_cold_editor_rebind_requires_exact_borrowed_config. |
| `tests/acp_adapter/test_session_mcp_selection.py` | Which editor MCP servers a session freezes, and under which names (#134889 ACP-8, ACP-9).""" Pins: test_a_broken_editor_server_is_left_out_of_the_session; test_editor_tool_names_keep_the_server_name. |
| `tests/acp_adapter/test_session_mcp_workspace_move.py` | A held editor connection follows a committed workspace move (#134889 ACP-12). Pins: test_workspace_move_respawns_held_stdio_servers_in_the_new_folder. |
| `tests/acp_adapter/test_session_provenance.py` | Tests for ACP session-provenance derivation (issue #33617). Pins: test_root_session_no_compression; test_compression_split_continuation. |
| `tests/acp_adapter/test_session_reasoning_config.py` | ACP sessions honor the configured reasoning setting (#85153). Pins: test_acp_agent_receives_configured_reasoning; test_acp_agent_receives_custom_provider_request_body. |
| `tests/acp_adapter/test_tools.py` | Tests for acp_adapter.tools — tool kind mapping and ACP content building.""" Pins: TestToolKindMap; test_unknown_tool_returns_other_kind. |
| `tests/ci/_gha_expr.py` | A small evaluator for the GitHub Actions expression subset our workflows gate on. |
| `tests/ci/desktop_release_roles.py` | Find desktop release workflow jobs by what they do, not by their ids. |
| `tests/ci/test_assemble_review_comment.py` | Tests for scripts/ci/assemble_review_comment.py. Pins: test_statuses_empty_json; test_statuses_bad_json. |
| `tests/ci/test_channel_build_publication.py` | Execute channel workflow seams and receipt transport; fixture bytes are not native qualification.""" Pins: test_channel_handoff_binds_full_request_and_feed_bytes; test_scoped_receiver_publication_preserves_existing_head_and_requires_smoke. |
| `tests/ci/test_check_blob_size.py` | scripts/ci/check_blob_size.py on real temp git repos: what a PR may add, and what it may not.""" Pins: test_verdict; test_pure_move_adds_no_bytes_but_move_with_edit_is_judged. |
| `tests/ci/test_check_catalog_cors.py` | scripts/ci/check_catalog_cors.py against a loopback docs host that redirects like the real one.""" Pins: test_redirect_without_cors_header_fails_the_probe; test_redirect_with_cors_header_reaches_the_catalog. |
| `tests/ci/test_check_os_marker_fakes.py` | The unmarked-macOS-fake guard (#111866): flags fakes, ignores honest reads and marked files.""" Pins: test_unmarked_fake_is_flagged_marked_and_opted_out_are_not; test_host_honest_platform_read_is_not_a_fake. |
| `tests/ci/test_classify_changes.py` | Tests for scripts/ci/classify_changes.py. Pins: test_classify; test_run_e2e_label_turns_every_slow_lane_on_and_nothing_else. |
| `tests/ci/test_clean_worktree_check.py` | Every job of the main CI lanes ends by checking that it left the checkout clean. Pins: test_every_checkout_job_ends_with_the_clean_worktree_step; test_no_workflow_overrides_the_master_switch. |
| `tests/ci/test_commit_build_staging.py` | Execute commit staging and summary steps against a disposable object store.""" Pins: test_failed_commit_summary_publishes_downloads_or_run_links; test_commit_staging_and_summary_bind_every_produced_file_without_channels. |
| `tests/ci/test_desktop_bundle_smoke.py` | Replay artifact handoffs and publication against a fake R2.""" Pins: test_public_smoke_fetches_the_receipt_bound_native_format; test_download_faults_never_export_an_accepted_artifact. |
| `tests/ci/test_desktop_release_commit_admission.py` | Commit-build admission rejects mixed inputs before repository code runs.""" Pins: test_mixed_dispatch_is_refused_before_loading_repository_code; test_trusted_dispatch_admits_a_pushed_feature_without_switching_checkout. |
| `tests/ci/test_desktop_release_tag_admission.py` | Tag admission for .github/workflows/desktop-bundled-release.yml (plan item 7). Pins: test_validate_exports_the_admitted_sha_as_a_job_output; test_signing_jobs_pin_source_and_controller_revisions_not_mutable_tags. |
| `tests/ci/test_desktop_store_eligibility.py` | Execute the packaging workflow branches; nonstable never builds Store identities.""" Pins: test_bundle_only_requests_store_for_stable; test_native_windows_build_selects_store_only_for_stable. |
| `tests/ci/test_docs_drift.py` | Docs drift ratchet: every DEFAULT_CONFIG key and slash command is documented, or baselined. Pins: test_no_new_undocumented_config_keys_or_slash_commands; test_detects_each_documentation_form. |
| `tests/ci/test_e2e_screenshot_status.py` | Tests for scripts/ci/e2e_screenshot_status.py.""" Pins: test_status_selects_only_new_explicit_screenshots_and_all_diffs; test_cli_output_ends_with_newline_for_github_output_delimiter. |
| `tests/ci/test_e2e_strict_acceptance.py` | Delivery gap guards must not excuse failures owned by a strict acceptance run.""" Pins: test_delivery_gap_respects_strict_owner_scope; test_delivery_guard_preserves_clean_passes_and_unrelated_errors. |
| `tests/ci/test_e2e_tmux_required.py` | The release/dispatch E2E lane fails, not skips, when the classic-CLI tmux suites lose tmux. Pins: test_missing_tmux_fails_in_the_ci_e2e_lane; test_missing_tmux_skips_outside_the_ci_e2e_lane. |
| `tests/ci/test_list_os_marked_tests.py` | Tests for scripts/ci/list_os_marked_tests.py. Pins: test_finds_decorator_and_pytestmark_forms; test_negated_spec_lists_for_that_lane. |
| `tests/ci/test_live_comment.py` | Tests for scripts/ci/live_comment.py run selection. Pins: test_selects_only_named_workflows; test_keeps_newest_attempt_per_workflow. |
| `tests/ci/test_lockfile_diff.py` | Tests for scripts/ci/lockfile_diff.py. Pins: test_add_remove_update_all_detected; test_nested_dedup_is_distinct_entry. |
| `tests/ci/test_messaging_gated_selection.py` | Dependency-gated gateway cases run in a job that has their dependency. Pins: test_every_messaging_gated_gateway_file_runs_in_the_messaging_job. |
| `tests/ci/test_pending_fixes_strict.py` | ``known_failure`` under strict acceptance: the gap fails the run instead of XFAILing. Pins: test_gap_still_open; test_other_failure_is_never_excused. |
| `tests/ci/test_plugin_catalog_ci_confinement.py` | The catalog admission gate must validate the pinned clone's own files only. Pins: test_bypass_fails_the_gate; test_one_entry_cannot_skip_or_impersonate_the_others. |
| `tests/ci/test_plugin_validate_action.py` | The external action must never install Hermes into the plugin checkout.""" Pins: test_external_validator_checkout_uses_requested_ref_and_preserves_caller. |
| `tests/ci/test_prompt_surface.py` | The committed prompt-surface snapshot is exactly what the code renders. Pins: test_committed_prompt_surface_is_current; test_summary_names_the_surface_and_tool_that_changed. |
| `tests/ci/test_protected_canary_publication.py` | Execute protected canary workflow/controller with local Git and HTTP only. Pins: test_canary_metadata_is_recorded_and_receipt_bound; test_published_canary_workflow_advances_only_after_every_gate. |
| `tests/ci/test_required_results.py` | Behavior tests for the strict CI aggregate gate (scripts/ci/required_results.py).""" Pins: test_status_policy; test_selected_update_consumers_must_succeed. |
| `tests/ci/test_stable_release_commit_threading.py` | Stable runs on the default branch, so every lane must be told which commit to test.""" Pins: test_every_reusable_lane_accepts_a_commit; test_every_call_forwards_the_commit. |
| `tests/ci/test_stable_release_graph.py` | The release workflow's dependency graph enforces publication ordering.""" Pins: test_admit_can_read_the_claim_draft; test_release_reuses_whole_ci_and_docker_before_publication. |
| `tests/ci/test_strict_ruff_target.py` | The strict lint config may only rewrite code to syntax the oldest supported Python runs. Pins: test_strict_ruff_target_is_the_supported_python_floor. |
| `tests/ci/test_tag_builds_summary.py` | Run the tagged-build summary step against a disposable R2 transport.""" Pins: test_admitted_failure_publishes_tag_info_without_promoting_channel. |
| `tests/ci/test_termux_input_archive.py` | CI runs archival before the exact tool and payload consumers.""" Pins: test_archive_reader_accepts_bom_without_changing_pin_authority; test_archive_gate_uses_bootstrap_python_and_trusted_exact_revision. |
| `tests/ci/test_timings_report.py` | Tests for scripts/ci/timings_report.py — generate_review_status(). Pins: test_no_baseline_is_debug; test_no_regression_is_debug. |
| `tests/ci/test_update_ci_routing.py` | Update-path CI routing: ownership-derived selectors and the full dispatch chain. Pins: test_replay_evaluator_follows_actions_semantics; test_every_set_lane_reaches_its_consumer_whatever_the_other_lanes_say. |
| `tests/ci/test_update_transitive_routing.py` | Executed second-hop update dependencies must retain their real-update routes. Pins: test_second_hop_update_change_dispatches_real_update_consumers; test_update_migration_on_a_journey_home_runs_no_plugin_install_code. |
| `tests/ci/test_windows_update_crash_oracles.py` | The Windows update E2E, judged on this OS: the workflow's selection runs every cell, and a verdict the crash cells can only reach on a Windows runner says pass exactly when the user's update was what… Pins: test_windows_update_workflow_selects_every_test_of_the_suite; test_kill_point_counts_only_an_update_killed_while_running. |
| `tests/ci/test_workflow_job_graph.py` | A job reads another job's result only through a `needs` entry it declares. Pins: test_jobs_only_read_declared_dependencies; test_no_workflow_runs_from_a_tag_push. |
| `tests/ci/workflow_steps.py` | Local receipts for the few safe routing steps, NOT a hosted workflow runner. |
| `tests/compat/README.md` | Doc headings: # Running updater compatibility / ## Runtime behavior / ## Manual review of dynamic edges |
| `tests/compat/old_updater_dependencies.py` | Frozen historical updater function, executed by test_old_updater_shims. |
| `tests/compat/old_updater_support.py` | Shared guards for historical exports; real child execution lives in test_old_updater_takeover.""" Pins: check_import. |
| `tests/compat/old_updater_surface.json` | JSON head: { / "_comment": "Baseline generated by scripts/audit-old-updater-imports.py --freeze; additively extended with the same audit engine over complete trees of every newly reachable shipped… |
| `tests/computer_use/driver_fixture.py` | Independent CUA process fixture shared by selection and doctor callers.""" |
| `tests/computer_use/live_cua_0_9_smoke.py` | Opt-in macOS smoke test for the installed cua-driver live MCP contract. |
| `tests/computer_use/test_cua_atexit_teardown.py` | Tests for cua-driver subprocess teardown on interpreter exit. Pins: TestAtexitTeardown; test_shutdown_stops_every_session_backend. |
| `tests/computer_use/test_cua_no_overlay.py` | Tests for the cua-driver --no-overlay policy. Pins: TestNoOverlayFlag; test_explicit_true_overrides. |
| `tests/computer_use/test_cua_perf_knobs.py` | Behavior contracts for computer_use latency knobs.""" Pins: test_aux_vision_route_follows_a_config_change_without_restart. |
| `tests/computer_use/test_cua_pm_selection.py` | CUA selection uses PM facts, never a second installer or stale vendor tree.""" Pins: test_pm_selection_ignores_vendor_tree_and_is_passive; test_setup_acquires_through_pm_and_validates_real_manifest. |
| `tests/computer_use/test_cua_spawn_env_sanitization.py` | Regression tests: every remaining cua-driver spawn site must sanitize the subprocess environment. Pins: test_resolve_mcp_invocation_sanitizes_env; test_runtime_contract_check_sanitizes_env. |
| `tests/computer_use/test_cua_telemetry.py` | Tests for the cua-driver telemetry opt-in policy. Pins: TestTelemetryDisabledFlag; test_explicit_false_disables. |
| `tests/computer_use/test_cua_wayland_env.py` | Holds 2 cases. Pins: test_configured_native_wayland_reaches_linux_wayland_child; test_native_wayland_not_injected_without_wayland_display_or_opt_in. |
| `tests/computer_use/test_cua_wsl_manifest_path.py` | Holds 2 cases. Pins: test_wsl_windows_manifest_path_translates_to_drvfs; test_resolve_mcp_invocation_normalizes_windows_manifest_command_in_wsl. |
| `tests/computer_use/test_doctor.py` | Tests for ``tools.computer_use.doctor``. Pins: TestDoctorExitCodes; test_ok_exits_0. |
| `tests/computer_use/test_permissions_resolution.py` | Computer Use readiness resolves PM state even under a thin GUI PATH.""" Pins: test_status_finds_pm_driver_when_path_omits_it; test_status_missing_pm_binary_is_unknown. |
| `tests/conformance/__init__.py` | Empty package marker / no cases. |
| `tests/conformance/persistence/README.md` | Doc headings: # Crash/resume persistence conformance cells / ## Cells / ## Method / ## Semantics / #80337 forensics established). A failing cell is a *fire**: report it on / #80921 with the cell's… |
| `tests/conformance/persistence/__init__.py` | Empty package marker / no cases. |
| `tests/conformance/persistence/_harness.py` | Shared harness for the crash/resume persistence conformance cells (#80921). |
| `tests/conformance/persistence/test_cell1_prefix_durability.py` | Cell 1 — prefix continuation + recovery determinism under real SIGKILL. Pins: test_acknowledged_appends_survive_sigkill. |
| `tests/conformance/persistence/test_cell2_consume_once.py` | Cell 2 — consume-once under cross-process concurrent delivery. Pins: test_exactly_one_claimant_wins. |
| `tests/conformance/persistence/test_cell3_rotation_atomicity.py` | Cell 3 — crash mid-compression-rotation: the atomic-publication contract. Pins: test_rotation_is_atomic_under_sigkill. |
| `tests/conformance/persistence/test_cell5_delivery_outbox_exactly_once.py` | Cell 5 — effect exactly-once across the delivery-outbox boundary. Pins: test_crash_between_send_and_record_never_double_delivers; test_boot_killed_inside_plain_redelivery_never_double_delivers. |
| `tests/conformance/test_profile_write_tripwire.py` | Profile-isolation write tripwire: no cross-profile writes to the default home. Pins: test_no_default_profile_writes. |
| `tests/conformance/test_vector_generator.py` | Conformance vector generator tests (Phase 5 oracle workstream). Pins: test_corpus_ids_unique_and_categorized; test_oracles_importable_and_self_free. |
| `tests/conformance/vectors/discord.json` | JSON head: { / "$comment": "GENERATED — do not hand-edit. Regenerate with hermes-agent scripts/generate_conformance_vectors.py; the native renderers are the oracle (executable spec).", / "oracle": {… |
| `tests/conformance/vectors/slack.json` | JSON head: { / "$comment": "GENERATED — do not hand-edit. Regenerate with hermes-agent scripts/generate_conformance_vectors.py; the native renderers are the oracle (executable spec).", / "oracle": {… |
| `tests/conformance/vectors/telegram.json` | JSON head: { / "$comment": "GENERATED — do not hand-edit. Regenerate with hermes-agent scripts/generate_conformance_vectors.py; the native renderers are the oracle (executable spec).", / "oracle": {… |
| `tests/conformance/vectors/whatsapp.json` | JSON head: { / "$comment": "GENERATED — do not hand-edit. Regenerate with hermes-agent scripts/generate_conformance_vectors.py; the native renderers are the oracle (executable spec).", / "oracle": {… |
| `tests/conftest.py` | Shared fixtures for the hermes-agent test suite. |
| `tests/cron/__init__.py` | Empty package marker / no cases. |
| `tests/cron/conftest.py` | Cron-test fixtures. |
| `tests/cron/test_agent_scheduling_gate.py` | Behavior contract for the cron.allow_agent_scheduling config gate. Pins: TestGateOffDefault; test_empty_config_denies_cronjob. |
| `tests/cron/test_atomic_paused_creation.py` | Creation is either armed normally or durably paused before registration.""" Pins: test_paused_creation_is_inert_until_operator_action; test_invalid_creation_is_rejected_without_writes. |
| `tests/cron/test_blueprint_catalog.py` | Tests for Automation Blueprints — the parameterized automation blueprint system. Pins: TestCatalog; test_bad_slot_type_rejected. |
| `tests/cron/test_bot_chat_delivery_no_owner.py` | A Bot Chat cron delivery whose target owner is not running is parked, never booked failed: a later tick admits it to the owner once, under the same delivery id.""" Pins: test_bot_chat_target_without_live_owner_is_parked_and_admitted_later. |
| `tests/cron/test_bot_chat_legacy_isolation.py` | One malformed legacy ``cron/bot_chat_pending`` record must not stop the profile's cron. Pins: test_corrupt_legacy_record_is_isolated_and_due_job_still_fires. |
| `tests/cron/test_canonical_completion_retention.py` | A recurring canonical cron job's completion tombstones stay bounded: an id is retired once its admission journal is gone (nothing can replay it), never while recovery could still replay it.""" Pins: test_completion_ids_retire_with_their_journal. |
| `tests/cron/test_canonical_cron.py` | Agent cron must enter the owner before importing any agent-side storage.""" Pins: test_agent_cron_is_transport_only_and_refuses_without_owner; test_owner_ticker_uses_direct_admission_without_loopback. |
| `tests/cron/test_canonical_firer_give_up.py` | An in-gateway firer that gives up on a canonical run records its own attempt as given up.""" Pins: test_given_up_fire_leaves_its_attempt_recoverable_not_running. |
| `tests/cron/test_canonical_receipt_bookkeeping.py` | Canonical cron recovery settles attempts and never re-pauses an explicitly resumed job.""" Pins: test_recovered_receipt_finishes_foreign_execution_and_is_idempotent; test_definite_refusal_is_booked_and_journal_retired. |
| `tests/cron/test_catchup_policy.py` | The local missed-run policy preserves grace and manual triggers.""" Pins: test_missed_policy_preserves_grace_and_manual; test_default_and_uncomputable_still_catch_up. |
| `tests/cron/test_claim_job_for_fire.py` | Tests for the store-level CAS fire claim (Phase 4C). Pins: test_claim_succeeds_once_then_blocks; test_claim_oneshot_cannot_be_double_claimed. |
| `tests/cron/test_cleanup_timeout.py` | Regression tests for bounded cron post-run cleanup. Pins: test_run_job_bounds_sessiondb_finalization; test_agent_teardown_is_bounded. |
| `tests/cron/test_codex_execution_paths.py` | Holds 1 cases. Pins: test_cron_run_job_codex_path_handles_internal_401_refresh. |
| `tests/cron/test_compute_next_run_dst.py` | Regression: ``compute_next_run`` must hold a cron job's wall-clock hour in the configured IANA timezone across DST. Pins: TestCronNextRunHoldsConfiguredWallClock; test_dst_transition_days_fire_at_9am_local. |
| `tests/cron/test_compute_next_run_last_run_at.py` | Test that compute_next_run uses last_run_at for cron jobs. Pins: TestCronComputeNextRunUsesLastRunAt; test_cron_uses_last_run_at_for_every_6h_schedule. |
| `tests/cron/test_context_from_response_extraction.py` | context_from must inject the previous run's answer, not its prompt (#117290). Pins: TestResponseSurvivesLongPrompt; test_long_prompt_archive_keeps_response. |
| `tests/cron/test_continuity_silent_audits.py` | Silent audit records must not replace useful continuity output (#104541).""" Pins: test_silent_audits_preserve_latest_payload; test_audit_only_history_is_empty_but_errors_remain_context. |
| `tests/cron/test_cron_bot_chat_create_if_missing.py` | Cron Bot Chat delivery creates the profile's canonical Bot Chat when it does not exist yet. Pins: test_cron_bot_chat_delivery_creates_the_missing_bot_chat_and_admits. |
| `tests/cron/test_cron_bot_chat_delivery.py` | Bot Chat cron delivery: deliver='bot-chat[:<profile>]' injects job output into a local profile's canonical Bot Chat session as a real inbound turn. Pins: test_bare_token_targets_own_profile; test_named_token_returns_profile. |
| `tests/cron/test_cron_context_from.py` | Tests for cron job context_from feature (issue #5439 Option C).""" Pins: TestJobContextFromField; test_create_job_with_context_from_string. |
| `tests/cron/test_cron_created_delivery.py` | Create-time delivery resolution for cron-context job creation. Pins: TestCronContextDeliveryResolution; test_omitted_deliver_resolves_to_creator_target. |
| `tests/cron/test_cron_delivery_redaction.py` | Cron output is secret-redacted on every outward lane, fail-closed. Pins: test_every_outward_lane_masks_secret_in_payload_and_job_name; test_delivery_redaction_is_forced_and_fails_closed. |
| `tests/cron/test_cron_direct_api_call.py` | Regression guard for #62151 — gateway cron must not wedge on 2nd+ API call. Pins: test_direct_api_call_keeps_activity_alive_during_slow_wait; test_direct_api_call_heartbeat_stops_on_exception. |
| `tests/cron/test_cron_direct_api_call_watchdog.py` | Regression guard for #80759 — the inline non-streaming call must be bounded. Pins: test_stalled_inline_call_is_aborted_and_raises_retryable_timeout; test_inline_cron_openai_codex_keeps_large_context_stale_floor. |
| `tests/cron/test_cron_emfile_stall.py` | Regression tests for #87644 — cron scheduler silently stalls after EMFILE. Pins: TestTickLockEmfileNotSwallowed; test_lock_open_emfile_raises_instead_of_silent_skip. |
| `tests/cron/test_cron_empty_payload.py` | Regression tests for empty-payload cron jobs (incident a5e29e688dc0). Pins: test_create_job_rejects_empty_payload; test_create_job_rejects_blank_script_and_blank_skills. |
| `tests/cron/test_cron_empty_turn_stays_silent.py` | An abnormal empty turn (``empty_response_exhausted``) is delivered as silence, not as a '⚠️ Cron ... failed' alert: the finalizer stamps ``failure_reason`` for the UI but keeps ``failed`` False, and… Pins: test_empty_response_exhausted_turn_delivers_silence_not_a_failure_alert; test_a_failed_turn_still_raises_so_the_job_is_marked_failed. |
| `tests/cron/test_cron_execution_identity.py` | Plugins can tell which cron execution they run inside (#130722).""" Pins: test_tool_hook_in_a_ticked_job_sees_its_execution_and_none_outside; test_identity_is_scoped_and_not_inherited_by_delegated_children. |
| `tests/cron/test_cron_explicit_empty_toolsets.py` | An explicitly-set EMPTY per-job toolset allowlist must mean 'nothing allowed' end to end. Pins: test_create_persists_explicit_empty_allowlist_and_survives_reload; test_update_path_preserves_explicit_empty_allowlist. |
| `tests/cron/test_cron_failure_deliver.py` | Per-job ``failure_deliver`` routing (NS-788). Pins: TestFailureDeliverRouting; test_failure_without_failure_deliver_goes_to_deliver_targets. |
| `tests/cron/test_cron_failure_notice_copy.py` | User-facing cron failure notices: plain words, the real output path, and the exact `hermes cron` command to act on. Contract tests, not snapshots (root AGENTS.md). Pins: test_auth_failure_names_the_pinned_provider_and_the_failing_profile; test_rate_and_usage_limit_phrases_still_yield_a_provider_notice. |
| `tests/cron/test_cron_failure_summarizer_inactivity.py` | _summarize_cron_failure_for_delivery must not mislabel the scheduler's own inactivity-timeout abort as a provider/fallback-chain failure, and must not claim a fallback chain was "exhausted" when none… Pins: test_inactivity_timeout_is_not_reported_as_provider_timeout; test_genuine_provider_timeout_with_no_fallback_configured. |
| `tests/cron/test_cron_home_target_profile_scope.py` | Regression: multiplex cron delivery destination must follow the OWNING profile. Pins: TestHomeTargetFollowsOwningProfile; test_chat_id_resolves_from_profile_scope_not_process_env. |
| `tests/cron/test_cron_import_error_skew_hint.py` | Import-class cron failures name gateway code skew when it exists (#95294). Pins: test_import_error_with_skew_names_shas_and_the_restart_command; test_import_error_without_skew_stays_a_plain_import_message. |
| `tests/cron/test_cron_inactivity_timeout.py` | Tests for the cron inactivity watchdog loop (runs on its own daemon thread).""" Pins: TestInactivityWatchdogLoop; test_fires_when_idle_crosses_limit. |
| `tests/cron/test_cron_incidents.py` | Durable cron failure incidents: signature dedup, lifecycle, ack, CLI.""" Pins: test_new_failure_creates_incident_and_is_new; test_incidents_list_newest_instant_first_across_dst_fall_back. |
| `tests/cron/test_cron_incidents_resolve.py` | A successful run resolves the job's open incidents; the same error afterwards re-opens them. Pins: test_successful_run_resolves_open_incidents_and_a_repeat_reopens_them; test_operator_ack_survives_a_successful_run. |
| `tests/cron/test_cron_journal_terminal_exits.py` | Bug class: a canonical cron firer books its own terminal ledger row on a non-completion exit (ownership lost, shutdown interrupt, crashed tail) but leaves the admission journal behind; receipt… Pins: test_firer_booked_exit_is_not_replayed_by_receipt_recovery. |
| `tests/cron/test_cron_kanban_env_isolation.py` | Cron sessions must not inherit a kanban worker's dispatcher identity. Pins: TestDispatcherOwnedPredicate; test_false_inside_non_dispatcher_context. |
| `tests/cron/test_cron_live_bot_delivery.py` | Cron admission must not become a second writer or a completed-delivery claim.""" Pins: test_live_delivery_retry_keeps_receipt_across_owner_loss; test_result_records_pending_until_terminal_receipt. |
| `tests/cron/test_cron_live_delivery_confirmation.py` | Live-adapter delivery confirmation for cron (#77763). Pins: TestConfirmAdapterDelivery; test_none_is_not_delivered. |
| `tests/cron/test_cron_manage_profile_scope.py` | cron.manage optional ``profile`` param — per-profile store scoping. Pins: test_cron_manage_profile_reads_that_profiles_store; test_cron_manage_unknown_profile_errors. |
| `tests/cron/test_cron_mcp_toolset_empty_block.py` | A cron job whose ``enabled_toolsets`` names an MCP server that resolves to zero tools is blocked as ``blocked_config`` instead of running tool-less and booking success (#109050). Pins: test_requested_mcp_server_owned_by_other_profile_blocks_run; test_requested_mcp_server_with_tools_runs. |
| `tests/cron/test_cron_memory_contract.py` | Contract pin: cron <-> persistent-memory loading. Pins: TestCronMemoryContractOff; test_config_disabled_toolsets_denies_memory. |
| `tests/cron/test_cron_multiplex_desktop_ticker_scope.py` | Regression tests for #100489 — desktop multiplex ticker must not deliver a secondary profile's cron output through the default profile's identity. Pins: test_standalone_fallback_pool_keeps_profile_scope; test_multiplex_ticker_profile_gate_skips_rejected_profile. |
| `tests/cron/test_cron_multiplex_inflight_release.py` | One process ticks every profile: a claim must be released under the key it was registered with. Pins: test_pool_worker_release_clears_the_ticked_profiles_claim; test_a_profiles_release_never_clears_another_profiles_claim. |
| `tests/cron/test_cron_multiplex_liveness_and_pools.py` | Per-home cron liveness and worker-pool lifetime under one multiplexing process. Pins: TestPerProfileJobLiveness; test_is_job_running_answers_for_the_asking_profile_only. |
| `tests/cron/test_cron_multiplex_profile_route_preflight.py` | Multiplex profile_routes must rescue cron preflight from false blocks. Pins: TestRoutedSatellitePreflight; test_routed_platform_passes_preflight. |
| `tests/cron/test_cron_multiplex_served_profile_parity.py` | Standalone-vs-served parity for the cron subsystem under ``gateway.multiplex_profiles``. Pins: test_cron_env_settings_resolve_from_the_served_profile; test_child_env_for_served_profile_drops_launch_profile_settings. |
| `tests/cron/test_cron_multiplex_shared_route_delivery.py` | Regression tests for #101113 — a credentialless satellite profile under ``gateway.profile_routes`` delivers cron output through the PRIMARY adapter for exactly the targets the primary routes to it,… Pins: test_satellite_routes_exact_target_through_primary_adapter; test_shared_view_is_falsy_without_routes_or_primary_adapters. |
| `tests/cron/test_cron_multiplex_tick_ownership.py` | One host process ticks every profile: cron ownership and state must be per profile. Pins: TestPerProfileInflightState; test_same_job_id_in_two_profiles_does_not_collide. |
| `tests/cron/test_cron_next_run_profile_timezone.py` | Regression test for #97905 / carrier PR #92489. Pins: test_foreign_process_tick_persists_owning_profile_offset. |
| `tests/cron/test_cron_no_agent.py` | Tests for cronjob no_agent mode — script-driven jobs that skip the LLM. Pins: test_create_job_no_agent_requires_script; test_script_must_be_a_file_under_scripts_dir_not_a_shell_command. |
| `tests/cron/test_cron_non_push_origin.py` | Cron deliver=origin on a non-push surface (#69304). Pins: test_non_push_session_stamps_no_origin_and_gets_creation_notice; test_stamped_api_server_origin_falls_back_to_home_channel. |
| `tests/cron/test_cron_origin_synthetic_thread.py` | Cron origin capture: Slack per-message session-key threads are not routing. Pins: TestSlackSyntheticThreadCapture; test_synthetic_slack_thread_not_captured. |
| `tests/cron/test_cron_pinned_job_fallback.py` | A cron job with its own provider/model/base_url pin never walks the global fallback chain (#100437). Pins: test_pinned_job_primary_auth_failure_does_not_land_on_the_global_chain; test_pinned_job_dns_blip_does_not_land_on_the_global_chain. |
| `tests/cron/test_cron_pre_agent_fallback_notice.py` | A cron job whose primary provider failed credential resolution and ran on a fallback entry must say so in the delivered report (#74349): the cron agent has no status rail, so the pre-agent switch… Pins: test_fallback_run_prepends_the_switch_notice_to_the_delivered_report; test_primary_run_and_silent_fallback_run_are_untouched. |
| `tests/cron/test_cron_profile_isolation.py` | Regression tests for #4707 — cron must be per-profile. Pins: test_cron_storage_anchors_at_profile_home. |
| `tests/cron/test_cron_prompt_injection_skill.py` | Regression guard: skill content loaded at cron runtime must be scanned. Pins: TestScanAssembledCronPrompt; test_clean_prompt_passes_through. |
| `tests/cron/test_cron_provider_pin.py` | Unpinned cron jobs run on the main agent model at fire time; ``pinned`` locks it. Pins: TestUnpinnedJobsFollowTheMainModel; test_legacy_snapshot_record_follows_the_main_model. |
| `tests/cron/test_cron_reasoning_effort.py` | Per-job reasoning_effort override: store contract + scheduler precedence. Pins: TestJobStoreReasoningEffort; test_valid_levels_stored_normalized. |
| `tests/cron/test_cron_reconnect_only_rejection.py` | A cron payload the live lane rejected as reconnect-only is not lost when standalone fails (#125363). Pins: test_reconnect_only_rejection_survives_a_failed_standalone_for_the_sweep; test_other_live_failures_still_fall_to_standalone_and_queue_nothing. |
| `tests/cron/test_cron_recover_after_commit.py` | A cron submit that fails after the owner committed the admission is observed, not paused (N61). Pins: test_submit_error_after_commit_observes_the_admitted_run. |
| `tests/cron/test_cron_recover_pause.py` | Receipt recovery: a ``missing`` admission is a definite non-admission (booked failed, never a pause), and a verified terminal receipt lifts the pause its own ``CronExecutionUnknown`` caused.""" Pins: test_missing_admission_is_booked_failed_not_paused; test_terminal_receipt_lifts_the_unknown_pause_it_caused. |
| `tests/cron/test_cron_recovery.py` | Terminal owner receipts recover delivery without replay or double bookkeeping.""" Pins: test_lost_ack_reconciles_frozen_delivery_once; test_failed_manual_run_exits_nonzero. |
| `tests/cron/test_cron_relay_delivery_guards.py` | Fire-time guards: stale Slack creation-thread routing + relay-fronted preflight. Pins: TestOriginThreadStaleGuard; test_origin_thread_dropped_when_chat_is_home. |
| `tests/cron/test_cron_relay_dm_origin_user_id.py` | A cron fire into a relay DM carries the origin's ``user_id``, so a COLD routing cache still egresses. Pins: test_origin_discriminators_ride_relay_route_and_media_metadata; test_no_user_id_off_the_relay_or_for_fan_out_targets. |
| `tests/cron/test_cron_relay_run_forward.py` | Manual `hermes cron run` forwarding for relay-fronted delivery targets. Pins: TestRelayFrontedDeliveryPlatforms; test_detects_fronted_delivery_platform. |
| `tests/cron/test_cron_run_metrics.py` | hermes.cron.run: one row per terminal execution and per dropped occurrence.""" Pins: test_each_terminal_execution_is_one_row_classified_without_job_details; test_an_occurrence_dropped_after_downtime_is_one_missed_row. |
| `tests/cron/test_cron_run_stale_claim_reap.py` | Regression for #86721 — a one-shot `hermes cron run` invocation's dispatched runner thread dies with the exiting process, leaving a stale 'claimed'/'running' row in cron/executions.db that blocks… Pins: test_one_shot_cli_path_reaps_dead_owner_row_before_returning_sync. |
| `tests/cron/test_cron_script.py` | Tests for cron job script injection feature. Pins: TestJobScriptField; test_create_job_with_script. |
| `tests/cron/test_cron_session_workdir.py` | Cron sessions stamp the job's workdir on their session row (#108205). Pins: test_run_job_stamps_workdir_on_cron_session_row; test_run_job_without_workdir_leaves_cron_session_cwd_null. |
| `tests/cron/test_cron_thread_seed_dm_keying.py` | Cron thread-seed must key EXACTLY like the reply that will continue it. Pins: test_dm_thread_seed_key_matches_dm_reply_key; test_channel_thread_seed_key_matches_thread_reply_key. |
| `tests/cron/test_cron_tick_stale_yield.py` | Stale-code cron tick yield gate. Pins: TestTickYieldGate; test_skew_plus_foreign_gateway_yields_before_lock. |
| `tests/cron/test_cron_ticker_drift.py` | Ticker loop period contract: the sleep is to a deadline, not for a duration. Pins: test_ticker_period_does_not_accumulate_tick_cost; test_ticker_overrun_rebaselines_instead_of_bursting. |
| `tests/cron/test_cron_timezone_migration_catchup.py` | Timezone-migration silent misfire on the cron fire path. Pins: test_legacy_utc_offset_next_run_still_fires; test_legacy_offset_catchup_fires_at_most_once. |
| `tests/cron/test_cron_windows_venv_abi.py` | Windows cron scripts overlay the committed generation, never the stale in-tree venv. Pins: test_managed_install_uses_the_committed_generation_not_the_in_tree_venv. |
| `tests/cron/test_cron_workdir.py` | Tests for per-job workdir support in cron jobs. Pins: TestNormalizeWorkdir; test_empty_string_returns_none. |
| `tests/cron/test_cronjob_gateway_liveness.py` | Tests for issue #87033 — the cronjob tool must surface gateway liveness. Pins: TestCreateSurfacesGatewayLiveness; test_create_with_gateway_running_has_no_warning. |
| `tests/cron/test_dead_owner_claim_reclaim.py` | Dead-owner cron claim reclaim + one-shot CLI `cron run` sync gate (#86721). Pins: TestTickReapsDeadOwnerClaims; test_stale_claimed_row_from_dead_owner_is_cleared_by_tick. |
| `tests/cron/test_delivery_outcome_writeback.py` | A queued cron delivery's real outcome is written back onto the run that queued it. Pins: test_drained_delivery_outcome_is_written_back. |
| `tests/cron/test_delivery_queue.py` | Durable at-most-once delivery handoff for restart-safe cron workers.""" Pins: test_pending_delivery_is_claimed_and_sent_once; test_pending_deliveries_are_claimed_in_instant_order_across_dst_fall_back. |
| `tests/cron/test_delivery_queue_retention_race.py` | A delivery must stay terminal when retention races a repeated enqueue.""" Pins: test_enqueue_during_retention_never_recreates_delivered_request. |
| `tests/cron/test_dispatch_lateness_stamp.py` | Missed-run dispatch visibility (#99879). Pins: TestDueScanDispatchStamp; test_catch_up_beyond_grace_stamped_and_persisted. |
| `tests/cron/test_due_scan_dst_fold.py` | Due-scan comparisons must use absolute instants across a repeated DST hour.""" Pins: test_fold_one_interval_is_not_due_during_fold_zero; test_fold_hour_timers_measure_real_elapsed_time. |
| `tests/cron/test_due_scan_save_failure.py` | The due scan must still hand back its due jobs when the store cannot be written. Pins: test_due_jobs_are_returned_when_the_store_cannot_be_saved; test_tick_on_unwritable_store_returns_cleanly_without_dispatch. |
| `tests/cron/test_due_stale_cron_edit.py` | Stale-schedule guard on the cron fire path (#93049). Pins: test_stale_next_run_on_excluded_dow_does_not_fire; test_matching_next_run_still_fires. |
| `tests/cron/test_duration_dst.py` | Duration schedules measure elapsed time, including across UTC offset changes.""" Pins: test_one_shot_delay_preserves_elapsed_duration; test_interval_preserves_elapsed_duration. |
| `tests/cron/test_estop.py` | Global emergency stop (`hermes pause` / `hermes resume`) — agent/estop.py. Pins: test_engage_creates_sentinel_and_is_engaged; test_disengage_removes_sentinel. |
| `tests/cron/test_execution_ledger.py` | Durable cron execution-ledger behavior.""" Pins: test_execution_transitions_are_durable; test_execution_can_be_loaded_by_exact_attempt_id. |
| `tests/cron/test_execution_progress_stamp.py` | The run monitor stamps ``progress_at`` on the execution row while the agent is active. Pins: test_active_run_stamps_progress_and_idle_run_does_not. |
| `tests/cron/test_external_worker_config_hooks.py` | External cron workers must register the owning profile's config-declared hooks (#131764). Pins: test_worker_registers_owning_profile_config_hooks. |
| `tests/cron/test_external_worker_secret_sources.py` | External cron workers must see plugin-registered secret sources (#121929). Pins: TestVaultSource; test_worker_hydrates_owning_profile_plugin_secret_source. |
| `tests/cron/test_file_permissions.py` | Tests for file permissions hardening on sensitive files. Pins: TestCronFilePermissions; test_ensure_dirs_sets_0700. |
| `tests/cron/test_fire_claim_lost_after_delivery.py` | 105861 / #113357: a fire-claim that only reads* as lost must not overwrite a completed run's terminal status — an ok, or a failure notice carrying its real error. Pins: test_delivered_run_keeps_its_terminal_status_when_claim_sample_misses_after_delivery; test_transport_cancel_during_delivery_stays_fail_closed. |
| `tests/cron/test_fire_forward_failure_stamp.py` | Tests for the last_fire_error stamp (missed scheduled fires made visible). Pins: TestNoteFireForwardFailure; test_stamps_last_fire_error. |
| `tests/cron/test_idle_tick_config_skip.py` | Idle cron ticks must not load config (#33612 salvage). Pins: TestIdleTickSkipsConfigLoad; test_idle_tick_still_sweeps_mcp_orphans. |
| `tests/cron/test_inflight_stale_guard.py` | RED-first regression test for the cron in-flight claim leak (t_27b59583). Pins: TestStaleInflightLeak; test_stale_claim_is_force_released_and_reported_after_tick. |
| `tests/cron/test_jobs.py` | Tests for cron/jobs.py — schedule parsing, job CRUD, and due-job detection.""" Pins: TestParseDuration; test_minutes. |
| `tests/cron/test_jobs_changed_notify.py` | Tests for on_jobs_changed wiring (Phase 4F.1). Pins: test_notify_helper_calls_provider_on_jobs_changed; test_create_registers_first_trigger_with_active_provider. |
| `tests/cron/test_jobs_crossprocess_lock.py` | Regression test for the jobs.json cross-process lock. Pins: test_jobs_lock_excludes_another_process. |
| `tests/cron/test_jobs_file_ownership.py` | Regression tests for issue #68483. Pins: TestSaveJobsOwnershipPreservation; test_root_writer_restores_previous_owner. |
| `tests/cron/test_jobs_shrink_merge.py` | Regression for #80624 — concurrent creates must not be clobbered on save. Pins: test_stale_empty_save_preserves_concurrent_no_agent_create; test_remove_other_job_preserves_concurrent_create. |
| `tests/cron/test_last_failure_stamp.py` | Tests for the sticky ``last_failure`` stamp (#118354). Pins: TestLastFailureStamp; test_failed_run_stamps_last_failure. |
| `tests/cron/test_lifecycle_guard_budget.py` | Whole-walk work budget for the gateway lifecycle guard (#78398). Pins: test_root_byte_limit_allows_exact_and_rejects_plus_one; test_root_line_limit_allows_exact_and_rejects_plus_one. |
| `tests/cron/test_lifecycle_guard_heredoc_walk.py` | The referenced-script walk sees the same inert-heredoc-masked view as the direct scan (#110422). Pins: test_inert_heredoc_body_path_not_walked_as_script; test_prefixed_inert_heredoc_body_path_not_walked_as_script. |
| `tests/cron/test_lifecycle_guard_live_db.py` | Regression tests for raw lifecycle-guard reads of live SQLite files.""" Pins: test_referenced_script_read_refuses_live_sqlite_connection; test_referenced_script_read_preserves_normal_script_behavior. |
| `tests/cron/test_lifecycle_guard_profile_scan.py` | Profile scanning must terminate without dropping long commands (#129281).""" Pins: test_long_profile_scan_preserves_targeting; test_nonmatching_flag_runs_finish. |
| `tests/cron/test_live_firer_receipt_recovery.py` | Receipt reconciliation keeps its journal while a live foreign firer still owns the ledger row.""" Pins: test_live_firer_journal_survives_until_its_execution_can_settle. |
| `tests/cron/test_media_delivery_parity.py` | Cron media-delivery parity — manual runs must not silently drop attachments. Pins: TestStandaloneWarningsSurfaced; test_upload_warning_becomes_delivery_error. |
| `tests/cron/test_media_send_timeout.py` | Cron media-send timeout resolution and failure-reason formatting. Pins: TestMediaSendTimeoutResolution; test_default. |
| `tests/cron/test_mirror_origin_fallback.py` | Mirror eligibility for origin-fallback and explicit cron delivery targets. Pins: TestMirrorEligibilityResolution; test_origin_target_is_eligible. |
| `tests/cron/test_misfire_backstop_oneshot_grace.py` | Misfire-backstop grace gate for one-shot cron jobs (#93526). Pins: TestMisfireBackstopOneShotGrace; test_stale_oneshot_beyond_grace_is_not_fired. |
| `tests/cron/test_misfire_catchup.py` | Tests for fire_overdue_jobs — misfire catch-up for external cron providers. Pins: TestFireOverdueJobs; test_noop_for_builtin_provider. |
| `tests/cron/test_missed_window_catchup.py` | A recurring occurrence that a tick took off the schedule but never dispatched must fire once after the scheduler restarts — never be silently lost, never fire twice (#107485). Pins: TestMissedWindowCatchUp; test_slot_lost_before_dispatch_fires_once_after_restart. |
| `tests/cron/test_monitor_kind.py` | Tests for monitor-mode cron jobs — cheap source each tick, hash-suppressed agent runs. Pins: test_create_job_monitor_script_and_url_mutually_exclusive; test_create_job_monitor_rejected_with_no_agent. |
| `tests/cron/test_notepad.py` | Per-job durable cron notepad: KV scratchpad surviving scheduled wake-ups. Pins: TestNotepadCrud; test_set_then_get_roundtrip. |
| `tests/cron/test_oneshot_dispatch_failure_run_claim.py` | Regression tests for #86522 — one-shot run_claim cleared on dispatch failure. Pins: TestClearRunClaim; test_clears_claim_on_oneshot. |
| `tests/cron/test_oneshot_grace_due_scan.py` | Due-scan grace gate for one-shot cron jobs. Pins: TestOneShotGraceDueScan; test_stale_beyond_grace_not_due_and_retired_with_diagnostic. |
| `tests/cron/test_oneshot_guard_warning.py` | Due-scan dispatch-limit guard: removal of a re-armed consumed one-shot is operator-visible (#93524 follow-up to #93615). Pins: test_guard_warns_on_rearmed_consumed_record. |
| `tests/cron/test_owner_start_time_drift.py` | Start-time fingerprint drift between claim and recovery reads (#117505). Pins: test_drift_within_tolerance_keeps_execution_running; test_unreadable_start_time_fail_safe. |
| `tests/cron/test_parallel_pool.py` | Tests for the persistent parallel pool and running-job guard in cron/scheduler.py. Pins: TestRunningJobGuard; test_running_set_prevents_double_dispatch. |
| `tests/cron/test_persisted_error_rearm_legality.py` | The persisted-error re-arm must respect cron schedule legality. Pins: TestCronRearmRespectsScheduleLegality; test_weekday_job_errored_friday_does_not_fire_on_saturday. |
| `tests/cron/test_preflight_config.py` | Cron pre-dispatch configuration validation (T1-26). Pins: TestMissingProviderKeyBlocks; test_missing_key_blocked_config_no_agent. |
| `tests/cron/test_preflight_credential_verdict_names_home.py` | A ``blocked_config`` credential verdict names the profile + HERMES_HOME the scheduler actually read (#116213): "No Codex credentials stored" from a gateway whose home differs from the shell that… Pins: test_missing_codex_credential_verdict_names_the_home_it_read. |
| `tests/cron/test_preflight_managed_routes.py` | Managed-scope ``gateway.profile_routes`` must reach the satellite cron path (#121212). Pins: test_managed_scope_routes_reach_satellite_preflight_and_delivery; test_managed_routes_replace_user_file_routes. |
| `tests/cron/test_queued_delivery_fencing.py` | The canonical delivery queue row is the cron run's send: it obeys the same fire-claim fence, receipt and settlement rules as a direct send.""" Pins: test_claim_stolen_after_the_ownership_sample_queues_no_ghost_send; test_dead_drain_owner_settles_the_run_it_fenced_unknown. |
| `tests/cron/test_quota_hold.py` | Provider quota windows park a cron job instead of re-firing into them (#89376; ai-velho-oy/chairman#3). Pins: test_hold_seconds_only_from_rate_limited_auth_error_in_cause_chain; test_weekly_cron_retries_when_quota_recovers_before_next_occurrence. |
| `tests/cron/test_recurring_persisted_error_recovery.py` | Persisted-state stale-error recovery for recurring cron jobs (t_8b5480b3). Pins: TestPersistedStaleErrorRecovery; test_stale_error_recurring_job_redispatches_without_force_run. |
| `tests/cron/test_recurring_wedge_selfheal.py` | Deterministic reproduction of the recurring-cron wedge (t_8b5480b3) — RED/GREEN. Pins: TestStaleInflightSelfHeal; test_stale_claim_self_heals_and_redispatches. |
| `tests/cron/test_registration_ownership.py` | Live direct runs and successor registrations must survive stale cleanup. Pins: test_live_direct_run_survives_stale_sweep; test_dispatch_cleanup_preserves_successor. |
| `tests/cron/test_relay_fronted_delivery.py` | Cron delivery for relay-fronted logical platforms. Pins: TestConfigHomeChannelFallback; test_chat_id_falls_back_to_config_home_channel. |
| `tests/cron/test_restart_safe_worker.py` | Restart-safe cron worker handoff and ownership contracts.""" Pins: test_execution_owner_moves_to_external_worker_before_running; test_external_worker_cannot_adopt_execution_without_handoff_fence. |
| `tests/cron/test_restart_safe_worker_death_evidence.py` | Post-adoption failure visibility (#128509, #129254), not the unknown crash cause.""" Pins: test_adopted_worker_failure_is_visible; test_terminalizer_refuses_an_attempt_whose_worker_is_still_alive. |
| `tests/cron/test_retirement_dispatch.py` | The tick-to-worker handoff must have no retirement-sized gap after can_dispatch.""" Pins: test_passed_gate_tick_and_queued_job_remain_busy_until_real_worker_exit. |
| `tests/cron/test_rewrite_skill_refs.py` | Tests for cron.jobs.rewrite_skill_refs — the curator integration that keeps scheduled cron jobs pointing at the right skill names after a consolidation / pruning pass. Pins: TestRewriteSkillRefsConsolidation; test_single_skill_replaced. |
| `tests/cron/test_run_error_diagnostics.py` | Failure detail belongs in the local audit, not the delivery summary.""" Pins: test_run_error_persists_redacted_cause_but_returns_summary; test_list_exposes_run_error_and_clears_it_after_success. |
| `tests/cron/test_run_one_job.py` | Characterization + unit tests for the `run_one_job` shared helper (Phase 4A). Pins: test_tick_skips_job_when_durable_fire_claim_is_lost; test_run_one_job_success_sequence. |
| `tests/cron/test_scheduled_occurrence.py` | Completed scheduled attempts survive a jobs.json rollback, not just a process restart.""" Pins: test_completed_occurrence_survives_restart_and_prestamp_rollback; test_ledger_migration_and_completion_identity. |
| `tests/cron/test_scheduler.py` | Tests for cron/scheduler.py — origin resolution, delivery routing, and error logging.""" Pins: test_cron_cleanup_worker_inherits_caller_contextvars; TestSummarizeCronFailureForDelivery. |
| `tests/cron/test_scheduler_completion_verification.py` | Fail-closed completion booking for cron runs (#93820). Pins: test_run_without_final_assistant_message_books_incomplete; test_run_with_final_assistant_reply_books_complete. |
| `tests/cron/test_scheduler_cron_session_isolation.py` | Regression test for cron-session approval isolation. Pins: test_run_job_cron_execute_code_deny_does_not_pollute_later_gateway_execute_code. |
| `tests/cron/test_scheduler_provider.py` | Characterization tests for the cron trigger before/after the provider refactor. Pins: test_ticker_calls_tick_at_least_once_then_stops; test_desktop_ticker_calls_tick_then_stops. |
| `tests/cron/test_scheduler_session_title_nudge.py` | Tests for cron/scheduler.py — cron session titling and the repeated-failure review nudge.""" Pins: TestSetCronSessionTitle; test_dedupes_on_duplicate_title. |
| `tests/cron/test_scheduler_shutdown_guard.py` | Regression coverage for #58720 / #55924 — cron scheduling races interpreter finalization. Pins: TestInterpreterShuttingDownHelper; test_matches_shutdown_error_text_as_fallback. |
| `tests/cron/test_script_claim_heartbeat.py` | Regression coverage for one-shot claims during blocking cron scripts.""" Pins: test_script_termination_reaps_descendants; test_no_agent_forwards_cancel_event_to_script_runner. |
| `tests/cron/test_sessiondb_init_hang.py` | Canonical cron must bound store acquisition without unpersisted inference. Pins: test_sessiondb_init_preserves_multiplex_profile_context; test_run_job_does_not_hang_when_sessiondb_init_wedges. |
| `tests/cron/test_shutdown_interrupt.py` | Tests for #60432: cron jobs must not be silently invisible to gateway shutdown, and a job whose tool subprocess got killed by shutdown must never be reported as a successful run. Pins: TestGetRunningJobIds; test_reflects_in_flight_jobs. |
| `tests/cron/test_stale_module_leaf_imports.py` | Regression tests for lazy consumers importing from stale cached modules. Pins: test_primary_client_ignores_stale_auxiliary_router. |
| `tests/cron/test_stale_running_recovery.py` | Live-but-deadlocked cron workers (#115692). Pins: test_live_owner_stale_claim_gets_recovered; test_live_owner_recent_claim_not_recovered. |
| `tests/cron/test_suggestions.py` | Tests for the Suggested Cron Jobs feature. Pins: TestStore; test_explicit_file_override_wins_over_profile_home. |
| `tests/cron/test_terminal_job_rearm.py` | Behavioral coverage for terminal cron jobs and explicit one-shot re-arm.""" Pins: test_completed_oneshot_trigger_is_refused_and_disk_record_is_unchanged; test_exhausted_recurring_job_trigger_is_refused. |
| `tests/cron/test_tick_without_gateway.py` | ``hermes cron tick`` with no live gateway refuses agent jobs instead of spawning one. Pins: test_tick_without_gateway_skips_agent_jobs_without_spawning_or_drift; test_tick_holds_agent_jobs_while_gateway_is_starting_or_silent. |
| `tests/cron/test_ticker_stall.py` | Regression tests for #60703 — cron ticker silently stalls after gateway restart. Pins: TestBoundedJobsLock; test_lock_acquisition_times_out_and_degrades. |
| `tests/cron/test_ticker_startup_survival.py` | The ticker contract — "an exception must not silently kill the cron thread" — holds for every step that runs on the cron-scheduler thread, not only the tick body: startup recovery, the multiplex… Pins: test_ticker_survives_a_corrupt_ledger_at_startup; test_multiplex_ticker_survives_a_raising_gate_without_ticking_ungated. |
| `tests/cron/test_timezone.py` | Tests for timezone support (hermes_time module + integration points). Pins: TestHermesTimeNow; test_valid_timezone_applies. |
| `tests/cron/test_unreachable_retry.py` | Cowork-inspired bounded automatic re-runs for cron fires that never reached the model. Pins: test_unreachable_failure_pulls_next_run_earlier_then_ladder_exhausts; test_will_retry_mirrors_plan_retry_yield. |
| `tests/cron/test_upgrade_module_skew.py` | Cron imports remain usable when a daemon spans an on-disk upgrade. Pins: test_lazy_cron_stores_import_against_pre_upgrade_sqlite_util; test_occurrences_resolve_fire_claim_constants_without_cached_jobs_exports. |
| `tests/cron/test_usage_audit_logger.py` | Tests for the cron usage_audit.jsonl logger. Pins: TestUsageAuditPath; test_resolves_through_get_hermes_home. |
| `tests/cron/test_warning_delivery_policy.py` | Failure classification survives durable delivery and drain-time policy changes.""" Pins: test_failure_queue_settles_without_claiming_a_suppressed_send; test_success_content_and_explicit_destination_override_survive. |
| `tests/cron/test_warning_execution_outcome.py` | Suppressed automatic diagnostics retain failed jobs without invented delivery receipts.""" Pins: test_real_run_ledger_and_incident_match_actual_presentation. |
| `tests/cron/test_warning_transport_contract.py` | Real cron router/queue with local transport doubles; no external network.""" Pins: test_warning_policy_at_real_transport_boundary. |
| `tests/cron/test_worktree_maintenance_isolation.py` | Background worktree maintenance must not initialize the interactive CLI.""" Pins: test_cold_worktree_maintenance_preserves_terminal_cwd. |
| `tests/dashboard/test_ws_client_host.py` | Regression tests for the in-container WebSocket client host resolution. Pins: TestResolveClientWsHost; test_wildcard_ipv4_uses_loopback. |
| `tests/desktop/test_appinstaller_check_script.py` | App Installer checker output contracts and native WinRT dependency coverage. Pins: test_projection_outcomes; check_update_availability_async. |
| `tests/desktop/test_check_store_update.py` | Store update contracts use the actual API's sequence and result shapes.""" Pins: test_store_operation_passes_update_sequence_and_requires_completed; test_native_projection_has_required_update_contract. |
| `tests/docker/__init__.py` | Empty package marker / no cases. |
| `tests/docker/conftest.py` | Shared fixtures for docker-image integration tests. |
| `tests/docker/test_config_migration.py` | Runtime smoke test for Docker config-schema migration on boot. Pins: test_config_migration_runs_on_boot. |
| `tests/docker/test_container_restart.py` | Container-restart survives per-profile gateway registrations. Pins: test_stopped_gateway_stays_stopped_after_restart; test_stale_gateway_pid_cleaned_up_on_restart. |
| `tests/docker/test_dashboard.py` | Harness: dashboard opt-in via HERMES_DASHBOARD. Pins: test_dashboard_not_running_by_default; test_dashboard_oauth_gate_engages_on_non_loopback_bind. |
| `tests/docker/test_docker_exec_privilege_drop.py` | Regression tests for the docker-exec privilege-drop shim. Pins: test_shim_drops_root_to_hermes_uid; test_e2e_login_then_supervised_gateway_can_read_auth. |
| `tests/docker/test_dump_build_sha.py` | Regression test: ``hermes dump`` reports a real git SHA inside the container. Pins: test_dump_reports_stamp_commit_when_present. |
| `tests/docker/test_gateway_bootstrap_state.py` | Runtime smoke tests for Docker gateway_state.json bootstrap seeding. Pins: test_seeds_running_state_on_blank_volume; test_no_seed_when_env_unset. |
| `tests/docker/test_gateway_run_supervised.py` | Harness: `docker run <image> gateway run` redirects to supervised mode. Pins: test_gateway_run_redirects_to_supervised; test_supervised_gateway_does_not_recurse. |
| `tests/docker/test_home_override_scripts.py` | Runtime smoke tests for Docker HOME overrides and script behavior. Pins: test_dashboard_service_resets_home; test_stage2_repairs_profiles_and_cron_ownership. |
| `tests/docker/test_image_payload.py` | The image's non-root runtime uses its staged tools and generated assets.""" Pins: test_python_uses_pm_interpreter_as_runtime_user; test_dashboard_ships_generated_icon_without_build_environment. |
| `tests/docker/test_immutable_install.py` | Runtime smoke tests for Docker immutable install tree and install-method stamp. Pins: test_install_tree_not_writable_by_hermes; test_stale_docker_stamp_in_home_is_healed_on_boot. |
| `tests/docker/test_immutable_install_permissions.py` | Docker smoke tests for immutable install permissions.""" Pins: test_container_sets_hosted_write_policy_env; test_hermes_user_cannot_modify_install_but_can_write_data. |
| `tests/docker/test_interactive_logging.py` | Keep supervised output away from an interactive Docker CMD's terminal.""" Pins: test_supervised_output_respects_terminal_ownership; test_explicit_logging_preserves_cmd_terminal. |
| `tests/docker/test_license_file_present.py` | Runtime smoke test for Docker image license-file presence. Pins: test_docker_image_contains_license_file. |
| `tests/docker/test_log_dir_seed.py` | Runtime smoke test for Docker $HERMES_HOME/logs/gateways seeding. Pins: test_logs_gateways_seeded_and_hermes_owned. |
| `tests/docker/test_main_invocation.py` | Harness: docker run <image> [cmd...] invocation patterns. Pins: test_chat_subcommand_passthrough; test_bash_pattern. |
| `tests/docker/test_profile_gateway.py` | Harness: a named profile does not get a gateway of its own inside the container. Pins: test_named_profile_gateway_start_refuses_without_force; test_named_profile_gateway_force_start_then_stop. |
| `tests/docker/test_puid_pgid_remap.py` | Runtime smoke tests for Docker PUID/PGID and UID/GID remap. Pins: test_puid_pgid_remaps_hermes_user; test_nas_low_uid_accepted. |
| `tests/docker/test_s6_gateway_planned_stop.py` | E2E: ``hermes gateway stop`` inside the s6 image is a PLANNED stop. Pins: test_gateway_stop_under_s6_is_planned. |
| `tests/docker/test_s6_profile_gateway_integration.py` | Harness: in-container integration tests for S6ServiceManager. Pins: test_s6_register_creates_service_dir_in_live_container. |
| `tests/docker/test_smoke.py` | Runtime smoke tests for the Docker image entrypoint and subcommands. Pins: test_hermes_help; test_dashboard_subcommand_present. |
| `tests/docker/test_sqlite_runtime.py` | Runtime qualification for SQLite in the published Docker image.""" Pins: test_image_links_fixed_sqlite_with_fts5_trigram. |
| `tests/docker/test_stage2_browser_discovery.py` | Verify Docker exports a runnable full Chromium executable. Pins: test_stage2_discovers_chromium_binary. |
| `tests/docker/test_tini_compat_shim.py` | Runtime smoke test for the Docker tini compatibility shim (#34192, #66679). Pins: test_legacy_tini_entrypoint_boots. |
| `tests/docker/test_toplevel_chown.py` | Runtime smoke tests for Docker top-level state-file ownership repair. Pins: test_root_owned_state_files_repaired_on_boot; test_non_allowlisted_host_file_not_touched. |
| `tests/docker/test_tui_gateway_startup.py` | Ink's real bootstrap starts its s6 owner without sharing the terminal.""" Pins: test_tui_bootstrap_starts_the_correct_supervised_owner; test_s6_discovery_refuses_another_install_root. |
| `tests/docker/test_tui_passthrough.py` | Harness: interactive TUI TTY passthrough. Pins: test_tty_passthrough_to_container. |
| `tests/docker/test_tui_prebuilt_bundle.py` | Harness: the image ships a prebuilt TUI bundle, not a runtime npm install. Pins: test_photon_baked_dependencies_load_without_writes_or_network; test_prebuilt_bundle_present_and_no_runtime_install. |
| `tests/docker/test_user_flag_guard.py` | Runtime smoke tests for Docker --user flag guard. Pins: test_arbitrary_user_uid_rejected; test_user_pinned_to_hermes_uid_works. |
| `tests/docker/test_zombie_reaping.py` | Harness: PID 1 must reap orphaned zombie processes. Pins: test_orphan_zombies_reaped. |
| `tests/evals/__init__.py` | Empty package marker / no cases. |
| `tests/evals/test_codebase_navigability.py` | Guardrail for the navigability eval: its symbol resolver must follow the facade/sibling layout. Pins: test_tokenizer_falls_back_without_crashing. |
| `tests/evals/test_compaction_jev_arm.py` | Invariants of the fast-jev-compaction eval arm (evals/compaction/jev_arm.py). Pins: test_drop_decisions_never_orphan_and_never_rewrite_text; test_drop_result_keeps_call_and_bounded_head. |
| `tests/evals/test_core_tool_deferral_sandbox.py` | The core-tool-deferral worker's host sandbox (evals/core_tool_deferral/sandbox.py). Pins: test_child_shell_crontab_and_home_stay_inside_the_run_dir. |
| `tests/fakes/cron_owner.py` | A real profile gateway authority that admits cron fires without running an agent turn. |
| `tests/fakes/fake_llm_provider.py` | Scripted, recording loopback LLM provider for end-to-end tests. |
| `tests/fakes/platforms/__init__.py` | Empty package marker / no cases. |
| `tests/fakes/platforms/_standin.py` | Shared plumbing for local stand-in messaging platform servers. |
| `tests/fakes/platforms/discord_shim/sitecustomize.py` | Point discord.py at a local Discord stand-in (tests only). |
| `tests/fakes/platforms/discord_standin.py` | Discord stand-in: REST API v10 + Gateway websocket (https://discord.com/developers/docs). |
| `tests/fakes/platforms/slack_shim/sitecustomize.py` | Point slack_sdk (and raw ``https://slack.com/api/`` aiohttp posts) at a local Slack stand-in. |
| `tests/fakes/platforms/slack_standin.py` | Slack Web API + Socket Mode stand-in (https://api.slack.com/methods, /apis/socket-mode). |
| `tests/fakes/platforms/telegram_standin.py` | Telegram Bot API stand-in (https://core.telegram.org/bots/api). |
| `tests/fakes/providers/__init__.py` | Empty package marker / no cases. |
| `tests/fakes/providers/anthropic_messages.py` | Scripted, recording loopback server speaking the Anthropic Messages API. |
| `tests/fakes/providers/bedrock_converse.py` | Loopback fake of the AWS Bedrock Runtime Converse / ConverseStream API. |
| `tests/fakes/providers/catalog_fake.py` | Multi-dialect recording loopback provider for the provider-catalog E2E matrix. |
| `tests/fakes/providers/catalog_oauth.py` | Loopback OAuth authorization server + bearer-checking inference server for the OAuth E2E cells. |
| `tests/fakes/providers/chat_variants.py` | Scripted, recording loopback server for OpenAI *chat-completions** dialect variants. |
| `tests/fakes/providers/codex_app_server.py` | Fake ``codex app-server``: newline-delimited JSON-RPC over stdio, validated against the protocol. Pins: check_interrupt. |
| `tests/fakes/providers/copilot_acp.py` | !/usr/bin/env python3 """Fake ACP agent executable standing in for ``copilot --acp --stdio`` (provider ``copilot-acp``). |
| `tests/fakes/providers/gemini_native.py` | Fake Google AI Studio ``generateContent`` / ``streamGenerateContent`` endpoint behind a real TLS boundary. |
| `tests/fakes/providers/oauth_token_server.py` | Recording loopback OAuth 2.0 authorization server for end-to-end tests. Pins: TestCA. |
| `tests/fakes/providers/openai_responses.py` | Scripted, recording loopback server for the OpenAI *Responses** wire dialect. |
| `tests/fakes/providers/vertex.py` | Loopback fake of Google Vertex AI (Gemini behind the OpenAI-compatible endpoint) + Google OAuth. |
| `tests/file_write_observer.py` | Run a "concurrent reader" at the exact instant a writer emits bytes (torn-read regression tests). |
| `tests/fixtures/cua_driver_0_9_tools_list.json` | JSON head: { / "format": "normalized-selected-tools-list-v1", / "contract_epoch": "cua-driver-0.9", / "observed_reported_version": "0.8.3", / "capability_version": "1", / "observed_tool_count": 49, /… |
| `tests/fixtures/identifier_speech_corpus.json` | JSON head: { / "description": "Identifier-dense tokens both speech normalizers must agree on (#119207). Unspeakable machine tokens become silence — never hardcoded English placeholder words (#86602).… |
| `tests/fixtures/legacy_desktop/update-marker-be3fd671.mts` | // The update-marker reader a packaged Desktop shipped at be3fd671d70 (apps/desktop/electron/update-marker.ts // lines 1-160, verbatim): the old reader new hand-off scripts must keep parked. Never… |
| `tests/fixtures/plugins/example-dashboard/dashboard/manifest.json` | JSON head: { / "name": "example", / "label": "Example", / "description": "Test-only dashboard plugin fixture — installed by tests that need a stable plugin API endpoint to verify auth + static-asset… |
| `tests/fixtures/plugins/example-dashboard/dashboard/plugin_api.py` | Example dashboard plugin — backend API routes (test fixture). |
| `tests/fixtures/prompt_surface/prompts/cli-code.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/cli.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/cli.gemini.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/cli.gpt.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/cli.hermes.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/cron.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/desktop.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/discord.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/prompts/telegram.claude.txt` | ===== stable ===== You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work… |
| `tests/fixtures/prompt_surface/surfaces.json` | JSON head: { / "cli-code.claude": { / "prompt_tokens": { / "context": 249, / "stable": 1935, / "volatile": 1813 / }, / "tool_tokens": 13277, / "tools": [ / "browser_back", / "browser_cdp", /… |
| `tests/fixtures/prompt_surface/tools/browser_back.json` | JSON head: { / "description": "Navigate back to the previous page in browser history. Requires browser_navigate to be called first.", / "name": "browser_back", / "parameters": { / "properties": {}, /… |
| `tests/fixtures/prompt_surface/tools/browser_cdp.json` | JSON head: { / "description": "Send a raw Chrome DevTools Protocol (CDP) command. Escape hatch for browser operations not covered by browser_navigate, browser_click, browser_console,… |
| `tests/fixtures/prompt_surface/tools/browser_click.json` | JSON head: { / "description": "Click on an element identified by its ref ID from the snapshot (e.g., '@e5'). The ref IDs are shown in square brackets in the snapshot output. Requires browser_navigate… |
| `tests/fixtures/prompt_surface/tools/browser_console.json` | JSON head: { / "description": "Get browser console output and JavaScript errors from the current page. Returns console.log/warn/error/info messages and uncaught JS exceptions. Use this to detect… |
| `tests/fixtures/prompt_surface/tools/browser_dialog.json` | JSON head: { / "description": "Respond to a native JavaScript dialog (alert / confirm / prompt / beforeunload) that is currently blocking the page.\n\n**Workflow:** call ``browser_snapshot`` first —… |
| `tests/fixtures/prompt_surface/tools/browser_exec.json` | JSON head: { / "description": "Drive a real web browser via the Browser Use CLI: `code` runs as full Python (stdlib available) with pre-imported browser helpers; stdout comes back in the result.… |
| `tests/fixtures/prompt_surface/tools/browser_get_images.json` | JSON head: { / "description": "Get a list of all images on the current page with their URLs and alt text. Useful for finding images to analyze with the vision tool. Requires browser_navigate to be… |
| `tests/fixtures/prompt_surface/tools/browser_navigate.json` | JSON head: { / "description": "Navigate to a URL in the browser. Initializes the session and loads the page. Must be called before other browser tools. For simple information retrieval, prefer a… |
| `tests/fixtures/prompt_surface/tools/browser_press.json` | JSON head: { / "description": "Press a keyboard key. Useful for submitting forms (Enter), navigating (Tab), or keyboard shortcuts. Requires browser_navigate to be called first.", / "name":… |
| `tests/fixtures/prompt_surface/tools/browser_scroll.json` | JSON head: { / "description": "Scroll the page in a direction. Use this to reveal more content that may be below or above the current viewport. Requires browser_navigate to be called first.", /… |
| `tests/fixtures/prompt_surface/tools/browser_snapshot.json` | JSON head: { / "description": "Get a text-based snapshot of the current page's accessibility tree. Returns interactive elements with ref IDs (like @e1, @e2) for browser_click and browser_type.… |
| `tests/fixtures/prompt_surface/tools/browser_type.json` | JSON head: { / "description": "Type text into an input field identified by its ref ID. Clears the field first, then types the new text. Requires browser_navigate and browser_snapshot to be called… |
| `tests/fixtures/prompt_surface/tools/browser_vision.json` | JSON head: { / "description": "Take a screenshot of the current page so you can inspect it visually. Use this when you need to understand what the page looks like - especially for CAPTCHAs, visual… |
| `tests/fixtures/prompt_surface/tools/clarify.json` | JSON head: { / "description": "Ask the user one or more questions when you need a decision, clarification, or feedback before proceeding. Pass every question in `questions` (1-5 entries) — a single… |
| `tests/fixtures/prompt_surface/tools/delegate_task.json` | JSON head: { / "description": "Spawn subagents in isolated contexts; each gets its own conversation, terminal session, and toolset, and only its final summary returns to you. Pass every task in… |
| `tests/fixtures/prompt_surface/tools/execute_code.json` | JSON head: { / "description": "Run Python that calls Hermes tools programmatically. Use when you need 3+ tool calls with logic between them: filtering/reducing large outputs before they enter… |
| `tests/fixtures/prompt_surface/tools/manage_connections.json` | JSON head: { / "description": "Connect the user to apps. Two kinds: a hosted connector account (Gmail, Notion, ...) served through the tool gateway, and a local MCP server from the bundled catalog.… |
| `tests/fixtures/prompt_surface/tools/memory.json` | JSON head: { / "description": "Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.\n\nHOW: make… |
| `tests/fixtures/prompt_surface/tools/patch.cli.gpt.json` | JSON head: { / "description": "Targeted find-and-replace edits in files. Use this instead of sed/awk in terminal. Uses fuzzy matching (9 strategies) so minor whitespace/indentation differences won't… |
| `tests/fixtures/prompt_surface/tools/patch.json` | JSON head: { / "description": "Targeted find-and-replace edits in files. Use this instead of sed/awk in terminal. Uses fuzzy matching (9 strategies) so minor whitespace/indentation differences won't… |
| `tests/fixtures/prompt_surface/tools/react_to_message.json` | JSON head: { / "description": "React to a message with a single emoji, the way you'd tapback in iMessage. Reach for it when a reaction is what a person would do: something funny gets a 😂, warmth… |
| `tests/fixtures/prompt_surface/tools/read_file.json` | JSON head: { / "description": "Read a text file with line numbers and pagination. Use this instead of cat/head/tail in terminal. Output format: 'LINE_NUM/CONTENT'. Suggests similar filenames if not… |
| `tests/fixtures/prompt_surface/tools/search_files.json` | JSON head: { / "description": "Search file contents or find files by name. Use this instead of grep/rg/find/ls in terminal. Ripgrep-backed, faster than shell equivalents. On macOS, broad searches… |
| `tests/fixtures/prompt_surface/tools/skill_manage.json` | JSON head: { / "description": "Create, update, or delete skills — your procedural memory for recurring task types. The call is an operations array (a single edit is a list of one); it applies… |
| `tests/fixtures/prompt_surface/tools/skill_view.json` | JSON head: { / "description": "Skills allow for loading information about specific tasks and workflows, as well as scripts and templates. Load a skill's full content or access its linked files… |
| `tests/fixtures/prompt_surface/tools/skills_list.json` | JSON head: { / "description": "List available skills (name + description). Use skill_view(name) to load full content.", / "name": "skills_list", / "parameters": { / "properties": { / "category": { /… |
| `tests/fixtures/prompt_surface/tools/terminal.json` | JSON head: { / "description": "Execute shell commands on the OS, shell and backend named in your environment section. The working directory, files and exported variables persist between calls:… |
| `tests/fixtures/prompt_surface/tools/text_to_speech.json` | JSON head: { / "description": "Convert text to speech audio. Returns a MEDIA: path that the platform delivers as native audio. Compatible providers render as a voice bubble on Telegram; otherwise… |
| `tests/fixtures/prompt_surface/tools/tool_call.json` | JSON head: { / "description": "Invoke deferred tools: `calls` is an array of {name, arguments}, one entry per invocation (batch independent calls; results come back in order). Arguments match the… |
| `tests/fixtures/prompt_surface/tools/tool_describe.json` | JSON head: { / "description": "Load the full JSON schemas for tools returned by `tool_search`. Required before `tool_call` if a tool's parameters are unknown. Batch every schema you need into one… |
| `tests/fixtures/prompt_surface/tools/tool_search.desktop.claude.json` | JSON head: { / "description": "Search 19 additional tools that are loaded on demand. Send one keyword query per capability you need; returns matching tool names and descriptions. Then `tool_describe`… |
| `tests/fixtures/prompt_surface/tools/tool_search.json` | JSON head: { / "description": "Search 7 additional tools that are loaded on demand. Send one keyword query per capability you need; returns matching tool names and descriptions. Then `tool_describe`… |
| `tests/fixtures/prompt_surface/tools/vision_analyze.json` | JSON head: { / "description": "Load an image into the conversation so you can see it. Call it any time the user references an image — then answer from what you see.", / "name": "vision_analyze", /… |
| `tests/fixtures/prompt_surface/tools/web_extract.json` | JSON head: { / "description": "Extract content from web page URLs. Returns clean page content in markdown/text (no LLM summarization — fast). Also works with PDF URLs (arxiv papers, documents) — pass… |
| `tests/fixtures/prompt_surface/tools/web_search.json` | JSON head: { / "description": "Search the web for information. Returns up to 5 results by default with titles, URLs, and descriptions. The query is passed through to the configured backend, so… |
| `tests/fixtures/prompt_surface/tools/write_file.json` | JSON head: { / "description": "Write content to a file, completely replacing existing content. Use this instead of echo/cat heredoc in terminal. Creates parent directories automatically. OVERWRITES… |
| `tests/fixtures/provider_wire_snapshot.json` | JSON head: { / "actual": { / "api_mode": "chat_completions", / "base_url": "https://api.actual.inc/v1", / "high": { / "extra_body": { / "thinking": { / "type": "enabled" / } / }, / "messages": [ / {… |
| `tests/fixtures/resolution_allowlist.json` | JSON head: [ / { / "path": "agent/anthropic_adapter.py", / "symbol": "<module>", / "kind": "known_path_table" / }, / { / "path": "agent/anthropic_adapter.py", / "symbol": "_claude_code_candidates", /… |
| `tests/fixtures/room_link_protocol_v2.json` | JSON head: { / "protocol_version": 2, / "catalog": { / "installation_id": "install:peer", / "protocol_versions": [2], / "link_modes": ["direct"], / "persistent_process": true, / "text": true, /… |
| `tests/fixtures/session-resume-active-turn.json` | JSON head: { / "info": { / "cwd": "/workspace", / "lazy": false, / "model": "test/model", / "skills": {}, / "tools": {} / }, / "inflight": { / "assistant": "partial answer", / "streaming": true, /… |
| `tests/fixtures/spark_failing_turn_shape.json` | JSON head: [ / { / "role": "user", / "content": "Investigate the installed 'agy' CLI and summarize its version and capabilities in one report." / }, / { / "role": "assistant", / "content": "", /… |
| `tests/fixtures/update_marker_corpus.json` | JSON head: { / "schema": 1, / "contract": { / "doc": "Shared update-marker identity corpus (ROUND5 A7 rule 7). Every marker reader runs the 'judge' cases and every releaser the 'release' cases.", /… |
| `tests/git_safety.py` | Classify accidental Git mutations before tests can touch their checkout.""" |
| `tests/hermes_platform/__init__.py` | Empty package marker / no cases. |
| `tests/hermes_platform/test_declaration.py` | Declaration parser, availability, and skill-gate contracts. Pins: test_app_block_parses_into_one_appdef_per_os; test_invalid_blocks_name_the_rule. |
| `tests/hermes_platform/test_facts.py` | Holds 8 cases. Pins: test_normalize_arch; test_windows_native_arch_precedence. |
| `tests/hermes_platform/test_gpu_adapters.py` | DXGI's adapter list, read live on Windows.""" Pins: test_dxgi_lists_this_machines_adapters; test_dxgi_answers_empty_off_windows. |
| `tests/hermes_platform/test_host_summary.py` | ``hermes_platform.host.summary``: the machine and account facts desktop first-run onboarding reads.""" Pins: test_shape; test_n1x_cpu_string_is_an_rtx_spark. |
| `tests/hermes_platform/test_import_hygiene.py` | Holds 1 cases. Pins: test_platform_modules_only_import_stdlib_and_hermes_platform. |
| `tests/hermes_platform/test_products.py` | Holds 2 cases. Pins: test_nvidia_platform_from_host_facts; test_linux_nvidia_gpus_come_from_the_driver_files_without_a_process. |
| `tests/hermes_platform/test_resolver_app.py` | Holds 11 cases. Pins: test_locate_reports_expanded_path_when_missing; test_bundle_presence_and_plist_version. |
| `tests/hermes_platform/test_resolver_core.py` | Holds 10 cases. Pins: test_path_hit_comes_first_and_known_dirs_are_still_recorded; test_known_dir_hit_when_path_misses. |
| `tests/hermes_state/__init__.py` | Empty package marker / no cases. |
| `tests/hermes_state/_wal_generation_harness.py` | Shared harness for the lost-WAL-generation tests (#105670 / #105726). |
| `tests/hermes_state/conftest.py` | Shared fixtures for tests/hermes_state.""" |
| `tests/hermes_state/test_append_message_after_close.py` | Regression tests for #94736 — append_message after close() raced a live writer. Pins: TestAppendAfterClose; test_append_message_after_close_reopens_and_lands. |
| `tests/hermes_state/test_append_messages_batch.py` | Tests for SessionDB.append_messages_batch (#23254 salvage). Pins: TestAppendMessagesBatch; test_batch_rows_identical_to_single_appends. |
| `tests/hermes_state/test_auto_archived_lineage_reactivation.py` | A chat the idle sweep archived must reappear once it is live again (#117713). Pins: test_compression_after_auto_archive_unhides_the_live_chat; test_compression_keeps_a_manually_archived_chat_hidden. |
| `tests/hermes_state/test_auto_vacuum_holder_gate.py` | Automatic state.db maintenance never VACUUMs under a foreign writer (#110054). Pins: test_auto_vacuum_skips_while_a_foreign_process_holds_the_store. |
| `tests/hermes_state/test_auto_vacuum_in_process_holder_gate.py` | Automatic VACUUM is refused under a LIVE in-process holder — and never under a retired one. Pins: test_auto_vacuum_skips_while_a_live_sibling_holds_the_same_store; test_auto_vacuum_is_not_starved_by_a_retired_write_fenced_generation. |
| `tests/hermes_state/test_automatic_ended_stamp.py` | Regression tests for #88197 — a dirty automatic ``ended_at`` stamp on a live compression parent must not wedge rotation. Pins: TestAutomaticEndReasonPredicate; test_taxonomy. |
| `tests/hermes_state/test_aux_usage_accounting.py` | Tests for auxiliary usage accounting (issue #23270). Pins: TestRecordAuxiliaryUsage; test_records_task_row. |
| `tests/hermes_state/test_background_review_session_isolation.py` | Tests for background-review session-store isolation (hermes_state). Pins: TestIsBackgroundReviewHarnessMessage; test_matches_skill_review_prompt. |
| `tests/hermes_state/test_bounded_recent_sessions.py` | Regression coverage for latency-bounded recent-session browsing.""" Pins: test_writable_startup_reconciles_legacy_activity_column_before_index; test_bounded_recent_orders_by_durable_activity_and_shapes_preview. |
| `tests/hermes_state/test_canonical_title_guard.py` | The canonical Bot Chat's title is its identity — renames must be refused. Pins: test_user_rename_of_canonical_bot_chat_is_refused; test_clearing_the_canonical_title_is_refused. |
| `tests/hermes_state/test_clean_close_residual_poison.py` | A clean ``SessionDB.close()`` racing a live caller must never be classified as an externally deleted WAL generation (regression for #116244, sibling of #105567). Pins: test_clean_close_never_causes_false_sticky_loss. |
| `tests/hermes_state/test_compacted_message_reactions.py` | Visible archived messages keep the same once-only reaction contract.""" Pins: test_compacted_reactions_are_delivered_once_without_reviving_rewound_rows. |
| `tests/hermes_state/test_composite_carrier_rewind.py` | Transactional persistence contracts for composite compaction carriers.""" Pins: test_composite_rewind_archives_tail_and_inserts_its_hidden_scaffold; test_lineage_display_prefers_tip_carrier_over_replayed_parent_ask. |
| `tests/hermes_state/test_compression_created_source.py` | A managed worker's usage write heals a NULL compression child to the agent surface. Pins: test_desktop_worker_heals_gui_to_desktop; test_stamp_walks_through_a_same_surface_mid_segment. |
| `tests/hermes_state/test_compression_lease_refresh_before_publish.py` | Tests for RC2: pre-publication lease refresh in publish_compression_child. Pins: TestLeaseRefreshBeforePublish; test_refresher_stopped_final_refresh_succeeds. |
| `tests/hermes_state/test_compression_lineage_guard.py` | Regression tests for stale writes after a compression session split.""" Pins: test_find_live_compression_child_returns_unique_direct_child; test_find_live_compression_child_fails_closed_when_ambiguous. |
| `tests/hermes_state/test_compression_watermark_commit.py` | Watermark commit: concurrent appends survive in-place compaction (#75316). Pins: TestWatermarkCommit; test_concurrent_tail_survives_compaction. |
| `tests/hermes_state/test_conftest_wal_gate.py` | The conftest WAL gate must agree with hermes_state, and must not import it. Pins: test_conftest_gate_agrees_with_hermes_state; test_conftest_does_not_import_hermes_state_at_collection. |
| `tests/hermes_state/test_conversation_root.py` | Tests for SessionDB.get_conversation_root — stable conversation id resolution. Pins: test_root_of_standalone_session_is_itself; test_root_covers_delegate_child_sessions. |
| `tests/hermes_state/test_corrupt_row_robustness.py` | One corrupt timestamp row must degrade to one '?' cell, never kill a whole listing/export/report. Pins: test_list_export_and_insights_survive_corrupt_timestamp_rows; test_last_active_skips_a_garbage_message_timestamp. |
| `tests/hermes_state/test_cron_run_sessions.py` | A cron job's run history includes the runs the unified gateway runtime creates (#138812). Pins: test_unified_runs_are_listed_with_legacy_runs_and_only_for_their_job; test_a_fresh_execution_id_with_a_colon_is_refused_before_it_can_misfile_a_run. |
| `tests/hermes_state/test_cross_vm_fs_wal_refusal.py` | Cross-VM filesystem (virtiofs/9p) WAL refusal — port of openclaw#120597. Pins: TestDetectCrossVmFs; test_only_virtiofs_and_9p_mounts_are_flagged. |
| `tests/hermes_state/test_dedupe_migration_contention.py` | The v25 dedupe migration must degrade gracefully on a contended DB. Pins: test_mid_loop_lock_error_returns_instead_of_raising; test_later_run_completes_the_remainder. |
| `tests/hermes_state/test_delegate_cascade.py` | Regression tests for delegate-child cascade collection (#49148). Pins: TestCollectDelegateChildIds; test_collects_delegate_child_excludes_parent. |
| `tests/hermes_state/test_delegate_child_routing_inheritance.py` | A delegate/branch child must never inherit its parent's gateway routing columns. Pins: test_delegate_and_branch_children_do_not_take_over_the_parent_route; test_compression_continuation_of_a_branch_child_keeps_inheriting. |
| `tests/hermes_state/test_delete_branched_root_leftovers.py` | Delete of a compressed + branched root (NF4): the /branch child survives as its own conversation, its ``_branched_from`` naming the deleted segment, and the delete's tombstones age out after the… Pins: test_a_deleted_compressed_root_leaves_its_branch_and_no_reusable_id. |
| `tests/hermes_state/test_delete_compression_chain.py` | Chain-aware deletion invariants for the dashboard delete endpoints (#57543). Pins: test_deleting_tip_removes_whole_chain; test_bulk_delete_removes_whole_chain_of_each_selected_root_and_nothing_else. |
| `tests/hermes_state/test_delete_mode_read_busy_wait.py` | DELETE-journal readers wait out another process's commit instead of raising ``database is locked``. Pins: test_delete_mode_read_waits_for_other_process_commit. |
| `tests/hermes_state/test_delete_session_write_guards.py` | Invariant tests for entry-side deletion refusal on active write guards (#123583).""" Pins: test_delete_session_refuses_when_write_guard_active; test_delete_sessions_bulk_skips_active_write_guards. |
| `tests/hermes_state/test_deleted_wal_checkpoint_guard.py` | Regression for #105670: a halted split-brain/replaced handle must not run ANY checkpoint. Pins: test_close_after_halt_runs_no_checkpoint; test_halt_disables_close_time_checkpoint. |
| `tests/hermes_state/test_deleted_wal_generation_guard.py` | Refuse SessionDB open/write when a deleted WAL generation is still held. Pins: test_classify_deleted_wal_separately_from_main_file_replacement; test_clean_open_and_second_open_still_work. |
| `tests/hermes_state/test_disk_full_error.py` | is_disk_full_error classifies ENOSPC / SQLITE_FULL failures.""" Pins: test_enospc_oserror; test_sqlite_full_operational_error. |
| `tests/hermes_state/test_display_dedupe_pruned_tool_payload.py` | 117750: a prune rewrite of a carried-forward tool call must not split the logical event into a second display identity. Pins: test_pruned_tool_payload_keeps_one_display_identity; test_distinct_idless_assistant_calls_are_not_merged. |
| `tests/hermes_state/test_display_projection_parity.py` | Every display projection of a compacted session must agree. Pins: TestDisplayProjectionParity; test_resume_display_matches_the_rest_transcript. |
| `tests/hermes_state/test_display_read_identity_work.py` | A display read hashes a display identity only where a removed copy could match it (RT-39). Pins: test_a_display_read_with_no_removed_row_hashes_nothing; test_a_display_read_hashes_only_rows_at_a_removed_rows_timestamp. |
| `tests/hermes_state/test_display_read_removed_rows.py` | Display reads hide a message whose newest copy was removed (rewound, or replaced by a newer copy), so they need the removed rows' identities, but never their bodies: ``assert_resume_safe`` does not… Pins: test_display_reads_fetch_no_body_of_a_removed_copy; test_a_rewound_turn_stays_hidden_without_its_body. |
| `tests/hermes_state/test_display_split_heal.py` | A split display generation must still project as one message (issue #122167). Pins: TestSplitDisplayGenerationProjectsOnce; test_text_reply_projects_once. |
| `tests/hermes_state/test_downgrade_delete_guard.py` | A release that predates the gateway runtime refuses, in words, to delete a ledgered session. Pins: test_an_older_release_delete_of_a_ledgered_session_is_refused_with_the_way_back; test_an_upgraded_store_gains_the_guard_on_its_next_open. |
| `tests/hermes_state/test_empty_sweep_archived_transcript.py` | The empty-session sweep must not eat a rewound / compacted transcript (#95868). Pins: test_rewind_to_empty_drifts_the_counter_to_zero; test_sweep_spares_a_rewound_session. |
| `tests/hermes_state/test_fts_cjk_bigram.py` | Tests for the messages_fts_cjk CJK-bigram index (salvaged from PR #65544). Pins: test_two_char_korean_hits_cjk_index; test_mixed_and_ascii_queries. |
| `tests/hermes_state/test_fts_fresh_bootstrap_admission.py` | Fresh state.db FTS bootstrap must honor cross-process rebuild admission.""" Pins: test_fresh_fts_bootstrap_does_not_publish_schema_without_admission. |
| `tests/hermes_state/test_fts_holder_instance_scope.py` | Instance-scoping of the uninspectable-holder fallback. Pins: TestUninspectableHolderInstanceScope; test_other_instance_argv_is_not_a_holder_of_our_db. |
| `tests/hermes_state/test_fts_index_fail_open.py` | Regression tests for #97794: an FTS5-index-only failure must not kill the turn, and an FTS-scoped error that escapes must not be rendered as whole-file damage. Pins: test_turn_flush_survives_fts_only_corruption; test_escaped_fts_only_error_is_index_scoped_not_quarantined. |
| `tests/hermes_state/test_fts_layout_drift.py` | FTS storage-layout drift: one structural answer shared by the stamp, the update notice and doctor. Pins: test_realign_does_not_stamp_current_while_the_trigram_is_stale; test_doctor_offers_optimize_storage_for_a_stale_trigram. |
| `tests/hermes_state/test_fts_orphan_shadow_repair.py` | 103840: a ``sqlite3 .recover`` restore re-emits FTS5 shadow tables as ordinary tables but cannot re-emit the ``CREATE VIRTUAL TABLE`` row. The next SessionDB open then failed in… Pins: test_orphaned_base_family_is_repaired_and_healthy_trigram_untouched. |
| `tests/hermes_state/test_fts_projection_integrity.py` | Regression for the ``messages_fts`` external-content drift (issue #114169). Pins: test_strict_integrity_probe_survives_tool_row_churn; test_index_reading_raw_messages_realigns_once_on_open. |
| `tests/hermes_state/test_fts_rebuild_admission.py` | Cross-process admission for full structural FTS rebuilds (PR #93200 class). Pins: TestRebuildFtsAdmission; test_rebuild_defers_while_another_process_holds_authority. |
| `tests/hermes_state/test_fts_rebuild_corruption_class.py` | ``rebuild_fts()`` must catch the corruption class it exists to recover from (#133375). Pins: test_corruption_class_error_is_caught_and_reported; test_one_corrupt_index_does_not_stop_the_remaining_indexes. |
| `tests/hermes_state/test_fts_runtime_rebuild.py` | Bounded FTS-corruption recovery on live SessionDB paths. Pins: TestRuntimeFtsRebuild; test_reap_candidates_exclude_uninspectable_holder_suspicions. |
| `tests/hermes_state/test_fts_tool_write_bounds.py` | Holds 5 cases. Pins: test_new_tool_rows_bound_fts_content_but_explicit_tool_search_is_complete; test_reopen_keeps_bounded_rows_consistent_without_a_marker. |
| `tests/hermes_state/test_fts_trigram_cron_exclusion.py` | Cron-source exclusion from the external-content trigram FTS index.""" Pins: test_fresh_trigram_indexes_conversations_but_not_cron; test_cron_remains_searchable_via_standard_fts_and_explicit_cjk_fallback. |
| `tests/hermes_state/test_fts_trigram_subagent_exclusion.py` | Delegate-child (subagent) transcripts stay out of the trigram FTS index (v30). Pins: test_subagent_rows_skip_trigram_but_stay_in_standard_fts; test_subagent_rows_remain_word_searchable. |
| `tests/hermes_state/test_fts_update_of_narrowing.py` | FTS UPDATE OF narrowing + migration (#73639 retargeted onto split SessionDB).""" Pins: test_fresh_db_installs_update_of_triggers; test_migrate_replaces_broad_update_trigger. |
| `tests/hermes_state/test_get_anchored_view.py` | Tests for SessionDB.get_anchored_view — anchored window + session bookends. Pins: TestWindowAndBookendShape; test_returns_window_with_bookend_start_and_end. |
| `tests/hermes_state/test_get_messages_around.py` | Tests for SessionDB.get_messages_around (anchored-window primitive). Pins: TestBasicWindow; test_returns_window_around_anchor. |
| `tests/hermes_state/test_get_messages_include_compacted.py` | Tests for SessionDB.get_messages(include_compacted=...). Pins: TestIncludeCompacted; test_default_returns_only_active_rows. |
| `tests/hermes_state/test_guest_durability_barriers.py` | Guest ledger connections must inherit the configured database.synchronous. Pins: test_guest_barriers_apply_configured_synchronous; test_guest_barriers_leave_synchronous_alone_when_unset. |
| `tests/hermes_state/test_hermes_state.py` | Tests for hermes_state.py — SessionDB SQLite CRUD, FTS5 search, export.""" Pins: TestConnectionLifecycle; test_writable_state_db_is_owner_only_under_permissive_umask. |
| `tests/hermes_state/test_hermes_state_archive_open.py` | `hermes sessions archive --include-open`: archive (reversible) may reach never-ended sessions (#139597).""" Pins: test_archive_include_open_reaches_never_ended_sessions; test_prune_rejects_include_open_fail_closed. |
| `tests/hermes_state/test_hermes_state_compression_busy_retry.py` | Appends flow freely during compression; the commit preserves them (#75316). Pins: test_append_is_never_blocked_by_a_foreign_compression_lock; test_append_is_never_blocked_by_a_stale_dead_pid_lock. |
| `tests/hermes_state/test_hermes_state_compression_locks.py` | Tests for ``SessionDB`` compression-lock primitives. Pins: test_acquire_succeeds_when_unlocked; test_acquire_blocks_second_holder. |
| `tests/hermes_state/test_hermes_state_ids.py` | Session-id minting contract: every surface that creates a session mints through ``hermes_state_ids.new_session_id`` and the id it produces is what lost-and-found salvage classifies as a session id… Pins: test_minted_ids_are_what_salvage_classifies_as_session_ids. |
| `tests/hermes_state/test_hermes_state_readonly_preflight.py` | Tests for the read-only DB preflight (port of Kilo-Org/kilocode#12508). Pins: TestRepairScope; test_repairs_readonly_db_inside_home. |
| `tests/hermes_state/test_hermes_state_ux_messages.py` | Plain-language contracts for hermes_state user-facing errors (CLI UX message campaign, cluster D).""" Pins: test_db_unavailable_is_one_line_for_chat_surfaces_by_default; test_db_unavailable_commands_are_pinned_to_the_failing_profile. |
| `tests/hermes_state/test_hermes_state_wal_fallback.py` | Tests for the WAL→DELETE journal-mode fallback on NFS / SMB / FUSE. Pins: TestApplyWalWithFallback; test_succeeds_on_local_fs. |
| `tests/hermes_state/test_history_login_label.py` | A dashboard login may act on the ``<provider>:<user>`` rows Desktop stamps for it. Pins: test_the_login_label_maps_for_an_issuer_less_login; test_a_desktop_labelled_row_takes_its_login. |
| `tests/hermes_state/test_import_deleted_session.py` | An import never restores a user-deleted session id: it refuses it by name at import time. Pins: test_import_sessions_refuses_a_deleted_id_by_name; test_the_runtime_import_refuses_a_deleted_id_by_name. |
| `tests/hermes_state/test_isolation_marker_env.py` | Subprocess-surviving isolation marker (#82770). Pins: test_marker_alone_reports_test_context; test_no_signals_reports_production. |
| `tests/hermes_state/test_journal_mode_config.py` | Behavioral coverage for #68545's centralized journal-mode setting.""" Pins: test_wal_probe_unknown_never_emits_set_pragma; test_resolve_journal_mode_uses_real_database_config. |
| `tests/hermes_state/test_journal_mode_upgrade_warning.py` | An existing database's journal mode must not be rewritten silently (#89293). Pins: TestTheWarningFires; test_an_existing_delete_database_warns_when_flipped. |
| `tests/hermes_state/test_lease_pid_namespace.py` | PID-namespace qualification for state.db lock/lease holder probes. Pins: test_turn_lease_of_sibling_namespace_is_not_stolen; test_flock_holder_record_qualifies_pid_namespaces. |
| `tests/hermes_state/test_ledger_delete_consistency.py` | Legacy delete/prune paths, local reset and adopted-worker settlement stay consistent with the ``session_admissions`` / ``worker_executions`` ledger (ON DELETE RESTRICT). Pins: test_legacy_delete_retires_terminal_ledger_rows_and_refuses_live_work; test_legacy_delete_publishes_the_full_retirement_fence. |
| `tests/hermes_state/test_live_db_guard_ancestry.py` | The live-DB guard must survive a scrubbed child environment (#82770). Pins: TestScrubbedChildEnvironment; test_child_without_pytest_env_still_refuses_production_db. |
| `tests/hermes_state/test_live_db_isolation_guard.py` | Behavioral tests for the live-DB test-isolation guard. Pins: TestProductionPathRefused; test_explicit_production_db_path_raises. |
| `tests/hermes_state/test_lockguard_fcntl_tolerance.py` | A partial or lookalike ``fcntl`` must disable the WAL lock guard, never kill the process. Pins: test_guard_degrades_to_a_no_op_instead_of_killing_every_importer; test_windows_never_arms_the_guard_even_with_an_importable_fcntl. |
| `tests/hermes_state/test_message_uid.py` | ``messages.message_uid``: a durable per-message id that survives every host copy path. Pins: TestMintAndRestore; test_insert_mints_a_uid_and_stamps_the_callers_dict. |
| `tests/hermes_state/test_named_profile_session_db.py` | Named-profile agents must FAIL CLOSED when their profile state.db won't open. Pins: test_open_profile_session_db_returns_profile_handle; test_open_profile_session_db_raises_when_store_unopenable. |
| `tests/hermes_state/test_never_active_keyed_prune.py` | Sweeping never-active keyed gateway rows (#82770). Pins: TestSelector; test_selects_old_never_active_keyed_row. |
| `tests/hermes_state/test_no_locked_readers_gate.py` | Pattern-C gate: pure-read SessionDB methods must not take the writer lock. Pins: TestNoPureReadersUnderWriterLock; test_no_locked_pure_readers. |
| `tests/hermes_state/test_no_more_rows_retry.py` | Retry of transient 'no more rows available' engine errors (#74934 port). Pins: TestNoMoreRowsRetry; test_transient_interface_error_is_retried_to_success. |
| `tests/hermes_state/test_orphan_gateway_session_repair.py` | Repair of gateway sessions that lost their routing identity (#82616). Pins: TestDetection; test_incident_orphan_is_adoptable_by_contiguity. |
| `tests/hermes_state/test_orphan_sweep_cross_backend.py` | Regression tests for #94895: startup orphan sweep must respect cross-backend liveness. Pins: TestStartupSweepRespectsOtherLiveBackends; test_other_backends_live_heartbeat_spares_session. |
| `tests/hermes_state/test_pinned_archived_sidebar.py` | Pinned rows must stay reachable from the sidebar session query. Pins: test_sidebar_query_returns_pinned_archived_session; test_pinned_backfill_still_obeys_other_filters. |
| `tests/hermes_state/test_pinned_lineage.py` | A pin covers the whole conversation, including segments compression publishes after it.""" Pins: test_a_pin_follows_the_chat_through_compression_and_bulk_cleanup_spares_it; test_orphan_sweep_spares_the_open_tip_of_a_chat_pinned_before_it_rotated. |
| `tests/hermes_state/test_placeholder_provenance.py` | Placeholder-first creation must not hide real CLI sessions (#138831).""" Pins: test_placeholder_creator_remains_visible_after_gateway_routing; test_routing_label_local_is_not_creation_provenance. |
| `tests/hermes_state/test_prune_activity_recency.py` | Holds 2 cases. Pins: test_prune_sessions_respects_touch_session_activity; test_prune_keeps_the_compressed_segments_of_a_chat_still_in_use. |
| `tests/hermes_state/test_purge_profile_state.py` | Regression tests for profile-keyed state purge on `hermes profile delete`. Pins: TestPurgeProfileState; test_purges_routing_and_heartbeats_but_keeps_bystanders. |
| `tests/hermes_state/test_read_path_transient_ioerr.py` | 100871: a transient SQLITE_IOERR on a warm pooled read connection is retried on the same connection, then surfaced -- never quarantined, never a close+reopen.""" Pins: test_transient_ioerr_on_pooled_read_is_retried_on_the_same_connection; test_persistent_ioerr_propagates_after_the_budget. |
| `tests/hermes_state/test_readonly_fts_decode_error.py` | Test that read-only SessionDB survives invalid UTF-8 in FTS content (issue #98924).""" Pins: TestReadOnlyFTSDecodeError; test_read_only_open_survives_invalid_utf8_in_fts_content. |
| `tests/hermes_state/test_reasoning_roundtrip.py` | Round-trip tests for the structured reasoning columns. Pins: TestDirectWrite; test_reasoning_fields_hydrate_as_structures. |
| `tests/hermes_state/test_rebuild_table_atomic.py` | ``_rebuild_table`` is one write transaction (port of qwibitai/nanoclaw#3766's idea: hold the write lock across a migration so two openers cannot interleave). Pins: test_sibling_opener_between_rename_and_create_cannot_strand_rows; test_rebuild_failure_rolls_back_rename. |
| `tests/hermes_state/test_recent_model_route.py` | get_recent_session_model_route picks the newest route deterministically on equal last_seen.""" Pins: test_recent_route_tie_on_last_seen_prefers_later_row. |
| `tests/hermes_state/test_rekey_profile_state.py` | Regression tests for profile-name-keyed state migration on `hermes profile rename`. Pins: TestRekeyProfileState; test_rekeys_session_key_namespace_and_profile_columns. |
| `tests/hermes_state/test_remove_session_files_glob_escape.py` | Pruned-session file removal is id-scoped even when the id carries glob metacharacters. Pins: test_remove_session_files_escapes_glob_metacharacters; test_remove_session_files_removes_legacy_session_prefix_snapshot. |
| `tests/hermes_state/test_repaired_history_commit_coverage.py` | The alternation repair's provenance keeps compaction from archiving rows the compressor never held. Pins: test_repaired_reload_commit_archives_only_held_rows. |
| `tests/hermes_state/test_replace_messages_archive_siblings.py` | Sibling-site regression tests for the #80216 bug class. Pins: TestAcpPersistPreservesArchives; test_persist_nonowned_branch_keeps_archived_rows. |
| `tests/hermes_state/test_replace_messages_archives_suffix_only.py` | 82956: ``replace_messages(archive_dropped=True)`` must archive only the dropped suffix. Pins: test_archive_mode_rewind_archives_only_the_dropped_suffix; test_reloaded_session_prefix_still_matches_its_rows. |
| `tests/hermes_state/test_reset_lineage_delete_queued_work.py` | A local reset conversation with accepted queued work survives every legacy delete and sweep of its current physical segment (JoaoMarcos44 R1, andrexibiza 8, dokterdok corr-reset-delete). Pins: test_segment_delete_or_sweep_keeps_a_conversation_with_queued_work; test_idle_conversation_deletes_whole_from_its_current_segment. |
| `tests/hermes_state/test_reset_owner_housekeeping.py` | Housekeeping keeps the logical owner of a retained local reset child. Pins: test_sweeps_keep_the_owner_a_retained_reset_child_needs. |
| `tests/hermes_state/test_resolve_resume_session_id.py` | Regression guard for #15000: --resume <id> after compression loses messages. Pins: test_returns_self_when_only_parent_has_messages; test_walks_from_middle_of_chain. |
| `tests/hermes_state/test_restore_alternation_repair.py` | get_messages_as_conversation(repair_alternation=True) — heal durable alternation violations at the restore boundary. Pins: test_repair_alternation_merges_user_pair; test_repaired_load_is_stable_under_prerequest_repair. |
| `tests/hermes_state/test_resume_summary_carrier_once.py` | Resuming a compressed conversation shows each message once. Pins: test_summary_carrier_does_not_show_its_message_twice. |
| `tests/hermes_state/test_retired_fence_outlives_horizon.py` | The retired-session marker is the deletion fence: the prune pass reclaims a deleted session's tombstones after the retry horizon, but never a user delete's marker, so the id stays deleted. A… Pins: test_a_deleted_session_is_never_recreated_after_the_horizon; test_a_deleted_bot_chat_generation_is_never_reissued. |
| `tests/hermes_state/test_retired_wal_generation_capture.py` | Durable capture of a lost WAL generation (#105670 follow-up). Pins: test_halt_captures_the_exact_retired_generation; test_close_captures_when_the_loss_is_first_seen_at_close. |
| `tests/hermes_state/test_rewind_surfaces_invariant.py` | Invariant: every /undo + /retry surface persists through ``SessionDB.rewind_user_turn``, so the same session rewound through the CLI, the gateway store, or the TUI helper leaves the IDENTICAL active… Pins: test_every_surface_persists_the_same_active_set; test_cli_undo_leaves_the_warm_history_shape_alone_while_the_tui_adopts_row_ids. |
| `tests/hermes_state/test_runtime_admission.py` | Transactional contracts against exclusively owned temporary profile databases.""" Pins: test_admission_retry_claim_and_restart_are_fenced; test_sqlite_failure_never_acknowledges_or_partially_claims. |
| `tests/hermes_state/test_runtime_adoption.py` | Holds 2 cases. Pins: test_explicit_worker_adoption_preserves_claim_without_reexecution; test_unknown_resolution_atomically_revokes_worker_before_unblocking. |
| `tests/hermes_state/test_runtime_destructive_mutations.py` | Deletion cannot erase an admitted input or an adopted worker.""" Pins: test_delete_refuses_outstanding_descendant_obligations; test_delete_receipt_survives_removal_and_fences_generation. |
| `tests/hermes_state/test_runtime_import_mutations.py` | Import rows and retry receipt either commit together or not at all.""" Pins: test_import_rolls_back_rows_with_receipt_failure; test_import_never_overwrites_existing_live_rows. |
| `tests/hermes_state/test_runtime_mutation_actions.py` | Action-specific mutations share the canonical receipt transaction.""" Pins: test_sidebar_edit_is_atomic_and_revision_fenced. |
| `tests/hermes_state/test_runtime_mutation_retired_import.py` | A retired physical ID cannot be assigned to a different imported transcript.""" Pins: test_import_cannot_reuse_a_deleted_receipt_identity. |
| `tests/hermes_state/test_runtime_mutations.py` | Revision, replay and business-rule invariants on real isolated SQLite.""" Pins: test_mutation_receipt_fences_replay_revision_and_epoch; test_mutation_rules_and_receipt_failure_are_atomic. |
| `tests/hermes_state/test_runtime_recovery.py` | Holds 2 cases. Pins: test_frozen_legacy_import_preserves_work_without_branch_theft; test_legacy_import_failure_rolls_back_rows_and_marker. |
| `tests/hermes_state/test_runtime_rewind_carrier_handoff.py` | An owner ``rewind`` of a composite compaction carrier keeps its handoff (main parity).""" Pins: test_rewind_of_carrier_keeps_handoff_and_reports_the_live_ask. |
| `tests/hermes_state/test_runtime_rewind_mutations.py` | Rewind fences the generation and preserves archived history.""" Pins: test_rewind_has_existing_semantics_with_atomic_retry; test_rewind_refuses_queued_work. |
| `tests/hermes_state/test_runtime_schema.py` | Real SQLite schema reconciliation and storage-failure controls.""" Pins: test_schema_reconciles_existing_sessions_without_losing_history; test_real_sqlite_full_aborts_admission_and_epoch_failure_is_atomic. |
| `tests/hermes_state/test_runtime_worker.py` | Holds 3 cases. Pins: test_worker_receipts_require_exact_sequence_assignment_and_adoption; test_worker_mutation_and_receipt_roll_back_together. |
| `tests/hermes_state/test_runtime_worker_children.py` | Owner-reserved delegated children of a worker execution (#141793): the owner mints every child, caps them, scopes their writes to their own row, and retires them with their parent.""" Pins: test_owner_mints_caps_and_scopes_children_and_retires_them_with_the_parent; test_owner_restart_retires_in_flight_children_instead_of_recovering_them. |
| `tests/hermes_state/test_runtime_worker_compaction.py` | Watermarked compaction and rotation share the worker receipt transaction.""" Pins: test_watermarked_compaction_preserves_foreign_tail_and_rejects_stale_holder; test_publication_replay_advances_assignment_once_and_keeps_markers. |
| `tests/hermes_state/test_runtime_worker_compression.py` | Worker compression retains local guard and transcript contracts.""" Pins: test_guard_rollback_and_streaks_are_durable_receipts; test_compression_lease_cannot_be_revived_or_released_by_old_holder. |
| `tests/hermes_state/test_runtime_worker_compression_admission.py` | Physical worker rotation cannot re-key an accepted input or unblock its FIFO.""" Pins: test_rotation_preserves_admission_identity_and_lost_ack_fifo; test_fifo_stays_blocked_while_its_worker_lives_on_a_compression_child. |
| `tests/hermes_state/test_runtime_worker_compression_annotations.py` | Compaction receipts must refresh the producer's row identities.""" Pins: test_compacted_messages_keep_current_row_ids_across_repeated_compaction; test_owner_minted_message_uid_round_trips_through_append_and_archive. |
| `tests/hermes_state/test_runtime_worker_compression_cleanup.py` | Compression cleanup keeps physical and logical lease identities separate.""" Pins: test_rotation_cleanup_releases_only_its_original_compression_holder; test_reopen_orphaned_parent_does_not_steal_live_or_published_continuations. |
| `tests/hermes_state/test_runtime_worker_compression_flush.py` | Compression's pre-publication flush uses the ordinary annotated append helper.""" Pins: test_compression_flush_returns_canonical_annotations_and_keeps_turn_guard. |
| `tests/hermes_state/test_runtime_worker_context.py` | Constructor context is assignment-scoped and shares durable mutation receipts.""" Pins: test_worker_context_preserves_authority_identity_and_prompt_receipts; test_worker_constructor_restores_persisted_compressor_guards. |
| `tests/hermes_state/test_runtime_worker_history.py` | Read receipts preserve replay markers and distinct cache/attribution roots.""" Pins: test_history_and_lineage_keep_cache_scope_distinct_from_attribution; test_declared_cache_boundary_matches_local_database. |
| `tests/hermes_state/test_runtime_worker_lifecycle.py` | Worker lifecycle parity on reserved rows; compose the documented parent hooks.""" Pins: test_reserved_constructor_backfill_and_end_are_receipted; test_late_finalizers_cannot_mutate_successor_or_foreign_rows. |
| `tests/hermes_state/test_runtime_worker_metadata.py` | Ranked labels and exact provider-side data share assignment receipts.""" Pins: test_worker_labels_keep_rank_and_reject_late_generations; test_worker_route_and_api_content_preserve_exact_usage_and_target_fences. |
| `tests/hermes_state/test_runtime_worker_operations.py` | Worker receipts cover the real transcript serializer, not a text-only substitute.""" Pins: test_structured_worker_receipts_are_atomic_and_scoped. |
| `tests/hermes_state/test_runtime_worker_read_fence.py` | Worker read receipts leave the session CAS fence where a client last saw it (W14).""" Pins: test_worker_reads_keep_revision_and_writes_still_advance_it. |
| `tests/hermes_state/test_runtime_worker_rotation_automation.py` | Worker rotation carries automation in the publication transaction.""" Pins: test_publication_moves_automation_once_and_preserves_cleared_controls. |
| `tests/hermes_state/test_runtime_worker_title_retry.py` | Expected title conflicts are committed outcomes, not failed persistence.""" Pins: test_worker_title_collision_can_dedupe_without_poisoning_persistence. |
| `tests/hermes_state/test_runtime_worker_turn_cleanup.py` | Logical turn cleanup remains holder-fenced after physical rotation.""" Pins: test_admitted_parent_lease_releases_after_rotation_without_stealing_successor. |
| `tests/hermes_state/test_runtime_worker_usage.py` | Holds 2 cases. Pins: test_usage_receipt_includes_route_rows_and_rolls_back_on_receipt_failure; test_worker_voice_turn_usage_counts_but_never_rewrites_the_session_route. |
| `tests/hermes_state/test_schema_read_probe.py` | Contract tests for schema_read_probe_statements(). Pins: TestSchemaReadProbeStatements; test_probes_cover_every_declared_column. |
| `tests/hermes_state/test_search_or_relaxed_fallback.py` | OR-relaxed zero-result retry for paraphrased session search recall. Pins: test_or_relaxed_query_rewrite; test_paraphrased_query_recovers_via_or_retry. |
| `tests/hermes_state/test_session_archived_round_trip.py` | Round-trip export/import must restore archived message state (#122679). Pins: test_export_all_round_trips_compacted_history. |
| `tests/hermes_state/test_session_archiving.py` | Holds 4 cases. Pins: test_archiving_compression_tip_archives_projected_root; test_unarchiving_compression_tip_unarchives_projected_root. |
| `tests/hermes_state/test_session_db_acp_cwd_backfill.py` | Repair ACP rows whose workspace lives only in the model_config JSON. Pins: test_backfill_promotes_cwd_from_model_config; test_backfill_never_overwrites_an_existing_cwd. |
| `tests/hermes_state/test_session_db_context_manager.py` | ``SessionDB`` must support ``with``, so an owning scope releases its fds. Pins: test_with_block_closes_the_handle; test_exception_inside_the_block_still_closes_and_propagates. |
| `tests/hermes_state/test_session_db_leak_sweep.py` | Suite-wide SessionDB leak-closing contract (OOM incident 20260816). Pins: test_constructed_sessiondb_is_registered; test_leaked_instance_stays_open_within_the_test. |
| `tests/hermes_state/test_session_db_profile_stamp.py` | SessionDB stamps its own store's profile onto new session rows (#99222). Pins: test_default_store_stamps_default; test_named_profile_store_stamps_own_name. |
| `tests/hermes_state/test_session_db_read_conn_pool.py` | The SessionDB read path must not leak one connection per (SessionDB x thread). Pins: test_read_pool_is_bounded_across_many_threads; test_read_conn_returned_to_pool_and_reused. |
| `tests/hermes_state/test_session_db_read_path_split.py` | Tests for the SessionDB read-path split (pooled read-only connections). Pins: test_reads_do_not_take_writer_lock; test_background_state_reads_never_touch_shared_writer. |
| `tests/hermes_state/test_session_delete_hook.py` | ``on_session_delete`` (#124511): every committed delete or deliberate archive notifies plugins once. Pins: test_every_delete_and_archive_path_fires_once_after_commit; test_raising_callback_never_breaks_deletion. |
| `tests/hermes_state/test_session_delete_profile_isolation.py` | Real-path proof for #78836: DELETE against the wrong profile is already_absent. Pins: test_delete_against_default_does_not_remove_winefox_messaging_session. |
| `tests/hermes_state/test_session_export_timings.py` | Session export timing evidence.""" Pins: test_export_session_includes_text_free_timing_evidence; test_lineage_export_timings_span_the_merged_messages_and_import_ignores_their_size. |
| `tests/hermes_state/test_session_git_metadata_generation.py` | Cross-process ordering for asynchronous session Git metadata probes.""" Pins: test_delayed_probe_cannot_overwrite_newer_a_b_a_claim; test_repeated_same_cwd_claim_invalidates_older_probe. |
| `tests/hermes_state/test_session_hidden.py` | Holds 1 cases. Pins: test_hidden_excluded_by_default_included_on_request. |
| `tests/hermes_state/test_session_id_recognition_recovery.py` | Session recovery must recognise every session-id shape this repo really mints. Pins: test_salvage_recognizes_minted_ids_and_rejects_arbitrary_cells; test_layout_inference_survives_every_derived_id_shape. |
| `tests/hermes_state/test_session_import_keep_flags.py` | A restored or adopted session keeps the user's durable flags. Pins: test_restored_sessions_keep_the_pin_and_the_sweeps_archive_provenance; test_adopted_bot_chat_stays_the_hidden_canonical_chat. |
| `tests/hermes_state/test_session_import_value_validation.py` | Session-import boundary validation for values later read by session APIs. Pins: test_import_rejects_non_finite_session_floats; test_import_rejects_non_finite_nested_model_config. |
| `tests/hermes_state/test_session_lifecycle_status.py` | Lifecycle status classification for session pickers. Pins: test_classify_session_status; test_session_lifecycle_statuses_shapes. |
| `tests/hermes_state/test_session_list_index_choice.py` | Session-list reads stay on the (session_id, timestamp) index whatever the planner stats say (#119403). Pins: test_session_listings_search_messages_only_through_the_timestamp_index. |
| `tests/hermes_state/test_session_md_export.py` | Holds 3 cases. Pins: test_export_candidates_via_prune_filters_ended_old_sessions; test_get_compression_lineage_returns_only_compression_chain. |
| `tests/hermes_state/test_session_model_usage_pk_heal.py` | Unconditional session_model_usage PK heal (#73823, salvage of #73838). Pins: TestSessionModelUsagePkHeal; test_stale_v22_pk_rebuilt_and_accounting_restored. |
| `tests/hermes_state/test_session_read_state.py` | Holds 6 cases. Pins: test_untracked_sessions_are_read; test_mark_read_then_new_activity_flips_back_to_unread. |
| `tests/hermes_state/test_session_turn_lease.py` | Cross-process session turn lease behavior (#84234).""" Pins: test_turn_lease_serializes_separate_session_db_instances; test_turn_lease_is_scoped_to_conversation_root. |
| `tests/hermes_state/test_session_workspace_binding.py` | Session <-> workspace grouping key (hermes_state_sessions.workspace_key). Pins: test_repo_root_is_the_key_when_known; test_falls_back_to_cwd_for_non_git_sessions. |
| `tests/hermes_state/test_shared_session_db_registry.py` | Shared SessionDB registry lifecycle regressions (#90837 review). Pins: TestInodeReplacement; test_live_holders_keep_working_handle_across_replacement. |
| `tests/hermes_state/test_show_subagents_listing.py` | ``sessions.show_subagents`` re-admits delegate runs to human-facing session lists (#97202).""" Pins: test_subagent_runs_stay_hidden_by_default; test_include_subagents_lists_delegate_runs_with_a_matching_count. |
| `tests/hermes_state/test_sqlite_lock_safe_inspection.py` | POSIX advisory locks must survive Hermes' own database inspection. Pins: test_preopen_read_refused_while_connection_is_live; test_tracking_registry_does_not_leak_across_close_paths. |
| `tests/hermes_state/test_sqlite_wal_reset_gate.py` | SQLite WAL-reset vulnerability gate (issue #69784). Pins: TestIsSqliteWalResetVulnerable; test_version_matrix. |
| `tests/hermes_state/test_stale_tool_call_marker_session_repair.py` | Tests for stale tool-call marker session repair (hermes_state, #78148). Pins: TestIsStaleToolCallMarkerMessage; test_matches_bare_marker_with_tool_calls. |
| `tests/hermes_state/test_startup_maintenance_lease.py` | Construction-time state.db maintenance must keep the startup watchdog's progress lease alive (#111092). Pins: test_maintenance_steps_renew_the_armed_watchdog_lease. |
| `tests/hermes_state/test_state_db_corrupt_quarantine.py` | Quarantine of a live SessionDB handle after structural (non-FTS) corruption. Pins: TestQuarantineAfterStructuralCorruption; test_structural_corruption_sets_sticky_flag_and_raises_typed. |
| `tests/hermes_state/test_state_db_darwin_fd_scan_hang.py` | A kernel-blocked vnode must not wedge Hermes startup (#113187). Pins: test_hung_vnode_scan_fails_open_within_budget; test_healthy_scan_still_reports_holder. |
| `tests/hermes_state/test_state_db_file_identity.py` | File-identity guard on SessionDB writes (#89332). Pins: test_replace_with_new_inode_fails_loudly_without_fts_repair; test_second_write_after_halt_does_not_attempt_repair. |
| `tests/hermes_state/test_state_db_fts_segment_collision_probe.py` | Segment-dependent FTS5 trigram corruption (#100227). Pins: test_write_probe_reports_segment_collision_that_integrity_check_misses; test_repair_heals_segment_collision_and_restores_appends. |
| `tests/hermes_state/test_state_db_holders.py` | Behavioral tests for the state-holder and repair-admission authority.""" Pins: test_foreign_holder_uses_device_and_inode_not_path; test_windows_restart_manager_scan_sizes_then_excludes_self. |
| `tests/hermes_state/test_state_db_holders_windows_live.py` | Live Windows proof for #120205: structural maintenance sees a real foreign SQLite holder.""" Pins: test_restart_manager_finds_real_foreign_state_db_holder; test_restart_manager_finds_foreign_sqlite_sidecar_holder. |
| `tests/hermes_state/test_state_db_lock_fail_closed.py` | Unopenable admission lock files must fail CLOSED (#100368). Pins: test_fts_admission_fails_closed_when_lock_file_is_unopenable; test_fts_admission_still_admits_a_pathless_db. |
| `tests/hermes_state/test_state_db_maintenance_conformance.py` | Conformance suite: state.db maintenance must be guard-aware and copy-honest. Pins: test_in_place_op_refuses_or_degrades_under_live_writer; test_live_writer_probe_detects_real_holder. |
| `tests/hermes_state/test_state_db_malformed_repair.py` | Recovery from a malformed state.db schema (duplicate sqlite_master rows). Pins: test_duplicate_fts_makes_every_statement_fail; test_generic_malformed_open_does_not_attempt_schema_surgery. |
| `tests/hermes_state/test_state_db_notadb_fail_closed.py` | Tests for fail-closed state.db NOTADB handling and journal-mode EIO retries. Pins: TestFailClosedAfterNotADb; test_write_does_not_reopen_after_connection_identity_breaks. |
| `tests/hermes_state/test_state_db_repair_live_writer_guard.py` | Regression: the state.db repair path must never run surgery against a database another connection is still writing. Pins: test_repair_refuses_while_another_connection_holds_the_db; test_repair_checks_foreign_holders_before_opening_sqlite. |
| `tests/hermes_state/test_state_db_repair_loop_cap.py` | 86747 regression: the state.db repair loop must be bounded across restarts and must not accumulate identical multi-hundred-MB forensic backups. Pins: TestPersistentAttemptCap; test_failed_repairs_accumulate_in_ledger. |
| `tests/hermes_state/test_state_db_repair_loop_mtime.py` | Regression: the state.db repair-loop guards must survive an mtime change. Pins: test_fingerprint_survives_mtime_change; test_fingerprint_changes_when_contents_change. |
| `tests/hermes_state/test_state_db_repair_non_destructive.py` | A failed state.db schema repair must preserve the recovery image. Pins: test_strategies_never_receive_the_live_database; test_failed_repair_leaves_the_original_byte_identical. |
| `tests/hermes_state/test_state_db_second_process_maintenance.py` | 103339 item 2: structural maintenance from a second PROCESS must refuse while ANY other process holds state.db, even where SQLite's own lock probe is blind (``journal_mode=DELETE`` reader; malformed… Pins: test_repair_refuses_delete_mode_db_held_open_by_another_process; test_holder_scan_sees_through_a_symlinked_home. |
| `tests/hermes_state/test_state_db_stats.py` | Tests for state.db health/stats collection (hermes doctor section). Pins: test_collect_stats_sane_values; test_collect_stats_is_read_only. |
| `tests/hermes_state/test_state_db_wal_unlink_race.py` | Regression coverage for WAL restoration during state.db repair (#101064). Pins: test_wal_restoration_reuses_exclusive_repair_connection; test_repair_never_reopens_after_the_guard_releases. |
| `tests/hermes_state/test_state_db_write_durability.py` | Regression: state.db repair-path writes must be durable on macOS. Pins: test_connect_repair_durable_sets_macos_barriers; test_connect_repair_durable_is_autocommit. |
| `tests/hermes_state/test_state_synchronous_pragma.py` | ``database.synchronous`` is configurable, validated, and floored on macOS. Pins: TestResolveSynchronousLevel; test_accepts_documented_spellings. |
| `tests/hermes_state/test_storage_failure_copy.py` | One copy table for "session storage unavailable / not written" across CLI, gateway and RPC. Pins: test_each_cause_has_a_stable_code_and_an_action; test_details_line_is_flattened_and_bounded. |
| `tests/hermes_state/test_storage_health_latch.py` | A structurally corrupt state.db is published once and read the same way everywhere (#72046). Pins: TestLatch; test_only_structural_corruption_latches. |
| `tests/hermes_state/test_storage_import_boundary.py` | The canonical store must not import gateway/ to compute its own identities (latent cycle).""" Pins: test_runtime_storage_modules_import_without_loading_gateway; test_gateway_names_are_the_storage_definitions. |
| `tests/hermes_state/test_sweep_orphaned_sessions.py` | Tests for #65194: startup-time sweep of orphaned UI-stack sessions. Pins: TestSweepOrphanedSessions; test_stale_tui_session_swept. |
| `tests/hermes_state/test_tail_rewind_semantics.py` | Tests for issue #86366 — carried-forward compaction tail must not satisfy the search recall filter as "summarized away" content. Pins: TestTailCountArchivesAsRewindSemantics; test_tail_originals_hidden_from_recall. |
| `tests/hermes_state/test_target_advance_fence.py` | Target-advancing mutations (reset, compress/model prepare) fence executing work only. Pins: test_target_advance_allows_queued_follower_and_refuses_started_head. |
| `tests/hermes_state/test_telegram_topic_selfheal.py` | Regression for #103363 — reading pre-v3 telegram topic tables self-heals to v3. Pins: test_topic_reads_selfheal_pre_v3_tables; test_absent_tables_still_read_empty_and_are_not_created. |
| `tests/hermes_state/test_terminal_retirement.py` | Deletion removes history but retains exact, scoped terminal evidence.""" Pins: test_used_history_retirement_is_atomic_and_exact; test_nonterminal_obligations_prevent_any_retirement. |
| `tests/hermes_state/test_unaddressed_rewrite_identity.py` | Durable logical-message identity for unaddressed live-replay rewrites (#129065). Pins: test_mutated_replay_rewrites_its_original_row; test_fresh_identical_message_is_never_adopted_by_payload. |
| `tests/hermes_state/test_wal_active_confirmed.py` | 86515: the lock-free mode=ro read pool needs a CONFIRMED WAL header. When the on-disk probe at open is blocked by a concurrent opener, apply_wal_with_fallback reports "wal" as the assumed mode with… Pins: test_blocked_probe_on_delete_file_does_not_enable_read_pool; test_confirmed_wal_file_keeps_read_pool. |
| `tests/hermes_state/test_wal_checkpoint_strategy.py` | Tests for SessionDB WAL checkpoint strategy (issue #45383). Pins: TestTryWalCheckpointPassive; test_checkpoint_uses_passive_mode. |
| `tests/hermes_state/test_wal_lock_guard.py` | A live writer's WAL generation survives lock cancellation and sibling closes. Pins: test_holder_survives_stray_close_then_sibling_closes. |
| `tests/hermes_state/test_wal_lock_guard_lifecycle.py` | The WAL lock guard tracks the lifecycle of the handle it protects. Pins: test_reopened_writer_is_guarded_again; test_guard_never_outlives_the_handle_under_fd_reuse. |
| `tests/hermes_state/test_watermark_interplay.py` | Regression tests for #86366 × watermark interplay in archive_and_compact. Pins: TestWatermarkTailCountInterplay; test_rewind_walk_bounded_at_watermark. |
| `tests/hermes_state/test_worker_lineage_exclusion.py` | A physical worker excludes its whole FIFO lineage; an explicit reset revokes orphan unknowns.""" Pins: test_physical_worker_excludes_logical_fifo_and_second_registration; test_reset_revokes_only_orphan_unknown_worker_and_unblocks_fifo. |
| `tests/hermes_state/test_worker_lineage_index.py` | Lineage worker exclusion is one indexed probe, also on a state.db created before the index.""" Pins: test_lineage_worker_probe_is_indexed_on_new_and_upgraded_stores. |
| `tests/hermes_state/test_write_lock_owner_attribution.py` | Regression: a state.db write-lock timeout names the process holding the lock. Pins: test_parse_proc_locks_keeps_only_write_locks_on_our_inodes_and_decodes_the_wal_write_byte; test_holder_skipped_by_one_proc_locks_pass_is_still_named. |
| `tests/hermes_state/test_write_lock_patience.py` | Write-lock patience for the shared state.db (#74478). Pins: TestTranscriptWritePatience; test_append_message_survives_multi_second_lock_hold. |
| `tests/hermes_state/test_writer_conn_thread_safety.py` | Cross-thread races on the shared writer connection (2026-08-20 incident). Pins: TestConcurrentReadersDoNotRaceTheWriter; test_compression_lock_holder_reads_race_free. |
| `tests/hermes_state/test_zeroed_db_quarantine_race.py` | A concurrent opener's writability preflight must not race another opener's quarantine. Pins: test_preflight_cannot_observe_db_mid_quarantine. |
| `tests/hermes_state/test_zeroed_state_db.py` | 68474 hardening: zeroed state.db detection + quarantine.""" Pins: test_is_zeroed_state_db_and_quarantine; test_is_zeroed_never_probes_special_files. |
| `tests/home_io_guard.py` | Guard Python filesystem calls in tests, not arbitrary native/subprocess I/O.""" |
| `tests/install/BUNDLED_UPDATES.md` | Doc headings: # Bundled application update acceptance / ## Input contract / ## Proof boundaries |
| `tests/install/KNOWN_FAILURES.md` | Doc headings: # Confirmed historical upgrade limitations / ## Windows launcher self-lock / ## July Windows app offers only a manual update for script installs / ## Not classified as unfixable |
| `tests/install/README.md` | Doc headings: # Install and Update E2E Tests / ## The layers / ## The isolation trick / ### The HEAD -> NEXT column / ## What one leg does / ## Desktop chat at install and update checkpoints / ##… |
| `tests/install/e2e-assets/bundle-inputs.mjs` | !/usr/bin/env node // Pin real release packages before a destructive update leg starts. |
| `tests/install/e2e-assets/bundle-manifest.cjs` | // Shared admission for remote inputs and resumed native acceptance phases. |
| `tests/install/e2e-assets/bundle-plan.mjs` | !/usr/bin/env node |
| `tests/install/e2e-assets/bundle-smoke-metadata.mjs` | // Fresh-install admission is separate from the stricter OLD -> NEW update contract. |
| `tests/install/e2e-assets/desktop-smoke-windows.ps1` | Journey-owned mock and ordinary window close, shared by source and MSIX drivers. # Callers supply a checkout-provisioned Node; never resolve tooling from OLD. function… |
| `tests/install/e2e-assets/desktop-smoke.ts` | Helper module (no test cases of its own). |
| `tests/install/e2e-assets/drive-dmg-install.sh` | !/usr/bin/env bash # Drive the Hermes-Setup dmg bootstrap through its first-run GUI. # # The Setup app is Tauri (Rust + system webview), so Playwright/Electron # attach never works. Launch the binary… |
| `tests/install/e2e-assets/drive-update.cjs` | // drive-update.cjs — launch the INSTALLED Hermes.exe (real Electron desktop // app) under Playwright's Electron driver and perform the update the way a // user does: Settings -> About -> "Update… |
| `tests/install/e2e-assets/install-and-launch.ahk` | Requires AutoHotkey v2.0 #SingleInstance Force |
| `tests/install/e2e-assets/installer-common.sh` | !/usr/bin/env bash # Driver-only setup; these helpers never install into the caller's real HOME. arm_source_redirect() { local repo="$1" work="$2" serve="$3" local… |
| `tests/install/e2e-assets/known-failures.cjs` | Helper module (no test cases of its own). |
| `tests/install/e2e-assets/known-failures.json` | JSON head: [ / { / "id": "windows-launcher-self-lock", / "title": "Released Windows updater locks its own console launcher", / "commits": ["a370ab8391ca5f8de7ebbc449f05cb0df36ade7c",… |
| `tests/install/e2e-assets/launch-capture/pm-launch.py` | Run an installed PM CLI with driver-side launch capture under its own -I interpreter. |
| `tests/install/e2e-assets/launch-capture/sitecustomize.py` | Driver-side spawn interception for hermes desktop E2E legs. |
| `tests/install/e2e-assets/launch-from-spec.mjs` | // @ts-check /** Launch the Hermes desktop app from a captured launch spec and click the real update flow: Settings -> About -> "Update now". * The spec is written by launch-capture/sitecustomize.py… |
| `tests/install/e2e-assets/mac-bundled-feed.mjs` | !/usr/bin/env node 'use strict' // mac-bundled-feed.mjs — build the loopback static update feed for the // macOS packaged-app -> open-app-update E2E arm from the REAL signed NEW // zip downloaded by… |
| `tests/install/e2e-assets/mac-bundled-manifest.cjs` | // Independent native signature and installed-stamp assertions. |
| `tests/install/e2e-assets/mac-bundled-relaunch-watch.cjs` | !/usr/bin/env node 'use strict' // mac-bundled-relaunch-watch.cjs — the EXTERNAL relaunch witness for the // macOS packaged-app -> open-app-update E2E arm. // // Runs as a detached process owned by… |
| `tests/install/e2e-assets/mac-bundled-serve.mjs` | !/usr/bin/env node 'use strict' // mac-bundled-serve.mjs — loopback-only static file server for the macOS // bundled-update E2E feed. Serves the directory produced by // mac-bundled-feed.mjs over… |
| `tests/install/e2e-assets/mac-bundled-update-driver.mjs` | // @ts-check // mac-bundled-update-driver.mjs — click the REAL in-app update flow on the // macOS packaged app: launch the installed OLD bundle binary under // Playwright, reach Settings -> About,… |
| `tests/install/e2e-assets/mac-bundled-verify.mjs` | !/usr/bin/env node 'use strict' // mac-bundled-verify.mjs — verify an INSTALLED macOS bundle on the runner: // real codesign validation, BOTH signing identifiers (CFBundleIdentifier // exactly,… |
| `tests/install/e2e-assets/mock-provider.mjs` | // Driver-side wrapper around tests-js/scripts/mock-server.ts (the desktop // E2E suite's OpenAI-compatible mock): starts the server as a LIBRARY // (importing, not executing, so the dev-launcher… |
| `tests/install/e2e-assets/mock-provider.sh` | !/usr/bin/env bash # Start/stop the mock inference server and point the app at it as a REAL # configured provider. # # Why: the desktop app boots to the onboarding overlay when no provider is #… |
| `tests/install/e2e-assets/playback.html` | <!doctype html> <html lang="en"> <head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <title>hermes install-e2e leg player</title> <script… |
| `tests/install/e2e-assets/preserve-plugins.sh` | !/usr/bin/env bash # Shared plugin upgrade-preservation hooks for the install E2E drivers # (POSIX + macOS). Sourced by tests/install/installer-script-e2e.sh and # tests/install/macos-desktop-e2e.sh.… |
| `tests/install/e2e-assets/preserve-user-state.sh` | !/usr/bin/env bash # Shared user-state preservation hooks for the install E2E drivers # (POSIX + macOS + Windows-via-bash). Sourced by installer-script-e2e.sh and # scripts under tests/install/. # #… |
| `tests/install/e2e-assets/process-close.cjs` | // Observe at launch: a renderer can close before the native process and its // stdio pipes. Playwright's driver exit cleanup tree-kills until that close. function observeProcessClose(child) { let… |
| `tests/install/e2e-assets/pty-run.py` | Run a command under a Windows pseudoconsole, capturing its output. |
| `tests/install/e2e-assets/record-start.ps1` | Start a continuous ffmpeg screen recording in the background (windows). # # Usage: powershell -File record-start.ps1 -OutFile recording.mkv # # The graceful stop is the character 'q' on ffmpeg's LIVE… |
| `tests/install/e2e-assets/record-start.sh` | !/usr/bin/env bash # Start a continuous ffmpeg screen recording in the background. # # Usage: record-start.sh OUTPUT.mkv [INPUT_ARGS...] # OUTPUT.mkv where to record (mkv: stays playable even… |
| `tests/install/e2e-assets/record-stop.ps1` | Stop a recording started by record-start.ps1 and verify the file is real. # # Usage: powershell -File record-stop.ps1 -OutFile recording.mkv # # Drops the STOP marker the holder watches for (it… |
| `tests/install/e2e-assets/record-stop.sh` | !/usr/bin/env bash # Stop a recording started by record-start.sh and verify the file is real. # # Usage: record-stop.sh OUTPUT.mkv # # Graceful stop: the character 'q' on ffmpeg's live stdin (the… |
| `tests/install/e2e-assets/red-tracker.mjs` | !/usr/bin/env node /** Keep ONE tracking issue in step with the scheduled install/update matrix. * Run by .github/workflows/install-e2e-red.yml after every scheduled "Install & Update E2E" run. A red… |
| `tests/install/e2e-assets/smoke-env.d.mts` | Empty package marker / no cases. |
| `tests/install/e2e-assets/smoke-env.mjs` | // Environment shaping shared by the desktop smoke drivers and the source-update // window. Dependency-free on purpose: `tests/scripts/test_source_build_env.py` // runs it under a bare `node` with no… |
| `tests/install/e2e-assets/source-branch-probe.cjs` | // Test-only preload for the unpublished Git main used by source-install E2E. // The shipped source checker accepts --branch main, but Desktop's automatic // check normally resolves the published… |
| `tests/install/e2e-assets/source-build-env.ps1` | Child installers/builds stamp their checkout; restore the workflow identity even on failure. function Invoke-SourceBuild([scriptblock]$Action) { $saved = @{} $names = @('GITHUB_SHA', 'GITHUB_REF',… |
| `tests/install/e2e-assets/source-build-env.sh` | !/usr/bin/env bash # OLD and NEW must stamp the checked-out source, not the CI driver's ref. # A subshell preserves the workflow's identity and the git URL redirect. source_build_env() ( unset… |
| `tests/install/e2e-assets/source-desktop-smoke.mjs` | // Read-only source checkpoint adapter. Tooling is resolved from the CI checkout, // never from the historical installation. The standalone driver owns the app. |
| `tests/install/e2e-assets/source-driver.ps1` | Dot-source only. Prefer the published command; never rescue a broken one # through PATH, the user's shared bin, or an obsolete checkout venv. function Get-SourceHermes([string]$Root) { foreach ($name… |
| `tests/install/e2e-assets/source-driver.sh` | !/usr/bin/env bash # Source-only helpers: never search PATH for a different installation. source_hermes() { local root="$1" command="$1/.hermes/bin/hermes" if [ -e "$command" ] // [ -L "$command" ];… |
| `tests/install/e2e-assets/source-runtime-settle.d.mts` | Empty package marker / no cases. |
| `tests/install/e2e-assets/source-runtime-settle.mjs` | Helper module (no test cases of its own). |
| `tests/install/e2e-assets/source-update-command.sh` | !/usr/bin/env bash # Build the installed CLI's invocation for a source-to-source update. # Older releases do not accept either flag, so probe their own help first. build_source_update_command() {… |
| `tests/install/e2e-assets/source-update-observer.mjs` | // A checkout reset is the start of preparation, not its completion. |
| `tests/install/e2e-assets/source_driver.py` | Read-only source-install acceptance, before a CLI launch can repair it. |
| `tests/install/e2e-assets/ts-prefix.ps1` | Add-TsPrefix: prefix each pipeline line with [+MM:SS] relative to the # moment the pipeline started (the playback.html leg player's sync axis). # # Usage (dot-sourced from a driver): # & cmd 2>&1 /… |
| `tests/install/e2e-assets/ts-prefix.sh` | !/usr/bin/env bash # ts_prefix: prefix each stdin line with [+MM:SS] relative to the DRIVER's # start (TS_BASE), not this pipe's start -- every log in a leg shares one # time base, so the… |
| `tests/install/e2e-assets/update-ui.cjs` | // Shared clicks only. Each route owns its receipt/process/relaunch observer. async function pickAppWindow(app, log) { await app.firstWindow({ timeout: 120_000 }) |
| `tests/install/e2e-assets/update-window-chat.d.mts` | Helper module (no test cases of its own). |
| `tests/install/e2e-assets/update-window-chat.mjs` | // The caller owns OLD's lifetime. Record backend provenance in the same receipt // as the shared chat assertion without launching a second app or provider. |
| `tests/install/e2e-assets/user-state-actions.sh` | !/usr/bin/env bash # Produce the user state that preserve-user-state.sh verifies — through the # ORDINARY user surface, including editing a profile's user-owned SOUL.md. # # Why this exists: an… |
| `tests/install/e2e-assets/verify-plugin-preservation.py` | !/usr/bin/env python3 """Plugin upgrade-preservation verifier (Hermes release-harness hook). |
| `tests/install/e2e-assets/verify-user-state.py` | !/usr/bin/env python3 """User-state upgrade-preservation verifier (Hermes install/update E2E hook). |
| `tests/install/e2e-assets/window-input.cjs` | // Shared input setup for the install drivers. Only the selected app window // is changed; helper windows retain their own coordinate system. async function prepareWindowForInput(app, page) { |
| `tests/install/e2e-assets/windows-bundle-metadata.ps1` | Metadata-only readers shared by native admission and pure XML/archive tests. function Read-SmokeXmlEntry($Zip, [string]$Name) { $entries = @($Zip.Entries / Where-Object { $_.FullName -ceq $Name }) if… |
| `tests/install/e2e-assets/windows-bundle-metadata.test.ps1` | Pure archive/XML admission tests: no package deployment or host impersonation. $ErrorActionPreference = 'Stop' Set-StrictMode -Version Latest . (Join-Path $PSScriptRoot 'windows-bundle-metadata.ps1')… |
| `tests/install/e2e-assets/windows-bundle-plugin-smoke.ps1` | Install and enable a plugin with Python dependencies through the installed # package's CLI execution alias, as a basic (non-admin) user. Dot-sourced by # windows-bundle-smoke.ps1 after the chat… |
| `tests/install/e2e-assets/windows-bundled-drive-update.ps1` | ============================================================================ # windows-bundled-drive-update.ps1 — drive the REAL in-app update surface of # the INSTALLED (MSIX) desktop app via UI… |
| `tests/install/e2e-assets/windows-bundled-helpers.mjs` | // Windows packaged-app acceptance helpers. Release Python owns descriptor XML; // msix-shared supplies the expected publisher and content types. --msix-shared // selects the checkout whose release… |
| `tests/install/e2e-assets/windows-bundled-helpers.test.mjs` | // windows-bundled-helpers — unit tests for the pure helpers of the // Windows packaged-app E2E arm. Pure manifest validation plus real descriptor // CLI calls through the release Python module; no… Pins: native acceptance descriptor CLI uses explicit publisher and a stable subscription across upgrades; the feed honours byte ranges, which App Installer requires (0x80D05011 without them). |
| `tests/install/e2e-assets/windows-bundled-processes.test.ps1` | Pipeline/array contracts only; no package installation or live process changes. $ErrorActionPreference = 'Stop' Set-StrictMode -Version Latest . (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1') |
| `tests/install/installer-script-e2e.sh` | !/usr/bin/env bash # Prove a user who installed OLD via the installer script can reach HEAD. # # The POSIX sibling of tests/install/windows-e2e.ps1, sharing its # staging trick and replacing the old… |
| `tests/install/macos-bundle-smoke.sh` | !/usr/bin/env bash # Consumes receipt-verified bytes; never builds, repairs, or relaxes Gatekeeper. set -euo pipefail fail() { printf '%s\n' "bundle smoke: $*" >&2; exit 1; } artifact= arch= commit=… |
| `tests/install/macos-bundled-e2e.sh` | !/usr/bin/env bash # Prove the macOS packaged-app update route: a user on a REAL signed OLD # bundle, installed in an isolated location, clicks About -> "Update now" # and Squirrel.Mac swaps in a… |
| `tests/install/macos-desktop-e2e.sh` | !/usr/bin/env bash # Prove a macOS user who installed OLD via the published desktop installer # (Hermes-Setup.dmg from the website) can reach HEAD. # # The macOS sibling of… |
| `tests/install/windows-bundle-smoke.ps1` | Real deployment of receipt-verified bytes. Never run on a developer desktop. param( [Parameter(Mandatory=$true)][string]$Artifact,… |
| `tests/install/windows-bundled-e2e.ps1` | Native package replacement acceptance. Never run on a developer desktop. param( [string]$ManifestUrl, [ValidateSet('x64','arm64')][string]$Arch = 'x64' ) $ErrorActionPreference = 'Stop'… |
| `tests/install/windows-e2e.ps1` | ============================================================================ # Windows Desktop GUI install + update E2E driver (the REAL user flow) #… |
| `tests/installation/__init__.py` | Empty package marker / no cases. |
| `tests/installation/test_installer_common.py` | Driver setup against private Git/script artifacts, never an installed app.""" Pins: test_redirect_and_historical_installer_keep_transport_flags_and_exit. |
| `tests/installation_launcher_fixture.py` | A real published launcher driving a disposable CLI, without installing deps.""" |
| `tests/integration/test_local_runtime_pm_download.py` | Opt-in live acceptance: download the actual pinned CUDA engine and run it.""" Pins: test_live_pinned_cuda_download_pause_resume_and_execute. |
| `tests/live_process_fixtures.py` | Sleeper script used by the live process-topology E2Es to stand in for real Hermes processes. |
| `tests/lock_contention.py` | Event-driven replacements for "give the other writer N seconds" in serialization tests. |
| `tests/manual/cron_inchannel_dm_e2e.py` | DM-path verification for in_channel continuable cron (Option A scoping). |
| `tests/manual/cron_inchannel_e2e.py` | Offline E2E for continuable in-channel cron (specs/cron-inchannel-continuable). |
| `tests/module_clock.py` | One module's view of ``time`` with a test-driven ``monotonic``. |
| `tests/monitoring/__init__.py` | Empty package marker / no cases. |
| `tests/monitoring/test_cron_health_export.py` | Holds 5 cases. Pins: test_execution_projection_is_opaque_bounded_and_content_free; test_cron_store_writability_is_exported. |
| `tests/monitoring/test_emitter.py` | Tests for the monitoring emitter: hot-path invariant + subscriber fan-out.""" Pins: test_emit_never_raises_when_disabled; test_process_singleton_stays_dormant_until_subscribed. |
| `tests/monitoring/test_export_redaction.py` | Export redaction tests — the security-critical layer. Pins: test_secret_key_always_stripped; test_bearer_header_stripped. |
| `tests/monitoring/test_gateway_health_export.py` | Holds 6 cases. Pins: test_otlp_attrs_redact_strings_and_never_export_profile; test_resource_attributes_are_allowlisted_and_sanitized. |
| `tests/monitoring/test_otlp_exporter.py` | OTLP exporter tests: config resolution, span mapping, streaming subscriber. Pins: test_gateway_health_event_maps_to_span_with_attrs; test_headers_resolve_from_env_not_value. |
| `tests/perf_guards/test_pattern_b_scaling.py` | Pattern-B perf-regression guards: hot paths must not degrade to O(N·M). Pins: TestListSessionsRichQueryBound; test_statement_count_does_not_scale_with_sessions. |
| `tests/plugins/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/browser/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/browser/check_parity_vs_main.py` | Behavior-parity check for the browser-provider plugin migration (#25214). |
| `tests/plugins/browser/test_browser_provider_plugins.py` | Plugin-side tests for the browser provider migration (PR #25214). Pins: TestIsAvailable; test_browserbase_requires_both_api_key_and_project_id. |
| `tests/plugins/dashboard_auth/test_basic_provider.py` | Tests for the BasicAuthProvider plugin (username/password, scrypt, signed tokens). Pins: TestPasswordHashing; test_hash_then_verify_round_trips. |
| `tests/plugins/dashboard_auth/test_drain_provider.py` | Tests for the DrainSecretProvider plugin (non-interactive bearer secret). Pins: TestEntropyGate; test_strong_secret_passes. |
| `tests/plugins/dashboard_auth/test_jwt_clock_skew_leeway.py` | Clock-skew leeway for dashboard-auth JWT verification (#47815). Pins: TestDefaultLeewayAbsorbsClockSkew; test_shared_verify_jwt. |
| `tests/plugins/dashboard_auth/test_nous_provider.py` | Tests for the bundled Nous dashboard-auth plugin. Pins: TestConstruction; test_protocol_compliance. |
| `tests/plugins/dashboard_auth/test_opaque_bearer_not_unreachable.py` | 94558 — a non-JWT bearer must not be reported as "Auth provider unreachable". Pins: test_classifier_maps_transport_failure_to_provider_error; test_classifier_maps_unverifiable_token_to_invalid_code. |
| `tests/plugins/dashboard_auth/test_self_hosted_provider.py` | Tests for the bundled self-hosted OIDC dashboard-auth plugin. Pins: TestConstruction; test_protocol_compliance. |
| `tests/plugins/fixtures/kanban_touch_drag_probe.js` | // Behavioral probe for attachTouchDrag() (#115568): extracts the function from the shipped // dashboard bundle (no build step — the bundle IS the source) and drives it through real //… |
| `tests/plugins/image_gen/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/image_gen/check_parity_vs_main.py` | Behavior-parity check for the image-gen FAL plugin migration (#26241). |
| `tests/plugins/image_gen/test_deepinfra_provider.py` | Tests for the bundled DeepInfra image_gen plugin. Pins: test_list_models_filters_by_image_gen_tag; test_generate_calls_openai_sdk_with_deepinfra_base_url. |
| `tests/plugins/image_gen/test_fal_provider.py` | !/usr/bin/env python3 """Tests for the FAL.ai image generation plugin. Pins: TestFalImageGenProviderSurface; test_default_model_matches_legacy. |
| `tests/plugins/image_gen/test_krea_provider.py` | !/usr/bin/env python3 """Tests for Krea image generation provider.""" Pins: TestKreaImageGenProvider; test_is_available_with_key. |
| `tests/plugins/image_gen/test_meta_ai_provider.py` | Tests for the bundled Meta Model API image_gen plugin (muse-image).""" Pins: TestMetadata; test_catalog_entries_have_display_speed_strengths_price. |
| `tests/plugins/image_gen/test_openai_codex_provider.py` | Tests for the bundled ``openai-codex`` image_gen plugin. Pins: TestMetadata; test_setup_schema_has_no_required_env_vars. |
| `tests/plugins/image_gen/test_openai_provider.py` | Tests for the bundled OpenAI image_gen plugin (gpt-image-2, three tiers).""" Pins: TestMetadata; test_picker_matches_resolvable_catalog. |
| `tests/plugins/image_gen/test_openrouter_compat_provider.py` | !/usr/bin/env python3 """Tests for the OpenRouter-compatible image gen provider (OpenRouter + Nous).""" Pins: TestProviderClass; test_capabilities_support_image_input. |
| `tests/plugins/image_gen/test_xai_provider.py` | !/usr/bin/env python3 """Tests for xAI image generation provider.""" Pins: TestXAIImageGenProvider; test_is_available_with_key. |
| `tests/plugins/memory/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/memory/test_bom_tolerant_config_reads.py` | User-editable plugin/auth JSON survives a Windows-editor BOM. Pins: test_plugin_config_json_tolerates_bom; test_qwen_cli_tokens_tolerate_bom. |
| `tests/plugins/memory/test_byterover_multiplex_child_env.py` | ByteRover's ``brv`` child carries the SERVED profile's cloud identity, never the launch profile's. Pins: test_secondary_profile_child_uses_its_own_key_not_defaults; test_secondary_without_key_gets_no_key_never_defaults. |
| `tests/plugins/memory/test_byterover_provider.py` | Tests for the ByteRover memory provider config gates.""" Pins: test_auto_extract_false_skips_sync_turn. |
| `tests/plugins/memory/test_config_schema.py` | Tests for config-schema loading from memory provider plugin dirs.""" Pins: test_unknown_provider_is_none; test_cache_keys_on_schema_path_not_name. |
| `tests/plugins/memory/test_disabled_provider_not_loaded.py` | A user-installed memory provider parked in ``plugins.disabled`` must not load. Pins: test_disabled_user_provider_is_found_but_never_loaded. |
| `tests/plugins/memory/test_discovery_sources.py` | Discovery parity for out-of-tree memory providers. Pins: test_project_dir_is_ignored_without_opt_in; test_project_dir_is_discovered_when_opted_in. |
| `tests/plugins/memory/test_multiplex_memory_identity_scope.py` | Multiplex invariant: memory-provider identity/tenant/endpoint never comes from the default profile. Pins: test_secondary_profile_memory_identity_never_inherits_default_environ. |
| `tests/plugins/memory/test_provider_multiplex_contract.py` | PLG-11 (#140058): the in-repo memory providers meet the multiplexing contract. Pins: test_byterover_binds_the_home_initialize_receives; test_byterover_two_profiles_interleaving_stay_in_their_own_trees. |
| `tests/plugins/memory/test_provider_threads_inherit_profile.py` | Multiplex invariant: every memory provider's background thread runs under the spawner's profile. Pins: test_provider_background_thread_sees_spawner_profile_home. |
| `tests/plugins/memory/test_retaindb_provider.py` | Holds 9 cases. Pins: test_write_queue_closes_owner_connection; test_write_queue_ignores_enqueue_after_shutdown. |
| `tests/plugins/model_providers/test_commandcode_profile.py` | Unit tests for the CommandCode provider profiles. Pins: TestCommandCodeReasoningWireControls; test_deepseek_disabled_reasoning_sends_thinking_disabled. |
| `tests/plugins/model_providers/test_copilot_profile.py` | Unit tests for the Copilot provider profile's reasoning-effort wiring. Pins: TestCopilotReasoningEffortClamp; test_supported_effort_forwarded_verbatim. |
| `tests/plugins/model_providers/test_custom_profile.py` | Unit tests for the custom provider profile's reasoning wiring. Pins: TestCustomReasoningWireShape; test_no_reasoning_config_emits_nothing. |
| `tests/plugins/model_providers/test_deepinfra_profile.py` | DeepInfra profile puts the reasoning switch on the wire (#111872). Pins: test_profile_translates_reasoning_config_to_top_level_effort; test_transport_main_turn_carries_reasoning_effort_without_capability_gate. |
| `tests/plugins/model_providers/test_deepseek_profile.py` | Unit tests for the DeepSeek provider profile's thinking-mode wiring. Pins: TestDeepSeekThinkingWireShape; test_v4_pro_default_enables_thinking_without_effort. |
| `tests/plugins/model_providers/test_fireworks_profile.py` | Unit tests for the Fireworks AI provider profile. Pins: TestFireworksHeaders; test_attribution_matches_canonical_hermes_values. |
| `tests/plugins/model_providers/test_gemini_profile.py` | Contract tests for the native Google Gemini provider profile.""" Pins: test_native_gemini_auxiliary_default_is_in_curated_catalog. |
| `tests/plugins/model_providers/test_kimi_profile.py` | Unit tests for the Kimi/Moonshot provider profile's reasoning wiring. Pins: TestKimiReasoningWireShape; test_no_config_enables_thinking_without_effort. |
| `tests/plugins/model_providers/test_minimax_profile.py` | Unit tests for the MiniMax provider profile. Pins: TestMinimaxAuxModelM3; test_consumer_api_returns_non_empty_for_each_provider. |
| `tests/plugins/model_providers/test_nous_profile.py` | Unit tests for the Nous Portal profile's reasoning wiring. Pins: TestNousReasoningWireShape; test_disable_reaches_optional_reasoning_model. |
| `tests/plugins/model_providers/test_ollama_cloud_profile.py` | Unit tests for the Ollama Cloud provider profile's reasoning-effort wiring. Pins: TestOllamaCloudReasoningEffort; test_xhigh_and_max_normalize_to_max. |
| `tests/plugins/model_providers/test_opencode_go_profile.py` | Unit tests for OpenCode Go reasoning-control wiring.""" Pins: TestOpenCodeZenOxReasoning; test_max_effort_is_emitted. |
| `tests/plugins/model_providers/test_solstice_profile.py` | Solstice invariants: a pre-release provider stays off every discovery surface until signed in, and a brokered OAuth row with an opaque bearer rotates on its stored expiry.""" Pins: test_solstice_is_off_every_discovery_surface_until_signed_in_but_always_resolves; test_brokered_opaque_bearer_rotates_on_stored_expiry_and_keeps_the_refresh_token. |
| `tests/plugins/model_providers/test_thinking_toggle_parity.py` | Thinking-toggle / reasoning_effort wire invariants shared by the Moonshot- and DeepSeek-style chat_completions profiles (all route through ``agent.reasoning_effort.thinking_toggle_extras``).""" Pins: test_thinking_toggle_and_effort_never_both_on_moonshot_wire; test_ox_alpha_translation_on_zen. |
| `tests/plugins/model_providers/test_upstage_profile.py` | Unit tests for the Upstage Solar provider profile. Pins: TestUpstageProfile; test_fallback_models_are_agentic_pro_only. |
| `tests/plugins/model_providers/test_zai_profile.py` | Unit tests for the Z.AI / GLM provider profile's reasoning wiring. Pins: TestZaiThinkingWireShape; test_no_preference_omits_thinking. |
| `tests/plugins/platforms/buzz/test_buzz_unscoped_requirement_gate.py` | Regression tests for the Buzz requirement gate vs external secrets (#95216). Pins: TestRequirementGateSeesExternalSecrets; test_externally_managed_key_passes_gate. |
| `tests/plugins/platforms/matrix/test_blank_config_env_fallback.py` | A present-but-blank ``matrix:`` key in config.yaml means "unset": the env-var fallback must fire exactly as it does when the key is absent (0.21.2 started seeding blank YAML values into… Pins: test_blank_yaml_values_fall_through_to_env; test_explicit_env_beats_yaml_and_yaml_beats_default. |
| `tests/plugins/platforms/matrix/test_event_size.py` | Every event the Matrix plugin builds fits the homeserver's byte cap, whatever the script or shape of the text: sends, stream/progress edits at the adapter's advertised budget, and the standalone… Pins: test_sends_and_budget_sized_edits_fit_one_event; test_standalone_sender_events_fit_one_event. |
| `tests/plugins/platforms/photon/test_auth.py` | Tests for the Photon auth module (device login + dashboard API).""" Pins: test_store_and_load_photon_token; test_save_auth_never_world_readable. |
| `tests/plugins/platforms/photon/test_check_requirements_risks.py` | Tests for check_requirements() diagnostic logging (fix) and remaining risks. Pins: test_fix_logs_warning_when_httpx_missing; test_risk2_fix_empty_node_modules_no_longer_passes_guard. |
| `tests/plugins/platforms/photon/test_fatal_notify_self_cancel.py` | Photon's fatal-error notification must not be cancelled by its own teardown. Pins: TestFatalNotifyIsDetached; test_health_task_cancellation_does_not_kill_notification. |
| `tests/plugins/platforms/photon/test_inbound.py` | Inbound dispatch + dedup tests for PhotonAdapter. Pins: test_dispatch_text_dm; test_dispatch_read_receipt_does_not_wake_agent. |
| `tests/plugins/platforms/photon/test_markdown.py` | Markdown handling tests for PhotonAdapter. Pins: test_format_message_passthrough_by_default; test_supports_code_blocks_never_enabled. |
| `tests/plugins/platforms/photon/test_mention_gating.py` | Group-chat mention-gating tests for PhotonAdapter. Pins: test_group_message_dropped_without_mention; test_dm_never_gated. |
| `tests/plugins/platforms/photon/test_multiplex_profile_scope.py` | Multiplex secondary-profile scope tests for the Photon adapter + auth module. Pins: TestAuthMultiplexProfileScope; test_scoped_miss_does_not_leak_default_project_id. |
| `tests/plugins/platforms/photon/test_npm_error_log_regression.py` | Regression tests for the npm stderr capture + error log persistence fix. Pins: test_regression_return_code_zero_on_success; test_regression_oserror_on_log_write_does_not_propagate. |
| `tests/plugins/platforms/photon/test_outbound_media.py` | Outbound-media tests for PhotonAdapter. Pins: test_send_image_file_hits_attachment_endpoint; test_standalone_send_text_then_attachments. |
| `tests/plugins/platforms/photon/test_overflow_recovery.py` | Photon adapter resilience to transient Spectrum/Envoy upstream overflow. Pins: test_overflow_strings_classified_retryable; test_unrelated_error_not_retryable. |
| `tests/plugins/platforms/photon/test_poll_clarify.py` | Native-poll clarify tests for PhotonAdapter. Pins: test_poll_vote_dispatched_as_choice_text; test_send_clarify_with_choices_sends_native_poll. |
| `tests/plugins/platforms/photon/test_presence_watchdog.py` | Presence-watchdog tests. Pins: test_probe_config_explicit_zero_disables_watchdog; test_probe_config_invalid_values_fall_back_to_defaults. |
| `tests/plugins/platforms/photon/test_reactions.py` | Reaction (tapback) tests for PhotonAdapter. Pins: test_add_reaction_posts_react; test_remove_reaction_posts_unreact. |
| `tests/plugins/platforms/photon/test_rich_links.py` | Rich-link handling tests for PhotonAdapter. Pins: test_url_only_send_routes_to_richlink_endpoint; test_mixed_prose_url_stays_on_markdown_send. |
| `tests/plugins/platforms/photon/test_runtime_record.py` | Sidecar runtime-record persistence tests (issue #69960). Pins: test_write_read_delete_roundtrip; test_record_written_with_0600. |
| `tests/plugins/platforms/photon/test_setup_access.py` | Tests for `hermes photon setup`'s access auto-configuration. Pins: test_autoconfigure_access_fills_unset; test_env_enablement_seeds_home_channel. |
| `tests/plugins/platforms/photon/test_sidecar_deps_stale.py` | Regression tests for the Photon sidecar stale-dependency self-heal. Pins: test_stale_when_lockfile_newer_than_marker; test_fresh_when_marker_newer_than_lockfile. |
| `tests/plugins/platforms/photon/test_sidecar_lifecycle.py` | Sidecar lifecycle tests: orphan reaping and parent-death wiring. Pins: test_reap_noop_when_port_free; test_start_sidecar_spawns_with_stdin_pipe. |
| `tests/plugins/platforms/photon/test_sidecar_paths.py` | Tests for the Photon sidecar directory resolver (NS-606). Pins: test_env_override_wins; test_writable_source_runs_in_place. |
| `tests/plugins/platforms/photon/test_spectrum_patch.py` | Regression tests for Hermes' Spectrum mixed text+attachment workaround.""" Pins: test_sidecar_patch_failure_still_reaches_health_endpoint; test_spectrum_patch_rewrites_the_imessage_mapper. |
| `tests/plugins/platforms/photon/test_threaded_replies.py` | Inbound iMessage threaded (swipe) replies for PhotonAdapter (#100663). Pins: test_threaded_text_reply_reaches_agent_with_context; test_threaded_photo_reply_keeps_the_photo. |
| `tests/plugins/platforms/photon/test_url_send_path.py` | Behavior tests for Photon raw-URL outbound routing (issue: markdown 500s). Pins: test_send_builder_selection. |
| `tests/plugins/platforms/photon/test_zombie_stream_watchdog.py` | Zombie-stream watchdog tests (half-open gRPC stream, issue #54036). Pins: test_probe_message_id_is_guid_shaped_and_unique; test_probe_rejection_classification_is_strict. |
| `tests/plugins/platforms/slack/test_slash_command_channel_prompt.py` | Slack slash-command turns carry the same channel prompt, skill binding and source names as messages. Pins: test_slash_turn_matches_message_turn_prompt_and_names; test_slash_that_starts_no_turn_costs_no_slack_lookup. |
| `tests/plugins/platforms/telegram/test_allowlist_json_adapter.py` | ``hermes config set telegram.allowed_chats '["a","b"]'`` stores a JSON-encoded string*; every Telegram allowlist reader must decode it instead of comma-splitting the brackets onto the ids.""" Pins: test_json_string_allowlists_decode_across_every_key; test_comma_and_malformed_strings_keep_the_legacy_split. |
| `tests/plugins/platforms/telegram/test_inline_picker_offset.py` | Negative or malformed ``offset`` values must not corrupt inline-picker pagination. Pins: test_negative_offset_returns_first_page; test_any_negative_offset_is_first_page. |
| `tests/plugins/platforms/telegram/test_notification_kwargs.py` | Telegram notification-mode gating (#132516): "important" mode silences ordinary sends, but a human-decision prompt (``is_approval_prompt``) must always push — a silently delivered prompt is… Pins: test_notification_kwargs; test_clarify_text_fallback_pushes_in_important_mode. |
| `tests/plugins/platforms/test_bracket_list_allowlists.py` | Allowlists stored as a JSON-list string* are honoured by every platform gate (issue #76457). Pins: test_bracket_list_string_is_decoded_by_every_platform_gate; test_plain_csv_and_yaml_lists_keep_their_meaning. |
| `tests/plugins/platforms/test_discord_gate_isolation.py` | Per-profile isolation of Discord/Telegram allow/deny gates (issue #72348). Pins: TestTwoAdapterChannelIsolation; test_snapshots_isolate_allowed_channels. |
| `tests/plugins/platforms/test_discord_reauthorize_allowed_roles.py` | Durable Discord re-authorization resolves ``allowed_roles`` like ingress, from current config (#139148). Pins: test_flat_platforms_allowed_roles_authorize; test_platforms_extra_allowed_roles_authorize. |
| `tests/plugins/platforms/test_interactive_setup_reconfigure_gate.py` | Every platform plugin's ``interactive_setup`` routes its "already configured? Reconfigure?" gate through ``hermes_cli.setup_platforms.declines_reconfigure``. Pins: test_declining_reconfigure_goes_through_shared_gate. |
| `tests/plugins/platforms/test_qqbot_plugin.py` | QQ Bot is a bundled platform plugin: env seeding and cron delivery, no live gateway.""" Pins: test_register_shape; test_is_connected_needs_both_credentials. |
| `tests/plugins/test_a2a_forwarded_cancel_retry.py` | A2A forwarded tasks: a resend stays a retry after the process-local id memory forgot it (andrexibiza 5480715949 P2c).""" Pins: test_a_resend_evicted_from_the_process_memory_is_still_a_retry. |
| `tests/plugins/test_a2a_phase23.py` | Streaming / push / anti-loop / task-store tests for the A2A plugin (v1.0). Pins: TestStreamResponseFormat; test_status_update_shape. |
| `tests/plugins/test_a2a_plugin.py` | Tests for the A2A (Agent-to-Agent) platform plugin — protocol v1.0. Pins: TestConnectionGateScope; test_secondary_profile_never_borrows_launch_env_port. |
| `tests/plugins/test_a2a_rejected_resend.py` | A forwarded message refused by an admission guard stays refused on its exact resend.""" Pins: test_resend_of_an_over_budget_message_is_rejected_again. |
| `tests/plugins/test_a2a_tools_gate.py` | a2a client tools config gate (#95681, maintainer-directed). Pins: TestA2AToolsGate; test_unconfigured_install_serves_nothing. |
| `tests/plugins/test_achievements_plugin.py` | Tests for the bundled hermes-achievements dashboard plugin. Pins: test_scan_sessions_default_scans_all_history_not_first_200; test_evaluate_all_first_run_returns_pending_and_starts_background_scan. |
| `tests/plugins/test_chronos_cron.py` | Unit tests for the Chronos NAS-mediated cron provider (Phase 4D). Pins: test_is_available_false_without_config; test_arm_one_shot_sends_provision. |
| `tests/plugins/test_chronos_verify.py` | Tests for the Chronos inbound cron-fire JWT verifier (Phase 4E.1). Pins: test_valid_token_returns_claims; test_wrong_audience_rejected. |
| `tests/plugins/test_context_engine_user_dir.py` | ``context.engine: <name>`` names the active engine, so an engine dropped into ``$HERMES_HOME/plugins/<name>/`` loads without a ``plugins.enabled`` entry and never trips the "Context engine 'X' not… Pins: test_user_installed_engine_is_selected_by_name. |
| `tests/plugins/test_discord_runtime_failure.py` | Holds 1 cases. Pins: test_discord_bot_task_runtime_exit_notifies_gateway_for_reconnect. |
| `tests/plugins/test_disk_cleanup_plugin.py` | Tests for the disk-cleanup plugin. Pins: TestIsSafePath; test_accepts_path_under_hermes_home. |
| `tests/plugins/test_google_meet_audio.py` | Tests for plugins.google_meet.audio_bridge (v2). Pins: test_setup_linux_loads_null_sink_and_virtual_source; test_teardown_linux_unloads_modules_in_reverse_order. |
| `tests/plugins/test_google_meet_node.py` | Tests for the google_meet node primitive. Pins: test_protocol_encode_decode_roundtrip; test_registry_add_get_roundtrip_persists. |
| `tests/plugins/test_google_meet_plugin.py` | Tests for the google_meet plugin. Pins: test_is_safe_meet_url_accepts_standard_meet_codes; test_meeting_id_extraction. |
| `tests/plugins/test_google_meet_realtime.py` | Tests for plugins.google_meet.realtime.openai_client (v2). Pins: test_connect_sends_session_update_with_voice_and_instructions; test_speak_sends_create_and_response_and_writes_audio. |
| `tests/plugins/test_irc_inbound_identity.py` | Distinct IRC lines must remain distinct inputs in the gateway's durable FIFO.""" Pins: test_same_millisecond_irc_lines_get_separate_admissions. |
| `tests/plugins/test_kanban_attachments.py` | Tests for Kanban task file attachments (#35338). Pins: test_add_list_get_delete_attachment; test_delete_attachment_missing_returns_none. |
| `tests/plugins/test_kanban_board_done_order.py` | Kanban dashboard plugin: the board's done column is completion history. Pins: test_done_column_orders_by_completion_time_not_creation; test_done_column_survives_non_integer_completed_at. |
| `tests/plugins/test_kanban_board_lifecycle_api.py` | Kanban dashboard plugin: board rename + delete over the REST surface. Pins: test_rename_board_keeps_slug; test_delete_board_archives_and_reverts_current. |
| `tests/plugins/test_kanban_board_project_api.py` | Kanban dashboard plugin: project listing + project-scoped boards. Pins: test_list_projects; test_create_board_with_project_mirrors_workdir. |
| `tests/plugins/test_kanban_dashboard_plugin.py` | Tests for the Kanban dashboard plugin backend (plugins/kanban/dashboard/plugin_api.py). Pins: test_board_empty; test_create_task_appears_on_board. |
| `tests/plugins/test_kanban_dashboard_task_updated_hook.py` | Dashboard mutation-boundary coverage for ``on_kanban_task_updated``. Pins: test_patch_priority_fires_task_updated; test_bulk_priority_fires_task_updated_per_task. |
| `tests/plugins/test_kanban_estimate.py` | Kanban dashboard plugin: task effort estimate. Pins: test_estimate_parses_model_json; test_estimate_tolerates_unparseable_reply. |
| `tests/plugins/test_kanban_events_tail.py` | The kanban events stream starts at the board's tail unless the client names a cursor. Pins: test_without_since_the_stream_starts_at_the_boards_tail; test_an_explicit_since_replays_from_exactly_there. |
| `tests/plugins/test_kanban_link_tasks.py` | GET /tasks/:id includes `link_tasks` — {id, title, status} rows for every parent/child — so the desktop drawer renders titles instead of raw ids (#kanban-modal). Same router-on-bare-FastAPI harness… Pins: test_link_tasks_resolves_titles_both_sides; test_link_tasks_empty_when_no_links. |
| `tests/plugins/test_kanban_model_override.py` | Per-task model/provider override — DB layer, worker spawn, dashboard API. Pins: test_set_and_clear_model_override; test_provider_without_model_rejected. |
| `tests/plugins/test_kanban_read_admission.py` | HTTP admission regression: board bursts must not consume every worker.""" Pins: test_board_burst_preserves_http_worker_capacity. |
| `tests/plugins/test_kanban_workflow_matrix.py` | Manual move matrix: ``DEFAULT_WORKFLOW.manual`` vs. the live ``PATCH /tasks/{id}``. Pins: test_manual_moves_match_server; test_get_workflow. |
| `tests/plugins/test_kanban_ws_idle_disconnect.py` | Regressions for the kanban events WebSocket connection lifecycle. Pins: test_stream_events_exits_on_idle_disconnect; test_stream_events_reuses_connection_and_closes_after_disconnect. |
| `tests/plugins/test_memory_hook_registration.py` | Exercise dual-kind plugins through the real general and memory loaders.""" Pins: test_dual_kind_plugin_hooks_run_once; test_same_name_different_sources_are_not_suppressed. |
| `tests/plugins/test_multiplex_plugin_cache_scope.py` | Plugin module-level caches must not hand profile A's state to profile B under a multiplexed HERMES_HOME override (``hermes_constants.set_hermes_home_override``). Pins: test_router_efforts_cache_and_base_url_follow_the_active_profile; test_credentialed_catalog_probe_failure_is_not_cached_across_keys. |
| `tests/plugins/test_plugin_automation_blueprints.py` | Plugins register Automation Blueprints via ``ctx.register_automation_blueprint``. Pins: test_plugin_blueprint_is_listed_by_slash_command_and_matches; test_plugin_blueprint_in_api_catalog_and_instantiates_real_job. |
| `tests/plugins/test_plugin_loader.py` | Regression tests for directory-plugin module loading.""" Pins: test_failed_sibling_is_removed_before_init_handles_missing_import; test_successful_sibling_remains_available_on_loaded_module. |
| `tests/plugins/test_plugin_loader_unreadable.py` | One mode-000 / ACL-denied child under a plugin root must not abort the listing (#111804).""" Pins: test_iter_plugin_dirs_skips_unreadable_child. |
| `tests/plugins/test_plugin_paths_follow_profile.py` | Plugin data paths follow the active profile's HERMES_HOME, including the ContextVar override. Pins: test_plugin_path_follows_profile_override. |
| `tests/plugins/test_plugin_storage.py` | Tests for the per-plugin durable storage convention (plugins/plugin_storage). Pins: test_data_dir_lives_outside_the_install_tree; test_hostile_names_are_rejected. |
| `tests/plugins/test_plugin_utils.py` | Tests for plugins/plugin_utils.py — thread-safe lazy singleton helpers. Pins: test_lazy_singleton_builds_once_and_returns_same_instance; test_lazy_singleton_reset_rebuilds. |
| `tests/plugins/test_plugins_manage_profile_scope.py` | plugins.manage optional ``profile`` param — per-profile plugins scoping. Pins: test_plugins_manage_profile_reads_that_profiles_dir; test_plugins_manage_unknown_profile_errors. |
| `tests/plugins/test_retaindb_plugin.py` | Tests for the RetainDB memory plugin. Pins: TestClient; test_base_url_trailing_slash_stripped. |
| `tests/plugins/test_scoped_secret_readers_fail_closed.py` | Credential shims outside the memory plugins honour the secret-scope contract. Pins: test_scoped_read_prefers_profile_scope_over_default_environ; test_scopeless_multiplex_read_fails_loud. |
| `tests/plugins/test_secret_scope_plugin_families.py` | Regression tests: plugin-family credential reads honor the profile secret scope. Pins: TestMemoryFamily; test_retaindb_scoped_key_wins. |
| `tests/plugins/test_security_guidance_plugin.py` | Tests for the security-guidance plugin. Pins: TestPatternsData; test_every_rule_has_required_fields. |
| `tests/plugins/test_teams_duplicate_job_claim.py` | One Graph batch carrying the same no-id notification twice runs its durable job once.""" Pins: test_duplicate_no_id_notifications_in_one_batch_run_the_job_once. |
| `tests/plugins/test_teams_pipeline_meetings.py` | Holds 2 cases. Pins: test_join_url_can_use_organizer_scoped_graph_lookup; test_transcript_download_requests_graph_vtt_content. |
| `tests/plugins/test_teams_pipeline_plugin.py` | Tests for the Teams pipeline plugin package.""" Pins: test_runtime_config_uses_existing_teams_platform_settings; test_bind_gateway_runtime_attaches_scheduler. |
| `tests/plugins/test_telegram_polling_progress_ptb.py` | Integration coverage for polling progress against the installed PTB runtime.""" Pins: test_real_base_request_bom_rejected_by_ptb_cannot_record_progress; test_real_base_request_ptb_replacement_decode_records_progress. |
| `tests/plugins/test_telegram_update_admission.py` | Telegram replay admission through real PTB dispatch (Refs #68502). Pins: test_replay_is_admitted_once_before_dispatch; test_only_pre_handoff_failure_reopens_admission. |
| `tests/plugins/test_transform_api_error_classification_hook.py` | Tests for the ``transform_api_error_classification`` plugin hook. Pins: test_no_hook_falls_through_to_builtin; test_plugin_classification_wins. |
| `tests/plugins/test_transform_tool_result_hook.py` | Tests for the ``transform_tool_result`` plugin hook wired into ``model_tools.handle_function_call``. Pins: test_first_valid_string_return_replaces_result; test_hook_receives_expected_kwargs. |
| `tests/plugins/transcription/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/transcription/check_parity_vs_main.py` | Behavior-parity check for the STT plugin hook + command-provider registry. |
| `tests/plugins/tts/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/tts/check_parity_vs_main.py` | Behavior-parity check for the TTS plugin hook (issue #30398). |
| `tests/plugins/video_gen/__init__.py` | Make tests/plugins/video_gen a package.""" |
| `tests/plugins/video_gen/test_deepinfra_provider.py` | Tests for the bundled DeepInfra video_gen plugin. Pins: test_availability_follows_api_key; test_generate_uses_env_only_proxy_http_client. |
| `tests/plugins/video_gen/test_fal_plugin.py` | Tests for the FAL video gen plugin — family routing, payload shape.""" Pins: test_kling_v3_standard_and_pro_payload_shape; test_minimax_h3_int_duration_and_resolution_alias. |
| `tests/plugins/video_gen/test_openrouter.py` | OpenRouter video_gen plugin — live-catalog shape, per-model clamping, and the submit→poll→download flow.""" Pins: test_catalog_drives_picker_rows_and_selected_model_capabilities; test_payload_clamps_to_model_limits_and_drops_unsupported_toggles. |
| `tests/plugins/video_gen/test_xai_plugin.py` | Smoke tests for the xAI video gen plugin — load & register surface.""" Pins: test_video_input_from_public_url_uses_url_field; test_xai_video_image_input_blocks_credential_store_symlink. |
| `tests/plugins/video_gen/test_xai_plugin_integration.py` | Integration tests for the xAI video gen plugin's simplified surface. Pins: TestXAIEndpoint; test_text_to_video_hits_generations. |
| `tests/plugins/web/__init__.py` | Empty package marker / no cases. |
| `tests/plugins/web/test_web_search_provider_plugins.py` | Plugin-side tests for the web search provider migration (PR #25182). Pins: TestIsAvailable; test_brave_free_requires_api_key. |
| `tests/pm/__init__.py` | Empty package marker / no cases. |
| `tests/pm/_fixtures.py` | Real artifacts and isolated PM workers shared by lifecycle tests.""" |
| `tests/pm/_range_server.py` | Shared Range-honoring loopback server for pm downloader tests. |
| `tests/pm/activation_support.py` | Fixtures shared by the shell-activation tests. |
| `tests/pm/conftest.py` | Shared fixtures for the PM suite.""" |
| `tests/pm/test_activate_fish.py` | ``activate.fish``: fish takes on the environment and gives it back, as ``activate`` does for bash. Pins: test_activate_applies_the_environment_and_deactivate_restores_the_shell; test_setup_failure_leaves_the_caller_unchanged. |
| `tests/pm/test_activate_scripts.py` | ``activate`` / ``activate.ps1``: an interactive shell takes on the environment and gives it back. Pins: test_bash_scripts_pass_syntax_check; test_source_activate_exports_the_pm_env. |
| `tests/pm/test_activation_runtime.py` | Activation syncs through setup before selecting or changing the caller's env.""" Pins: test_bash_cold_sync_changed_input_and_warm_noop; test_bash_setup_failure_preserves_caller. |
| `tests/pm/test_activation_setup.py` | Bash activation crosses real setup, PM install, and uv dependency publication. Pins: test_activation_real_setup_pm_lifecycle. |
| `tests/pm/test_agent_browser_package.py` | agent-browser staging leaves the kept native binary executable. Pins: test_staged_native_binary_is_executable. |
| `tests/pm/test_archive_safety.py` | Hostile archives must not write outside the store entry being staged. Pins: TestPathTraversal; test_zip_entries_cannot_escape_the_destination. |
| `tests/pm/test_artifact_mirror.py` | PM installation and cross-target staging consume the public pinned mirror.""" Pins: test_cold_consumers_recover_after_upstream_removal; test_npm_artifacts_follow_the_users_npm_registry. |
| `tests/pm/test_baked_selection.py` | A Docker image records the extras it bakes, and boot recovery restores them. Pins: test_build_records_the_extra_list_as_the_store_selection; test_record_selection_refuses_builds_without_an_extra_list. |
| `tests/pm/test_bootstrap_import_closure.py` | The tool-only build stage imports PM without third-party dependencies.""" Pins: test_minimal_bootstrap_closure_reaches_pm_paths_and_locks; test_home_mkdir_carries_the_acl_module_in_the_closure. |
| `tests/pm/test_build_operations.py` | Offline behavior contracts for PM's caller-owned build operations.""" Pins: test_stage_tools_copies_verified_closure_without_acquiring_or_live_state; test_verified_tools_admits_only_locked_entries_without_execution. |
| `tests/pm/test_chromium.py` | One browser payload serves both headed and headless callers.""" Pins: test_browser_closure_and_bundle_ship_full_chromium_only; test_chromium_binary_and_env_survive_store_relocation. |
| `tests/pm/test_cli_progress.py` | `pm cli` progress renders in place on a terminal and line-per-tick off one.""" Pins: test_progress_redraws_in_place_on_a_tty; test_progress_off_a_tty_prints_throttled_newline_lines. |
| `tests/pm/test_cold_runtime_e2e.py` | Cold CLI provisioning and repair, with real tools and no mocked child code. Pins: test_cold_cli_builds_own_runtime_discovers_plugins_and_repairs_app. |
| `tests/pm/test_cua_driver_package.py` | CUA archive staging preserves the native host payload, without running it.""" Pins: test_macos_cua_selects_bundle_binary_and_preserves_signature; test_windows_cua_keeps_uiaccess_and_cursor_helpers. |
| `tests/pm/test_custom_root_union.py` | Real default, custom and active-profile roots all discover sibling members.""" Pins: test_home_layout_joins_sibling_union. |
| `tests/pm/test_darwin_build.py` | Native static-library builds use PM's archiver, not PBS's build directory.""" Pins: test_managed_build_archives_native_code; test_archiver_defaults_preserve_explicit_and_custom_toolchains. |
| `tests/pm/test_deb_safety.py` | DebPackage.unpack containment regressions (via pm.store.extract_tar). Pins: test_chained_aliases_survive_without_symlink_support; test_relative_member_escape_preserves_outside. |
| `tests/pm/test_dmgbuild_package.py` | The build-only DMG supplier preserves its paired runtime without executing it.""" Pins: test_dmgbuild_stages_paired_runtime_and_stays_out_of_payload. |
| `tests/pm/test_download_mirrors.py` | Pinned downloads keep their identity when the upstream disappears.""" Pins: test_fallback_retains_hash_destination_and_progress; test_bad_hash_is_not_a_mirror_miss. |
| `tests/pm/test_download_progress.py` | Download progress describes actual whole-plan bytes on fresh and resumed runs.""" Pins: test_progress_counts_cached_files_and_distinguishes_equal_basenames; test_unknown_length_sources_do_not_lose_completed_bytes. |
| `tests/pm/test_download_retry_limits.py` | The real downloader bounds retries and pauses without publishing partial bytes.""" Pins: test_download_failure_never_publishes_partial_bytes; test_pause_interrupts_real_http_retry_backoff. |
| `tests/pm/test_download_serial_fallback.py` | A CDN refusal downgrades this transfer once, including later network retries.""" Pins: test_serial_fallback_survives_a_transient_retry. |
| `tests/pm/test_download_state.py` | GC and downloads acquire the same partial owner before changing its files.""" Pins: test_gc_respects_partial_ownership_and_recent_resume; test_pause_interrupts_an_owner_wait. |
| `tests/pm/test_downloader.py` | pm/downloader: resumable, hash-verified, 8-way parallel downloads. Pins: test_parallel_requests_overlap_without_exceeding_limit; test_progress_carries_overall_and_ranges. |
| `tests/pm/test_downloader_integrity.py` | Every ranged worker must prove which representation and bytes it received.""" Pins: test_invalid_worker_response_cannot_publish; test_failed_copy_publication_keeps_destination_atomic. |
| `tests/pm/test_environment_build.py` | Real, offline uv construction below PM selection and distribution packaging.""" Pins: test_prune_site_pth_keeps_only_load_bearing_pth; test_public_build_installs_all_extras_at_explicit_destination. |
| `tests/pm/test_environment_script.py` | ``pm.environments.shell_exports``: the composed environment as a script a shell can evaluate. Pins: test_a_real_shell_reads_every_value_back_unchanged; test_fish_keeps_path_variables_as_lists. |
| `tests/pm/test_extras.py` | pm.extras: anchor availability, ensure_import, ensure_and_bind, and the spec→extra install shim. Network-free — sync_venv is stubbed at the client seam used by extras; the engine and worker have… Pins: test_extra_supported_ungated_extra_is_true; test_ensure_import_raises_on_gated_off_extra. |
| `tests/pm/test_feature_inventory.py` | Feature inventory reads the selected dependency tree, not the builder.""" Pins: test_inventory_uses_the_target_and_requires_every_anchor. |
| `tests/pm/test_features.py` | pm.features: the frozen bundle feature set (enabled-features.json). Pins: test_write_then_read_roundtrip; test_features_path_in_bundle_uses_payload_root. |
| `tests/pm/test_ffmpeg_resolution.py` | Ffmpeg pin resolution uses the advertised version and target, never a guessed URL.""" Pins: test_resolved_version_fetches_its_exact_target_asset; test_unadvertised_version_refuses_instead_of_relabelling_old_bytes. |
| `tests/pm/test_filesystem_is_junction.py` | is_junction answers for any path, including one that does not exist yet.""" Pins: test_missing_path_is_not_a_junction; test_real_junction_and_plain_directory. |
| `tests/pm/test_generation_durability.py` | A generation's selection record is its completion marker, so it may only be written after the finished tree has been flushed to disk. Otherwise a power loss mid-publish can persist the (fsynced)… Pins: test_install_selection_is_committed_only_after_its_tree_is_flushed; test_side_environment_selection_is_committed_only_after_its_tree_is_flushed. |
| `tests/pm/test_held_entry_windows_live.py` | Live Windows obstacles to removing a replaced PM entry. Pins: test_mapped_dll_in_replaced_entry_does_not_fail_reinstall; test_read_only_file_in_replaced_entry_is_removed_on_reinstall. |
| `tests/pm/test_index_bridging.py` | Mirrored and air-gapped networks configure indexes through pip or uv; PM forwards exactly that into uv while still refusing every other ambient uv setting.""" Pins: test_pip_index_reaches_uv_but_ambient_uv_selection_does_not; test_pip_conf_is_bridged_only_when_uv_has_no_index. |
| `tests/pm/test_install_default_closure.py` | The default `pm install` closure must stage the interpreter boot requires. Pins: test_default_closure_includes_the_boot_interpreter; test_explicit_names_pass_through_untouched. |
| `tests/pm/test_install_download_control.py` | Install controls reach real archive transfers without publishing partial packages.""" Pins: test_install_pause_preserves_archives_and_resumes_the_same_pin. |
| `tests/pm/test_install_extra.py` | `hermes pm install --extra NAME` is the one command every missing-extra hint names.""" Pins: test_hint_names_a_command_the_cli_accepts; test_extra_syncs_only_the_named_extras. |
| `tests/pm/test_install_state_permissions.py` | Permission failures in install state must explain the actual access problem.""" Pins: test_bootstrap_reports_unwritable_install_once; test_pm_repair_reports_unwritable_runtime_without_traceback. |
| `tests/pm/test_install_states_gc.py` | Dependency state of a deleted checkout is reclaimed; state anything live could still read, or whose checkout this process merely cannot see, is kept (``pm/install_states.py``).""" Pins: test_startup_prune_reclaims_only_provably_deleted_checkouts; test_held_orphan_is_kept. |
| `tests/pm/test_installed_package.py` | Installed runtime lookup uses the same shipped/addition precedence as ensure.""" Pins: test_installed_lookup_prefers_current_pin_then_recorded_fallback; test_state_fact_in_shared_facts_file_is_not_a_store_install. |
| `tests/pm/test_lazy_install_policy.py` | PM reads boolean install policy from real config, without CLI output.""" Pins: test_real_policy_is_boolean_and_fails_closed; test_internal_disable_overrides_enabled_config. |
| `tests/pm/test_lease_reselection.py` | A reader that lost the install lock still ends up leasing the generation it imports from.""" Pins: test_unlocked_reader_releases_a_lease_the_installer_moved_away_from; test_release_removes_the_lease_file. |
| `tests/pm/test_llamacpp_pins.py` | Every supported local engine backend installs only reviewed PM artifacts.""" Pins: test_llamacpp_backends_have_pins_for_their_supported_targets. |
| `tests/pm/test_lockfile_publication.py` | Independent pin editors preserve winners and reject changed evidence.""" Pins: test_corrupt_package_state_cannot_be_replaced_by_a_partial_write; test_pin_writers_merge_without_losing_other_rows. |
| `tests/pm/test_long_path_exits.py` | A store root spelled in Windows' extended-length form (``\\\\?\\C:\\...``) stays inside PM. Pins: test_identity_does_not_depend_on_the_root_spelling; test_no_verbatim_spelling_leaves_through_records_environment_or_uv. |
| `tests/pm/test_long_paths_windows_live.py` | Live Windows proof for PM under ``LongPathsEnabled = 0`` (#130242, #130232). Pins: test_store_lifecycle_beyond_max_path_with_long_paths_disabled. |
| `tests/pm/test_member_selection.py` | The workspace and admission paths agree on scoped keys and disabled plugins.""" Pins: test_scoped_members_respect_disabled_and_keep_other_profiles; test_manifest_only_member_is_named_after_its_plugin_dir_and_stays_unique. |
| `tests/pm/test_network.py` | Network retry policy keeps permanent errors immediate and attempts bounded.""" Pins: test_only_transient_failures_use_a_finite_retry_budget; test_retry_after_is_bounded_and_interruptible. |
| `tests/pm/test_network_retries.py` | PM retries transient HTTP failures before publishing verified bytes.""" Pins: test_install_recovers_from_transient_http_failure; test_pm_metadata_reads_retry_transient_http_failure. |
| `tests/pm/test_no_lazy_deps.py` | Contract tests for scripts/ci/check_lazy_deps_imports.py. Pins: test_checker_outcomes; test_untracked_files_are_not_scanned. |
| `tests/pm/test_node_libatomic_install_boundary.py` | Regression tests for #124926: libatomic repair belongs to install, not verify.""" Pins: test_staged_repair_installs_libatomic_then_reprobes; test_auto_repair_never_reads_a_tty. |
| `tests/pm/test_node_release_candidates.py` | The package lock must never choose an unstable Node release.""" Pins: test_node_candidates_exclude_prereleases. |
| `tests/pm/test_node_resolution.py` | Node discovery reads PM state; legacy home-local trees are never activated.""" Pins: test_pm_node_wins_over_legacy_tree_and_composes_child_environment; test_passive_discovery_never_installs_or_repairs_a_legacy_tree. |
| `tests/pm/test_node_sidecar.py` | Plugin-local npm installs retain PM's paired Node and consent policy.""" Pins: test_no_package_json_never_acquires_npm; test_acquisition_receives_consent_and_reports_refusal. |
| `tests/pm/test_npm_dist_tags.py` | npm metadata keeps escaped names, caller headers and retry policy.""" Pins: test_tag_endpoint_drives_package_updates_and_preserves_escaped_names. |
| `tests/pm/test_npm_self_install.py` | npm's self-install keeps its cache out of the store's download entry. Pins: test_npm_self_install_leaves_download_entry_holding_only_the_archive. |
| `tests/pm/test_plugin_declarations.py` | Plugin declaration safeguards from #113851, through PM's real resolver.""" Pins: test_declaration_policy_survives_cross_profile_resolution; test_invalid_requirement_refused_at_declaration_boundary. |
| `tests/pm/test_plugin_inputs.py` | The worker receives the same plugin input the caller built.""" Pins: test_plugin_input_survives_the_worker_wire. |
| `tests/pm/test_plugin_survival_contract.py` | Plugin survival + upgrade contracts (mnemosyne-oss/mnemosyne#859). Pins: test_sidecar_no_root_pyproject_excludes_nested_and_external; test_conflicting_candidate_refused_unenabled_and_unimported. |
| `tests/pm/test_plugins_state.py` | pm.plugins_state: complete, order-preserving cross-profile discovery.""" Pins: test_enabled_plugins_ordered_reads_all_homes; test_only_live_profiles_join_the_dependency_union. |
| `tests/pm/test_pm_authority.py` | pm authority spine: digest-bound facts, tree_digest + doctor re-hash, repair logging. Pins: test_same_version_different_sha_is_not_installed_and_repaired; test_install_repairs_corrupt_entry_from_verified_archive. |
| `tests/pm/test_pm_bionic.py` | Behavior contracts for pm's bionic target + DebPackage + stage_only. Pins: test_all_targets_includes_bionic; test_python_bionic_row_matches_supplier. |
| `tests/pm/test_pm_core.py` | pm end-to-end: install a fake tool from a loopback server, prove the lockfile/installed-state split, env composition, single-flight, adoption, and gc behavior. Real downloads, real archives, real… Pins: test_bad_hash_rejected; test_multi_archive_merges_into_one_entry. |
| `tests/pm/test_pm_musl.py` | A native musl userland resolves PM to musl-native runtime artifacts (#123682).""" Pins: test_musl_userland_gets_a_satisfiable_native_musl_closure. |
| `tests/pm/test_progress.py` | Contained child output: CI keeps every line, interactive runs never hide a failure.""" Pins: test_ci_streams_and_an_explicit_choice_overrides_it; test_contained_run_shows_output_only_when_the_child_fails. |
| `tests/pm/test_project_relock.py` | `hermes pm lock` with no arguments relocks uv.lock through PM and nothing else.""" Pins: test_relock_writes_nothing_when_current_and_names_new_opt_in_extras. |
| `tests/pm/test_python_release_identity.py` | Automatic Python candidates reconstruct only filenames the release advertises.""" Pins: test_python_candidate_preserves_the_advertised_patch_and_build; test_python_candidates_reject_nonmatching_assets_and_leave_manual_targets_alone. |
| `tests/pm/test_receipt.py` | pm.receipt: the universal machine-readable surface for venv ops. Pins: test_begin_record_finalize_roundtrip; test_bare_python_can_report_a_failed_bootstrap. |
| `tests/pm/test_recovery.py` | PM repair replays the selected dependency graph without broken app imports.""" Pins: test_startup_validation_checks_real_ruamel_dependency; test_repair_restores_recorded_plugin_dependencies_without_config. |
| `tests/pm/test_registry_gap_refusal.py` | A registry gap is refused in the caller, never by a PM worker round trip. Pins: test_a_registry_gap_is_refused_without_a_worker; test_selected_git_env_keeps_the_system_git_without_a_worker. |
| `tests/pm/test_restart_needed.py` | restart_needed / adopt_selected against real generations: real uv, offline wheels, temp HERMES_HOME.""" Pins: test_a_process_on_a_superseded_generation_needs_a_restart_until_it_adopts. |
| `tests/pm/test_ripgrep_vc_runtime.py` | ARM64 Windows ripgrep carries the VC++ runtime it links against. Pins: test_arm64_windows_ripgrep_stages_pythons_vc_runtime_beside_rg; test_python_installs_before_ripgrep_so_staging_can_read_it. |
| `tests/pm/test_runtime.py` | PM's resolver must not depend on the application it is repairing.""" Pins: test_pm_runtime_discovers_plugins_without_application_dependencies; test_cold_worker_bootstrap_reuses_the_requests_cache. |
| `tests/pm/test_runtime_boot_gc.py` | A real bootstrap reader pins its generation before GC can select victims.""" Pins: test_bootstrap_lease_survives_selection_change. |
| `tests/pm/test_runtime_bootstrap_tls.py` | The shell-staged uv can prepare TLS support before PM downloads Python.""" Pins: test_staged_uv_prepares_pm_before_any_tool_download; test_pm_cli_verifies_tls_with_platform_trust. |
| `tests/pm/test_runtime_context_home.py` | Context-only homes use the same dependency state as their own process.""" Pins: test_context_home_publication_recovers_from_its_own_process; test_named_context_profile_shares_its_install_root. |
| `tests/pm/test_runtime_entrypoints.py` | Bootstrap entrypoints must hand dependency operations to PM's own interpreter.""" Pins: test_cli_dispatches_before_calling_engine; test_cli_runtime_executes_without_redispatch. |
| `tests/pm/test_runtime_gc.py` | Superseded and aborted PM runtime generations are collected; running workers are not.""" Pins: test_collector_keeps_selected_leased_and_pre_lease_generations; test_collector_yields_to_an_in_flight_stage. |
| `tests/pm/test_runtime_journal_concurrent_edit.py` | Recovery does not overwrite a config edited after interrupted publication.""" Pins: test_recovery_refuses_to_replace_newer_config. |
| `tests/pm/test_runtime_journal_safety.py` | Recovery refuses corrupted metadata and never overwrites unrelated config.""" Pins: test_invalid_journal_cannot_write_outside_home. |
| `tests/pm/test_runtime_selection.py` | Install-scoped dependency selection is readable before third-party imports.""" Pins: test_install_runtime_selection_is_scoped_and_read_only; test_boot_uses_one_selected_dependency_tree_in_fresh_process. |
| `tests/pm/test_runtime_wheelhouse.py` | Exercise offline PM staging with real wheels, not the application's environment.""" Pins: test_offline_wheelhouse_runtime_survives_sealing_and_move; test_offline_wheelhouse_rejects_missing_locked_wheel. |
| `tests/pm/test_security_consumers.py` | Security consumers cross the real PM worker/HTTP/publication boundary.""" Pins: test_consumer_lifecycle; test_signature_rejection_preserves_previous_selection. |
| `tests/pm/test_setup_lock_format.py` | Exercise setup's pre-Python pin reader through real downloads and extraction. Pins: test_setup_reads_pins_independent_of_indentation. |
| `tests/pm/test_shell_candidates.py` | Windows bash resolution as pure data: Program Files Git beats PATH, and the WSL / MSIX stubs never win (#116818). Host-independent — the candidate ladder takes the ``which`` result and env as… Pins: test_system_stub_bash_is_never_a_candidate; test_program_files_git_precedes_the_path_bash. |
| `tests/pm/test_shell_discovery.py` | The local transport can use Git Bash without a PATH entry.""" Pins: test_local_transport_finds_conventional_bash_without_path. |
| `tests/pm/test_source_launcher_stages.py` | Native whole-script publication; POSIX setup/install lives in the fresh E2E.""" Pins: test_powershell_stage_publishes_without_a_checkout_venv. |
| `tests/pm/test_source_update_launch.py` | Source-update launch completion must publish a real PM generation. Pins: test_source_python_pin_update_survives_real_gc; test_launcher_publication_failure_retries_without_rebuilding_dependencies. |
| `tests/pm/test_stage_only.py` | Native/cross-target execution and Windows directory-hold staging contracts.""" Pins: test_bionic_deb_stages_real_packages_without_host_execution; test_real_node_foreign_stage_checks_bytes_without_exec. |
| `tests/pm/test_startup_activation.py` | Startup consumes one real PM verdict; activation never serves a partial toolchain.""" Pins: test_activate_moves_store_dirs_ahead_of_user_dirs; test_drift_activates_intact_chains_and_reports_the_live_verdict. |
| `tests/pm/test_startup_recovery.py` | Bare startup repairs through real PM workers before activating dependencies. Pins: test_bootstrap_repairs_before_dependency_activation. |
| `tests/pm/test_store_extensions.py` | A bundle reuses shipped bytes and adds missing pinned tools outside its seal.""" Pins: test_missing_bundle_tool_is_installed_in_writable_store; test_corrupt_shipped_facts_are_only_read. |
| `tests/pm/test_store_extract.py` | Regression for the Ubuntu 22.04 bootstrap interpreter: python-build-standalone tarballs carry relative terminfo symlinks (``share/terminfo/1/1178 -> ../a/adm1178``).""" Pins: test_relative_symlinks_resolve_from_their_own_directory; test_symlinks_escaping_the_destination_are_rejected. |
| `tests/pm/test_store_lock_wait.py` | A writer queued behind the store lock says so instead of blocking silently.""" Pins: test_install_lock_reports_what_it_waits_on. |
| `tests/pm/test_store_resume.py` | Store scratch cleanup retains resumable bytes outside the scratch directory.""" Pins: test_store_fetch_resumes_interrupted_download. |
| `tests/pm/test_sync_bytecode_compile_fallback.py` | uv --compile-bytecode is an optimization. A compile-step failure must not fail the dependency sync (#124268). Pins: test_streamed_sync_retries_without_bytecode_compile_and_reports_no_failure; test_sync_does_not_retry_an_unrelated_uv_failure. |
| `tests/pm/test_takeover_preparation.py` | Fresh takeover bootstrap prepares actual dependencies before completion.""" Pins: test_fresh_takeover_prepares_generation_and_runs_selected_python. |
| `tests/pm/test_termux_libs.py` | The termux pool pin authority: parse the index, retire, repin. Pins: test_parse_index_reads_stanzas_and_ignores_continuations; test_parse_index_keeps_the_pool_epoch_and_drops_rows_without_a_hash. |
| `tests/pm/test_tree_digest_links.py` | Realized digests bind link text without reading the linked directory.""" Pins: test_digest_without_pathlib_junction_api; test_directory_links_bind_only_their_target_text. |
| `tests/pm/test_update.py` | Independent resolution decisions; HTTP parsing lives in request-reuse tests.""" Pins: test_version_key_sorts_numeric_and_suffixes; test_minor_of. |
| `tests/pm/test_update_artifact_refresh.py` | Minor-style updates follow advertised artifacts without dropping other pins.""" Pins: test_same_minor_refresh_updates_real_bytes_and_preserves_unresolved_targets. |
| `tests/pm/test_update_auth_scope.py` | Index credentials stay on their exact HTTPS origin, including redirects.""" Pins: test_index_credentials_match_the_exact_origin; test_index_redirects_use_the_credential_safe_opener. |
| `tests/pm/test_update_dependency_legs.py` | Optional dependency refreshes run in PM's repository with its installed tools.""" Pins: test_uv_refresh_uses_real_installed_tool_and_only_the_owned_project; test_npm_refresh_uses_its_installed_entry_and_owned_project. |
| `tests/pm/test_update_failure_status.py` | A failed update lookup is not a current result or permission to apply.""" Pins: test_failed_resolution_stops_every_apply_path; test_current_and_manual_results_are_successful_without_writes. |
| `tests/pm/test_update_pin_isolation.py` | 125386: one failing pin must not zero out the whole `pm update` run. Pins: test_one_failing_pin_does_not_block_the_rest; test_all_pins_failing_leaves_lockfile_untouched. |
| `tests/pm/test_update_request_reuse.py` | An update reads each successful index/artifact once, not once per target.""" Pins: test_resolution_reuses_successful_responses_but_refreshes_next_operation; test_llama_real_index_fallback. |
| `tests/pm/test_user_facing.py` | The terminal runs the user's own tools first and Hermes's after them (pm.user_facing).""" Pins: test_user_tools_come_before_hermes_and_python_stops_at_the_store_stub; test_a_sealed_windows_payload_swaps_packaged_tools_for_writable_copies. |
| `tests/pm/test_uv_cache.py` | PM caches are writable; shipped dependency environments stay immutable.""" Pins: test_uv_cache_dir_seeds_from_payload; test_uv_cache_dir_cold_machine_no_payload. |
| `tests/pm/test_uv_cache_publication.py` | Cache readers must never see an unfinished payload seed copy.""" Pins: test_seed_publishes_only_a_complete_file; test_interrupted_seed_preserves_readers_and_retries. |
| `tests/pm/test_uv_cache_seed.py` | A failed uv-cache seed must not record completion. Pins: test_update_merges_the_new_payload_into_an_existing_seed; test_partial_seed_is_retried_on_the_next_install. |
| `tests/pm/test_uv_python.py` | PM-owned uv commands use the installed interpreter, never host discovery.""" Pins: test_internal_tooling_cannot_escape_package_queries; test_all_uv_commands_keep_the_pm_interpreter. |
| `tests/pm/test_venv_command.py` | A sealed payload enters its venvs on its own interpreter, never through their redirectors. Pins: test_unsealed_trees_run_the_venv_interpreter; test_sealed_payload_runs_scripts_code_and_modules_without_the_redirector. |
| `tests/pm/test_venv_sync_ambient_config.py` | Ambient uv settings cannot steer PM; project configuration still can.""" Pins: test_ambient_uv_config_does_not_affect_pm_venv_sync. |
| `tests/pm/test_windows_build_deps.py` | Native PowerShell prerequisite selection without downloading build tools.""" Pins: test_entrypoint_exports_child_environment_and_only_github_deltas; test_initializer_preserves_rust_homes_and_shared_openssl_without_downloads. |
| `tests/pm/test_worker.py` | Real isolated workers: no parent imports or callables cross the wire.""" Pins: test_isolated_worker_preserves_install_error; test_refused_or_already_paused_install_does_not_acquire_runtime. |
| `tests/pm/test_worker_observers.py` | Progress observers cannot stall other range writers in the isolated worker.""" Pins: test_slow_worker_observer_does_not_hold_range_writers; test_worker_observer_failure_preserves_resumable_bytes. |
| `tests/pm/test_worker_publication.py` | Plugin publication runs in PM's independent worker, not application callbacks.""" Pins: test_worker_publishes_selection_even_when_dependencies_are_current; test_staged_plugin_publication_uses_installed_identity_and_local_dependencies. |
| `tests/pm/test_worker_receipts.py` | Worker receipts cross the process seam by identity, never latest.json.""" Pins: test_worker_receipt_is_attributed_only_to_its_invoking_update. |
| `tests/pm/test_worker_registry.py` | Registered package declarations survive a fresh, isolated interpreter.""" Pins: test_registered_package_installs_archive_in_real_worker; test_definition_import_failures_are_package_errors. |
| `tests/pm/test_worker_stdio.py` | Worker control traffic must never become a subprocess's standard input.""" Pins: test_worker_children_get_eof_while_control_pipe_stays_open. |
| `tests/pm/test_workspace.py` | pm.workspace: the generated uv-workspace root for plugin deps. Pins: test_preparation_refuses_existing_workspace_without_mutating_it; test_missing_explicit_seed_cannot_silently_resolve_new_versions. |
| `tests/pm/test_workspace_build_inputs.py` | Workspace generation carries the source inputs of a buildable core.""" Pins: test_real_build_inputs_stay_in_generated_root; test_repair_replays_saved_in_tree_build_backend. |
| `tests/pm/test_workspace_output_encoding.py` | Captured package-tool output must not depend on the host's ANSI code page.""" Pins: test_uv_failure_retains_utf8_build_diagnostic; test_node_sidecar_retains_output_and_exit_status. |
| `tests/pm/test_zip_symlinks.py` | Zip extraction must preserve symlinks — and refuse hostile ones. Pins: test_framework_shaped_links_round_trip; test_intree_dotdot_target_is_kept. |
| `tests/posix_lock_probe.py` | This process's POSIX advisory locks on a file, read from ``/proc/self/fdinfo`` (Linux). |
| `tests/providers/__init__.py` | Empty package marker / no cases. |
| `tests/providers/fake_pkce_idp.py` | Local fake OAuth IdP on 127.0.0.1 for the PKCE plugin helper (tests + live evidence). |
| `tests/providers/test_auth_registry_import_order.py` | Regression coverage for provider auth registration during TUI imports.""" Pins: test_tui_import_exposes_auth_registry_to_provider_plugins. |
| `tests/providers/test_auth_registry_mid_discovery.py` | Regression tests for #102123: plugins discovered after ``hermes_cli.auth`` is first imported must still reach ``PROVIDER_REGISTRY``. Pins: test_plugins_discovered_after_auth_import_resolve; test_post_discovery_registration_is_mirrored. |
| `tests/providers/test_e2e_wiring.py` | E2E tests: verify _build_kwargs_from_profile produces correct output. Pins: TestNvidiaProfileWiring; test_nvidia_tool_messages_drop_name_fields. |
| `tests/providers/test_entry_point_discovery.py` | Tests for pip entry-point provider discovery (hermes_agent.plugins group). Pins: test_entry_point_callable_and_module_targets; test_entry_point_not_enabled_is_skipped. |
| `tests/providers/test_fetch_models_base_url.py` | Tests for ProviderProfile.fetch_models base_url override (issue #47009).""" Pins: TestFetchModelsBaseUrlOverride; test_base_url_override_used. |
| `tests/providers/test_installed_plugin_discovery.py` | A provider installed by ``hermes plugins install`` must actually be found. Pins: test_flat_installed_model_provider_plugins_are_discovered_alongside_nested_ones; test_other_plugins_in_the_flat_directory_are_left_to_the_plugin_manager. |
| `tests/providers/test_meta_ai_profile.py` | Tests for the bundled Meta Model API (Muse Spark) provider plugin. Pins: TestMetaAIProfile; test_images_ride_user_turns_not_tool_results. |
| `tests/providers/test_named_custom_reasoning.py` | Named custom routes use the same reasoning contract as bare custom. Pins: test_bare_named_custom_provider_gets_custom_profile; test_named_custom_route_keeps_final_reasoning_effort. |
| `tests/providers/test_oauth_pkce_plugin.py` | Invariants for the declarative OAuth PKCE helper an out-of-tree provider plugin plugs into ``ProviderProfile.auth_handler`` / ``refresh_credential``.""" Pins: test_pkce_handler_add_status_refresh_logout_against_fake_idp; test_token_url_off_authorize_allowlist_refused_before_any_request. |
| `tests/providers/test_plugin_discovery.py` | Tests for the model-providers plugin discovery system. Pins: test_bundled_plugins_discovered; test_all_profiles_register. |
| `tests/providers/test_profile_home_layers.py` | ``$HERMES_HOME`` model-provider plugins resolve for the profile home bound at lookup time (#88143). Pins: test_secondary_profile_plugin_resolves_for_its_home_only; test_plugin_installed_after_discovery_is_found_without_a_restart. |
| `tests/providers/test_profile_wiring.py` | Profile-path parity tests: verify profile path produces identical output to legacy flags. Pins: TestNvidiaProfileParity; test_max_tokens_match. |
| `tests/providers/test_provider_profiles.py` | Tests for the provider module registry and profiles.""" Pins: TestOpenRouterProfile; test_sticky_session_id_normalizes_cron_timestamp. |
| `tests/providers/test_provider_registry.py` | Holds 4 cases. Pins: test_list_providers_reuses_cached_snapshot_until_registration_changes; test_list_providers_dedupes_aliases_in_cached_snapshot. |
| `tests/providers/test_transport_parity.py` | Parity tests: pin the exact current transport behavior per provider. Pins: TestNvidiaParity; test_user_max_tokens_overrides. |
| `tests/run_interrupt_test.py` | !/usr/bin/env python3 """Run a real interrupt test with actual AIAgent + delegate child. |
| `tests/scripts/desktop_update/legacy_desktop_reader.py` | Run the update-marker reader an old packaged Desktop shipped (not collected).""" |
| `tests/scripts/desktop_update/lineage_rule_cases.py` | The launcher-lineage rule shared by marker.sh (marker_launcher_rule) and marker-claim.ps1 (Test-MarkerLauncherRule): one table, every consumer runs it. |
| `tests/scripts/desktop_update/test_desktop_update_gateway_flag.py` | The hand-off's `--gateway` flag, exercised against the real posix script. Pins: test_default_handoff_asks_for_the_local_gateway; test_no_gateway_flag_omits_gateway_from_update. |
| `tests/scripts/desktop_update/test_desktop_update_linux_gate.py` | The linux relaunch gate must compare canonical paths, not spellings. Pins: test_symlinked_spelling_on_either_side_still_relaunches; test_target_outside_the_checkout_is_still_skew. |
| `tests/scripts/desktop_update/test_desktop_update_linux_gate_arm.py` | ARM64 unpacked-dir coverage for the linux relaunch gate (#94703). Pins: test_arch_specific_unpacked_dir_still_relaunches; test_arch_specific_dir_is_preferred_over_a_stale_x86_64_one. |
| `tests/scripts/desktop_update/test_desktop_update_mac_swap_interrupt.py` | An interrupted macOS app swap always comes back as one complete bundle. Pins: test_killed_app_swap_recovers_to_a_complete_bundle. |
| `tests/scripts/desktop_update/test_desktop_update_macos_no_browser.py` | The macOS hand-off never launches a second browser instance (#96374). Pins: test_macos_handoff_opens_no_browser_window_when_chrome_is_default. |
| `tests/scripts/desktop_update/test_desktop_update_posix_handoff_protocol.py` | posix.sh / marker.sh hand-off protocol 2 and the A7 marker lock, against real processes. Pins: test_dead_marker_is_reclaimed_by_exactly_one_of_two_live_claimants; test_old_desktop_bridge_naming_its_launcher_is_adopted_by_lineage. |
| `tests/scripts/desktop_update/test_desktop_update_posix_marker.py` | posix.sh owns the update marker like a lock (contract C1/C2) and reports a committed update as committed (contract C3). Every case runs the real script against a disposable install; liveness is… Pins: test_live_marker_is_never_reclaimed_and_refuses_the_handoff; test_marker_bodies_are_parsed_positionally_like_every_other_reader. |
| `tests/scripts/desktop_update/test_desktop_update_posix_marker_corpus.py` | marker.sh runs EVERY case of the shared update-marker corpus (A7 rule 7). Pins: test_every_judge_case; test_every_release_case. |
| `tests/scripts/desktop_update/test_desktop_update_runtime_unicode.py` | runtime.ps1 must decode the launcher's UTF-8 path output on Windows (#124526). Pins: test_runtime_command_survives_a_non_ascii_profile_path; test_legacy_version_identity_check_matches_a_non_ascii_install. |
| `tests/scripts/desktop_update/test_desktop_update_shim_profile_cleanup.py` | The update hand-off cleans only an atomically claimed browser profile.""" Pins: test_shim_removes_only_its_owned_profile. |
| `tests/scripts/desktop_update/test_desktop_update_shim_progress.py` | The shim's /progress contract, exercised against the real posix hand-off. Pins: test_elapsed_advances_between_publishes; test_every_state_carries_a_clock. |
| `tests/scripts/desktop_update/test_desktop_update_tcc_heal.py` | Desktop hand-off self-heal for venvs bricked by the reverted macOS TCC anchor (#95759), exercised against the REAL ``posix.sh`` functions. Pins: TestAnchorHeal; test_healthy_venv_untouched. |
| `tests/scripts/desktop_update/test_desktop_update_windows_commit_outcome.py` | Post-commit outcomes (contract C3) on the real Windows hand-off script. Pins: test_verify_failure_after_a_committed_update_is_ok_with_warnings; test_result_is_atomic_json_carrying_started_at_and_warnings. |
| `tests/scripts/desktop_update/test_desktop_update_windows_cwd.py` | Native regression coverage for the Windows Desktop handoff cwd.""" Pins: test_handoff_children_run_from_install_root; test_handoff_children_cannot_read_the_handoff_console. |
| `tests/scripts/desktop_update/test_desktop_update_windows_handoff_lineage.py` | Who may adopt a pre-written claim (real processes): an OLD packaged Desktop's ``cmd.exe`` wrapper v1 overwrite is accepted by lineage only (R4), and with ``-HandoffRun`` only the Desktop bridge for… Pins: test_r4_old_desktop_wrapper_claim_is_adopted_by_lineage; test_r4_old_desktop_lineage_never_adopts_an_unrelated_live_claim. |
| `tests/scripts/desktop_update/test_desktop_update_windows_marker.py` | Update-marker contract C1 v2 on the real Windows hand-off script. Pins: test_claim_is_the_first_action_and_writes_a_v2_body; test_live_foreign_owner_refuses_and_reused_pid_is_reclaimed. |
| `tests/scripts/desktop_update/test_desktop_update_windows_marker_corpus.py` | The shared update-marker corpus (A7 rule 7) on the PowerShell reader/releaser. Pins: test_every_corpus_case_matches_on_windows_powershell. |
| `tests/scripts/desktop_update/test_desktop_update_windows_marker_lock.py` | A7 on the real Windows hand-off script: every marker mutation happens inside one hold of the kernel lock on ``<marker>.lock`` and the update child is the marker's delegate before it runs a single… Pins: test_a7_claim_is_decided_inside_the_marker_lock; test_a7_concurrent_claimants_over_a_dead_marker_yield_one_owner. |
| `tests/scripts/desktop_update/test_desktop_update_windows_marker_ops.py` | Protocol-2 helper ops (``windows.ps1 -MarkerOp reclaim/withdraw``) and the production release / heartbeat functions, on real processes and files. """ Pins: test_marker_op_reclaim; test_marker_op_reports_busy_while_the_lock_is_held. |
| `tests/scripts/desktop_update/test_desktop_update_windows_pipe_drain.py` | Regression: Windows Desktop update steps must drain and terminate reliably. Pins: test_update_step_survives_pipe_leak_flood_and_live_child_stall. |
| `tests/scripts/desktop_update/test_desktop_update_windows_progress.py` | The Windows hand-off keeps serving progress while its main thread blocks. Pins: test_progress_advances_while_the_orchestrator_blocks. |
| `tests/scripts/desktop_update/test_desktop_update_windows_python_handoff.py` | Native launch/result acceptance: real publisher, no checkout-local venv.""" Pins: test_pm_handoff_reports_update_and_gateway_results; test_update_killed_by_idle_watchdog_after_completing_is_a_success. |
| `tests/scripts/desktop_update/test_desktop_update_windows_timestamp.py` | The Windows handoff writes numeric Unix seconds under comma-decimal locales.""" Pins: test_windows_update_writes_locale_independent_marker_and_result. |
| `tests/scripts/desktop_update/test_desktop_update_windows_ui_delivery.py` | The real Windows update server retains terminal events until acknowledged.""" Pins: test_delayed_client_receives_terminal_state_before_acknowledging; test_no_client_does_not_keep_the_update_process_alive_forever. |
| `tests/scripts/desktop_update/test_handoff_delegate_publication.py` | Exercise the real handoff's publication barrier with owned inert processes.""" Pins: test_delegate_publication_refuses_without_our_claim; test_sidecar_timeout_never_releases_the_parked_update. |
| `tests/scripts/desktop_update/test_handoff_result_identity.py` | Real PowerShell producer/heartbeat/result contract (portable, not native UI proof).""" Pins: test_powershell_result_keeps_identity_after_actual_heartbeat. |
| `tests/scripts/desktop_update/test_posix_handoff_pid_export.py` | A later generation of a POSIX Desktop hand-off's update adopts the hand-off's own claim. Pins: test_a_later_update_generation_adopts_the_handoffs_claim. |
| `tests/scripts/desktop_update/windows_handoff_support.py` | Shared helpers for the real-process Windows hand-off protocol tests (not collected).""" |
| `tests/scripts/install/test_dmg_install_driver.py` | The DMG driver must wait for native bootstrap completion, not install.sh's marker.""" Pins: test_dmg_driver_requires_complete_pm_source_install. |
| `tests/scripts/install/test_install_clone_throttle_fallback.py` | A throttled clone is retried without publishing a partial checkout.""" Pins: test_clone_retries_and_publishes_only_materialized_tree; test_existing_treeless_checkout_is_refetched_before_update. |
| `tests/scripts/install/test_install_desktop_product_present.py` | Installer repair/upgrade reruns detect a built desktop app on every arch (#94703). Pins: test_install_sh_detects_desktop_build; test_install_sh_without_desktop_build. |
| `tests/scripts/install/test_install_diverged_rescue_ref.py` | Regression: the installer's update reset must not drop local commits unanchored. Pins: test_install_sh_repository_stage_parks_local_commits_before_reset; test_install_ps1_repository_stage_parks_local_commits_before_reset. |
| `tests/scripts/install/test_install_ps1_execution_policy.py` | The iex'd installer must reach its runtime helper under the Restricted policy. Pins: test_installed_hermes_runs_under_restricted_policy; test_installer_runs_runtime_command_from_apostrophe_account_path. |
| `tests/scripts/install/test_install_ps1_iex_failure.py` | A failed install run through `iex (irm ...)` must not end the caller's session. Pins: test_failed_iex_install_reports_and_returns_to_the_callers_session; test_failed_file_install_still_exits_nonzero. |
| `tests/scripts/install/test_install_ps1_json_failure_frame.py` | A fatal stage under -Stage -Json yields exactly one failure frame carrying the reason.""" Pins: test_fail_inside_a_stage_emits_one_json_frame_with_the_reason. |
| `tests/scripts/install/test_install_ps1_managed_python_provenance.py` | The real installer waits for bootstrap uv before it delegates to PM.""" Pins: test_python_stage_delegates_to_pin_without_touching_existing_env. |
| `tests/scripts/install/test_install_ps1_native_calls.py` | install.ps1 native calls survive Windows PowerShell 5.1, and reruns keep local work. Pins: test_native_stderr_under_stop_leaves_the_exit_code_to_the_caller; test_path_uv_must_run_and_meet_the_pin. |
| `tests/scripts/install/test_install_ps1_pinned_git_extract.py` | Pinned git staging must not need a bzip2-capable tar (#122512, #122774). Pins: test_pinned_git_extracts_without_a_bzip2_capable_tar. |
| `tests/scripts/install/test_install_ps1_script_suites.py` | install.ps1's self-contained PowerShell suites, under Windows PowerShell 5.1 and pwsh 7. Pins: test_suite_passes. |
| `tests/scripts/install/test_install_ps1_skipsetup_alias.py` | Regression for #125350: -SkipSetup must keep binding after the staged-installer rework. Pins: test_skipsetup_still_binds; test_skipsetup_alone_skips_needs_input_stage. |
| `tests/scripts/install/test_install_ps1_staged_git.py` | The bootstrap's separately launched stages must each use PM's pinned Git.""" Pins: test_stage_processes_restore_pinned_git_and_never_fall_back. |
| `tests/scripts/install/test_install_sh_existing_destination.py` | A fresh clone never lands inside, or on top of, an unrelated destination.""" Pins: test_unrelated_destination_is_refused_untouched; test_empty_destination_directory_becomes_the_checkout. |
| `tests/scripts/install/test_install_sh_git_prerequisite.py` | install.sh prerequisites: a git on PATH that cannot run is not git. Pins: test_macos_stub_opens_clt_dialog_waits_then_continues; test_macos_stub_shows_why_clt_install_failed_before_waiting. |
| `tests/scripts/install/test_install_sh_musl_uv_bootstrap.py` | install.sh bootstraps musl uv when the native userland is musl (#123682).""" Pins: test_musl_elf_interpreter_selects_musl_uv_even_when_ldd_says_glibc. |
| `tests/scripts/install/test_install_sh_node_tarball_without_xz.py` | PM's shared Node unpacker needs no host xz executable (#11197). Pins: test_node_archive_unpacks_without_host_xz. |
| `tests/scripts/install/test_install_sh_output.py` | install.sh child output: one status line on a terminal, the full stream in CI.""" Pins: test_terminal_run_keeps_output_in_the_log_and_shows_it_only_on_failure; test_ci_streams_every_line_and_writes_no_log. |
| `tests/scripts/install/test_install_sh_repository_stage.py` | install.sh reruns, pins and invocation modes, driven through the real stage functions. Pins: test_piped_one_liner_runs_the_installer; test_rerun_parks_local_work_before_updating. |
| `tests/scripts/install/test_install_sh_reuse_supported_python.py` | Bootstrap reuses a supported base Python and reports failures (#10778). Pins: test_missing_value_fails_before_any_install_work; test_browser_skip_becomes_the_pm_opt_out. |
| `tests/scripts/install/test_install_sh_shell_path.py` | install.sh wires ~/.local/bin into the startup file a login bash reads, without duplicating it (#123424). Pins: test_bare_assignment_counts_as_existing_setup; test_fedora_login_shell_has_local_bin_once. |
| `tests/scripts/install/test_install_sh_termux_refusal.py` | install.sh sends Termux hosts to the APT package instead of building a source install.""" Pins: test_termux_host_is_refused_before_any_stage_with_apt_hint; test_plain_linux_host_passes_platform_check. |
| `tests/scripts/install/test_pm_desktop_launch_capture.py` | The installer E2E's capture must survive the installed PM launcher's -I.""" Pins: test_isolated_pm_launch_captures_only_final_electron_spawn. |
| `tests/scripts/test_activation_guard.py` | The guard repo scripts call to require an activated shell. Pins: test_returns_when_activated_and_exits_naming_the_command_when_not; test_command_is_the_posix_source_line. |
| `tests/scripts/test_agent_build.py` | Prepared inputs become runnable products without acquiring dependencies.""" Pins: test_contained_cli_assembly_runs_after_move_and_preserves_prepared_state; test_referenced_installed_code_uses_derived_command_map_without_copying. |
| `tests/scripts/test_appinstaller.py` | App Installer descriptors bind explicit package facts to explicit feed URLs.""" Pins: test_canary_publication_verifies_native_identity_and_uploads_bundle_before_pointer. |
| `tests/scripts/test_archive_inputs.py` | CI archives exact pinned inputs and supplies the real staging consumers.""" Pins: test_target_selection_preserves_multi_archive_and_any_fallback; test_invalid_pins_fail_without_rewriting_authority. |
| `tests/scripts/test_baked_bytecode.py` | Baked bytecode: staging contract and launcher marker behavior.""" Pins: test_bake_produces_readonly_unchecked_hash_pycs; test_bake_fails_closed_on_uncompilable_module. |
| `tests/scripts/test_bash_shebangs.py` | The repository shebang checker scans tracked scripts and embedded payloads.""" Pins: test_checker_reports_and_clears_fixed_bash_paths. |
| `tests/scripts/test_bootstrap_mirror.py` | Real bootstrap downloads preserve the pin across an upstream outage.""" Pins: test_windows_download_uses_only_verified_candidates; test_windows_bootstrap_rejects_corrupt_bytes_before_extract. |
| `tests/scripts/test_bootstrap_pins_fragment.py` | Generated bootstrap pins must match the shared pin and mirror authorities.""" Pins: test_fragments_match_the_pin_table. |
| `tests/scripts/test_build_skills_index_health.py` | Invariants for scripts/build_skills_index.py's health-check guard. Pins: test_degenerate_crawl_exits_nonzero_and_writes_no_file; test_healthy_crawl_writes_index_with_all_sources. |
| `tests/scripts/test_build_skills_index_resolve.py` | Invariants for scripts/build_skills_index.py's skills.sh path resolution. Pins: test_underscore_dirs_resolve_and_uninstallable_rows_are_not_shipped; test_truncated_tree_resolves_through_bounded_skill_md_probes. |
| `tests/scripts/test_bundle_native.py` | The native bundle pipeline publishes only after a real staged sync succeeds.""" Pins: test_bundle_stages_git_tree_and_runs_native_children_before_manifest; test_staged_cache_prunes_entries_the_lock_cannot_resolve. |
| `tests/scripts/test_bundle_npm.py` | Bundle commands run the prepared npm, including Nix's shell wrapper.""" Pins: test_bundle_npm_runs_workspace_from_unrelated_directory. |
| `tests/scripts/test_bundle_payload.py` | Shared bundle operations use real filesystem and entrypoint contracts.""" Pins: test_release_version_comes_from_the_release_identity_not_the_checkout; test_wrapper_rejects_unresolved_template_fields. |
| `tests/scripts/test_case_collision_check.py` | Wrappers for scripts/check-case-collisions.py. Pins: test_full_repo_has_no_case_colliding_paths; test_detects_case_colliding_paths. |
| `tests/scripts/test_channel_build_versions.py` | A channel request is a complete, immutable input, not a commit flavor.""" Pins: test_preparation_preserves_exact_channel_inputs_without_source_version_ordering; test_prepare_cli_accepts_request_path_but_refuses_mismatched_checkout_before_provisioning. |
| `tests/scripts/test_check_agents_md_size.py` | scripts/ci/check_agents_md_size.py: every AGENTS.md chain an agent can load stays under the cap it is truncated at.""" Pins: test_budget_is_per_chain_from_the_root_down. |
| `tests/scripts/test_check_no_tmp_literals.py` | scripts/check_no_tmp_literals.py: literal /tmp paths are flagged; idioms, comments, markers and tests are not.""" Pins: test_literal_tmp_paths_are_flagged; test_non_tmp_tokens_are_not_flagged. |
| `tests/scripts/test_check_profile_archive_boundary.py` | Behavioral tests for the profile archive CI guard.""" Pins: test_clean_root_passes; test_root_profile_archive_fails_without_printing_contents. |
| `tests/scripts/test_check_profile_scope_patterns.py` | scripts/check_profile_scope_patterns.py flags a known profile-scope hazard and stays silent on clean code. Pins: test_child_env_from_environ_is_flagged_and_the_scoped_builder_is_not; test_adapter_key_outside_the_seam_is_flagged_only_under_platforms. |
| `tests/scripts/test_check_public_surface.py` | scripts/ci/check_public_surface.py detects silently dropped public names, methods and test defs. Pins: test_dropped_public_names_methods_and_test_defs_are_reported_and_moves_are_not; test_unresolvable_refs_are_an_error_not_a_clean_report. |
| `tests/scripts/test_code_health.py` | Invariants of the code-health ratchet (scripts/code_health), on a real git repo + pinned ruff.""" Pins: test_ratchet_blocks_growth_new_and_swapped_violations; test_enforcement_switch_is_read_from_the_base. |
| `tests/scripts/test_code_health_cli.py` | scripts/check runner, git hooks, CLI output modes and regex-rule scope, on real git repos. Pins: test_staged_health_ignores_unstaged_policy_and_engine; test_unknown_or_empty_selector_is_a_usage_error. |
| `tests/scripts/test_code_health_identity.py` | Unit identity in the code-health ratchet: moves between files, repeated names, TypeScript. Pins: test_module_level_hits_follow_code_moved_to_another_file; test_module_level_constant_moved_to_another_file. |
| `tests/scripts/test_code_health_rules.py` | Rule and structure precision of the code-health ratchet (scripts/code_health): each case is a reviewer's repro paired with the control that must keep its verdict.""" Pins: test_import_alias_resolves_per_scope; test_import_alias_parameter_of_consuming_function_shadows. |
| `tests/scripts/test_code_health_sleep_rule.py` | HX013: a new wall-clock sleep in a test blocks; existing ones are grandfathered (moved code keeps its debt) and the shared ``tests.waiting`` helper is the compliant way to wait.""" Pins: test_wall_clock_sleep_shapes; test_condition_must_read_more_than_the_clock. |
| `tests/scripts/test_commit_bundle_entrypoints.py` | Tagless packaging enters the real builder with an exact source identity.""" Pins: test_desktop_build_reaches_the_managed_payload_with_commit_ref; test_store_build_rejects_nonstable_before_reading_or_preparing_repo. |
| `tests/scripts/test_commit_stamp_identity.py` | The Python stamp writer binds tagless identity to the built checkout.""" Pins: test_stamp_uses_built_commit_even_with_dispatch_sha_and_refuses_mismatch. |
| `tests/scripts/test_contributor_map.py` | Tests for the conflict-free contributor mapping system. Pins: test_loader_reads_login_from_first_noncomment_line; test_effective_map_merges_legacy_and_directory. |
| `tests/scripts/test_desktop_build_cache.py` | The cache transport describes candidates without bootstrapping their owners.""" Pins: test_stdlib_description_has_stable_allowlisted_paths_before_bootstrap; test_keys_follow_dependency_inputs_not_checkout_or_release_identity. |
| `tests/scripts/test_desktop_cli_wrapper.py` | Unit tests for the bundled payload's win32 launcher wrapper. Pins: test_launcher_dir_resolves_from_argv0; test_payload_sys_paths_order_repo_first. |
| `tests/scripts/test_desktop_preparation.py` | Prepared desktop inputs bind a source and reject stale files before building.""" Pins: test_stable_build_accepts_the_admitted_commit_before_the_final_tag_exists; test_native_version_capture_uses_admitted_build_environment. |
| `tests/scripts/test_desktop_toolchain.py` | Desktop preparation keeps dependency acquisition out of live installs.""" Pins: test_bootstrap_environment_isolates_owned_paths_without_mutating_caller; test_run_preparation_bootstraps_before_worker_in_isolated_child. |
| `tests/scripts/test_desktop_update_target.py` | Run the real handoffs against a disposable CLI, never an installed updater.""" Pins: test_posix_channel_survives_retry_in_active_profile; test_windows_channel_survives_retry_in_active_profile. |
| `tests/scripts/test_dev_sandbox.py` | Both development entrypoints keep their data identities and cleanup contract.""" Pins: test_ephemeral_sandbox_preserves_command_and_removes_state; test_persistent_identities_seed_once_and_honor_overrides. |
| `tests/scripts/test_dispatch_log.py` | The pre-build log must name the release.py command that started the run.""" Pins: test_pre_build_setup_prints_the_dispatch_before_any_other_work; test_printed_command_is_the_dispatcher_command. |
| `tests/scripts/test_dmgbuild_diagnostics.py` | DMG diagnostics observe failures without changing the native result.""" Pins: test_detach_diagnostics_run_before_cleanup_and_preserve_results; test_resize_timings_preserve_native_arguments_and_failure. |
| `tests/scripts/test_footgun_encoding_direction.py` | Encoding-direction diagnostics through the real file scanner, not a cloned loop.""" Pins: test_encoding_diagnostics. |
| `tests/scripts/test_footgun_subprocess_encoding.py` | Tests for the ``subprocess text=True without explicit encoding=`` footgun rule in ``scripts/check-windows-footguns.py``. Pins: TestDetection; test_flags_subprocess_check_output_text_true. |
| `tests/scripts/test_fresh_source_install.py` | Whole current installer, real PM worker and local application dependency. Pins: test_current_installer_publishes_real_dependencies_and_warm_path. |
| `tests/scripts/test_icon_flavors.py` | Build native icons on the runtime interpreter. Measure pixels, not SVG text.""" Pins: test_renderer_canary_rule_is_the_canonical_one; test_canary_changes_only_desktop_background_preserving_art_and_native_geometry. |
| `tests/scripts/test_icon_generation_exit.py` | Icon generation reports per-target failures without hiding later targets.""" Pins: test_svg_readers_accept_bom_without_rewriting_assets; test_write_status_includes_every_target. |
| `tests/scripts/test_install_ps1_chosen_channel.py` | install.ps1 reads the update channel a checkout chose, as Hermes wrote it (#137714). Pins: test_installer_reads_the_channel_hermes_recorded. |
| `tests/scripts/test_install_ps1_desktop_stage.py` | install.ps1 desktop stage + single authoritative stage list (audit C27). Pins: test_manifest_without_flag_lists_no_desktop; test_manifest_with_include_desktop_selects_the_desktop_product. |
| `tests/scripts/test_install_ps1_stable_default.py` | install.ps1 lands a new or rerun official install on the latest stable release. Pins: test_install_ps1_lands_on_the_latest_stable_release. |
| `tests/scripts/test_install_sh_chosen_channel.py` | An installer rerun keeps a checkout on the update channel it chose (#137714). Pins: test_rerun_keeps_a_chosen_channel_checkout. |
| `tests/scripts/test_install_sh_launch_handoff.py` | Post-PM installer stages use the real installation-bound publication.""" Pins: test_installer_post_pm_stages; test_products_and_desktop_stages_share_the_completion_tail. |
| `tests/scripts/test_install_sh_python_pin_indent.py` | install.sh reads the python pin from pm/lock.json by structure, not layout. Pins: test_bootstrap_python_reads_pin_independent_of_indentation. |
| `tests/scripts/test_install_sh_stable_default.py` | A new or rerun install of the official repository lands on the latest stable release. Pins: test_install_lands_on_the_latest_stable_release. |
| `tests/scripts/test_install_stage_frames.py` | The real Bash stage dispatcher emits one JSON result for every exit.""" Pins: test_stage_result_matches_the_actual_exit; test_real_single_stage_cli_reports_admission_or_execution_failure. |
| `tests/scripts/test_install_stamp_distance.py` | A dev install's distance counts from the highest reachable release, not a prerelease. Pins: test_distance_ignores_the_prerelease_tag_on_the_same_commit; test_stamp_writer_leaves_git_derived_identity_to_unstamped_local_builds. |
| `tests/scripts/test_job_groups.py` | Behavior contract for the `jobs` input parser (no workflow YAML is read).""" Pins: test_the_default_selects_every_group; test_one_group_selects_only_itself. |
| `tests/scripts/test_macos_channel_artifact_record.py` | Native artifact metadata stays bound to tagged or tagless package inputs.""" Pins: test_macos_record_binds_filename_version_and_provenance. |
| `tests/scripts/test_mint_launchers.py` | Live tests for the win32 launcher mint (scripts/build/mint_launchers.py). Pins: test_mint_writes_exactly_one_named_exe_per_spec; test_minted_launcher_shebang_carries_the_launcher_dir_placeholder. |
| `tests/scripts/test_native_build.py` | PM Bundle shares preparation, not the desktop product dependency closure.""" Pins: test_payload_transport_does_not_require_or_export_desktop_inputs; test_native_worker_passes_shared_toolchain_to_native_owner. |
| `tests/scripts/test_payload_digests.py` | Packaged facts describe final tool bytes without changing their identity.""" Pins: test_rehash_records_all_changed_tools_and_preserves_identity; test_packaged_metadata_is_shared_but_mutable_writes_stay_private. |
| `tests/scripts/test_pick_release_tags.py` | The release-tag picker reads origin, not the local checkout, and keeps CalVer order.""" Pins: test_picking_reads_origin_not_local_tags; test_picking_rejects_schemes_other_than_calver. |
| `tests/scripts/test_pm_build_consumers.py` | Build adapters consume selected Python environments, never install commands.""" Pins: test_ci_setup_exports_python_first_and_no_installer_policy; test_ci_packages_exports_python_and_preserves_real_child_exit. |
| `tests/scripts/test_pm_runtime_bundle.py` | A payload carries PM's independent dependency graph, not the app's imports.""" Pins: test_native_pm_runtime_survives_payload_move; test_resident_pm_bypasses_windows_redirector_after_move. |
| `tests/scripts/test_powershell_script_syntax.py` | The repo's PowerShell scripts must parse — checked with the REAL parser. Pins: test_fetched_scripts_have_no_utf8_bom; test_repo_has_powershell_scripts_to_gate. |
| `tests/scripts/test_release_artifacts.py` | Native metadata and artifact publication use the same verified bytes.""" Pins: test_windows_metadata_is_read_from_package_and_stale_stamp_is_rejected; test_bootstrap_reuses_published_candidate_and_rejects_substitution. |
| `tests/scripts/test_release_build_commit.py` | Commit-build entry points resolve real Git refs without publishing releases.""" Pins: test_commit_build_cli_dispatches_only_the_resolved_remote_commit; test_commit_build_dispatch_is_repository_independent. |
| `tests/scripts/test_release_canary_git.py` | Canary policy on real Git refs; GitHub publication stays an inert boundary.""" Pins: test_canary_cut_keeps_the_stable_core_and_dispatches_exactly_once; test_unchanged_head_does_not_cut_another_timestamp. |
| `tests/scripts/test_release_changelog.py` | -no-changelog keeps the release body's frame and drops the commit sections.""" Pins: test_no_changelog_keeps_the_frame_without_commit_sections. |
| `tests/scripts/test_release_channel_build.py` | Channel dispatch names an exact pushed Git commit; CI allocates and builds.""" Pins: test_dispatch_names_channel_and_binds_to_pushed_source; test_missing_default_branch_is_rejected_without_dispatch. |
| `tests/scripts/test_release_channels.py` | Exercise publisher/reader through the real signed HTTP transport.""" Pins: test_unknown_channel_created_over_http_retains_identity_and_immutable_requests; test_stable_branded_channel_reuses_the_published_stable_identity. |
| `tests/scripts/test_release_darwin.py` | tests/scripts/test_release_darwin.py — contract tests for the macOS # electron-updater feed publication (port of tests-js/darwin-feed.test.mjs). # Feed merge/validation is pure; publication runs… Pins: test_real_prune_protects_live_macos_artifacts_and_fails_closed; test_merges_native_legs_and_preserves_release_metadata. |
| `tests/scripts/test_release_docker_cli.py` | Docker receipt CLI validates identity and hashes actual local archive bytes.""" Pins: test_cli_manifest_and_verify; test_manifest_admits_the_attempt_ref_image_tag. |
| `tests/scripts/test_release_entrypoint.py` | The release entrypoint claims an attempt, cuts a draft, and dispatches the gate. Pins: test_release_claims_the_first_attempt_creates_a_draft_and_dispatches; test_a_commit_only_on_a_release_branch_can_be_cut. |
| `tests/scripts/test_release_handoff.py` | Release handoffs use exact R2 bytes without advancing a channel.""" Pins: test_stage_and_fetch_bind_tag_commit_and_files_without_feed_writes; test_failed_stage_never_publishes_a_receipt_or_channel. |
| `tests/scripts/test_release_lanes.py` | The stable release lanes: what a lane set builds, tests, and records in its claim.""" Pins: test_the_default_builds_everything_but_macos_intel_and_termux; test_select_edits_the_default_or_replaces_it. |
| `tests/scripts/test_release_progress.py` | Release progress logging: stderr only, grouped, and commands stay readable.""" Pins: test_logged_run_logs_each_command_and_its_outcome; test_logged_run_logs_a_failure_and_reraises. |
| `tests/scripts/test_release_r2.py` | tests/scripts/test_release_r2.py — contract tests for the Python R2 # release transport (port of tests-js/r2-release.test.mjs). The SigV4 # vectors pin the signer against botocore (the reference… Pins: test_disposable_scope_streams_lists_and_never_touches_production; test_independent_sigv4_vectors. |
| `tests/scripts/test_release_revision_anchor.py` | Changelog attribution is anchored to the selected release range.""" Pins: test_get_commits_attributes_each_revision_not_current_head. |
| `tests/scripts/test_release_sequencer.py` | Stable publication is ordered, held by default, and idempotent. Pins: test_a_sole_green_draft_waits_without_autopublish; test_autopublish_flips_the_current_green_release. |
| `tests/scripts/test_release_store.py` | The green run commits the Store build held; publication tries to switch it to Immediate.""" Pins: test_submit_commits_the_upload_held_so_certification_starts_before_the_gate; test_submit_replaces_a_draft_or_failed_submission. |
| `tests/scripts/test_release_tag_sampling.py` | Release sampling follows tag chronology across CalVer and SemVer, local tags or not.""" Pins: test_sampling_reads_origin_not_local_tags. |
| `tests/scripts/test_release_tags.py` | Release-tag policy accepts only the current stable and canary grammars.""" Pins: test_every_stable_selector_rejects_legacy_calver_tags; test_canary_tag_order_and_remote_selection. |
| `tests/scripts/test_release_version_from_ref.py` | A ref names a version, and the next version is derived, never read from the tree. Pins: test_final_tag_is_its_version; test_non_final_refs_are_not_versions. |
| `tests/scripts/test_render_builds_binding.py` | Commit rows bind a literal producer's receipt, not merely object names.""" Pins: test_commit_row_binding_faults; test_failed_legs_from_release_needs. |
| `tests/scripts/test_render_builds_publication.py` | Tag pages and release bodies publish the same independently named objects.""" Pins: test_tag_publication_pending_rerun_stale_and_dry_run; test_incomplete_tag_keeps_channel_and_links_diagnostics. |
| `tests/scripts/test_run_in_hermes_env.py` | ``scripts/run-in-hermes-env``: run a command in the Hermes environment, syncing only when needed. Pins: test_foreign_checkout_with_matching_input_times_resyncs; test_recorded_inputs_are_left_alone. |
| `tests/scripts/test_run_tests_parallel.py` | Verify scripts/run_tests_parallel.py kills test-spawned grandchildren. Pins: test_progress_output_tolerates_legacy_stdout_encoding; test_grandchild_leak_is_killed_by_runner. |
| `tests/scripts/test_run_tests_parallel_stdio.py` | The runner's status glyphs must not crash narrow console encodings. Pins: test_silent_child_failure_reports_exit_code; test_glyph_safe_stdio_survives_cp1252. |
| `tests/scripts/test_run_tests_parallel_timeout_scaling.py` | Duration-aware per-file timeout scaling in scripts/run_tests_parallel.py. Pins: test_scaler_never_lowers_the_flat_cap; test_slow_file_gets_proportional_headroom. |
| `tests/scripts/test_run_tests_shell.py` | The canonical shell must run tests and propagate a failing test's status.""" Pins: test_shell_runner_executes_tests_and_propagates_failure. |
| `tests/scripts/test_scan_plugin_payloads.py` | Unit tests for the catalog payload scanner (README rule 17). Pins: test_plain_source_tree_is_clean; test_compiled_binary_is_flagged_by_header. |
| `tests/scripts/test_setup_toolchain.py` | The CI bootstrap reads PM's pins without importing installed dependencies.""" Pins: test_development_setup_keeps_test_groups_out_of_the_runtime; test_stdlib_bootstrap_exports_the_pm_lock. |
| `tests/scripts/test_smoke_nemo_relay_shared_metrics.py` | Tests for the shared-metrics smoke artifact.""" Pins: test_resolve_hermes_executable_from_repository_venv; test_resolve_hermes_executable_reports_missing_binary. |
| `tests/scripts/test_source_build_env.py` | Source E2E children stamp their own checkout, not the workflow's NEW ref.""" Pins: test_posix_build_children_stamp_old_and_new_without_changing_parent; test_powershell_build_children_stamp_old_and_new_without_changing_parent. |
| `tests/scripts/test_source_driver.py` | Cheap source-driver checks: real shells, disposable installs, no installer.""" Pins: test_shell_selects_the_installed_command_not_the_phase_or_path; test_installer_marker_is_the_only_dirty_state_a_driver_accepts. |
| `tests/scripts/test_source_update_command.py` | Source E2E updates must follow the staged git branch when supported.""" Pins: test_source_update_follows_staged_main_if_installed_cli_accepts_branch; test_installed_cli_help_drives_explicit_staged_branch. |
| `tests/scripts/test_stable_admission.py` | Stable admission reads the version and the attempt from the attempt ref, not from the checkout. Pins: test_admission_reads_the_version_and_attempt_from_the_attempt_ref; test_admission_refuses_a_claim_for_a_commit_off_main. |
| `tests/scripts/test_stable_release.py` | Release gates and package transitions bind the intended immutable artifacts.""" Pins: test_gate_requires_every_success_including_real_cli; test_gate_requires_every_lane_removed_job_to_have_skipped. |
| `tests/scripts/test_stage_apt_repo.py` | Tests for scripts/termux/stage_apt_repo.py — stdlib + pytest, no network. Pins: test_pool_subdir_is_in_the_path_and_the_index; test_no_pool_subdir_keeps_the_plain_layout. |
| `tests/scripts/test_termux_agent_assembly.py` | Bionic assembly consumes prepared bytes without running foreign binaries.""" Pins: test_bionic_facts_and_agent_keep_fixed_prefix_and_tui_only. |
| `tests/scripts/test_termux_assembly_permissions.py` | Exercise the build mount's real Linux UID permissions, not Android binaries.""" Pins: test_assembly_publishes_facts_as_termux_uid_and_returns_host_owned_output. |
| `tests/scripts/test_termux_build_driver.py` | Exercise the Termux sequencing boundary with real child executables.""" Pins: test_driver_prepares_only_tui_then_passes_product_to_deb; test_invalid_cli_never_starts_a_build. |
| `tests/scripts/test_termux_build_wheels.py` | Pinned source dependencies build online and install from wheelhouse offline.""" Pins: test_requirement_readers_preserve_pins_and_reject_malformed_rows; test_source_pin_survives_resolution_build_and_offline_install. |
| `tests/scripts/test_termux_commit_identity.py` | Termux packaging refuses identity mistakes before modifying its payload.""" Pins: test_deb_identity_refusal_leaves_payload_and_output_untouched. |
| `tests/scripts/test_termux_deb_version.py` | Literal tag boundaries and real Debian ordering (not a second parser).""" Pins: test_apt_readers_accept_bom_and_keep_archive_bytes; test_tag_mapping. |
| `tests/scripts/test_termux_launchers.py` | Run generated launchers with a real interpreter and captured entrypoint.""" Pins: test_launchers_forward_arguments_and_export_payload_environment; test_postinst_refuses_foreign_path_and_prerm_preserves_it. |
| `tests/scripts/test_termux_python_linkage.py` | Exercise the linker repair against a real native extension on Linux.""" Pins: test_python_symbols_gain_an_explicit_library_dependency; test_wheel_rewrite_regenerates_record_for_changed_member. |
| `tests/scripts/test_termux_retag_wheel.py` | Behavior contracts for scripts/termux/retag_wheel.py (PEP 738 retagger). Pins: test_filename_and_wheel_tags_rewritten_consistently; test_native_extension_presence_required. |
| `tests/scripts/test_termux_runtime_libs.py` | Tests for scripts/termux/stage_runtime_libs.py — cache correctness. Pins: test_stage_cache_correctness; test_collision_identical_ok_conflicting_raises. |
| `tests/scripts/test_termux_update_refusal.py` | The installed-package gate distinguishes commit builds from release packages.""" Pins: test_validator_child_decodes_utf8_and_preserves_strict_errors; test_validator_accepts_real_cli_refusal_for_installed_identity. |
| `tests/scripts/test_termux_wheelhouse_cache.py` | A restored cache is usable only for the exact proven build inputs.""" Pins: test_cache_rejects_changed_inputs_and_modified_outputs; test_cache_rejects_incomplete_or_inconsistent_manifests. |
| `tests/scripts/test_upload_summary.py` | Every verified R2 upload lands in the GitHub step summary, with its public URL.""" Pins: test_render_uses_the_public_asset_host; test_render_names_a_key_whose_url_cannot_be_built. |
| `tests/scripts/test_validate_plugin_catalog.py` | Behavior tests for scripts/validate_plugin_catalog.py. Pins: test_valid_entry_passes; test_valid_entry_without_optional_fields_passes. |
| `tests/scripts/test_verify_bootstrap_version_stamp.py` | Tests for scripts/verify-bootstrap-version-stamp.py. Pins: test_verifier_cli. |
| `tests/scripts/test_verify_plugin_preservation.py` | Unit tests for the plugin upgrade-preservation verifier. Pins: test_preservation_cli_fault_matrix; test_empty_snapshot_is_inconclusive. |
| `tests/scripts/test_verify_user_state.py` | Unit tests for the user-state upgrade-preservation verifier. Pins: test_snapshot_records_rows_not_bytes_for_state_db; test_snapshot_is_read_only. |
| `tests/scripts/test_version_stamping.py` | Release stamping changes only metadata consumed by external builders.""" Pins: test_stamping_only_writes_external_builder_inputs; test_stamping_a_payload_snapshot_without_external_inputs_is_a_noop. |
| `tests/scripts/test_write_install_stamp.py` | The emitted stamp must preserve build identity and reach the runtime reader.""" Pins: test_cli_stamp_roundtrip; test_missing_or_invalid_mechanism_cannot_emit_stamp. |
| `tests/secret_sources/__init__.py` | Empty package marker / no cases. |
| `tests/secret_sources/conformance.py` | Conformance kit for :class:`agent.secret_sources.base.SecretSource`. Pins: TestMySourceConformance; test_name_is_lowercase_identifier. |
| `tests/secret_sources/test_error_remediation.py` | Error remediation for secret sources. Pins: test_summarize_strips_rust_report_noise; test_fetch_auth_failure_gets_friendly_error. |
| `tests/secret_sources/test_profile_secrets.py` | Orchestrator-level profile secret handling. Pins: test_preserve_existing_beats_override; test_preserve_existing_only_guards_set_vars. |
| `tests/secret_sources/test_secret_source_registry.py` | Tests for the secret-source contract + orchestrator. Pins: TestRegistration; test_registers_conforming_source. |
| `tests/security/test_gitspawn_config_injection.py` | GitSpawn / GHSA-7x36-8jrh-v4pw regression suite. Pins: TestHardenGitArgv; test_diff_gets_flags_after_subcommand. |
| `tests/skills/test_authoring_standards.py` | CI enforcement of the skill authoring standards (AGENTS.md hardline). Pins: test_at_least_the_expected_population; test_required_frontmatter_fields. |
| `tests/skills/test_bundled_skill_doc_placeholders.py` | Bundled skill files must not carry bare chat-role tags. Pins: test_bundled_skills_have_no_role_tag_placeholder; test_tool_error_strings_have_no_role_tag. |
| `tests/skills/test_cloudflare_temporary_deploy_skill.py` | Tests for optional-skills/web-development/cloudflare-temporary-deploy/scripts/parse_deploy_output.py""" Pins: TestParseCreated; test_live_url. |
| `tests/skills/test_comfyui_skill.py` | Invariant tests for the bundled comfyui skill. Pins: test_load_schema_reads_non_ascii_under_non_utf8_locale; test_load_schema_tolerates_utf8_bom. |
| `tests/skills/test_evidence_store.py` | Holds 8 cases. Pins: test_evidence_store_add; test_evidence_store_sequential_ids. |
| `tests/skills/test_fetch_transcript.py` | Tests for skills/media/youtube-content/scripts/fetch_transcript.py (issue #22243).""" Pins: TestExtractVideoId; test_standard_watch_url. |
| `tests/skills/test_github_credential_token.py` | Regression tests for scanner-safe GitHub credential extraction (#22722).""" Pins: test_extracts_supported_git_credential_url_forms; test_extracts_password_from_exact_github_https_credential. |
| `tests/skills/test_google_workspace_api.py` | Tests for Google Workspace gws bridge and CLI wrapper.""" Pins: test_bridge_returns_valid_token; test_bridge_main_injects_token_env. |
| `tests/skills/test_google_workspace_credential_files.py` | Regression test: google-workspace SKILL.md must declare required_credential_files. Pins: TestGoogleWorkspaceCredentialFiles; test_entries_are_registered_when_files_exist. |
| `tests/skills/test_google_workspace_setup.py` | Google Workspace setup delegates dependency ownership to PM.""" Pins: test_explicit_install_uses_pm_and_reports_restart; test_auth_uses_pm_import_check. |
| `tests/skills/test_google_workspace_setup_deps.py` | OAuth must not run against an unavailable or newly selected environment.""" Pins: test_oauth_stops_at_pm_restart_boundary; test_standalone_without_hermes_reports_setup_not_ambient_installs. |
| `tests/skills/test_grounded_citations_skill.py` | Tests for the grounded-citations bundled skill. Pins: test_ids_are_stable_and_sequential; test_url_normalization_collapses_fragment_and_trailing_slash. |
| `tests/skills/test_har_derived_api_client_skill.py` | Tests for the har-derived-api-client optional skill. Pins: test_derives_endpoint_and_filters_static; test_path_template_collapses_ids. |
| `tests/skills/test_hyperliquid_skill.py` | Holds 4 cases. Pins: test_normalize_perp_markets_extracts_change_and_volume; test_main_markets_json_prints_normalized_payload. |
| `tests/skills/test_live_dashboard_skill.py` | Tests for the live-dashboard optional skill.""" Pins: test_frontmatter_blueprint_is_a_valid_installed_blueprint. |
| `tests/skills/test_mcp_oauth_remote_gateway_skill.py` | Tests for the mcp-oauth-remote-gateway optional skill. Pins: test_token_ok_branch; test_refresh_dead_no_refresh_token. |
| `tests/skills/test_memento_cards.py` | Tests for optional-skills/productivity/memento-flashcards/scripts/memento_cards.py""" Pins: TestCardCRUD; test_add_creates_card. |
| `tests/skills/test_openclaw_migration.py` | Holds 10 cases. Pins: test_extract_markdown_entries_promotes_heading_context; test_merge_entries_respects_limit_and_reports_overflow. |
| `tests/skills/test_openclaw_migration_hardening.py` | Tests for the OpenClaw→Hermes migration hardening features. Pins: test_redact_replaces_secret_by_key_name; test_redact_handles_github_token_pattern. |
| `tests/skills/test_optional_skill_scripts.py` | Execute optional research helpers offline; upstream/SDK doubles are boundary spies. Pins: test_pinecone_client_uses_key_and_rejects_missing_key; test_evolver_provider_routing. |
| `tests/skills/test_optional_skill_self_paths.py` | Contract: a skill's self-referencing install paths match its own location. Pins: test_optional_skills_self_install_paths_resolve_to_their_own_location. |
| `tests/skills/test_product_price_monitor_skill.py` | Tests for the product-price-monitor skill's price-watch blueprint.""" Pins: test_price_watch_blueprint_schedule_resolves. |
| `tests/skills/test_property_listings_skill.py` | Property card recipes are optional, discoverable, and loadable on demand.""" Pins: test_optional_catalog_fetch_preserves_a_usable_property_recipe. |
| `tests/skills/test_reddit_reading_skill.py` | Tests for optional-skills/social-media/reddit-reading/scripts/reddit.py — backend selection and throttle handling.""" Pins: test_anonymous_thread_uses_atom_feed_and_waits_out_a_429_exactly_once; test_oauth_credentials_route_to_oauth_host_and_flatten_nested_comments. |
| `tests/skills/test_rss_feeds_skill.py` | Tests for optional-skills/research/rss-feeds/scripts/feed.py — parsing and discovery contracts.""" Pins: test_all_three_formats_normalise_to_the_same_entry_shape_and_utc_dates; test_page_url_discovers_advertised_feed_then_reads_it. |
| `tests/skills/test_skill_blueprint_contracts.py` | Blueprint-to-skill relationships, independent of the generic catalog/renderer tests.""" Pins: test_task_blueprint_loads_procedure; test_every_blueprint_skill_is_bundled. |
| `tests/skills/test_skill_docs_contract.py` | Contract: the committed skill docs stay in sync with the shipped skill tree. Pins: test_catalog_lists_every_shipped_skill; test_catalog_rows_resolve_to_a_shipped_skill. |
| `tests/skills/test_skill_document_contracts.py` | Specific shipped-document obligations; generic policy lives in test_authoring_standards. Pins: test_required_document_and_credit; test_required_references_are_present_and_routed. |
| `tests/skills/test_skill_pages_match_shipped_skills.py` | Contract: a generated per-skill page exists only while its skill ships. Pins: test_every_generated_page_documents_a_shipped_skill. |
| `tests/skills/test_telephony_skill.py` | Holds 4 cases. Pins: test_save_twilio_writes_env_and_state; test_upsert_env_updates_existing_values. |
| `tests/skills/test_unbroker_skill.py` | Hermetic tests for the unbroker skill. Pins: test_browser_clears_captcha_logic; test_storage_json_and_jsonl_roundtrip. |
| `tests/skills/test_weekly_review_planning_skill.py` | Invariant: every skill a cron blueprint loads ships as a bundled skill.""" Pins: test_every_blueprint_skill_resolves_in_repo. |
| `tests/skills/test_youtube_quiz.py` | Tests for optional-skills/productivity/memento-flashcards/scripts/youtube_quiz.py""" Pins: TestNormalizeSegments; test_basic. |
| `tests/termux_fixtures.py` | Small, structurally valid Termux archives with independent integrity checks.""" |
| `tests/test_agent_close_lifecycle.py` | Side-agent AIAgent instances must be closed on every exit path (#50197). Pins: TestBatchRunnerClosesAgent; test_agent_closed_after_successful_prompt. |
| `tests/test_atomic_json_writers_unified.py` | Invariant for the non-secret atomic JSON writers that used to inline ``utils._atomic_write``. Pins: test_sessions_json_failed_replace_keeps_old_bytes_and_no_temp; test_suggestions_failed_replace_keeps_old_bytes_and_no_temp. |
| `tests/test_atomic_replace_symlinks.py` | Regression tests for GitHub #16743 — atomic writes must preserve symlinks. Pins: test_atomic_replace_preserves_symlink; test_atomic_replace_regular_file. |
| `tests/test_atomic_write_fsync_dir_target.py` | ``atomic_write_text(..., fsync_dir=True)`` must sync the directory that actually received the replacement file. Pins: test_fsync_dir_targets_resolved_parent_for_symlinked_destination; test_fsync_dir_uses_destination_parent_without_symlink. |
| `tests/test_atomic_write_text_metadata.py` | ``atomic_write_text``'s opt-in metadata preservation (mode + owner). Pins: TestPreserveMode; test_existing_mode_survives_the_rewrite. |
| `tests/test_audit_old_updater_imports.py` | Exercise updater archaeology against real Git DAGs, not today's filenames.""" Pins: test_discovers_entrypoint_renames_extractions_and_deleted_helpers; test_all_merge_parents_and_merge_result_but_not_unmerged_branches. |
| `tests/test_base_url_hostname.py` | Targeted tests for ``utils.base_url_hostname`` and ``base_url_host_matches``. Pins: test_empty_returns_empty_string; test_plain_host_without_scheme. |
| `tests/test_basetemp_isolation.py` | pytest's basetemp must never sit inside the operator's platform-native Hermes home. Pins: test_basetemp_inside_the_native_home_is_relocated_outside_it; test_basetemp_outside_the_native_home_is_left_alone. |
| `tests/test_batch_runner_checkpoint.py` | Tests for batch_runner checkpoint behavior — incremental writes, resume, atomicity.""" Pins: TestSaveCheckpoint; test_writes_valid_json. |
| `tests/test_batch_runner_discard_resume.py` | Discarded samples must be visible to --resume (#93527). Pins: test_content_scan_treats_tombstone_as_completed; test_content_scan_still_skips_failed_rows. |
| `tests/test_batch_runner_durability.py` | Tests for batch_runner trajectory durability and pool cleanup. Pins: TestTrajectoryWriteDurability; test_trajectory_entry_is_synced_to_disk. |
| `tests/test_credential_file_permissions.py` | Read-time permission warnings for on-disk credential/token files. Pins: TestWarnIfCredentialFileBroadlyReadable; test_warns_on_world_readable. |
| `tests/test_dispatch_session_id.py` | Tests that handle_function_call forwards session_id into registry.dispatch.""" Pins: TestSessionIdForwarding; test_standard_path_forwards_session_id. |
| `tests/test_display_hermes_home.py` | display_hermes_home() renders POSIX separators on every platform. Pins: TestDisplayHermesHomePosix; test_nested_home_renders_forward_slashes. |
| `tests/test_engines_satisfiable.py` | The manifest's ``engines`` must be satisfiable by a toolchain we can actually ship. Pins: TestEnginesAreSatisfiable; test_npm_floor_is_met_by_a_shipping_node. |
| `tests/test_fast_safe_load.py` | Invariants for utils.fast_safe_load. Pins: test_equivalent_to_safe_load_for_strings; test_equivalent_to_safe_load_for_file_objects. |
| `tests/test_get_tool_definitions_cache_isolation.py` | Regression tests for issue #17335. Pins: TestQuietModeCacheIsolation; test_first_uncached_call_returns_fresh_list. |
| `tests/test_git_safety_boundary.py` | A removed live-checkout guard can damage only disposable repositories here.""" Pins: test_guard_blocks_native_and_shell_git_mutations_without_touching_checkout; test_checkout_guard_covers_write_verbs_without_blocking_queries. |
| `tests/test_hermes_bootstrap.py` | Tests for hermes_bootstrap — Windows UTF-8 stdio shim. Pins: TestWindowsBehavior; test_env_vars_set_on_windows. |
| `tests/test_hermes_constants.py` | Tests for hermes_constants module.""" Pins: TestGetDefaultHermesRoot; test_no_hermes_home_returns_native. |
| `tests/test_hermes_dir_acl.py` | ``make_user_dir`` contract off Windows and its grant selection (the Windows ACL effect itself is proved by ``test_hermes_dir_acl_windows.py`` on Windows CI). Pins: test_off_windows_it_is_plain_mkdir; test_elevated_grants_every_created_dir_and_an_existing_leaf_once. |
| `tests/test_hermes_dir_acl_windows.py` | 139845 / #134889 W8 + W2 on real Windows ACLs. Pins: test_dir_made_while_elevated_stays_usable_by_the_filtered_token; test_elevated_rerun_repairs_a_dir_an_earlier_elevated_run_left. |
| `tests/test_hermes_home_key_cache.py` | Tests for the remembered results in `hermes_home_key`. Pins: TestSameAnswerAsBefore; test_matches_the_uncached_calculation. |
| `tests/test_hermes_home_profile_warning.py` | Tests for get_hermes_home() profile-mode fallback warning. Pins: TestGetHermesHomeProfileWarning; test_classic_mode_no_active_profile_no_warning. |
| `tests/test_hermes_logging.py` | Tests for hermes_logging — centralized logging setup.""" Pins: test_repeated_setup_routes_records_once; TestSetupLogging. |
| `tests/test_hermes_yaml.py` | Contracts for Hermes' shared YAML reader and writer.""" Pins: test_safe_load_accepts_existing_config_boolean_spellings; test_safe_load_rejects_python_object_construction. |
| `tests/test_ipv4_preference.py` | Tests for network.force_ipv4 — the socket.getaddrinfo monkey-patch.""" Pins: TestApplyIPv4Preference; test_double_patch_is_safe. |
| `tests/test_live_system_guard.py` | Regression tests for the conftest live-system guard's argv handling. Pins: test_argv_arguments_are_not_treated_as_executables; test_direct_killer_argv_is_still_blocked. |
| `tests/test_live_system_guard_self_test.py` | Self-test for the live-system guard fixture in tests/conftest.py. Pins: test_fail_closed_probe_reports_guard_active; test_os_kill_blocks_foreign_pid. |
| `tests/test_load_yaml_file_readonly.py` | ``load_yaml_file_readonly`` re-parses only when the file signature changes.""" Pins: test_cache_hit_returns_same_object_and_invalidates_on_rewrite; test_callers_do_not_mutate_the_shared_cached_object. |
| `tests/test_log_isolation.py` | The test suite must never write into the operator's real Hermes logs. Pins: TestLogIsolation; test_hermes_home_is_sandboxed_before_imports. |
| `tests/test_managed_runtime_resolution.py` | Guard: Hermes-owned subprocesses must not resolve managed runtimes by bare PATH. Pins: test_bare_which_and_known_path_tables_are_allowlisted; test_resolution_allowlist_has_no_stale_rows. |
| `tests/test_mini_swe_runner.py` | Holds 1 cases. Pins: test_run_task_kimi_omits_temperature. |
| `tests/test_model_forces_max_completion_tokens.py` | Targeted tests for ``utils.model_forces_max_completion_tokens``. Pins: TestPositiveCases; test_gpt_5_bare. |
| `tests/test_model_tools_async_bridge.py` | Regression tests for the _run_async() event-loop lifecycle. Pins: TestRunAsyncLoopLifecycle; test_cached_transport_survives_between_calls. |
| `tests/test_no_shadowed_test_definitions.py` | No test module may define the same name twice in one scope. Pins: test_no_shadowed_definitions_in_test_modules; test_guard_detects_a_known_duplicate_shape. |
| `tests/test_old_updater_compat_surface.py` | An old `hermes update` must still find every name it loads mid-swap. Pins: TestTheFrozenSurfaceStillResolves; test_bare_name_exists. |
| `tests/test_os_marker_gating.py` | Run the real collection hook; skip-all and unregistered guards must fail.""" Pins: test_native_collection_witnesses. |
| `tests/test_packaging_build_guard.py` | Behavioral regression coverage for the wheel/sdist distribution guard.""" Pins: test_artifact_build_rejects_nix_development_shell_environment. |
| `tests/test_packaging_metadata.py` | Independent core/optional dependency and reviewed CVE policies.""" Pins: test_test_dependencies_are_group_only_in_manifest_and_lock; test_core_and_optional_speech_dependencies. |
| `tests/test_packaging_py_modules.py` | Packaging invariant: every root-level module that packaged code imports ships in the wheel. Pins: test_pyproject_has_no_static_py_modules_list; test_every_root_module_imported_by_packaged_code_is_shipped. |
| `tests/test_platforms_marker.py` | Native platform policy table; collection wiring lives in test_os_marker_gating.""" Pins: test_native_spec_table; test_unknown_spec_is_a_collection_error_not_a_skip. |
| `tests/test_project_metadata.py` | Regression tests for packaging metadata in pyproject.toml.""" Pins: test_wake_dependencies_and_runtime_gate_agree_on_supported_targets; test_direct_overrides_preserve_the_declared_exact_version. |
| `tests/test_sanitize_tool_error.py` | Tests for `_sanitize_tool_error` in model_tools. Pins: TestRoleTagStripping; test_strips_tool_call_tags. |
| `tests/test_scratch_dir.py` | Scratch dir contract: TMPDIR/TMP/TEMP follow HERMES_HOME/cache/scratch unless the user set them.""" Pins: test_scratch_env_follows_home_and_respects_user_tmpdir; test_bootstrap_import_exports_scratch_to_process_and_children. |
| `tests/test_scratch_prune_undeletable.py` | An idle scratch entry this user cannot read or delete is reported once and not re-walked hourly.""" Pins: test_undeletable_or_unreadable_entry_logged_once_then_skipped_without_walk; test_fixed_expired_or_other_uid_entry_is_judged_again. |
| `tests/test_scratch_scan_failures.py` | Cleanup needs a complete idle scan before deleting a scratch tree.""" Pins: test_unreadable_subtree_is_preserved_until_it_can_be_scanned; test_post_selection_scan_failure_keeps_entry_with_honest_audit. |
| `tests/test_search_cjk_prefix_wildcard.py` | CJK search must survive the prefix wildcard callers append (#90636). Pins: test_trailing_star_matches_the_bare_query; test_star_is_stripped_per_token_in_boolean_queries. |
| `tests/test_session_daemon_reaper.py` | The session teardown stops processes left running against this run's Hermes homes. Pins: test_session_teardown_terminates_daemons_under_the_session_basetemp_only. |
| `tests/test_session_spillover_cleanup.py` | Session-tied spillover unlinking (#126351): an archive referenced by a retained session stays available exactly as long as that session does. Pins: test_retained_sessions_spill_survives_the_age_sweep; test_structured_and_backslashed_pointers_are_owned. |
| `tests/test_state_config_contention.py` | Existing databases remain usable while a config writer finishes publication.""" Pins: test_partial_config_import_cannot_invert_config_and_module_locks; test_existing_database_does_not_wait_for_config_writer. |
| `tests/test_tests_tree_layout.py` | The tests/ tree mirrors the source tree. Pins: test_every_test_directory_mirrors_a_source_directory_or_is_declared; test_no_issue_numbers_in_test_filenames. |
| `tests/test_trajectory_compressor.py` | Tests for trajectory_compressor.py — config, metrics, and compression logic.""" Pins: test_import_loads_env_from_hermes_home; test_generate_summary_kimi_omits_temperature. |
| `tests/test_trajectory_compressor_async.py` | Tests for trajectory_compressor AsyncOpenAI event loop binding. Pins: TestAsyncClientLazyCreation; test_get_async_client_creates_fresh_each_call. |
| `tests/test_utils_atomic_roundtrip_yaml_save.py` | Tests for atomic_roundtrip_yaml_save() — comment-preserving full-state writes. Pins: TestAtomicRoundtripYamlSave; test_creates_file_when_missing. |
| `tests/test_utils_atomic_writers_deleted_profile.py` | Atomic writers must not resurrect a deleted named profile home. Pins: TestAtomicWritersRefuseDeletedProfileHome; test_atomic_json_write_does_not_recreate_home. |
| `tests/test_utils_no_proxy_sanitize.py` | NO_PROXY entries httpx cannot compile are rewritten to the bare-IPv6 form (#118159). Pins: TestSanitizeNoProxyEntries; test_bracketed_ipv6_becomes_bare_literal. |
| `tests/test_utils_rmtree_readonly.py` | ``utils.rmtree_readonly`` removes trees that ``shutil.rmtree`` refuses. Pins: test_checkpoint_clear_all_removes_tree_with_read_only_object; test_removes_read_only_file_in_writable_directory. |
| `tests/test_utils_truthy_values.py` | Tests for shared truthy-value helpers.""" Pins: test_is_truthy_value_accepts_common_truthy_strings; test_is_truthy_value_respects_default_for_none. |
| `tests/test_wal_reset_repair_hint.py` | Behavior tests for hermes_state._wal_reset_repair_hint. Pins: test_source_checkout_gets_venv_setup_hint; test_git_install_gets_hermes_managed_hint. |
| `tests/test_windows_subprocess_no_window_flags.py` | Holds 11 cases. Pins: test_bounded_git_probe_fast_path_spawn_contract_windows; test_bounded_git_probe_nonzero_returncode_returns_empty. |
| `tests/test_yaml_indent_consistency.py` | All YAML write paths use indented block sequences (#31999).""" Pins: test_atomic_write_then_key_update_keeps_layout_and_values; test_failed_atomic_yaml_write_keeps_original. |
| `tests/verify/test_environment_and_runner.py` | Tests for the verify environment manifest and the smoke runner.""" Pins: TestManifest; test_roundtrip. |
| `tests/verify/test_ledger_and_nudge_integration.py` | Integration of the verify subsystem with the existing verification stack. Pins: test_record_verify_run_marks_workspace_passed; test_record_verify_run_records_failure. |
| `tests/verify/test_recipes.py` | Tests for agent/verify/recipes.py — static run-recipe detection.""" Pins: TestPackageManagerDetection; test_pnpm_lock_wins. |
| `tests/verify/test_verify_cmd.py` | Tests for the ``hermes verify`` CLI command implementation.""" Pins: test_detect_only_json; test_no_recipe_found. |
| `tests/waiting.py` | Wait for a condition instead of the clock (the HX013 fix). |
| `tests/website/__init__.py` | Empty package marker / no cases. |
| `tests/website/test_catalog_rules_mirror.py` | The catalog submission guide mirrors the canonical admission rules word for word. Pins: test_docs_page_mirrors_readme_admission_rules. |
| `tests/website/test_check_doc_links.py` | Tests for website/scripts/check_doc_links.py. Pins: test_fix_rewrites_route_to_relative_path_keeping_anchor. |
| `tests/website/test_extract_plugins.py` | Tests for website/scripts/extract-plugins.py. Pins: test_valid_entry_is_extracted_with_install_command; test_entries_missing_required_fields_are_skipped. |
| `tests/website/test_extract_skills.py` | Tests for website/scripts/extract-skills.py helpers. Pins: test_local_skills_publish_exact_install_target; test_local_skills_publish_mapped_artwork_only. |
| `tests/website/test_fetch_plugin_stars.py` | fetch-plugin-stars.py: plugin-catalog star counts, GitHub consulted only from the scheduled run. Pins: test_deploy_reuses_the_cache_without_any_github_call; test_probe_is_one_graphql_request_for_a_small_catalog_and_a_failure_keeps_previous_counts. |
| `tests/website/test_generate_llms_txt.py` | `llms.txt` is how an LLM learns what Hermes can do. Pins: test_every_docs_page_is_indexed; test_the_enumerator_sees_the_whole_docs_tree. |
| `tests/website/test_generate_skill_docs.py` | Tests for website/scripts/generate-skill-docs.py. Pins: test_code_block_without_box_chars_is_not_wrapped; test_code_block_with_box_chars_gets_wrapped. |

### Tier 3 — skipped with a reason

- `tests/install/e2e-assets/install-button.png` — **binary PNG asset** (911 bytes on disk). It is the macOS/Windows
  install GUI's click target (the AutoHotkey/`drive-dmg-install.sh` legs click it by image). Confirmed present
  and sized; the image itself carries no logic, so it was not decoded.
- `tests/install/e2e-assets/launch-button.png` — **binary PNG asset** (882 bytes on disk), the launcher's click
  target in the same E2E flow. Same treatment: confirmed on disk, not decoded.

These are the only two files in the shard that were not read line by line; nothing else was skipped.

---

## 2. Ideas worth stealing

> **Convergence note.** This shard is one repo only, so a `CONVERGENT` claim cannot be verified from here.
> Everything below is marked `UNIQUE` (this repo demonstrably does it) unless the same behaviour is visible in
> the shard's own cross-references, which is noted in-line. Cross-repo convergence must be confirmed by
> reading the other two shards.

1. **A committed *prompt-surface snapshot* turns "the prompt got bigger" into a CI failure.**
   `tests/fixtures/prompt_surface/surfaces.json` records, per surface (`cli`, `cli-code`, `cron`, `desktop`,
   `discord`, `telegram`) and per model family (`claude`/`gpt`/`gemini`/`hermes`), the token count of the
   **stable**, **volatile** and **context** prompt parts plus the total **tool** tokens, and
   `tests/ci/test_prompt_surface.py:1` fails when the committed snapshot is not what the code renders — and
   names *which* surface and *which* tool changed. The 36 committed tool schemas under
   `tests/fixtures/prompt_surface/tools/` are the same idea per tool.
   *Why it transfers:* August already has `constants/promptRegistry.ts` and a real prompt-size problem; a
   snapshot + drift gate turns a regression into a red CI line instead of a mystery. `UNIQUE`.
2. **Banned test shape: never read source code in a test.** `tests/AGENTS.md:139` forbids `fs.readFileSync
   ('main.ts')` + regex assertions, and prescribes the alternative — extract the logic into a pure/
   DI-testable function and call it. The stated reason is exactly right: a source-text test passes when the
   implementation is subtly broken and fails on correct refactors. *Why it transfers:* August's AGENTS.md
   already bans some source-text patterns; this is the general, enforceable form. `UNIQUE`.
3. **Banned test shape: "don't write change-detector tests."** `tests/AGENTS.md:126` — *"if it reads like a
   snapshot, delete it; if it's a contract between two pieces of data, keep it"*, with a worked example
   (`assert len(models) == 8` → `assert len(models) >= 1` and a *relationship* assertion). August's release
   gate already re-measures the vitest census in the tree map; this is the doctrine behind it. `UNIQUE`.
4. **A live-system guard as an autouse fixture.** `tests/_fixtures/live_system_guard.py:1` makes `os.kill`,
   `os.killpg`, `os.system`, `os.popen`, `pty.spawn`, `asyncio.create_subprocess_exec/shell` and every
   `subprocess` entry point **refuse** to touch anything outside the test's own process subtree, and refuses
   any *mutating* `systemctl` verb against any `hermes*` unit while letting read-only verbs through. The
   design decision worth stealing: *"Discovery without delivery is harmless"* — it deliberately does **not**
   stub the pid-scanning helper, so the helper's own tests still exercise the real implementation.
   *Why it transfers:* August's Electron app shells out and can kill processes; a guard turns a flaky
   "I killed the developer's gateway" incident into a stack trace. `UNIQUE`.
5. **Recording loopback servers for every provider dialect instead of mocks.**
   `tests/fakes/providers/` implements the *real wire* of Anthropic Messages, OpenAI Responses,
   chat-completions, Gemini native, Bedrock Converse, Vertex, Codex app-server (JSON-RPC over stdio),
   Copilot ACP, a multi-dialect catalog fake and an OAuth token server — each recording what it received.
   `tests/fakes/platforms/` does the same for Discord, Slack and Telegram (with `sitecustomize` shims that
   redirect the real SDKs at the stand-in). *Why it transfers:* August's `GenericProviderService` already
   speaks three API formats; a recording loopback per format turns the provider contract into something
   testable without keys, and yields a request-wire record. `UNIQUE`.
6. **A golden provider-wire snapshot.** `tests/fixtures/provider_wire_snapshot.json` is a committed record of
   the exact JSON body sent on each dialect (`api_mode`, `base_url`, `extra_body.thinking`, the `messages`
   array). *Why it transfers:* August has three providers × a shared `providerRequestPolicy.cjs`; a golden
   wire snapshot would catch an accidental temperature/`max_tokens`/thinking-key change on one provider. `UNIQUE`.
7. **A known-failure ledger that explains a red job but never suppresses it.**
   `tests/install/e2e-assets/known-failures.json` matches a red E2E leg on (commit, case, error regex, log
   channel) and `tests-js/install-known-failures.test.ts:1` pins that the CLI "writes a receipt and exits zero
   only on a confirmed match" and that it "renders known receipts as footnotes, without suppressing a red job".
   `tests/install/KNOWN_FAILURES.md` is the human-readable half. *Why it transfers:* a trading app that runs
   live-paper evaluations overnight needs exactly this — "this failure is the known X" as an *annotation* on
   the failure, never as a filter. `UNIQUE`.
8. **One flag inverts "known gap" from XFAIL to FAIL.** `tests/ci/test_pending_fixes_strict.py:1` and
   `tests/e2e/core/_pending_fixes.py`: in the default run a known gap is an expected failure; under
   `STRICT_ACCEPTANCE` the same gap **fails the batch** — and "strict acceptance fails the batch-owned gaps
   only" (a gap owned by another owner is not yours to excuse). *Why it transfers:* the same ledger can be
   run in "explain" mode nightly and "refuse" mode before a release. `UNIQUE`.
9. **A code-health ratchet that blocks *growth* instead of failing.**
   `tests/scripts/test_code_health.py:1`, `test_code_health_cli.py:1`, `test_code_health_identity.py:1`,
   `test_code_health_rules.py:1`, `test_code_health_sleep_rule.py:1`: a per-rule violation budget is measured
   against the **base** commit; moved code keeps its cap; the enforcement switch is read from the base so a
   branch cannot lower its own bar; and a *new* `time.sleep` in a test is a hard error (HX013) while existing
   ones are grandfathered. *Why it transfers:* this is the mechanism that answers "how do we stop the feature
   count from becoming the product" — a budget that can only go down. `UNIQUE`.
10. **A cross-cutting "wait for a condition, not the clock" helper with a CI rule behind it.**
    `tests/waiting.py:1` gives `wait_until` / `async_wait_until` (deadline-based, returns the first truthy
    value, and fails with a message *naming what never happened*), and the HX013 rule makes a new wall-clock
    sleep in a test a build failure. It also ships `wait_for_ctime_tick` for the case where the filesystem's
    timestamp clock is coarser than the write. *Why it transfers:* directly applicable to August's async
    analysis pipeline and its probe-style tests. `UNIQUE`.
11. **An execution-ledger + CAS-claim model for scheduled work.** `tests/cron/test_claim_job_for_fire.py:1`,
    `test_execution_ledger.py:1`, `test_delivery_queue.py:1`, `test_cron_recovery.py:1`: every fire is a
    durable row with a **compare-and-set claim**, an owner token, a heartbeat, a terminal state and an
    attempt id; terminal rows cannot be rewritten; a stale claim is reclaimable but the *old* owner may not
    mark the replacement's run; delivery is an at-most-once handoff through a durable queue; a lost ack is
    reconciled exactly once from a terminal receipt. *Why it transfers:* this is the model a trading monitor
    (poll → decide → notify) needs to survive a restart without double-firing or losing a fill. `UNIQUE`.
12. **Crash/resume conformance cells with a real `SIGKILL`.**
    `tests/conformance/persistence/README.md:1` documents five machine-checked persistence contracts —
    prefix durability, consume-once, rotation atomicity, and delivery exactly-once — each run against the
    real store with a real `SIGKILL` to a separate OS process, "asserted to be **alive at kill time** (a clean
    early exit cannot masquerade as a crash test)". The README's closing rule is the transferable part:
    *"A failing cell is a **fire**: report it with the cell's evidence — do not silence it."* `UNIQUE`.
13. **Atomic writers that respect symlinks, modes, owners and the right directory.**
    `tests/test_atomic_replace_symlinks.py:1`, `test_atomic_write_text_metadata.py:1`,
    `test_atomic_write_fsync_dir_target.py:1`, `test_atomic_json_writers_unified.py:1`: an atomic replace
    must write *through* a symlink rather than replacing it, restore the target's mode and owner, and fsync
    the directory that **actually received** the file (not the symlink's parent). *Why it transfers:* August
    writes user config and a notebook on both web and native; these are exactly the four ways such a write
    goes wrong. `UNIQUE`.
14. **A "public surface" check that detects silently dropped exports.**
    `tests/scripts/test_check_public_surface.py:1` detects names, methods and test definitions that
    disappeared, while a *relocation* is not reported as a drop; an unresolvable reference is an error, not a
    clean report. *Why it transfers:* August's `utils/` and `constants/` are described in AGENTS.md as
    canonical single-source modules; a gate that notices when one of them quietly loses a name is cheap
    insurance. `UNIQUE`.
15. **A "the tests tree mirrors the source tree" gate, plus a no-duplicate-definitions gate.**
    `tests/test_tests_tree_layout.py:1` (every test directory mirrors a source directory or is declared; no
    issue numbers in test filenames) and `tests/test_no_shadowed_test_definitions.py:1` (no module may define
    the same name twice in one scope — a silently shadowed test is a test that never runs).
    *Why it transfers:* both are cheap, and the second one catches a real class of false-green. `UNIQUE`.

---

## 3. Trading-specific findings

**1. Long-lived monitoring & scheduled work — this shard's strongest answer, and it is the `tests/cron/` block
(~180 files).** What keeps it reliable, file by file:
- *Claiming, not starting:* a fire is a **compare-and-set claim** with an owner token; only one claimant wins,
  a stale claim is reclaimable, and a stale owner cannot mark its replacement's run
  (`tests/cron/test_claim_job_for_fire.py:1`, `test_fire_claim_lost_after_delivery.py:1`).
- *A durable execution ledger:* transitions are durable, a terminal execution cannot be rewritten, a foreign
  process cannot start or finish an execution, retention bounds terminal history but preserves in-flight rows
  (`tests/cron/test_execution_ledger.py:1`).
- *Delivery as a separate durable outbox:* a queued delivery is claimed and sent **once**; a dead owner
  becomes `unknown` and is **not** retried; a wait timeout marks it unknown without retry
  (`tests/cron/test_delivery_queue.py:1`).
- *Receipt recovery:* a lost ack reconciles the frozen delivery exactly once; a recovered receipt settles the
  departed firer's row; an owner that refuses is booked failed and retires its journal
  (`tests/cron/test_cron_recovery.py:1`, `test_cron_canonical_receipt_bookkeeping.py:1`).
- *Catch-up after downtime:* a recurring occurrence a tick took off the schedule but never dispatched fires
  **once** after a restart, never twice (`tests/cron/test_missed_window_catchup.py:1`); a misfire beyond the
  grace window is not fired at all and a one-shot gets its own grace
  (`tests/cron/test_misfire_catchup.py:1`, `test_misfire_backstop_oneshot_grace.py:1`).
- *Visibility of lateness:* every dispatch is stamped `on_time` / `late` / `catch_up` and the stamp is
  persisted (`tests/cron/test_dispatch_lateness_stamp.py:1`); a missed fire leaves a `last_fire_error`
  (`test_fire_forward_failure_stamp.py:1`).
- *Idempotency of the whole schedule:* a completed occurrence survives a `jobs.json` rollback, not just a
  restart (`tests/cron/test_scheduled_occurrence.py:1`); concurrent creates are merged rather than clobbered
  (`tests/cron/test_jobs_shrink_merge.py:1`).
- *A breaker after repeated empty runs:* the failure-streak nudge is silent below a threshold, never fires
  for a one-shot, and is configurable (`tests/cron/test_scheduler_session_title_nudge.py:1`).
- *A durable incident ledger:* failures become incidents keyed by a **signature** (same error → same incident,
  changed error → new incident), with redaction, bounded error length, a lifecycle and an operator ack; a
  later success **resolves** the open incident but the operator's ack survives
  (`tests/cron/test_cron_incidents.py:1`, `test_cron_incidents_resolve.py:1`).
- *A global kill switch that fails closed:* `hermes pause` writes a sentinel; a **corrupt sentinel still
  engages**; cron dispatch, gateway turns and kanban dispatch all stop; the paused reply names the reason and
  the resume command (`tests/cron/test_estop.py:1`).
- *A quota hold instead of a hot loop:* a provider quota window **parks** the job rather than re-firing into
  it, and a weekly job retries when the quota recovers (`tests/cron/test_quota_hold.py:1`).
- *A "monitor" job kind:* a cheap source is polled each tick and the **agent** runs only when the hash
  changes — with the first run always running the agent, and the monitor's output sanitised before it
  reaches the model (`tests/cron/test_monitor_kind.py:1`).
- *A per-job scratchpad:* a durable KV notepad that survives scheduled wake-ups, is isolated per job and dies
  with the job (`tests/cron/test_notepad.py:1`).
- *A supervision rule:* "an exception must not silently kill the cron thread" is held for **every** step that
  runs on that thread — startup recovery, per-cycle enumeration, status-marker writes — and a dead ticker is
  respawned by housekeeping (`tests/cron/test_ticker_startup_survival.py:1`).

**2. Human-in-the-loop approval.** The gate lives in the ACP adapter: a permission/clarify bridge schedules
the request on the caller's loop, tool-call ids are unique, a timeout returns a timeout *and* cancels the
future, a scheduler failure closes the permission coroutine, a denied edit-approval is closed as **failed**
(not completed), and an allowed one is closed as completed **once**
(`tests/acp_adapter/test_permissions.py:1`, `tests/acp_adapter/test_edit_approval.py:1`). The **audit record
is the session itself**: an unanswered card is re-offered on reattach and is never auto-answered
(`tests/acp_adapter/test_gateway_prompt_reoffer.py:1`); the decision's outcome is carried on the tool call
(`AllowedOutcome` / `DeniedOutcome`) and a terminal receipt settles the reply exactly once
(`tests/acp_adapter/test_gateway_terminal_receipt_claim.py:1`). Approval isolation is enforced per thread and
per session (`tests/acp_adapter/test_approval_isolation.py:1`,
`tests/cron/test_scheduler_cron_session_isolation.py:1` — a cron session's denial must not pollute a later
gateway execution).

**3. Post-mortem / reflection loops.** This shard shows the *bookkeeping* side of a learning loop rather than a
reflection engine: when the skill curator consolidates or prunes a skill, **every scheduled job that pointed
at it is rewritten**, and the rewrite report records the old→new mapping
(`tests/cron/test_rewrite_skill_refs.py:1`). The complementary rule is that a job's private state dies with
the job (`tests/cron/test_notepad.py:1`), and that a *suggested* job is deduped, a dismissal latches against
redisplay, and the pending set is capped (`tests/cron/test_suggestions.py:1`). The lesson for a trading app:
when a rule is consolidated or retired, the **references** to it must be rewritten automatically, and the
history of what changed must be recorded, not guessed.

**4. Multi-agent.** There is **no debate engine in this shard** — the debate/abstraction surface belongs to
other shards. What is here is the *isolation* of delegated work, which is the part worth stealing: a delegate
child's transcript is excluded from the trigram FTS index and from the default human-facing session list
(`tests/hermes_state/test_fts_trigram_subagent_exclusion.py:1`,
`tests/hermes_state/test_show_subagents_listing.py:1`); a delegate child never inherits its parent's gateway
routing columns (`tests/hermes_state/test_delegate_child_routing_inheritance.py:1`); the owner mints, caps,
scopes and retires a worker's delegated children, and a child reserve verifies the parent claim and refuses
while the parent is draining (`tests/hermes_state/test_runtime_worker_children.py:1`); deleting a parent
cascades to its delegate children, with cycle-safety (`tests/hermes_state/test_delegate_cascade.py:1`).
The transferable principle: **a subagent's work must be invisible to the human's history by default and must
carry its own scope, identity and ledger** — which is the opposite of "just run another agent and merge its
output".

**5. Structured logs the model can query.** SQLite with FTS5 and several index families, plus a query
relaxation layer: an exact FTS query that returns nothing is retried as an OR-relaxed query, and the
relaxation never fires for exact semantics or absent terms
(`tests/hermes_state/test_search_or_relaxed_fallback.py:1`). The index is bounded on purpose — new tool rows
are content-bounded while an explicit tool search stays complete
(`tests/hermes_state/test_fts_tool_write_bounds.py:1`) — and scoped by role: cron-source rows and
subagent rows are excluded from the trigram index but stay reachable through standard FTS
(`tests/hermes_state/test_fts_trigram_cron_exclusion.py:1`,
`test_fts_trigram_subagent_exclusion.py:1`). A CJK bigram index exists beside the trigram one
(`tests/hermes_state/test_fts_cjk_bigram.py:1`); a **layout-drift registry** decides when a reindex is offered
as opt-in work rather than done silently (`tests/hermes_state/test_fts_layout_drift.py:1`); and an FTS-only
failure **fails open for the turn** and is never rendered as whole-file damage
(`tests/hermes_state/test_fts_index_fail_open.py:1`). The trading analogue is direct: a trade journal the
model can query, with the *tool* payloads bounded so the index cannot be flooded, and with a relaxation
fallback so a paraphrased query still finds the trade.

**6. Staying simple as features accumulate.** Four mechanisms, all visible in this shard: the code-health
ratchet with a per-rule budget that can only go down (§2.9); the HX013 sleep rule; the **docs-drift ratchet**
— every `DEFAULT_CONFIG` key and slash command must be documented or explicitly baselined
(`tests/ci/test_docs_drift.py:1`); and the public-surface check that notices dropped names (§2.14). Plus the
placement rule itself: a test lives in `tests/<top-level source dir>/`, and a Python test may not assert about
`package.json`/`tsconfig.json`/`.ts` sources because such a test would be green on a JS-only PR and red on
main (`tests/AGENTS.md:37` and `:43`).

---

## 4. Non-obvious decisions and gotchas (the things a reader would get wrong)

- **A red job is never hidden by a "known failure".** The receipt explains it; the job still reports red
  (`tests-js/install-known-failures.test.ts:1`).
- **A failing test file is retried once in a fresh subprocess, but a worker killed by signal or timeout is
  never retried** — "relaunching a runaway doubles the damage" — and a pass-on-retry is green but printed
  under "⚠ FLAKY" with both outputs (`tests/AGENTS.md:30`).
- **A bare `skipif` is a silent skip.** A test gated with `@pytest.mark.skipif(sys.platform != "win32")`
  "runs on no host at all, silently"; the `platforms(...)` marker replaced the historic
  `linux_only`/`macos_only`/`windows_only` markers, and a misspelt spec is a **collection error**, not a skip
  (`tests/AGENTS.md:87`, `:108`).
- **"Don't fake the host OS":** if a test needs the interpreter to believe it is on another OS to pass, it
  belongs on that OS (`tests/AGENTS.md:64`).
- **A stack trace in the test output is evidence, not noise** — a failing file's failure is preserved, and a
  flaky pass is still printed.
- **A corrupt sentinel still ENGAGES the emergency stop** (fail closed) and the paused reply names the reason
  and the resume command (`tests/cron/test_estop.py:1`).
- **A misclassified failure is worse than no failure:** the scheduler's own inactivity timeout must not be
  reported as a provider timeout, and a "fallback chain exhausted" phrase must not appear when no chain is
  configured (`tests/cron/test_cron_failure_summarizer_inactivity.py:1`).
- **An empty abnormal turn is delivered as silence, not as a failure alert** — while still stamping
  `failure_reason` for the UI — and a genuinely failed turn still raises
  (`tests/cron/test_cron_empty_turn_stays_silent.py:1`).
- **A pin is a decision, not a preference:** a cron job with its own provider/model/base-url pin never walks
  the global fallback chain, and legacy snapshot keys do not count as a pin
  (`tests/cron/test_cron_pinned_job_fallback.py:1`).
- **The previous run's *answer* is injected, never its prompt** — and a silent audit record must not replace
  useful continuity output (`tests/cron/test_context_from_response_extraction.py:1`,
  `test_continuity_silent_audits.py:1`).
- **Skill content is scanned at cron runtime** for injection patterns, env-exfiltration and invisible unicode
  (`tests/cron/test_cron_prompt_injection_skill.py:1`).
- **A pure-read method must not take the writer lock** — enforced by a static AST gate that scans every
  state source file (`tests/hermes_state/test_no_locked_readers_gate.py:1`).
- **A lost WAL generation is captured by inode, never by pathname**, and a capture that cannot be proven
  refuses to settle (`tests/hermes_state/test_retired_wal_generation_capture.py:1`).
- **The repair path is non-destructive and bounded:** strategies never receive the live database, a failed
  repair leaves the original byte-identical, the forensic backup is still taken, and there is a per-file
  attempt cap that a changed file resets (`tests/hermes_state/test_state_db_repair_non_destructive.py:1`,
  `test_state_db_repair_loop_cap.py:1`).
- **A session id has exactly one minting function**, and the recovery sentinel is the *shape* of that
  function's id (`tests/hermes_state/test_hermes_state_ids.py:1`).
- **A pinned cron job, a pinned model and a pinned reasoning effort are three separate knobs with a stated
  precedence** (job > global > per-model) and an explicit "none disables thinking, and config never re-enables
  it" (`tests/cron/test_cron_provider_pin.py:1`, `test_cron_reasoning_effort.py:1`).
- **The install/update E2E proves a real user on an OLD install can reach HEAD** by pointing every git at a
  local bare clone — the sandbox replaces the internet, not the code path
  (`tests/install/installer-script-e2e.sh`).
- **A frozen historical surface is kept, not trimmed:** `tests/compat/old_updater_surface.json` is a
  generated union of every name an old updater could still load mid-swap, and the README says plainly:
  *"A historical name is cheaper than a missed live import"* (`tests/compat/README.md:1`).
- **A "conformance cell" that fails is a fire, not a bug to be silenced** — report it with the cell's
  evidence (`tests/conformance/persistence/README.md:1`).
- **The updater's compatibility contract is the union, not the current tree:** current-tree tests alone
  cannot protect the moment an updater retains old modules and reads new files
  (`tests/compat/README.md:1`).

---

## 5. Weak spots

- **The suite is enormous and mostly one-kind.** 1,373 files here, ~180 of them cron. The *contracts* are
  excellent, but a reader cannot tell a contract test from a one-off regression pin without reading the
  docstring — a CI-enforced docstring shape (what the skill-authoring standard already does for skills:
  `tests/skills/test_authoring_standards.py:1`) would make the set navigable.
- **A green local run says little about the release path.** Live Windows behaviour runs on a dedicated
  `wine2e/**` branch lane that is inert on PRs and main (`tests/AGENTS.md:94`), Docker tests need a container,
  macOS notarization needs a signed bundle. The repo knows this and isolates it, but the cost is that a
  "green" tree can still ship a broken Windows update.
- **The test suite is nearly as complex as the state layer it guards.** FTS rebuild, WAL repair, quarantine,
  forensic backups, retention caps and holder detection are re-implemented *inside* `tests/hermes_state/` —
  ~30 files of machinery. That is a second implementation of database management, which is exactly the
  complexity the reference repo warns about elsewhere.
- **The `pm/` block (~130 files) is a different product.** The repo's own package manager, build system and
  release machinery dominate the shard's byte count and have nothing to do with the harness. It makes the
  shard's "one idea" hard to see, and any research pass over this shard will over-weight packaging concerns.
- **The prompt-surface fixtures are hand-maintained.** Ten prompt files (~13 KB each) and 36 tool schemas are
  committed; the CI check keeps them in sync, but a human editing a tool description gets no local signal about
  the token-budget consequence — only CI.
- **Some of the hardest-won knowledge is only in docstrings.** The rationale for the fire-claim protocol, the
  delivery ledger and the compaction lineage is excellent prose *inside* the test files. A reader (or an agent)
  who does not read docstrings will read these tests as a wall of fixtures.

---

*Report produced by reading 1,373 files of the `hermes-agent` reference harness (read-only; no repo code was
executed, installed or built). Artefacts: `hermes-tests-state-rest.md` (this file) and
`hermes-tests-state-rest.status.tsv` (one row per file).*
