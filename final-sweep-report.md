# Final repository sweep report

Date: 2026-08-03
Scope: Full repository review with four independent reviewers, deterministic validation, and repository-state inspection.

## Validation results

- `npm run typecheck` — passed.
- `npm run test` — passed: 11 test files, 104 tests.
- `npm run build` — passed.
- `npm run lint` — passed with existing warnings only; no lint errors.
- `git diff --check` — passed for the available scoped diff check.
- `npm run e2e` — blocked before test execution because the local Playwright Chromium executable is not installed.

## Important findings

### High: in-flight responses can target the wrong conversation

Files:

- `hooks/useConversations.ts:36-52`
- `hooks/useAnalysisPipeline.ts:384, 1177-1211, 1350-1366`
- `App.tsx:1263-1267, 1294-1305`

`updateMessages` resolves the destination using the current `activeConversationId` when an async update completes. If a response starts in conversation A and the app switches to conversation B before completion, the response can be appended to B.

Recommendation: capture the initiating conversation ID when the request starts and update that conversation explicitly, or cancel the request before switching conversations.

### High: composer keyboard focus is invisible

Files:

- `components/chat/ChatInput.tsx:114-124`
- `index.css:372-385`

The textarea removes its outline and the global stylesheet also removes focus outlines from textareas. No replacement focus ring is present.

Recommendation: add a visible `focus-visible` ring or border treatment to the textarea.

### High: chat image controls are not keyboard-operable

File:

- `components/chat/MessageItem.tsx:205-216, 250-259`

Image viewer activation is attached to clickable `div` elements without keyboard semantics, focusability, or an accessible action label.

Recommendation: use buttons or add `role="button"`, `tabIndex`, keyboard handling, and accessible labels.

### High: conversation history entries are not keyboard-operable

File:

- `components/chat/ConversationHistory.tsx:129-135`

Conversation loading is attached to a clickable `div` without keyboard semantics.

Recommendation: replace the clickable container with a button or add equivalent keyboard behavior and focus styling.

## Medium findings

### Safe-area insets may be applied more than once

Files:

- `index.css:125-130`
- `components/shared/Header.tsx:141`
- `components/chat/ChatInput.tsx:102-105`
- `components/chat/ConversationHistory.tsx:61-72`

Root, header, composer, and fixed panels each apply some safe-area compensation. On notched devices this can create excessive gaps or panels beneath system UI.

Recommendation: define one consistent safe-area ownership strategy and verify on real notched mobile layouts.

### Custom provider URLs can transmit keys over insecure HTTP

Files:

- `services/providers/GenericProviderService.ts:68-73, 181-190, 233-247`
- `services/infrastructure/ProviderConfigService.ts:11-15, 34-55`
- `components/settings/ProviderManager.tsx:197-210`

Arbitrary provider endpoints are supported without enforcing HTTPS. A configured HTTP endpoint can receive an API key without transport encryption.

Recommendation: require HTTPS except for an explicit localhost/development exception and validate URLs before saving or testing.

### Electron custom protocol lacks explicit path containment validation

File:

- `electron/main.cjs:54-67`

The `app://` handler joins a decoded URL path to the distribution directory without an explicit resolved-path containment check.

Recommendation: resolve the path, verify it remains under `distPath`, reject traversal, and serve only controlled files or a safe SPA fallback.

### Release workflow permissions and supply-chain controls are broad

File:

- `.github/workflows/release.yml:14-16, 43-46`

The release workflow grants repository content write access broadly and does not show immutable action pinning or separate build/publish permissions.

Recommendation: pin actions to commit SHAs, isolate publishing permissions, and verify/sign release artifacts.

### Public production source maps are enabled

Files:

- `vite.config.ts:26-29`
- generated `dist/assets/*.map`

Production builds emit source maps that can reveal source structure and internal implementation details if publicly deployed.

Recommendation: disable public release source maps or upload them privately to an error-monitoring system.

### Generated artifacts need explicit repository-state review

Observed ignored/generated paths include:

- `dist/`
- `dist_electron/`
- `node_modules/`
- `test-results/`
- APK files
- build and diagnostic logs

These were ignored in the inspected state, but should remain excluded from commits and releases unless intentionally required.

## Low findings

- `onToggleProvider` appears to remain in the `ChatArea`/`ChatInput` prop chain without being used in the composer.
- The empty-state comment still mentions a grid while the grid class was removed from the rendered wrapper; `.bg-grid` may now be unused.
- Several icon-only controls lack explicit accessible names.
- The post-mortem collapsible header should expose `aria-expanded`.
- Sidebar secondary text using `text-zinc-600` may have insufficient contrast.
- Sidebar delete affordances are pointer-hover-only and should also reveal on keyboard focus.
- Smooth scrolling and Virtuoso smooth following do not fully respect reduced-motion preferences.
- Narrow mobile composer controls may become cramped around 320px widths.
- Truncated conversation previews lack a full-text title or accessible name.
- Existing lint configuration excludes Electron `.cjs` files.

## Repository state note

The working tree contains many unrelated modified files in addition to the chat UI files. The sweep did not overwrite or clean those changes.

## Overall conclusion

## Follow-up completion

The previously identified high-priority items are now addressed in the working tree:

- Async analysis and post-mortem message writes are explicitly bound to the initiating conversation, including throttled debate stream updates.
- Composer focus styling, image viewer controls, and conversation history entries have keyboard semantics and visible focus treatment.
- Provider URLs are validated at the persistence and request boundaries, allowing HTTP only for localhost development endpoints.
- Electron `app://` file serving validates resolved path containment.
- Production source maps are disabled and the release workflow rejects emitted `.map` files.
- The empty chat canvas now uses a restrained grid treatment and was visually checked against the supplied reference UI.
- Duplicate Conversation History overlay/navigation was removed; the Sidebar Recent list remains the single conversation-history surface.
- Live Market now has a roomier chart workspace, clearer controls, accessible alert actions, and stale AI-analysis protection when symbol/timeframe changes.
- Hybrid Intelligence uses a visible Brain icon, and automated-capture settings plus embedded Journal summary controls are now wired and persisted.

The current validation status is: typecheck passed, 12 test files / 115 tests passed, production build passed, and `git diff --check` passed. Lint still has existing warnings but no errors. Local E2E remains unavailable until Playwright Chromium is installed; the release workflow installs it in CI.

The repository is ready for the remaining optional low-priority cleanup and a real-device notched-layout check.

## Latest provider and casual-chat fixes

- Provider Test now tests the staged, normalized URL/model values, reports missing-model input immediately, always clears its busy state, and stops after a 30-second timeout.
- When Ensemble is disabled, stale hybrid data/loading/progress state is cleared and the analysis-step pipeline is not initialized.
- Gate Keeper execution is now explicitly guarded by both Ensemble and Hybrid Intelligence, so casual chat cannot trigger chart-analysis support work.

Latest validation: `npm run typecheck`, `npm run test -- --run` (115/115), `npm run build`, `npm run lint` (0 errors; existing warnings), and `git diff --check` all passed.

## React update-loop fix

The Ensemble-off cleanup now guards each state update so it only clears stale non-empty state. This prevents repeated nested renders while preserving the casual-chat cleanup behavior. Typecheck and all 115 tests pass after this fix.

## Provider CORS transport fix

Desktop provider requests now route through an Electron main-process IPC handler, where the request is made with Electron's network transport instead of the renderer's browser `fetch`. This removes the OpenCode Zen CORS preflight failure for the released desktop app while preserving direct browser fetch behavior for web deployments. The IPC path supports chat-completions, Messages, and Responses formats, including provider-friendly error mapping and request timeouts.

Validation: typecheck passed, production build passed, 115/115 tests passed, `node --check` passed for both Electron files, and `git diff --check` passed. Electron must be fully restarted after this change so the new preload/main-process handlers are loaded.

## Development cache invalidation

Vite development responses now use `Cache-Control: no-store`, and the Electron development window clears its session cache before loading localhost and rewrites localhost response headers to prevent caching. Production response caching is unaffected.

The localhost web development path also now uses a Vite server-side provider proxy at `/__provider_proxy`, so `npm run dev` no longer sends OpenCode Zen requests directly from the browser and does not hit provider CORS restrictions. Electron continues to use the main-process IPC transport.

Chat model presentation was simplified to match the supplied reference: casual-chat model selection shows only the model ID in the composer, while completed assistant messages no longer repeat provider/model metadata in a footer. Copy Text remains available as the sole footer action.

Generation UX now includes a compact Thinking indicator, progressive rendering for the newest casual-chat response, and a Stop button in the composer that uses the existing abort controller to cancel active generation. Test suite remains 115/115; typecheck and lint pass with the repository's existing warnings only.

Casual replies no longer populate or display the ensemble-only Individual AI Insights section. Existing casual messages are also filtered from that section, so the cleanup applies without requiring old conversations to be deleted.

The remaining Copy Text footer action was removed completely. Active generation controls now consistently say `Stop generating`; the Thinking panel and stop controls appear only while a provider request is actually in progress.

The reference-style thinking row is now retained on completed casual replies. During generation, the composer Send control becomes Stop, and cancellation propagates through the Electron provider IPC to abort the active main-process request rather than merely hiding the spinner.

Thinking is now an expandable row at the top of the assistant bubble. It displays provider-returned insight text when available; for ordinary casual models that do not expose a separate reasoning trace, it explicitly explains that only the answer is available. The old lower insights row is no longer rendered.
