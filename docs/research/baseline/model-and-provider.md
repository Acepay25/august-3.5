# Model and provider handling — baseline

**Repo:** `C:\Dev\august-3.5` (August Trading, React + TypeScript)
**Section:** model/provider handling — routing, fallbacks, errors, timeouts, context windows, reasoning effort, and the failure modes that hang or fail silently.
**Method:** static read + `git` inspection only. No build, no run, no provider configured, no key used, no order placed. Every claim below carries a `file:line`.

**Verdict vocabulary**

| Verdict | Meaning |
| --- | --- |
| **REAL** | The code does the thing, on the path the trader actually uses, and there is a test or a direct read that proves it. |
| **PARTIAL** | The mechanism exists and works on part of the surface, or works but leaves a hole another path falls into. |
| **COSMETIC** | The control/label exists; the underlying behaviour is not what the control says. |

---

## 1. FEATURE LIST

### 1.1 Wire formats and routing

**1. Four wire formats behind one dispatcher — REAL.**
`ApiFormat` is a four-value union (`chat_completions`, `messages`, `responses`, `google`) and every AI call in the app goes through `GenericProviderService`; the dispatcher picks the format from `ProviderConfig.apiFormat` and falls through to `throw new Error('Unknown API format: …')` for anything else. `types/provider.ts:13`, `types/provider.ts:141-146`, `services/providers/GenericProviderService.ts:1485-1498`.

**2. The OpenAI SDK is pinned to exactly one attempt — REAL.**
`createOpenAIClient` sets `maxRetries: 0` so the SDK's own retry loop cannot multiply with the app's `withRetry(fn, 3)` (which would have sent up to 9 requests to a rate-limited gateway per logical call). `services/providers/GenericProviderService.ts:519-526`.

**3. Three transports, one decision per request — REAL.**
A request is routed to (a) the Electron bridge, (b) the localhost dev proxy, or (c) the direct SDK/`fetch` path, decided at call time; the dev-proxy branch is gated on `import.meta.env.DEV` **and** hostname `localhost`/`127.0.0.1` so a packaged Capacitor WebView never takes it. `services/providers/GenericProviderService.ts:415-419`, `:1359-1363`, `:1411`, `:1893-1911`.

**4. One shared wire policy for all three transports — REAL.**
`shared/providerRequestPolicy.cjs` is the single source for the Anthropic thinking gate and budget, the messages-format temperature, the Gemini `thinkingConfig`, the provider-URL host policy, base-URL normalization and the redirect-hop rule; it is imported by the renderer, the vite dev proxy and `electron/main.cjs`. `shared/providerRequestPolicy.cjs:1-39`, `:428-435`, `:501-535`.

**5. The 400/422 degrade ladder — REAL.**
A gateway that refuses the request body is walked down a ladder of progressively less ambitious bodies: original → `json_schema`→`json_object` → no `response_format` → no `tools`/`tool_choice`. Only 400/422 advances it (429/5xx/network propagate to the retry policy), and a body with nothing left to drop is not re-sent. `services/providers/GenericProviderService.ts:585-633`, `:693-702`; pinned by `tests/providerDegradeLadder.test.ts:78-204`.

**6. The desktop bridge mirrors the ladder and adds a stream→buffered retry — REAL.**
`electron/main.cjs` re-issues the request without `response_format` on a 400/422, and re-issues a `stream:true` request buffered when a gateway rejects `stream`/`stream_options`. `electron/main.cjs:725-750`, `:751-765`.

**7. Provider URL policy — HTTPS only, HTTP on loopback/RFC1918, link-local refused — REAL.**
The cloud-metadata range (169.254/16, fe80::/10) is refused over **HTTPS too**, and every redirect hop is re-validated against the same policy with a 3-hop cap. `shared/providerRequestPolicy.cjs:331-393`, `:501-535`; the renderer's UX layer is `utils/providerUrlValidation.ts:13-47`.

### 1.2 Timeouts and retry

**8. Per-attempt hard timeouts — REAL.**
`REQUEST_TIMEOUT_MS = 120_000` for non-streaming and `STREAM_TIMEOUT_MS = 300_000` for streaming, applied through `AbortSignal.timeout` + `AbortSignal.any` so each retry gets a fresh budget. `services/providers/GenericProviderService.ts:638-659`.

**9. The Electron bridge has its own renderer-side cap — REAL.**
The bridge has no built-in cap, so the renderer arms a 120s `cancelRequest` timer per attempt (and a 300s one for the streaming bridge) — without it a wedged main-process request could hang the pipeline ~15 minutes across 3 retries. `services/providers/GenericProviderService.ts:1365-1378`, `:1785-1792`; the main process independently caps at 300s, re-armed per phase (headers → body → degrade re-fetch). `electron/main.cjs:255`, `:696-712`.

**10. The dev-proxy path had no timeout signal — FIXED 2026-10-23.**
`sendChatRequestOnce`'s dev-proxy branch used to pass `signal: options?.signal` with no `AbortSignal.timeout`, unlike every other branch. **The finding under-recorded the hole:** the *streaming* dev-proxy branch in `sendChatTurnOnce` had the same missing signal, and no row named it — and a third proxy branch (`streamViaProxy`, `:2053`) was already capped, so this is two of three, not all of them. Those two now pass what the transport they stand in for passes — `withTimeoutSignal` (120 s, `services/providers/GenericProviderService.ts:1432`) and `withStreamTimeoutSignal` (300 s, `:1619`), the second one deliberately the stream budget because a reasoning model streams its chain of thought before its answer. Dev-only (`import.meta.env.DEV` + localhost), so it was never a shipped-app hang — but it is the branch a developer runs, and pressing Stop was the only way out. Pinned by `tests/devProxyTimeout.test.ts`: the signal handed to `fetch` is not the caller's bare one, the named budget is the right one per path, and the caller's abort still reaches the wire (compare `:1486-1490`).

**11. Retry policy: 3 attempts, jittered backoff, Retry-After honoured — REAL.**
`withRetry(fn, provider, 3, signal)`; delays are `Retry-After` (capped at a 30s base, +up to 50% jitter) or exponential 2s/4s/8s with equal jitter. Jitter exists so parallel seats do not wake in lockstep and re-trip the limiter. `utils/apiErrorUtils.ts:136-156`, `:195-236`; call sites `services/providers/GenericProviderService.ts:1499-1503`, `:1726-1729`, `:2084`.

**12. What is NOT retried — REAL.**
`shouldRetry` admits only `rate_limit`, `network` and `server`. Not retried: `timeout` (deliberately — a request that burned its budget is wedged, and immediate retries only extend the stall), `invalid_key` (401), `quota_exceeded` (403/quota text), and `unknown`. `utils/apiErrorUtils.ts:65-76`, `:116-120`.

**13. A 400/422 body refusal is not retried by the retry policy — REAL.**
It is handled by the degrade ladder instead; the ladder, not `withRetry`, owns "this body was refused". `services/providers/GenericProviderService.ts:686-701`; `tests/providerDegradeLadder.test.ts:189-204` proves a 401 issues exactly one request.

### 1.3 Errors and their route to the trader

**14. `toFriendlyProviderError` leads with the provider's own words and the real cause — REAL.**
The provider's own message (sanitised at the boundary) is the headline; the cause chain under `fetch failed` is appended (`ENOTFOUND: getaddrinfo api.example.com`), and the actionable advice follows. Status is always in the message. `services/providers/GenericProviderService.ts:1114-1146` (sanitiser + extractor), `:1148-1173` (cause chain), `:1175-1278` (the mapper). Pinned end-to-end through the public transport by `tests/realProviderError.test.tsx:77-113`.

**15. Raw provider bodies never reach the trader — REAL.**
Provider text is stripped of URLs, `sk-/pk-/rk-` keys and any 24+ char token, and capped at 300 chars. `services/providers/GenericProviderService.ts:1140-1146`; the pipeline has its own parallel sanitiser. `hooks/analysisPipeline/runOutcome.ts:77-78`, `utils/runStatus.ts:96-104`.

**16. A failed turn is drawn as a failure, not as an answer — REAL.**
The error goes in the `error` field, never the `text` field; both conversation homes render the same `ChatFailureRow` ("request failed" + the real reason); a half-written answer that then failed is stamped `interrupted` so the prose cannot read as finished advice. `components/shared/ChatFailureRow.tsx:16-26`, `components/trade/panels/ChatTranscriptList.tsx:174-206`, `components/shared/ChatTranscriptRow.tsx:173-222`, `services/trade/chatTurnRunner.ts:1056-1081`; pinned by `tests/realProviderError.test.tsx:115-238`.

**17. The failure is logged — REAL.**
`toFriendlyProviderError` writes one `console.warn` per failed request, and the health service records the error (rate limits counted separately). `services/providers/GenericProviderService.ts:1272`, `:1506-1511`, `services/infrastructure/ProviderHealthService.ts:82-96`.

**18. The app has ONE status vocabulary and ONE error sanitiser — REAL.**
`utils/runStatus.ts` owns status→colour+word, `classifyStepError` (numeric fields only, never message text), `STEP_ERROR_LABEL`/`STEP_ERROR_HINT`, and `sanitizeErrorText`. `utils/runStatus.ts:28-63`, `:66-115`, `:131-156`.

**19. A 429 sets a rate-limit state and re-queues the replay — REAL.**
`classifyRunFailure` checks 429 **before** quota (both claim status 429), the pipeline sets `isRateLimited` with a 60s auto-clear tied to the run's own controller, and returns `ok:false` so a queued replay backs off instead of dequeuing a dead run. `hooks/analysisPipeline/runOutcome.ts:39-51`, `hooks/useAnalysisPipeline.ts:1546-1563`.

**20. The quota path replaces the provider's message with a canned sentence — PARTIAL.**
A quota error writes a SYSTEM row "Model "X" has exceeded its usage quota." and returns `ok:false`; the provider's own wording is dropped, and the model is matched by a substring scan of the error text. `hooks/useAnalysisPipeline.ts:1565-1569`, `hooks/analysisPipeline/runOutcome.ts:53-71`.

**21. An offline send is queued and replayed — REAL.**
An offline send is enqueued with the profile stamp, the conversation is told so, and the replay on reconnect throws on `ok:false` so the queue's own retry/backoff path applies. `hooks/useAnalysisPipeline.ts:1579-1589`, `App.tsx:934-966`.

**22. `useNetworkStatus` is a two-value flag with one consumer — COSMETIC.**
It reports `isOnline`/`wasOffline` and drives the offline-queue replay and a header badge. It does **not** gate provider calls, and it is not consulted before a send. `hooks/useNetworkStatus.ts:12-47`, `App.tsx:526`, `:934-966`, `:2264`.

### 1.4 Context window

**23. One window resolved from four sources, with the evidence named — REAL.**
Order: user override → a limit the provider itself stated in a rejection → the window `/models` reported for that model id → the 1,000,000 default. The resolved object carries `source` and a human `label` so the UI can say which one it is relying on. `utils/contextWindow.ts:46`, `:69-78`, `:136-158`; pinned by `tests/contextWindow.test.ts:73-129`.

**24. A provider-stated limit is learned and remembered (session-scoped) — REAL.**
`recordMeasuredContextWindow` stores `providerId::modelId → tokens`, clamped to 512…100,000,000 so a misread number cannot persist. `utils/contextWindow.ts:98-124`.

**25. Outbound history is sized by automatic compaction — REAL.**
`compactForWire` fits the array to `promptTokenCeiling(window, reserve) = window − outputReserve − 4,096 framing`, floored at 1,024 tokens. Compaction order: shrink old tool payloads (400-char head + a clip note) → shrink old assistant prose (600-char head) → drop whole atomic turn groups, oldest first, never the system block, never the last user turn, never the protected tail of 6 messages. `utils/contextWindow.ts:54-67`, `:169-176`; `services/providers/contextCompact.ts:73-84`, `:122-145`, `:217-308`, `:343-358`.

**26. A `tool_calls` block never loses its replies — REAL.**
`turnGroups` keeps an assistant `tool_calls` message and its `tool` replies together, because a split pair 400s an OpenAI-compatible gateway. `services/providers/contextCompact.ts:122-145`.

**27. The compaction notice is built from the actions actually taken — REAL.**
`compactNotice` counts tool payloads / prose / dropped turns and reports before→after estimated tokens; it cannot claim a drop that never happened. A request that still does not fit says "CONTEXT FULL: …" instead of being sent to a provider that will 400 it. `services/providers/contextCompact.ts:300-324`.

**28. The output budget is sized against the SAME window — REAL.**
`outputTokenBudget(window, promptTokens)` shrinks `max_tokens` to what the window still affords; if less than 128 tokens remain the request is refused with "CONTEXT WINDOW TOO SMALL: …" rather than being sent. `utils/contextWindow.ts:187-196`; `services/analysis/DeskToolsService.ts:345-378` (especially `:366-372`).

**29. A context-length rejection is read for its own number and retried ONCE — REAL.**
`contextRecoveryMessages` matches the provider's phrasing (`maximum context length is N tokens`, `prompt is too long: X > Y maximum`, `context size is N`, `inputTokenLimit`, …), records the limit as `measured`, compacts to it and returns a retry body; `sendChatRequest` / `sendChatTurn` / `streamChatRequest` each retry exactly once. If compaction changed nothing, no retry is attempted and the provider's own message reaches the trader. `utils/contextWindow.ts:207-250`, `services/providers/GenericProviderService.ts:1300-1304`, `:1324-1341`, `:1524-1529`, `:1870-1878`.

**30. The compaction notice reaches the trader — REAL.**
The desk-tool loop reports it as a tool-event line the work card draws; the casual chat route reports it in the thinking channel. `services/analysis/DeskToolsService.ts:352-357`, `services/trade/toolTurn.ts:181`, `services/providers/GenericAnalysisService.ts:646`.

**31. The 1M default is safe — REAL, with a stated dependency.**
The default changes no injected byte (every injection budget is `min(cap, window × fraction)` and both caps already bind at 65,536), and it is only used as an **outbound** ceiling, which compaction plus the measured-limit retry make survivable. The module states the assumption explicitly and labels it "assumed · 1,000,000 tokens (this model has not stated one)". `utils/contextWindow.ts:27-41`, `:153-157`; `utils/tokenEstimate.ts:25-38`; `tests/contextWindow.test.ts:48-71`.

### 1.5 Reasoning effort

**32. One ladder, one schedule, one resolution point — REAL.**
`ReasoningEffort` is a six-value union (`off|low|medium|high|max|auto`) living in the wire vocabulary; `EFFORT_BY_TASK` maps task→tier; `effortForTask` applies the stored Fast/Quality profile; `resolveComposerEffort` is the ONE resolution point, and the resolved tier rides out of the executor on the outcome so no write site re-derives it. `types/provider.ts:28`, `services/providers/reasoningControls.ts:69-96`, `:100-121`, `:136-137`; `services/trade/toolTurn.ts:79-85`, `:155-165`.

**33. Translation keys on CAPABILITY CLASSES, not provider identity — REAL.**
Detection reads host/model strings only as *evidence provenance*; the returned flags are the scope. Six routes: xAI `reasoning_effort`, OpenAI `reasoning_effort`, GLM `thinking:{enabled|disabled}` + `thinking_effort`, DeepSeek `thinking` + `reasoning_effort`, Anthropic `budget_tokens`, Responses `reasoning.effort`. `services/providers/reasoningControls.ts:167-193`, `:271-378`.

**34. Fail-closed on an unknown route — REAL.**
An unrecognised model produces **no** body change and an audit entry saying "no verified reasoning route for this wire shape (fail closed)", rather than a 200-accepted-but-ignored knob. `services/providers/reasoningControls.ts:377`.

**35. A recorded wire lesson can pin a route off — REAL.**
`registerWireRoutePins` lets a harness lesson disable a route that name-based detection would enable; a pinned route fails closed with the reason "pinned off by a harness wire lesson (re-probe to clear)". `services/providers/reasoningControls.ts:206-220`, `:278-280`, `:303-305`, `:326-328`, `:363-365`.

**36. Effort actually changes the Anthropic and Gemini wire — REAL.**
Anthropic `budget_tokens` is effort-scaled (low 0.15 / medium 0.35 / high 0.55 / max 0.85 of `max_tokens`, clamped to ≥1024 and < `max_tokens`); Gemini `thinkingBudget` is 2048/4096/8192/16384 clamped to the call's own output limit. `shared/providerRequestPolicy.cjs:67-72`, `:113-121`, `:241-262`, `:289-294`; `services/providers/GenericProviderService.ts:865-873`.

**37. The tier is a control the trader can see and change — REAL.**
`EFFORT_CHOICES` is the one ladder, `ModelChip` is the merged trigger+panel, and `Ctrl/Cmd+Shift+E` asks `effortDialUp()` before it writes — a panel session or a bot turn renders no dial and must not answer to the key. `components/shared/effortScale.ts:21-58`, `components/shared/effortDial.ts:18-31`, `components/shared/ModelChip.tsx:64-85`, `components/shared/ModelMenu.tsx:42-49`.

### 1.6 The wire audit

**38. `WireAuditEntry` is one shape, declared once — REAL.**
`types/provider.ts` declares `WireAuditRoute` and `WireAuditEntry` (route / effort / applied / reason); `reasoningControls.ts` re-exports rather than redeclares. `types/provider.ts:38-67`; `services/providers/reasoningControls.ts:48-53`; `tests/wireAudit.test.tsx:185-194`.

**39. Every transport emits an audit line, applied or not — REAL.**
`chat_completions` via `applyReasoningToChatParams`; `messages` emits an explicit `anthropic-thinking`/`none` line with the reason it did not send a thinking block; `responses` via `buildReasoningPatch`; `google` via `geminiThinkingParams` (the audit reports the budget actually sent, and says why no `thinkingConfig` went out). `services/providers/GenericProviderService.ts:880-894`, `:968-969`, `:1043-1059`, `services/providers/reasoningControls.ts:395-405`.

**40. The audit rides out on the outcome and onto the row — REAL.**
`runToolTurn` collects one entry per call and carries them on `ToolTurnOutcome.wireAudit`; the dock writes `wireAudit: outcome.wireAudit`, the pipeline writes `wireAudit: toolTurn.wireAudit`. `services/trade/toolTurn.ts:86-96`, `:137-165`; `services/trade/chatTurnRunner.ts:782`; `hooks/useAnalysisPipeline.ts:1495`; `tests/wireAudit.test.tsx:196-200`.

**41. The row distinguishes "did not think" from "was never asked to" — REAL.**
`WireAuditRow` shows `No thinking trace — <the transport's own reason>` when a settled turn produced no trace, and the applied route otherwise; it lists every call the turn made, and it is a native `<details>`. A STREAMING turn is never said to have no trace. `components/shared/WireAuditRow.tsx:36-75`, `components/trade/panels/ChatWorkTimeline.tsx`; `tests/wireAudit.test.tsx:98-183`.

### 1.7 Model selection, catalog, health

**42. One model menu everywhere — REAL.**
`ModelMenu` is the single panel; `ModelChip` (both composers) and `ModelPicker` (Settings, automation, seat pickers) mount it, so the star list and the free-only preference follow the trader. `components/shared/ModelMenu.tsx:1-25`, `components/shared/ModelPicker.tsx:1-25`, `:196-211`, `components/shared/ModelChip.tsx:95-123`.

**43. The picker is provider-qualified — REAL.**
Selections are `"providerId::modelId"`, so a model offered by two providers answers from the one actually picked; a bare legacy id resolves heuristically. `utils/providerUtils.ts:48-92`, `components/shared/ModelMenu.tsx:166`.

**44. Model discovery also learns each model's context window — REAL.**
`/models` is parsed for `context_length`, `context_window`, `context_size`, `max_context_length`, `model_context_window`, `max_model_len`, `inputTokenLimit`/`input_token_limit`, including nested `limits`/`limit`/`details`/`metadata`; implausible values are refused, and a model the provider says nothing about yields no claim (which is why the measured/default paths exist). `services/infrastructure/ProviderConfigService.ts:605-719`.

**45. A background sweep keeps the catalog fresh — REAL.**
Sweep on boot (+3s) and every 6h (15 min after an all-provider failure), concurrent per provider, merging ids and windows into the same write; a repeated sweep that says the same thing writes nothing. `hooks/useModelCatalogRefresh.ts:29-34`, `:66-146`, `:148-181`; `utils/providerUtils.ts:280-298`.

**46. Discovery failure is silent by design — REAL (documented).**
A provider that has no `/models` endpoint keeps its stored list; only the first failure is warned to the console. `hooks/useModelCatalogRefresh.ts:126-134`, `services/infrastructure/ProviderConfigService.ts:564-594` (each candidate URL has its own 15s timeout and the chain continues to the next candidate).

**47. Provider health telemetry + a cooldown bench — REAL.**
Per-provider request/success/error/rate-limit counts, average latency over successes only, last error; ≥3 persisted errors in 15 min → 10-minute bench, cleared by the next success; in-memory by design. `services/infrastructure/ProviderHealthService.ts:22-43`, `:64-96`, `:104-122`.

**48. The bench is consulted — but only in three places — PARTIAL.**
It is consulted for the global "fallback model" pick (a non-benched provider is preferred) `App.tsx:328-336`, for a bot's seat (`services/agents/botAttention.ts:55`), and it is shown in Settings (`components/settings/ProviderManager.tsx:94`). It is **not** consulted when the Chat surface or the dock chooses the provider for a turn, so a benched provider keeps answering the trader's chat.

**49. `isProviderReady` vs `readyProviderModels` disagree on keyless local servers — PARTIAL.**
`isProviderReady` accepts a keyless loopback/LAN provider (`isLocalBaseUrl`); `readyProviderModels` requires `apiKey.trim().length > 0` and does not accept the keyless exemption — and it is the list the pipeline's fallback provider, quota attribution and notebook quick-save read. A local Ollama/LM Studio server is therefore visible in the model menu but excluded from the pipeline's fallback roster. `utils/providerUtils.ts:18-22` vs `:38-42`; `hooks/useAnalysisPipeline.ts:645`, `:1342-1344`.

**50. `readyProviderModels` still caps at three — COSMETIC.**
`.slice(0, 3)` is a leftover from the deleted multi-seat ensemble; the comment says the ensemble is gone, so the cap no longer means anything. `utils/providerUtils.ts:38-42`.

### 1.8 Tooling, turns, and the desk

**51. A tool call has its own 20s deadline — REAL.**
`withinToolDeadline` runs each call under a 20s timer and the seat's Stop; neither exit throws past the batch, because a `tool_calls` turn must be answered by a tool result or the provider rejects the transcript. A timeout, a stop and a throw all come back as a `DATA_UNAVAILABLE:` receipt naming what the seat did not get. `services/analysis/DeskToolsService.ts:211-285`; `utils/harnessMarks.ts` owns the sentinel.

**52. A malformed tool call self-heals — REAL.**
A malformed `<tool_call>` block is bounced back with a correction prompt (bounded by the round budget); a call cut off mid-emission gets a DIFFERENT repair ("make it fit", not "re-emit"), because asking for an exact re-emission asks for the same cut. `services/analysis/DeskToolsService.ts:3788-3822`.

**53. A thinking-cut round is re-asked once at a lower tier — REAL.**
A round that produced no text and reported `length` (or no stop signal at all) is re-asked ONCE with the tier stepped down, and the step-down persists for the rest of the turn. `services/analysis/DeskToolsService.ts:3823-3857`; `services/providers/reasoningControls.ts:109-110`.

**54. A repeating seat is stopped — REAL.**
Three identical calls, or an alternating pair seen twice, ends the turn with a "REPEAT" notice. `services/analysis/DeskToolsService.ts:293-306`, `:4090-4103`.

**55. The turn budget is SOFT — PARTIAL.**
`DESK_TURN_BUDGET_MS = 180_000` only *nudges* the model at `DESK_TURN_WRAPUP_AT` of the budget; it never stops the turn. The hard bounds are `MAX_DESK_TOOL_ROUNDS = 8` and the per-request transport timeout — a worst case of 8 × 300s. `services/analysis/DeskToolsService.ts:196-219`, `:4092-4095`.

**56. A thinking-only turn is named, not hidden — REAL.**
If the model streams only its reasoning, the row says so ("The model streamed only its reasoning this turn — no separate answer came through") rather than showing the scratchpad twice. `services/trade/toolTurn.ts:222-241`.

**57. The casual-chat "reasoning ate the budget" case retries once at double tokens — REAL.**
A clean stream with zero visible text but real reasoning retries once with `TASK_BUDGETS.chat * 2`; if that also yields nothing, the trader gets a named explanation, not a generic apology. `services/providers/GenericAnalysisService.ts:664-675`, `:550-553`.

**58. The empty-answer fallback distinguishes "no answer" from "no answer after thinking" — REAL.**
`emptyVisibleFallback(reasoningSeen)` names the real cause ("the model spent its entire reply budget on hidden reasoning"). `services/providers/GenericAnalysisService.ts:543-553`.

**59. JSON-boundary failures degrade, they do not lie — REAL.**
An unparseable strategy-search/discovery response returns `[]` with a console error; a vision failure returns a visible "Chart N | Analysis Failed" summary; a chart-image OCR failure is written into the image metadata. `services/providers/GenericAnalysisService.ts:804-810`, `:833-843`, `:865-878`; `services/providers/imageProcessor.ts:138-160`.

**60. The final-summary generator retries once with thinking forbidden — REAL.**
A response with no structured summary is retried with "Do NOT output any reasoning" and a heading-first instruction; if that also fails the function returns a sentence that says exactly that, instead of storing the reasoning as a summary. `services/providers/GenericAnalysisService.ts:982-996`.

**61. API keys are encrypted at rest on desktop, and a failed decrypt marks the provider NOT ready — REAL.**
`safeStorage` encryption with an `enc:v1:` prefix; a decrypt failure yields an EMPTY key (the ciphertext is never sent as a Bearer token) and the stored ciphertext is preserved against a later read-modify-write. `services/infrastructure/ProviderConfigService.ts:14-77`, `:86-96`, `:202-223`.

**62. The provider read degrades to "none configured" instead of hanging the boot — REAL.**
A rejecting read of the provider prefs now sets `isLoaded` and empties the list, with a console error — previously the flag stayed false forever and every boot step gated on it silently never ran. `hooks/useProviderConfigs.ts:26-47`.

**63. Provider writes are serialised — REAL.**
Every CRUD op is a read-modify-write behind one promise chain, so two overlapping ops cannot clobber each other. `services/infrastructure/ProviderConfigService.ts:225-257`.

**64. Optional provider fields survive a restart — REAL.**
`contextWindowTokens`, `thinkingCapable`, `jsonSchemaCapable`, the two pricing rates and `modelContextWindows` are read back with coercions and COPIED — they were being dropped, so a typed window held for the session and vanished on restart, and `utils/contextWindow` fell back to its assumed default. `services/infrastructure/ProviderConfigService.ts:161-189`; `tests/providerConfigService.test.ts:71-126`.

**65. A provider whose key cannot be decrypted is preserved, not destroyed — REAL.**
`undecryptableCiphertexts` re-persists the original ciphertext for any entry still carrying the failed-decrypt empty key, so an unrelated CRUD op cannot permanently destroy a key the OS keyring merely could not open. `services/infrastructure/ProviderConfigService.ts:86-96`, `:202-223`; `tests/providerConfigService.test.ts:190-211`.

**66. Per-task output budgets are one table — REAL.**
`TASK_BUDGETS` is the single source for `maxTokens` at every provider call site. `services/providers/taskBudgets.ts:1-27`.

**67. Token usage is measured, never inferred — REAL.**
`extractTokenUsage` reads `usage` or `usageMetadata`; the desktop bridge path coerces and REFUSES a non-numeric frame (a NaN used to disable the per-run spend cap). `utils/tokenUsage.ts:19-46`, `services/providers/GenericProviderService.ts:248-280`.

**68. A missing usage frame is a stated gap, not a zero cost — REAL.**
`usageCalls` distinguishes one round from four, and `costUsd` is left undefined without real rates. `services/trade/toolTurn.ts:73-78`, `utils/sessionUsage.ts:56-92`, `utils/tokenUsage.ts:48-59`.

**69. The finish reason is normalized across the four families, and truncation is a first-class fact — REAL.**
`normalizeFinishReason` maps the four vocabularies onto one closed set and keeps an unknown token as `'unknown'` rather than `'stop'`; `extractFinishReason` reads all four body shapes and treats a Responses `status:'incomplete'` as `'length'`. The per-run tally is bracketed by the caller and read with `peekTruncations()`. `utils/finishReason.ts:17-111`, `:113-200`, `:211-217`.

**70. The estimator is deliberately biased high — REAL.**
Wide (CJK) characters count at ~1 token, dense ASCII at ~1/2, plain ASCII at 1/4, plus 4 tokens of per-message framing. `utils/tokenEstimate.ts:40-83`.

**71. The measured chars-per-token anchor is observed but NOT consumed — PARTIAL, and honestly documented.**
`observePromptRatio` records the ratio, but `effectiveCharsPerToken()` ignores it: the measurement's denominator includes system framing and tool schemas the numerator does not, so consuming it pinned the slice at a quarter of its size and starved injected memory. The reversal (2026-09-22) is documented in place. `utils/tokenEstimate.ts:85-120`, `:122-143`.

---

## 2. Failure modes

| # | Failure | Timeout? | Surfaced to the trader? | Logged? | file:line |
| --- | --- | --- | --- | --- | --- |
| (a) | **Provider never resolves** (direct/web path) | **Yes** — 120s per attempt, 3 attempts (≈6 min + backoff) | **Yes** — error row with the provider's own message + cause chain | **Yes** — `console.warn` + `recordProviderError` | `GenericProviderService.ts:638`, `:651-654`, `:695`, `:1491-1503`, `:1272`, `:1509` |
| (a′) | Provider never resolves (Electron bridge) | **Yes** — renderer 120s cancel timer + main-process 300s per phase | Yes — same error row | Yes | `GenericProviderService.ts:1365-1378`; `electron/main.cjs:255`, `:696-712` |
| (a″) | Provider never resolves (dev proxy — **both** branches, not just the non-streaming one this row first named) | **Now Yes** — 120 s on the request, 300 s on the turn (fixed 2026-10-23; it used to be **no timeout signal at all**) | The turn ends and the row shows the failure | Yes | `GenericProviderService.ts:1432`, `:1619`; pinned by `tests/devProxyTimeout.test.ts` |
| (b) | **Stream stalls mid-answer** | **Yes** — 300s TOTAL budget (not an idle timer) on every streaming path | **Yes** — the generator rethrows once a delta was painted; the row shows the failure, or the "Run stopped" card with the cause when prose had arrived | Yes | `GenericProviderService.ts:643`, `:656-659`, `:1792`, `:1870-1878`; `ChatTranscriptList.tsx:199-206` |
| (b′) | Stream stalls **before** the first delta | Yes — same 300s | Yes | Yes | `GenericProviderService.ts:1866-1878` |
| (c) | **A tool throws** | **Yes** — 20s per tool call, plus the seat's Stop | **Yes, as a tool result, not a turn failure** — a `DATA_UNAVAILABLE:` receipt to the model + a digest line in the work card | The digest line is the record; individual tools also `console.error` | `DeskToolsService.ts:220`, `:252-285`, `:4019-4022`; `utils/harnessMarks.ts` |
| (c′) | A tool call never returns | Yes — 20s → `DATA_UNAVAILABLE: did not answer within 20s` | Yes, same channel | Same | `DeskToolsService.ts:277-280` |
| (d) | **Context-length rejection** | n/a — the provider answered | **Yes** — the request is retried once against the stated limit; if compaction cannot help, the provider's own message reaches the trader | The compaction notice is painted; the measured limit is recorded | `GenericProviderService.ts:1324-1341`, `:1300-1304`; `utils/contextWindow.ts:233-243`; `DeskToolsService.ts:352-357` |
| (d′) | Context window too small even after compaction | n/a | **Yes** — "CONTEXT WINDOW TOO SMALL: … Raise the provider context window or shorten the conversation." and the request is refused | The line is reported as a tool event | `DeskToolsService.ts:366-372` |
| (e) | **Quota / 403** | n/a | **Yes** — fails fast (not retried); the pipeline writes a canned quota row naming the model (the provider's wording is dropped) | Yes | `utils/apiErrorUtils.ts:44-50`, `:116-120`; `useAnalysisPipeline.ts:1565-1569` |
| (e′) | **Invalid key / 401** | n/a | **Yes** — fails fast, "HTTP 401: invalid API key. Check your provider settings." | Yes | `utils/apiErrorUtils.ts:52-59`; `GenericProviderService.ts:1223-1225` |
| (e″) | **429 rate limit** | Per-attempt 120s/300s; backoff 2/4/8s + jitter, `Retry-After` honoured (≤30s base, +50%) | **Yes** — after 3 attempts, an error row; the pipeline also sets a 60s rate-limit state | Yes — one `console.warn` per retry | `utils/apiErrorUtils.ts:26-41`, `:136-156`; `useAnalysisPipeline.ts:1549-1563` |
| (f) | **Aborted run (Stop)** | n/a | **Dock: yes** — the streamed prose is kept and the row is stamped `interrupted`. **Chat surface: partially** — the partial text is kept, but the canonical `Message` has no `interrupted` field, so a cut answer can read as a finished one, and no error row is written | Not logged | `chatTurnRunner.ts:1051`, `:1077`; `useAnalysisPipeline.ts:1533-1544`; `types/message.ts` has no `interrupted` (contrast `components/shared/ChatTranscriptRow.tsx:78`) |
| (g) | **Automation run produces nothing** | Per-request, as (a)–(d) | **Yes** — the run settles as `error`/`skipped` with its own reason on the run card, a toast fires, and after 3 in a row the schedule disables itself with a persisted `disabledReason` and a banner | Yes — the `AutomationRun` row is the record | `useAutomations.ts:282-310`, `:510-538`, `:594-602`; `services/automation/AutomationService.ts:127`; `services/trade/automationTurn.ts:290-304` |
| (g′) | Automation run returns an **empty but successful** answer | — | **Weak** — the run settles `complete` with an empty message; the streak breaker counts only `error`/`skipped`, so it does not trip | The run row exists but holds no text | `useAutomations.ts:287` (`failed = status === 'error' \|\| status === 'skipped'`), `:594` |
| (h) | Malformed provider response (non-JSON from the dev proxy) | per attempt | **Yes** — "Provider proxy returned invalid JSON: … Body: …" | Yes | `GenericProviderService.ts:1441-1447`, `:1628-1634` |
| (i) | Provider error event inside an SSE stream | per attempt (stream open retried) | **Yes** — a `chunk.error` throws rather than finishing the stream "cleanly" | Yes | `GenericProviderService.ts:2131-2143`, `:2161-2169` |
| (j) | Provider returns 200 with **no** content | — | **Yes** — a JSON-mode call retries without `response_format`; a plain call returns empty, and the casual route explains the empty-visible-after-reasoning case | Warned | `GenericProviderService.ts:712-714`; `GenericAnalysisService.ts:543-553`, `:664-675` |
| (k) | Offline | n/a | **Yes** — "You're offline — this analysis was queued and will run automatically when you're back online." | Yes | `useAnalysisPipeline.ts:1579-1589` |
| (l) | Model truncated at the token ceiling | n/a | **Yes** — "THE PROVIDER STOPPED EARLY: …" written onto the row | Written onto the row | `utils/finishReason.ts:211-217`; `chatTurnRunner.ts:769`, `:795` |
| (m) | Seat loops on the same tool call | Repeat detector (3 identical / A,B,A,B) | **Yes** — a "REPEAT" notice and the turn ends | Tool-event line | `DeskToolsService.ts:293-306`, `:4090-4103` |
| (n) | Seat thinks the whole round away (no text, no call) | per attempt | **Yes** — re-asked once at a lower tier, with a tool-event line saying so | Tool-event line | `DeskToolsService.ts:3823-3857` |
| (o) | A stale model pick (provider disabled / key gone / model deleted) | n/a | **Yes** — the amber banner names the reason and the provider+model that WILL answer | n/a (UI state) | `utils/providerUtils.ts:119-134`; `components/trade/panels/ChatComposer.tsx:94-106`; `components/agents/AgentsView.tsx:1542-1544` |
| (p) | No provider configured at all | n/a | **Yes** — a blocked-run notice in the conversation | `console.error` | `useAnalysisPipeline.ts:700-725` |

---

## 3. Model fallback: real or not — the decisive section

**Verdict: there is NO automatic runtime fallback across providers or models in the chat, dock, analysis or automation path. What exists is (i) a *resolution-time* fallback for a stale pick, and (ii) exactly ONE runtime cross-provider fallback, in a non-chat feature, and it fails silently.**

There are three distinct things the word "fallback" can mean in this repo. Only the first two exist.

### 3.1 Resolution-time fallback — REAL, and honestly announced

A stored pick goes stale for ordinary reasons (provider edited, disabled, key removed, model deleted). `computeChatModelFallback` resolves the pick, and when it cannot, returns the **first ready provider** plus a reason string. The composer's amber banner prints the reason and names the provider+model that will answer. `utils/providerUtils.ts:101-134`.

- Dock composer: `components/trade/panels/ChatComposer.tsx:94-106`, mounted at `:121`.
- Chat surface composer: `components/agents/AgentsView.tsx:1542-1544` (suppressed when a bot is active, because a bot answers on its own config).
- The reason is computed ONCE, in `utils/providerUtils.ts`, and handed to both surfaces by `App.tsx` and `components/trade/TradeChatPanel.tsx` — no second, divergent copy. `tests/modelFallbackBanner.test.tsx:47-63`.
- The form-field variant says "· unavailable" instead of rendering a dead slug. `components/shared/ModelPicker.tsx:150-165`.

This is a **pick-time** fallback. It is real, it is announced, and it is not what most people mean by "fallback when the provider fails".

### 3.2 Runtime fallback on a provider FAILURE — ABSENT

When the selected provider returns 500/429/401/malformed, the turn **fails**. There is no second provider tried, no second model tried, and no "answered by another model" notice. The error reaches the trader as a failure row.

Evidence:

- `sendChatRequestOnce` / `sendChatTurnOnce` catch, record the health error, and rethrow a friendly error. There is no loop over other providers. `services/providers/GenericProviderService.ts:1506-1511`, `:1732-1737`.
- The pipeline picks ONE provider for the turn (`chosen` = the composer's selection, else `enabledProviders[0]`) and uses it for the whole turn. `hooks/useAnalysisPipeline.ts:1338-1344`.
- The dock uses ONE `soloProvider` for the turn. `services/trade/chatTurnRunner.ts:1044-1045`.
- The automation resolves ONE seat (`automationSeatFor` returns the first ready pair, or `null` = a visible error). `services/trade/automationTurn.ts:106-127`.
- The cooldown bench (`isProviderOnCooldown`) is consulted for the global fallback-model pick and for bot seats — **not** for the chat/dock turn provider. `App.tsx:328-336`, `services/agents/botAttention.ts:55`.

What the app *does* have at runtime is **within-provider** resilience: the 3-attempt retry, the 400/422 body-degrade ladder, the empty-content retry without `response_format`, the context-length compaction+retry, the thinking-cut re-ask, and the malformed-tool self-heal. All of those keep the SAME provider and the SAME model.

### 3.3 The one runtime cross-provider fallback — REAL but SILENT, and in a chart-overlay feature only

`AITrendlineService.analyzeWithAI` loops over the ready providers and tries each until one returns parseable JSON. This is the ONLY code in the app that switches provider on a failure. `services/analysis/AITrendlineService.ts:225-243`; pinned by `tests/aiTrendlineJson.test.ts:64` ("falls through to the next provider when one returns unparseable junk").

But: on total failure it returns `EMPTY_RESULT` — a hard-coded object whose summary is "AI analysis unavailable" and whose risk factors say "AI analysis failed - use caution". The only trace is a `console.error`. The trader is not told which provider failed or why. `services/analysis/AITrendlineService.ts:46-60`, `:242-243`.

### 3.4 What the trader is told when the configured provider is down

Trace of a 500 / 429 / 401 on the Chat surface:

1. `withRetry` classifies and retries (429/network/5xx) or fails fast (401/403). `utils/apiErrorUtils.ts:21-120`.
2. `toFriendlyProviderError` builds the message: the provider's own text leads, the cause chain is appended, the status is named. `services/providers/GenericProviderService.ts:1175-1278`.
3. The error propagates out of the transport; the pipeline's catch classifies it (`rate-limit` / `quota` / `generic`) and writes an error row with `error:` set (never `text:`) and `retryOf` so the trader can re-run the same prompt. `hooks/useAnalysisPipeline.ts:1523-1613`.
4. The row renders as a `ChatFailureRow` — "request failed" + the real reason. `components/shared/ChatFailureRow.tsx:16-26`.
5. `recordProviderError` bumps the health telemetry; a third persisted error in 15 minutes benches the provider for 10 minutes (visible in Settings, and it loses bot seats). `services/infrastructure/ProviderHealthService.ts:82-96`, `:104-122`.

**So: the trader sees a REAL error, not a silent failure — on the chat/dock/analysis path.** The one place a failure is silent is the AI-trendline overlay (§3.3).

### 3.5 The "amber model-fallback warning" — what the Stage 3 plan asked for, and what exists

The Stage 3 plan (recovered from git at `dd34ea87`, `docs/plans/stage3-arrangement.md`, Phase F item 4) says:

> **Model handling:** consistent `modelsUsed` on every write path; amber model-fallback warning added to the Chat surface composer (dock-only today, `ChatComposer.tsx:105`); Journal→Models tab stays the per-model home.

**The amber warning: IMPLEMENTED — but it is a STALE-PICK warning, not a "the provider failed and we answered from somewhere else" warning.** The component is `ModelFallbackBanner` (`components/trade/panels/ChatComposer.tsx:94-106`), it is styled amber (`border-amber-500/30 bg-amber-500/10 text-amber-300`), it reads `role="status"`, and it is mounted in BOTH composers — the dock (`ChatComposer.tsx:121`) and the Chat surface (`AgentsView.tsx:1542-1544`). `tests/modelFallbackBanner.test.tsx:23-45` pins the wording; `scripts/render-probe.cjs:2005-2029` drives it in a real browser ("a stale chat-model pick warns on the Chat surface"). The Chat surface's half of the plan item is therefore **closed**.

**The `modelsUsed` half: PARTIAL.** Every model-answer write path stamps it — the Chat surface's streaming and settle writes (`hooks/useAnalysisPipeline.ts:1360`, `:1461`), the schedule (`:1281`), the bot routine (`services/agents/botRoutine.ts:153`), the mailbox (`services/agents/botMailbox.ts:279`, `hooks/useBotMailbox.ts:191`), the group room (`hooks/useAgentGroups.ts:219`), the dock's bot turn (`App.tsx:1747`) and the failed-turn error row (`hooks/useAnalysisPipeline.ts:1603`).

**One model-answer write path does not: the Chart AI dock's SOLO turn mirrored into the Chat conversation.** `commitSoloChatTurn` writes the row *deliberately un-stamped* — "no `botId`, no `modelsUsed`" (`App.tsx:1768-1769`, `:1770-1807`). Because `threadForProvider` claims an AI row only when it carries exactly one `modelsUsed` key matching the provider (+ model), such a row is **never filed into a provider/model thread** (`utils/agentThreads.ts:84-92`), so it contributes nothing to per-model attribution (the Journal's per-model home, the calibration ledger's provider keys, `utils/avoidReason.ts:231-233`).

Two further gaps, for completeness:
- The `modelsUsed` collision fallback the plan alludes to (`hooks/analysisPipeline/modelsUsed.ts:15-27`) no longer exists — the multi-seat ensemble was deleted, so the collision (two lens roles on one provider) it solved cannot occur. `git log --all -- hooks/analysisPipeline/modelsUsed.ts` shows the file removed in `d737b908`. The plan item is therefore **moot, not open**.
- The harness-authored AI rows (the notebook quick-save receipt and its failure row) carry no `modelsUsed` — correct, since they are not model answers. `hooks/analysisPipeline/notebookQuickSave.ts:63-90`.
- The "Log this trade" receipt is an AI-role row with no `modelsUsed` — also correct (a receipt, not an answer). `services/trade/proposedTrade.ts:370-380`.

---

## 4. Wire audit and the effort tier — is the UI honest?

**What is recorded.** One `WireAuditEntry` per REQUEST: `route` (which capability route the transport applied), `effort` (the harness tier that drove it), `applied` (machine-readable outcome), `reason` (human-readable, and the transport's own words). `types/provider.ts:58-67`. The route vocabulary is eight values: `xai-effort`, `openai-effort`, `glm-thinking`, `deepseek-thinking`, `anthropic-thinking`, `responses-effort`, `gemini-thinking`, `none`. `types/provider.ts:38-46`.

**What the trader sees.** `WireAuditRow` is a native `<details>` disclosure. Its summary is either `No thinking trace — <reason>` (a settled turn that produced no thinking, where the transport's reason is the only thing that can explain it) or `Wire · <route label> · <effort>`. The body lists EVERY call the turn made, numbered, with route, effort, applied/not applied, and the reason. `components/shared/WireAuditRow.tsx:36-75`.

**Is it honest? Yes, with three specific honesties worth naming.**

1. **It distinguishes "the model did not think" from "the model was never asked to think."** A turn with no trace shows the transport's own reason verbatim — e.g. "no thinking block: model id not recognized as thinking-capable (set the override in Settings)". `components/shared/WireAuditRow.tsx:52-53`; `services/providers/GenericProviderService.ts:876-894`; `tests/wireAudit.test.tsx:98-111`.
2. **A STREAMING turn is never said to have no trace** — the trace may still be on its way, and claiming there is none would be a lie the trader would act on. `tests/wireAudit.test.tsx:170-182`.
3. **The effort tier is resolved ONCE and carried out of the executor**, so the composer's label, the request and the row can never disagree. `services/providers/reasoningControls.ts:136-137`; `services/trade/toolTurn.ts:79-85`, `:155-165`; `components/shared/effortScale.ts:30-33` (one label table for the trigger and the menu).

**Two honest weak spots:**

- **The effort chip and the wire audit are separate facts and the row does not join them.** The audit's `effort` is the tier the transport was told; the answer's tier chip is the tier the turn ran under. They are the same value by construction today, but nothing in `WireAuditRow` renders the tier chip's own label — it prints the raw union id (`high`, `max`) next to the route, while the composer prints the ladder's label ("High"). `components/shared/WireAuditRow.tsx:54`, `:69` vs `components/shared/effortScale.ts:21-28`. The AGENTS.md rule that the ladder "also LABELS the answer's tier chip" is satisfied for the chip, not for the audit row.
- **A turn with no wire record says nothing about the wire** — correct, and tested. But it means a turn whose transport never emitted an audit (e.g. a format whose path was not instrumented) is indistinguishable from a turn that was never audited. `tests/wireAudit.test.tsx:162-168`.

---

## 5. Weak spots

1. **No runtime provider/model fallback on the chat path (the big one).** A provider outage, a 429 storm, or a quota exhaustion ends the turn. The app has every ingredient for a fallback (a ready-provider roster, a cooldown bench, the health ledger) but the turn path consults none of it. `services/providers/GenericProviderService.ts:1506-1511`, `hooks/useAnalysisPipeline.ts:1338-1344`, `services/trade/automationTurn.ts:106-127`.
2. **The cooldown bench is not consulted for a chat turn's provider.** It moves the global fallback pick and bot seats, but a benched provider keeps answering the trader's chat. `App.tsx:328-336`, `services/agents/botAttention.ts:55` vs `hooks/useAnalysisPipeline.ts:1338-1344`.
3. **The one existing runtime cross-provider fallback is silent** — `AITrendlineService` returns a hard-coded "AI analysis unavailable" object with only a `console.error` behind it. `services/analysis/AITrendlineService.ts:46-60`, `:242-243`.
4. **A stopped turn on the Chat surface is not marked as stopped.** The canonical `Message` has no `interrupted` field, so the partial answer can read as finished; only the dock's row carries the flag (declared on the persisted `StoredChatEntry`, `services/trade/chatSessions.ts:103`, inherited by `chatStore.LiveEntry` at `chatStore.ts:48`) and the "Run stopped" card. `types/message.ts` (no `interrupted`) vs `components/shared/ChatTranscriptRow.tsx:78`, `components/trade/panels/ChatTranscriptList.tsx:204-206`; `services/trade/chatTurnRunner.ts:1077`; `useAnalysisPipeline.ts:1544`.
5. **`readyProviderModels` excludes keyless local providers** that `isProviderReady` includes, so an Ollama/LM Studio server is in the menu but not in the pipeline's fallback roster. `utils/providerUtils.ts:18-22` vs `:38-42`.
6. **~~The dev-proxy non-streaming branch has no per-attempt timeout~~ — FIXED 2026-10-23**, and the fix covered the streaming branch too, which this row did not know was open. Dev-only, but it is the branch a developer runs. `services/providers/GenericProviderService.ts:1432`, `:1619`.
7. **The turn budget is soft.** `DESK_TURN_BUDGET_MS` only nudges the model; the hard bound is 8 rounds × a 300s per-request cap, so a pathological desk turn can run for tens of minutes (each round is individually stoppable). `services/analysis/DeskToolsService.ts:196-219`, `:4092-4095`.
8. **The stream timeout is a TOTAL budget, not an idle timeout.** A legitimate reasoning stream that takes more than 300s is killed mid-answer, and the trader's stream fails with a timeout rather than a "keep waiting". `services/providers/GenericProviderService.ts:643`, `:656-659`.
9. **The quota path drops the provider's own wording** for a canned sentence and matches the model by a substring scan. `hooks/useAnalysisPipeline.ts:1565-1569`, `hooks/analysisPipeline/runOutcome.ts:53-71`.
10. **An automation run that returns an empty but successful answer does not trip the breaker** — only `error`/`skipped` count, so a schedule that answers "" forever never disables itself. `hooks/useAutomations.ts:287`, `:594`.
11. **The dock's solo turn carries no `modelsUsed`**, so it is invisible to per-model attribution and to `threadForProvider`. `App.tsx:1768-1807`, `utils/agentThreads.ts:84-92`.
12. **The estimator's measured anchor is observed but not consumed**, by a documented and deliberate reversal. `utils/tokenEstimate.ts:85-120`.
13. **`readyProviderModels` still caps at three** — an ensemble leftover. `utils/providerUtils.ts:38-42`.
14. **The wire-audit row prints the raw effort id** while the composer prints the ladder's label. `components/shared/WireAuditRow.tsx:54` vs `components/shared/effortScale.ts:21-28`.

---

## 6. What is ALREADY GOOD

1. **One provider client, one wire policy.** Every AI call in the app goes through `GenericProviderService`; the thinking gate, temperature, Gemini budget, URL host policy, base-URL normalization and the redirect rule live in ONE `.cjs` that the renderer, the dev proxy and `electron/main.cjs` all import. The three hand-copied copies that had drifted are gone. `shared/providerRequestPolicy.cjs:1-39`; `services/providers/GenericProviderService.ts:22-29`.
2. **The error the trader sees is the provider's real reason.** The cause chain under "fetch failed" is read and the provider's own text leads the sentence, with the actionable advice after it — and the whole thing is pinned through the public transport, not a helper. `services/providers/GenericProviderService.ts:1148-1278`; `tests/realProviderError.test.tsx:77-113`.
3. **A failed turn is drawn as a failure, in both homes, and never as an answer.** `ChatFailureRow` + the `error` field + the `interrupted` stamp. `components/shared/ChatFailureRow.tsx:16-26`; `tests/realProviderError.test.tsx:115-238`.
4. **The context window is resolved from the best available evidence and the evidence is named.** Four sources, a stated reason, a session-scoped measured limit, and a default that is explicitly labelled "assumed". `utils/contextWindow.ts:27-41`, `:136-158`.
5. **The optimistic 1M default is backed by a compaction engine and a self-correcting retry** — the reason the default can be optimistic without being unsafe. `services/providers/contextCompact.ts:217-308`; `services/providers/GenericProviderService.ts:1324-1341`.
6. **Compaction never splits a `tool_calls` block from its replies**, never touches the system block, the protected tail, or the last user turn, and reports exactly what it cut. `services/providers/contextCompact.ts:122-145`, `:252-288`, `:313-324`.
7. **The 400/422 degrade ladder is a ladder, not nested try/catch** — and there is a test for the exact shape the nesting used to strand (jsonMode + tools). `services/providers/GenericProviderService.ts:585-633`; `tests/providerDegradeLadder.test.ts:87-105`.
8. **Retry is jittered and timeouts are NOT retried.** The two decisions that stop a rate-limited gateway from being hammered and a wedged request from being re-wedged. `utils/apiErrorUtils.ts:116-120`, `:136-156`.
9. **The reasoning ladder is one ladder with one resolution point**, capability-classed, fail-closed, and pinnable by a recorded wire lesson. `services/providers/reasoningControls.ts:69-96`, `:167-193`, `:271-378`.
10. **The wire audit turns "no trace" into a stated fact**, collected per call, carried on the outcome, and rendered as a native disclosure that never lies about a streaming turn. `types/provider.ts:58-67`; `components/shared/WireAuditRow.tsx:47-75`; `tests/wireAudit.test.tsx`.
11. **The tool layer refuses to hang.** A 20s per-call deadline, a Stop that answers at once, a `DATA_UNAVAILABLE:` receipt instead of a thrown exception, a malformed-call self-heal, a repeat detector, and a thinking-cut re-ask. `services/analysis/DeskToolsService.ts:211-285`, `:293-306`, `:3788-3857`.
12. **An unattended schedule that produces nothing disables itself**, with a persisted reason, a toast, a banner, and only a human re-enable clears it. `hooks/useAutomations.ts:265-310`; `services/automation/AutomationService.ts:127`.
13. **Finish reasons are normalized and truncation is a first-class, readable fact** — a cut-off answer is never mistaken for a complete one, and an unknown provider token stays visible as `unknown`. `utils/finishReason.ts:17-111`, `:211-217`.
14. **Usage is measured, not inferred**; a missing usage frame is reported as a gap, and a malformed frame is refused rather than allowed to NaN the run ledger. `services/providers/GenericProviderService.ts:248-280`; `utils/tokenUsage.ts:19-46`.
15. **The provider credential path is careful**: encrypted at rest on desktop, plaintext only where the platform has no keyring, a failed decrypt marks the provider not-ready rather than sending ciphertext as a Bearer token, and the stored ciphertext is preserved against a later save. `services/infrastructure/ProviderConfigService.ts:14-77`, `:86-96`, `:202-223`.
16. **The provider URL policy is a real SSRF defence** — HTTPS by default, HTTP only on loopback/RFC1918, the cloud-metadata range refused over HTTPS too, and every redirect hop re-validated. `shared/providerRequestPolicy.cjs:331-393`, `:501-535`.
17. **The model menu is genuinely one menu**, and the amber banner is real, mounted in both composers, driven in a browser probe, and computed in exactly one place. `components/shared/ModelMenu.tsx`; `components/trade/panels/ChatComposer.tsx:94-106`; `scripts/render-probe.cjs:2005-2029`; `tests/modelFallbackBanner.test.tsx`.

---

## 7. Quick reference — where the numbers live

| Thing | Value | Where |
| --- | --- | --- |
| Non-streaming per-attempt timeout | 120,000 ms | `GenericProviderService.ts:638` |
| Streaming per-attempt timeout (total, not idle) | 300,000 ms | `GenericProviderService.ts:643` |
| Desktop main-process per-phase cap | 300,000 ms | `electron/main.cjs:255` |
| Retry attempts | 3 | `GenericProviderService.ts:1501`, `:1727`, `:2084` |
| Backoff (no `Retry-After`) | 2s/4s/8s, equal jitter, cap 30s | `utils/apiErrorUtils.ts:154-155` |
| Backoff (`Retry-After`) | min(header, 30s) + up to +50% jitter | `utils/apiErrorUtils.ts:146-147` |
| Retried classes | rate_limit, network, server | `utils/apiErrorUtils.ts:116-120` |
| NOT retried | timeout, invalid_key, quota_exceeded, unknown | `utils/apiErrorUtils.ts:65-76`, `:116-120` |
| Default context window | 1,000,000 tokens (assumed) | `utils/contextWindow.ts:46` |
| Framing reserve | 4,096 tokens | `utils/contextWindow.ts:54` |
| Default output reserve | 4,096 tokens | `utils/contextWindow.ts:62` |
| Protected tail in compaction | 6 messages | `utils/contextWindow.ts:67` |
| Tool-call deadline | 20,000 ms | `DeskToolsService.ts:220` |
| Desk round cap | 8 | `DeskToolsService.ts:196` |
| Desk turn budget (soft) | 180,000 ms | `DeskToolsService.ts:208` |
| Desk round output budget | 8,192 tokens | `DeskToolsService.ts:241` |
| Cooldown trigger / window / duration | 3 errors / 15 min / 10 min | `ProviderHealthService.ts:41-43` |
| Provider model-catalog sweep | 6h (15 min after an all-provider failure) | `useModelCatalogRefresh.ts:31-34` |
| Model discovery per-candidate timeout | 15,000 ms | `ProviderConfigService.ts:566` |
| Connection test timeout | 30,000 ms | `GenericProviderService.ts:2249` |
| Provider warm-up HEAD timeout | 3,000 ms | `GenericProviderService.ts:501` |
| Effort ladder | off, auto, low, medium, high, max | `components/shared/effortScale.ts:21-28` |
| Anthropic thinking budget fractions | 0.15 / 0.35 / 0.55 / 0.85 (floor 1024) | `shared/providerRequestPolicy.cjs:67-72`, `:77` |
| Gemini thinking budgets | 2048 / 4096 / 8192 / 16384 | `shared/providerRequestPolicy.cjs:241-247` |
| Per-task output budgets | analysis 8192, chat 8192, ocr 2560, rebuttal 2560, clarification 400, postMortem 8192 | `services/providers/taskBudgets.ts:8-27` |
| Max redirect hops | 3 | `shared/providerRequestPolicy.cjs:475` |
| Automation failure streak before self-disable | 3 | `services/automation/AutomationService.ts:127` |
