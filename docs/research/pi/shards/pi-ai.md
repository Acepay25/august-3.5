# pi :: pi-ai

**Files in shard:** 402 (read: 399, skipped with reason: 3)
**What this shard covers:** `@earendil-works/pi-ai` v1.4.0 — the reference repo's unified LLM API SDK (`packages/ai`). It is the layer between an agent loop and ~45 model providers: a normalized transcript type, one streaming event protocol, a provider/auth registry, ten wire-protocol transports (Anthropic Messages, OpenAI Completions/Responses/Codex, Google Generative AI/Vertex, Bedrock Converse, Mistral, Azure, and pi's own `pi-messages`), nine OAuth flows, a credential store, a generated model catalogue with a validated manifest, and 185 test files. There is **no agent loop, no scheduler and no UI** in this shard — this is the *transport* layer only. What it contributes to a trading app is the "last mile" discipline: how a provider's quirks become data, how a failure is classified, how cost is computed, and how a transcript stays replayable.

**How this shard was read.** Every one of the 402 paths was opened. Source files were read line by line (the largest — `anthropic-messages.ts` 1690 lines, `openai-completions.ts` 1744, `openai-codex-responses.ts` 1724, `bedrock-converse-stream.ts` 1428 — were read in numbered chunks so no segment was silently dropped). The 185 test files were read at tier 2: each file was opened and its `describe`/`it` titles extracted and summarised into the table in §1.9. Three files were too large to read line by line (`CHANGELOG.md`, `scripts/generate-models.ts`) or are binary (`test/data/red-circle.png`); each is listed in the status TSV with what was read instead.

---

## 1. File-by-file

### 1.1 Package root and build config

| File | Purpose | Notes |
| --- | --- | --- |
| `packages/ai/package.json` | Package manifest, `@earendil-works/pi-ai` v1.4.0 | `sideEffects` names exactly three modules (`compat.js`, `images.js`, `providers/images/register-builtins.js`) — everything else is tree-shakeable. `exports` map is per-subpath (`./api/*`, `./providers/*`, `./utils/*`, `./models`, `./oauth`, `./compat`). Scripts show the build order: `generate-models` → `check:model-data` → `tsc` → copy `providers/data`. `engines.node >= 22.19.0`. |
| `packages/ai/bedrock-provider.js` | 1-line re-export shim for the AWS-only entrypoint | `export * from "./dist/bedrock-provider.js";` — exists so a consumer can import Bedrock without pulling the rest. |
| `packages/ai/bedrock-provider.d.ts` | Type shim for the same | Same one-liner. |
| `packages/ai/tsconfig.build.json` | Build tsconfig | `module`/`moduleResolution` `NodeNext`, `rootDir: ./src`, `include: src/**/*.ts`, `exclude: **/*.d.ts` (so `data-json.d.ts` is types-only). |
| `packages/ai/vitest.config.ts` | Vitest config | `environment: "node"`, `testTimeout: 30000` ("30 seconds for API calls"), `silent: "passed-only"`, and an alias that points `@earendil-works/pi-telemetry` at the *source* of the sibling package so the SDK is tested against the local telemetry implementation. |

### 1.2 Public entrypoints and top-level modules

#### `packages/ai/src/index.ts`
- **Purpose:** the core, side-effect-free public surface.
- **Key abstractions:** re-exports `types.ts`, `models.ts`, `models-store.ts`, `utils/{diagnostics,event-stream,identity,json-parse,overflow,retry,text,transcript,typebox-helpers,uuid,validation}`, `auth/{context,credential-store,helpers,types}`, `providers/faux.ts`, `session-resources.ts`, and the *types* of every provider's options object.
- **Non-obvious design decisions:** the file header states the rule explicitly: *"Core only, side effect free: no generated catalogs, no provider factories, no api-registry, no OAuth implementations, no compat."* The generated model catalogue, the provider factories and the whole legacy global API live behind *other* entrypoints so a browser bundle that imports only `types.ts` pulls in nothing.
- **Surprising:** `export * from "./providers/faux.ts"` — the test-double provider ships in the main entrypoint.

#### `packages/ai/src/types.ts` (908 lines) — the wire vocabulary
- **Purpose:** every type that crosses a provider boundary.
- **Key abstractions:** `ProviderRequestOptions`, `StreamOptions`, `SimpleStreamOptions`, `Message` = `SystemMessage | UserMessage | AssistantMessage | ToolResultMessage`, `AssistantMessageEvent` (the normalized stream event union), `Usage`, `Model` / `ImageModel` / `ClassifierModel`, `Tool`, `Context` vs `TranscriptContext`.
- **Data flow:** a `Context` (`{systemPrompt, messages, tools}`) is normalized once by `normalizeContext()` into a branded `TranscriptContext`; providers only ever see the transcript.
- **Non-obvious design decisions:**
  - `TranscriptContext` is branded with a `unique symbol` so a raw `Context` *cannot* reach provider code by accident — only `normalizeContext()` may produce one. This is a compile-time "you forgot to normalize" guard.
  - `Model.type` is **optional** and defaults to `"chat"`; `utils/model-operations.ts` owns that default. Narrow with `isModelType()`, never by comparing `type` to a string.
  - `Usage.output` **includes** reasoning tokens; `Usage.reasoning` is the *subset*.
  - `Usage.cacheWrite1h` exists so Anthropic's 1-hour cache writes can be priced at 2× the 5-minute rate.
  - `SystemMessage` carries `sections` (named, patchable prompt sections) and `toolsAdded`/`toolsRemoved` — the prompt is part of the transcript, not a separate argument.
  - `ToolCall.argumentsError` keeps the model's own broken argument text so validation can report it back.
  - `AssistantMessage.rawStopReason` and `endTurn` are preserved "for debugging and does not currently affect agent control flow".
  - `NestedToolCalls` records calls a tool made to other tools, with `complete: false` when anything was dropped — a bounded, honest record.
- **Edge cases & failure handling:** `ToolResultMessage` is generic over `TDetails` but is `never` unless `TDetails` is JSON-compatible (`IsJsonCompatible`) — a compile-time guarantee that a tool result can be persisted.

#### `packages/ai/src/models.ts` (1299 lines) — the `Models` collection and `createProvider`
- **Purpose:** the runtime registry: providers + auth + model reads + request dispatch.
- **Key abstractions:** `Provider<TApi>`, `Models` / `MutableModels`, `createModels()`, `createProvider()`, `RefreshModelsContext`, `calculateCost()`, `getSupportedThinkingLevels()`, `clampThinkingLevel()`, `hasApi()`, `modelsAreEqual()`.
- **Data flow:** `models.stream(model, context, options)` → `normalizeContext` → `lazyStream(...)` → `applyAuth` (resolve auth, merge headers, merge identity) → the owning provider's `stream` → `AssistantMessageEventStream`.
- **Non-obvious design decisions:**
  - **`refresh()` runs the provider's refresh TWICE**: once with `allowNetwork:false` to *restore the cached catalogue from the store*, then once with network allowed. Offline boot therefore still shows the last-known models.
  - **Publication is generation-checked.** `supersedeProviderRefresh` bumps a per-provider generation counter and aborts the previous controller; `publishProviderModels` refuses to write if the generation moved. A slow in-flight refresh can therefore never overwrite a newer one.
  - **Per-provider publication is serialized** through a promise chain, and the chain tail is deleted when it drains so the map does not grow.
  - `getModels()` is **best-effort**: a provider whose `getModels()` throws yields *no models* rather than breaking the whole read.
  - `mergeHeaders` deletes any existing key with the same *case-insensitive* name before setting the new one, so a caller can suppress a default header with `null`.
  - `calculateCost` **mutates** the `usage` object it is given and returns `usage.cost`.
  - Cost **tiers** are request-wide: the highest matching `inputTokensAbove` tier's rates apply to the *whole* request.
  - `clampThinkingLevel` walks **up** first, then down, so asking for a tier the model lacks yields the nearest *higher* supported tier.
  - `applyAuth` ordering: explicit request options win per-field; the `Models`-only `transformHeaders` runs last.
  - `login()` writes through `credentials.modify` and, if the signal aborts *before* the mutation starts, rejects — but a mutation already in flight is allowed to finish so a credential is never half-written.
- **Edge cases & failure handling:** `ModelsError` codes are `model_source | model_validation | provider | stream | auth | oauth`. `generateImages()` and `classify()` **never reject** — they return an error-shaped result.

#### Other top-level modules
| File | Purpose | Notable |
| --- | --- | --- |
| `src/compat.ts` (302) | The **legacy global API**: `stream()`/`complete()` dispatching on `model.api` via a global registry, `registerApiProvider()`, `getEnvApiKey()`, static catalog reads, image generation. | The header says it plainly: *"This module is deleted with the coding-agent ModelManager migration."* It is a strict superset of the root entrypoint, so an app can switch import paths wholesale. `getModel`/`getModels`/`getProviders` are aliased to the new static-catalog reads and marked `@deprecated`. |
| `src/legacy-api-aliases.ts` (108) | Old names → new names for the compat surface | `getImageModel` → `getModelOfType('image', …)` and friends; the "Images" plural collection names were removed when image models moved onto the ordinary provider. |
| `src/env-api-keys.ts` (195) | The env-var name constants | Central list: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_FEDERATION_RULE_ID_ENV`, `ANTHROPIC_ORGANIZATION_ID_ENV`, `ANTHROPIC_IDENTITY_TOKEN_FILE_ENV`, `ANTHROPIC_SERVICE_ACCOUNT_ID_ENV`, `ANTHROPIC_WORKSPACE_ID_ENV`, and the Azure/Google/Bedrock ones. Importing a constant never reads the environment. |
| `src/telemetry.ts` (209) | The telemetry schema + span wiring | Declares `AI_TELEMETRY_SCHEMA` as **data**, not prose: start attributes `provider`/`api`/`model`/`reasoning`; end attributes `stop`, `usage.input`, `usage.output`, `usage.cache_read`, `usage.cache_write`, `cost.total`, optional `response.id`. `stop: "error"` sets error status with the fixed category `provider_error` and the message truncated to **500 characters**; **cancellation keeps status `ok` with `stop: "aborted"`**. `pi.ai.first_chunk` marks the first normalized event *including setup errors*; each completed text/thinking/tool block emits `pi.ai.block` with `type`, `index`, `chars`. Metrics: `pi.ai.request.duration`, `pi.ai.first_chunk.duration`, `pi.ai.tokens` (kind = input/output/cache_read/cache_write), `pi.ai.cost`. **Prompts, generated text, reasoning and arguments are never recorded.** |
| `src/model-catalog.ts` | The `flattenChatModelCatalog` / `flattenImageModelCatalog` / `flattenClassifierModelCatalog` helpers | Reads the generated JSON, groups by API, and produces **exact** model/API literal types — so `getBuiltinModel("openai", "gpt-4o-mini")` returns `Model<'openai-responses'>`, not `Model<Api>`. |
| `src/models-store.ts` | `ModelsStore` interface + `InMemoryModelsStore` | One persisted catalogue entry per provider; `read`/`write`/`delete` each take an optional `AbortSignal` and `write` calls `throwIfAborted()` first. |
| `src/session-resources.ts` (36) | A registry of per-session cleanup callbacks | `registerSessionResourceCleanup(fn)` returns an unregister function; `cleanupSessionResources(sessionId?)` runs all of them and throws an `AggregateError` if any failed. Registered by the Codex WebSocket pool so pooled sockets do not keep a CLI process alive. |
| `src/image-models.ts` (50) | Image-model type helpers | The old plural `ImagesModel`/`ImagesProvider` names live on only in the compat layer. |
| `src/images.ts`, `src/images-api-registry.ts` | Image-generation registry + dispatch | `generateImages` returns `AssistantImages` and **never rejects** — an unknown provider, missing auth or a provider with no image implementation all yield `stopReason: "error"`. |
| `src/oauth.ts` (10) | Type-only compat barrel | The built-in OAuth *implementations* are deliberately absent; the extension barrel stays free of them (there is a test for exactly this). |
| `src/bun-oauth.ts` | Bun-binary OAuth loader registration | Lets a standalone Bun bundle register statically-imported OAuth flows instead of dynamic ones. |
| `src/bedrock-provider.ts` | Static AWS-SDK import for single-file bundles | `setBedrockProviderModule()` overrides the bundler-opaque dynamic import for a bundle that must include Bedrock. |
| `src/cli.ts` | The `npx @earendil-works/pi-ai login|list` CLI | Interactive provider selection; `login` writes `auth.json` in the current directory. |
| `src/compat/extension-oauth-types.ts` | Type-only declarations for extension OAuth | No runtime code. |
| `src/models.generated.ts` (309) | **GENERATED** aggregator | Imports the 42 `*.models.ts` shards and exposes three maps — `MODELS`, `IMAGE_MODELS`, `CLASSIFIER_MODELS` — each typed as `{ readonly "<provider>": typeof <PROVIDER>_MODELS }`. Read in full. |

### 1.3 `src/utils/` — 26 files, the reusable core

| File | Purpose | Notable |
| --- | --- | --- |
| `abort.ts` | `operationSignal`, `raceWithAbortSignal` | `raceWithAbortSignal` **keeps observing the abandoned promise** (`void operation.catch(() => {})`) so a later rejection is always handled — no unhandled-rejection warning after an abort. |
| `abort-signals.ts` | `combineAbortSignals` | Combines N signals into one; returns the single signal unchanged when there is only one; the caller must call `cleanup()` to detach listeners. |
| `diagnostics.ts` | `AssistantMessageDiagnostic` + `extractDiagnosticError` | A structured error record (`name`, `message`, `stack`, `code`) attached to a message, not thrown. `appendAssistantMessageDiagnostic` appends rather than replaces. |
| `error-body.ts` | `normalizeProviderError`, `formatProviderError` | One place that turns any thrown value into a provider-shaped error and one that formats it for a human. This is the ancestor of August's `toFriendlyProviderError`. |
| `estimate.ts` | Token-count estimation | Reserves **3.5 characters per token** when limiting output; ignores stale assistant usage after a newer message was inserted, and resumes using it only after the model answered that inserted context. |
| `event-stream.ts` | `AssistantMessageEventStream` | The ONE stream protocol. `push(event)`, `end(result?)`, `result()`. It stamps `durationMs` on the message using a **monotonic** clock (`performance.now()`), guarded so it never rewrites a message that already has one or whose timestamp is in the future. |
| `hash.ts` | `shortHash` | Short, stable ids for cache keys and prompt-cache keys. |
| `headers.ts` | `headersToRecord`, `providerHeadersToRecord` | Converts `Headers` → plain record; `ProviderHeaders` values may be `null` to mean "suppress this header". |
| `identity.ts` | `ClientIdentity`, `getIdentityHeaders`, `mergeClientIdentity`, `formatUserAgent`, `getOpenCodeSessionHeaders` | The User-Agent is `pi/<version> (<platform>; <runtime>; <arch>)`. Attribution headers are sent for OpenRouter, NVIDIA NIM and OpenCode. `mergeClientIdentity` merges field by field, request over collection. |
| `json-parse.ts` | `parseStreamingJson`, `parseToolCallArguments`, `parseJsonWithRepair` | `parseToolCallArguments` keeps the **raw text** when the JSON is malformed and reports it back so the model can see what it actually sent. A string containing an invalid `\u` escape (e.g. `\usepackage`) does not drop the remaining fields. |
| `model-operations.ts` | `getModelType`, `isModelType`, `assertChatModel`, `assertClassifierModel`, `assertImageModel`, `*ErrorResult` | The ONE place `Model.type` defaults to `"chat"`. `assertX` narrows or throws; `classifierErrorResult`/`imageErrorResult` build the non-rejecting error shapes. |
| `models-error.ts` | `ModelsError` codes | `model_source | model_validation | provider | stream | auth | oauth`. |
| `node-http-proxy.ts` | `resolveHttpProxyUrlForTarget` | Honours `NO_PROXY` (subdomain wildcards, IPv6, ports), prefers scoped proxy env aliases before process env aliases, and **rejects SOCKS and PAC proxy URLs explicitly** rather than silently ignoring them. |
| `oauth-page.ts` | The local callback HTML page | A self-contained success/error page rendered by the OAuth callback server. |
| `overflow.ts` | `isContextOverflow` + `isRecoverableLength` | The overflow patterns match provider wording; **any HTTP 413 counts as context overflow** (GitHub Copilot rejects large bodies that way). `isRecoverableLength` asks "did the stop end *below* the caller's intended output limit?" — the signal that one bounded compact-and-retry is worth attempting. |
| `provider-env.ts` | `getProviderEnvValue(name, env)` | Request-scoped env beats process env. Every provider reads its configuration through this one function. |
| `provider-retry.ts` | `retryProviderRequest` | The retry loop, delegating the *decision* to `retry.ts`. |
| `retry.ts` | The retry/non-retry classifiers | **Two** pattern sets. Retryable: overloaded, server_busy, 429/500/502/503/504/520/524 (with lookarounds so a request id or a byte count is not read as a status code), "service temporarily unavailable", "upstream request failed", "stream was interrupted", network/proxy/fetch failures (including Bun's socket-drop wording), premature stream endings, WebSocket close/error text. **Non-retryable**: quota/budget/billing exhaustion, `insufficient_quota`, the ChatGPT subscription usage limit, the ChatGPT *Business workspace* limit ("only the admin can raise it"), and OpenCode Go/free-tier limits. |
| `sanitize-unicode.ts` | `sanitizeSurrogates` | Strips lone UTF-16 surrogates before anything goes on the wire. |
| `sleep.ts` | Abortable `sleep(ms, signal)` | Used by the retry loop and the OAuth device-code poller. |
| `text.ts` | `contentText`, `getSystemMessageText`, `renderSystemMessageUpdate` | Rendering of system-message content and of a *system-message update* (the named-section patch). |
| `transcript.ts` | The transcript algebra | `createInitialSystemMessage`, `normalizeContext`, `getCurrentTools`, `getCurrentSystemMessage`, `getCurrentSystemPrompt`, `collapseSystemMessages`, `resolveTranscript`, `resolveTranscriptTools`, `withoutInitialSystemMessage`, `getDeclaredTools`. **The transcript is replayable**: every system message in order yields the current prompt and the current tool set. `sections` are patched by name; `null` removes a section. |
| `typebox-helpers.ts` | TypeBox helpers | `StringEnum` — needed because `Type.Enum` emits `anyOf`/`const` patterns that **Google's API does not accept**. |
| `uuid.ts` | `uuidv7` | Time-ordered ids (uuidv7) for message and request ids. |
| `validation.ts` | The tool-argument validator | Coerces with TypeBox, then, on failure, returns an error **that includes the received arguments and the raw text** so the model can retry. |
| `version.ts` | `PI_AI_VERSION` | The version string in the User-Agent. |

### 1.4 `src/api/` — 43 files, the wire protocols

#### The transports (read in full)

| File | Lines | What it does | Notable decisions |
| --- | --- | --- | --- |
| `anthropic-messages.ts` | 1690 | Anthropic Messages API, streaming, via `@anthropic-ai/sdk` beta types. | **Stealth mode**: the tool-name table `claudeCodeTools` (Read, Write, Edit, Bash, Grep, Glob, Task, TodoWrite, …) is copied from a public transcript history, and OAuth requests rename tools to Claude Code's canonical casing and rename them back. `redacted_thinking` becomes a thinking block with `redacted: true` and the encrypted payload as the signature. The **fallback** content block (Anthropic's server-side model fallback) is tolerated only when nothing has been emitted yet — mid-output fallback is an error. A fallback model that differs from the requested one is re-costed using `allowedFallbackModels`. `thinkingSignature` is preserved for replay. |
| `openai-completions.ts` | 1744 | OpenAI Chat Completions — the API **~20 providers share**. | `thinkingFormat` selects the reasoning wire shape: `openai`, `openrouter` (`reasoning:{effort}`), `deepseek` (`thinking:{type}`), `together` (`reasoning:{enabled}`), `zai` (`thinking:{type}` + `clear_thinking`), `qwen` (`enable_thinking`), `qwen-chat-template` (`chat_template_kwargs.enable_thinking` + `preserve_thinking`), `chat-template` (configurable kwargs with a `$var` indirection), `baseten` (`chat_template_args`), `string-thinking` (a top-level string), `ant-ling` (only mapped efforts). A **`compat` object is merged over URL-based auto-detection**, field by field, and every duplicated property requires an explicit override — an override that resolves nothing is an error. |
| `openai-responses.ts` | 471 | OpenAI Responses API. | Detects a **ChatGPT sign-in** credential (an OpenAI key that does not start with `sk-`) and turns the ChatGPT workspace usage-limit error into a message that names `admin.openai.com → Workspace → Usage limits`. `prompt_cache_key` is derived from the session id and clamped. |
| `openai-responses-shared.ts` | 887 | The shared Responses message/tool conversion and stream processor. | `TextSignatureV1` is a JSON payload (`{v:1,id,phase}`) with a legacy plain-string fallback. Tool results become `input_text` / `input_image` parts when the model accepts images, and a **placeholder string** otherwise. The terminal check throws if the stream ends with an unfinished tool call. |
| `openai-codex-responses.ts` | 1724 | The ChatGPT/Codex backend: SSE **and** WebSocket transports, zstd request bodies. | Three transports (`sse`, `websocket`, `websocket-cached`). The WebSocket pool is keyed by session, expires after **5 minutes idle** and **55 minutes absolute**, and falls back to SSE on failure, with `getOpenAICodexWebSocketDebugStats()` exposing requests/connections created/reused/cached-context requests/deltas/fallbacks. `previous_response_id` allows a **delta** request instead of resending the whole context. `closeOpenAICodexWebSocketSessions()` is registered as a session resource cleanup. |
| `bedrock-converse-stream.ts` | 1428 | AWS Bedrock Converse streaming, via `@aws-sdk/client-bedrock-runtime`. | Proxy-aware (`HttpProxyAgent`/`HttpsProxyAgent`). **Redacted reasoning** is accumulated as byte chunks and base64-encoded in slices (the encrypted reasoning runs to tens of KB and a naive `String.fromCharCode(...bytes)` would blow the argument-count limit). `decodeRedactedContent` drops a signature that is not valid base64 rather than failing the whole request — the session may have been hand-edited. The model-name matcher checks both the id and the name, so application inference-profile ARNs (which contain no model name) still match. `bedrockThinkingDisplay: "summarized" \| "omitted"` lets the caller drop the text and keep only the signature, reducing time-to-first-text-token. |
| `google-generative-ai.ts` | 472 | Gemini via `@google/genai`. | A custom `fetch` is **rejected outright** ("Custom fetch is not supported by the Google Generative AI adapter") rather than silently ignored. Thinking budgets are per-model-family tables for 2.5-pro / 2.5-flash / 2.5-flash-lite. |
| `google-vertex.ts` | 567 | Gemini on Vertex (project/location scoped). | A local `toolCallCounter` mints unique tool-call ids. |
| `google-shared.ts` | 517 | The shared Google adapter logic. | `usesGoogleThinkingLevel()` decides whether to send the discrete `thinkingLevel` (Gemini 3 Pro/Flash, Gemini 4+, Gemma 4) or the token `thinkingBudget`. `retainThoughtSignature()` keeps the signed empty/thought blocks Gemini requires. `retryGoogleRequest` is the Google-specific retry. |
| `mistral-conversations.ts` | 952 | Mistral's native Chat Completions, hand-rolled (no SDK). | The `finish_reason: "error"` mapping is deliberately phrased as *"Provider stopped with: error (server error)"* so the **retry classifier** recognises it as transient. Error bodies are truncated at 4000 characters. Tool-call ids are 9 characters. |
| `azure-openai-responses.ts` | 261 | Azure's Responses API. | `max_output_tokens` is floored at 16 (OpenAI rejects less). `prompt_cache_key` is set. Reasoning uses `reasoning.encrypted_content` so the encrypted reasoning replays. |
| `azure-openai-config.ts` | 107 | Azure endpoint resolution. | Root endpoints are **normalized** to `/openai/v1` so the SDK can append `/deployments/<model>/…`; the deployment name is sent as the request's `model` while `model.id` stays the catalogue id. `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` maps `model-id=deployment` pairs. |
| `pi-messages.ts` | 448 | pi's **own** message protocol, spoken to a backend (the Radius gateway). | A single POST of `{model, context, options}` and an SSE stream of serialized assistant-message events. It carries a `PiMessagesRewriteImpact` — a **summary of a server-side rewrite** (policy id, policy version, changed?, token-count delta, message-count delta, system-prompt-changed?) — so a gateway that silently rewrote the prompt cannot hide it. A stream that ends without a terminal event is an error. |
| `openrouter-images.ts` | 213 | Image generation through OpenRouter. | The only image provider. |
| `llama-cpp-classify.ts` | 461 | Turns a llama.cpp chat model into a classifier. | The model never generates an answer: each question becomes one chat prompt whose answer labels are single tokens, and the answer is the **softmax over the label tokens' log-probabilities**. `/tokenize` gives the label token ids; `/apply-template` gives the model's own chat template; `/completion` with `n_predict: 1` and pre-sampling `n_probs` returns the logits. A label missing from the top-`n_probs` list is retried with a deeper list and then reported as an error. The prompt up to the final question is shared by all questions, so the server's prompt cache evaluates the state once per request. `temperature` > 1 softens overconfident labels. The system prompt explicitly tells the model that the state is data to judge, not instructions to follow. |
| `openai-decisions.ts` | 175 | OpenAI's Decisions API. | `choice` → choice, `score` → score, `bool` → predicate (which has no criteria field, so the meanings of true/false are appended to the instructions). If OpenAI refuses one question, the **whole result** is an error. |
| `typesafe-system-one.ts` | 55 | TypeSafe's System One classifier. | Bool answers use the `noul` wire representation. |
| `cloudflare-workers-ai-system-one.ts` | 97 | Workers AI System One (Jev / Clef). | Image forms differ per service: TypeSafe `assets`, Clef `images` data URLs, OpenRouter `state-image-urls`. Clef rejects more than four images **before** sending. |
| `system-one-shared.ts` | 237 | The shared System One transport. | The usage is parsed **before** the answers, so a request with malformed answers was still billed and is still charged. |
| `classifier-shared.ts` | 176 | Shared classifier plumbing. | `classify()` never rejects; it returns a result with `stopReason: "error"`. |
| `constrained-sampling.ts` | 298 | Strict JSON schema and grammar-constrained tool sampling. | **"Prefer" vs "require"**: `strict: 'prefer'` falls back to a normal tool call; `strict: 'require'` fails the request. The offending schema keyword is **named** in the error. Grammar tools (OpenAI Lark/regex) fall back to normal function tools when the model does not support them, and a grammar tool must have an object schema with exactly one required string property. |
| `transform-messages.ts` | 341 | The cross-provider message transformer. | Assistant messages from a **different model** have their thinking blocks **dropped** (a signature only works for the model that produced it, and readable thinking sent as plain text makes the new model treat it as part of the reply). Tool calls, text and tool results pass through. |
| `simple-options.ts` | 143 | The shared request-building helpers. | `buildBaseOptions`, `adjustMaxTokensForThinking`, `clampMaxTokensToContext`, `clampThinkingBudgetToAnswerRoom`, `thinkingBudgetForLevel`, `resolveSamplingParams`. |
| `lazy.ts` | 148 | Lazy API loading. | `lazyApi(load)` returns a `ProviderStreams` whose `stream()` returns **synchronously** while the module loads behind it; a setup failure terminates the stream with an error event rather than rejecting. `lazyStream` also accepts a read-only observer. |
| `openai-prompt-cache.ts` | 26 | `clampOpenAIPromptCacheKey` | The session id is turned into a bounded cache key. |
| `github-copilot-headers.ts` | 44 | Copilot's dynamic headers + vision detection | |
| `cloudflare.ts` | 39 | Cloudflare base-URL constants | The `{account}`/`{gateway}` placeholders are materialized per request. |
| `cloudflare-ai-binding.ts` | 166 | `createAiBindingFetch(binding)` | A Cloudflare Workers AI **binding** instead of a URL. The binding's `fetch` is bound **eagerly** (it is a mutable property, so the narrowing would not survive into the closure), and a binding without `fetch` throws at construction, not on the first request. |

#### The 15 lazy wrappers (`*.lazy.ts`, 185–251 bytes each)
Every one is the same shape: `export const <x>Api = (): ProviderStreams => lazyApi(() => import("./<x>.ts"));`. The classifiers use a slightly different shape (`ProviderClassifier` with a `classify` that awaits the import). `bedrock-converse-stream.lazy.ts` is the exception: it imports through a **variable specifier** so a bundler cannot follow it into the Node-only AWS SDK, and exposes `setBedrockProviderModule()` for the Bun single-file build. `openai-codex-responses.lazy.ts`, `anthropic-messages.lazy.ts`, `azure-openai-responses.lazy.ts`, `google-generative-ai.lazy.ts`, `google-vertex.lazy.ts`, `mistral-conversations.lazy.ts`, `openai-completions.lazy.ts`, `openai-responses.lazy.ts`, `pi-messages.lazy.ts` are the plain form. `cloudflare-workers-ai-system-one.lazy.ts`, `llama-cpp-classify.lazy.ts`, `openai-decisions.lazy.ts`, `typesafe-system-one.lazy.ts` are the classifier form. `openrouter-images.lazy.ts` is the images form.

### 1.5 `src/auth/` — 18 files

| File | Purpose | Notable |
| --- | --- | --- |
| `auth/types.ts` | `Credential`, `CredentialStore`, `AuthContext`, `AuthResult`, `OAuthAuth`, `ApiKeyAuth`, `ProviderAuthInteraction` | The `CredentialStore` contract has **exactly one write path**, `modify(providerId, fn)` — a serialized read-modify-write — so OAuth refresh inside a request cannot double-refresh a rotated token. `list()` must not execute configured API-key commands. |
| `auth/resolve.ts` | `resolveProviderAuth`, `refreshStoredOAuthCredential`, `ModelsError` | Refresh happens **inside** `credentials.modify`, under the store's lock. |
| `auth/credential-store.ts` | `InMemoryCredentialStore` | The default store. |
| `auth/context.ts` | `defaultProviderAuthContext` | `env(name)` and `fileExists(path)` — injectable for tests and browsers. |
| `auth/helpers.ts` | `envApiKeyAuth`, `lazyOAuth` | `envApiKeyAuth(label, envVars)`: stored credential wins, then the first set env var. `lazyOAuth` loads the flow on first use through a bundler-opaque dynamic import, so registering an OAuth-capable provider does not pull Node-only code into a browser bundle. |
| `auth/oauth/load.ts` | The nine flow loaders | Same variable-specifier trick; `registerBundledOAuthFlowLoaders()` for the Bun binary. |
| `auth/oauth/pkce.ts` | Web-Crypto PKCE | Works in Node 20+ and browsers. |
| `auth/oauth/callback-server.ts` | The loopback callback server | **Races the loopback callback against a manual paste prompt.** Fails rather than picking another port when the requested port is taken. On completion it calls `closeAllConnections()` — a browser's spare connection can otherwise deliver a *later* login's callback to the *earlier* server, which then rejects it with "OAuth state mismatch" and the new login never completes. |
| `auth/oauth/device-code.ts` | RFC 8628 poller | Implements `slow_down` (+5 s when the server gives no interval), honours a server-supplied interval, and cancels an in-flight wait. |
| `auth/oauth/anthropic.ts` | Claude Pro/Max | Browser login **and** a "copy code" paste path. The redirect port is fixed (53692) but falls back to a free port when it cannot be bound. `parseAuthorizationInput` accepts a URL, a `code=…` query, a `#code` fragment, or the bare code. |
| `auth/oauth/openai-chatgpt.ts` | Sign in with ChatGPT | Registers a **user-owned client**, stores the issued client id and granted scopes, requires a device id before authorizing, and requires the refresh response to rotate the refresh token. |
| `auth/oauth/openai-codex.ts` | ChatGPT Plus/Pro (legacy) | Device-code and browser login; decodes the JWT claim path to read `chatgpt_account_id`. |
| `auth/oauth/openrouter.ts` | OpenRouter PKCE | Mints a **permanent API key**; refresh is a no-op. |
| `auth/oauth/github-copilot.ts` | Copilot subscription | Derives a per-account base URL from the token's `proxy-ep` claim (`proxy.` → `api.`), falling back to the enterprise domain then the individual endpoint. The model catalogue is filtered by `model_picker_enabled` and `policy.state`, with a policy fallback **limited to the individual endpoint**. `fetchWithRateLimitRetry` honours `retry-after` (numeric seconds or an HTTP date) under a total elapsed budget. |
| `auth/oauth/kimi-coding.ts` | Kimi Code | Device-code flow. |
| `auth/oauth/meta.ts` | Meta Model API | RFC 8628 device grant, then the identity token is **exchanged for a Model API key** via a key-mint endpoint. The identity token is stored as `refresh` and the minted key as `access`, so the standard OAuth scheduler re-mints it. The identity token is *not* renewable — a 401/403 from mint means the session is dead and the user must sign in again. |
| `auth/oauth/xai.ts` | xAI | |
| `auth/oauth/radius.ts` | Radius gateway | Offers browser (with OIDC discovery) and device-code; refreshes directly through the gateway without discovery. |

### 1.6 `src/providers/` — 53 files

#### The 42 provider factories (each ~15–25 lines)
`amazon-bedrock.ts`, `ant-ling.ts`, `anthropic.ts`, `azure.ts`, `baseten.ts`, `cerebras.ts`, `cloudflare-ai-gateway.ts`, `cloudflare-workers-ai.ts`, `deepseek.ts`, `fireworks.ts`, `github-copilot.ts`, `google.ts`, `google-vertex.ts`, `groq.ts`, `huggingface.ts`, `kimi-coding.ts`, `meta.ts`, `minimax.ts`, `minimax-cn.ts`, `mistral.ts`, `moonshotai.ts`, `moonshotai-cn.ts`, `nvidia.ts`, `openai.ts`, `openai-codex.ts`, `opencode.ts`, `opencode-go.ts`, `openrouter.ts`, `qwen-token-plan.ts`, `qwen-token-plan-cn.ts`, `qwen-token-plan-individual.ts`, `radius.ts`, `together.ts`, `typesafe.ts`, `vercel-ai-gateway.ts`, `xai.ts`, `xiaomi.ts`, `xiaomi-token-plan-ams.ts`, `xiaomi-token-plan-cn.ts`, `xiaomi-token-plan-sgp.ts`, `zai.ts`, `zai-coding-cn.ts` — each is a `createProvider({id, name, baseUrl, auth, models, api})` call. The only variety is which API is used, whether OAuth is attached, and the base URL. Notable: `openai-codex.ts` has **no apiKey auth at all** — OAuth only; `typesafe.ts` has **no chat API at all** — classifiers only; `vercel-ai-gateway.ts` and `opencode.ts` also serve the `typesafe-system-one` classifier; `fireworks.ts` serves **two** APIs (`anthropic-messages` *and* `openai-completions`) and dispatches per model; `anthropic.ts` has a bespoke `ApiKeyAuth` that resolves, in order: stored credential → `ANTHROPIC_AUTH_TOKEN` (bearer header) → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → **workload identity federation** (the SDK exchanges the identity token itself) — with the federation ids travelling in `env` because they are provider config, not auth.

#### The 42 generated `*.models.ts` shards
`amazon-bedrock.models.ts`, `ant-ling.models.ts`, `anthropic.models.ts`, `azure.models.ts`, `baseten.models.ts`, `cerebras.models.ts`, `cloudflare-ai-gateway.models.ts`, `cloudflare-workers-ai.models.ts`, `deepseek.models.ts`, `fireworks.models.ts`, `github-copilot.models.ts`, `google.models.ts`, `google-vertex.models.ts`, `groq.models.ts`, `huggingface.models.ts`, `kimi-coding.models.ts`, `meta.models.ts`, `minimax.models.ts`, `minimax-cn.models.ts`, `mistral.models.ts`, `moonshotai.models.ts`, `moonshotai-cn.models.ts`, `nvidia.models.ts`, `openai.models.ts`, `openai-codex.models.ts`, `opencode.models.ts`, `opencode-go.models.ts`, `openrouter.models.ts`, `qwen-token-plan.models.ts`, `qwen-token-plan-cn.models.ts`, `qwen-token-plan-individual.models.ts`, `radius.models.ts`, `together.models.ts`, `typesafe.models.ts`, `vercel-ai-gateway.models.ts`, `xai.models.ts`, `xiaomi.models.ts`, `xiaomi-token-plan-ams.models.ts`, `xiaomi-token-plan-cn.models.ts`, `xiaomi-token-plan-sgp.models.ts`, `zai.models.ts`, `zai-coding-cn.models.ts` — each is **14 lines of machine output**: `import values from "./data/<provider>.json"`, then `flattenChatModelCatalog` / `flattenImageModelCatalog` / `flattenClassifierModelCatalog`. Every one of the 42 was opened and confirmed to be the same generated shape (14 lines, the same "auto-generated — do not edit manually" header); one was read in full.

#### The other provider files
| File | Purpose | Notable |
| --- | --- | --- |
| `providers/all.ts` (190) | The registry + static catalogue reads | `builtinModels()` / `builtinProviders()`; `getBuiltinModel`, `getBuiltinImageModel`, `getBuiltinClassifierModel` return **exact literal types** derived from the generated JSON keys. It also imports `data/.manifest.json` so the catalogue's provenance is in the bundle. |
| `providers/faux.ts` (727) | The in-process test-double provider | A **real implementation of the stream protocol**, not a stub: it emits `text_start`/`text_delta`/`text_end`, `thinking_*`, `toolcall_start`/`toolcall_delta`/`toolcall_end` at a configurable tokens-per-second, honours aborts mid-block, supports **deferred fetches** (a `DeferredHandle` that returns the original handle N times before the scripted response is ready) and **cancelled deferreds**, and simulates prompt-cache reads/writes from the common prompt prefix when a `sessionId` is present. `fauxAssistantMessage`, `fauxText`, `fauxThinking`, `fauxToolCall` are the builders. An empty queue returns an assistant error message ("No more faux responses queued") rather than throwing. |
| `providers/compat-schema.ts` (664) | The TypeBox schemas for every provider's `compat` block | `OpenAICompletionsCompatSchema`, `OpenAIResponsesCompatSchema`, `AnthropicMessagesCompatSchema`, `BedrockCompatSchema`, `MistralConversationsCompatSchema`, `SystemOneCompatSchema`, plus `OpenRouterRoutingSchema` (fallbacks, `require_parameters`, `data_collection: deny/allow`, ZDR, `enforce_distillable_text`, `order`, `only`, `ignore`, `quantizations`, `sort` with percentile cutoffs) and `VercelGatewayRoutingSchema`. Every boolean has a **description that states its default**, because the description is what a human reads when a provider behaves unexpectedly. |
| `providers/model-schema.ts` (99) | `ModelCostSchema`, `ModelPromptCacheSchema`, `ModelInputLimitsSchema`, `ModelThinkingLevel` | The cost schema carries **tiers** — a rate can change above an input-token threshold. |
| `providers/openrouter.ts` | OpenRouter provider + `personalizeOpenRouterCatalog()` | The personalisation narrows the catalogue to the models a key may actually use, with **that key's** context size, max output and prices from `GET /models/user`. OpenRouter's negative placeholder prices are normalised to 0. |
| `providers/openrouter-api.ts` | OpenRouter's request shaping | |
| `providers/opencode-headers.ts` | The OpenCode session header | |
| `providers/cloudflare-stream.ts` | Materialises `{account}`/`{gateway}` placeholders in the base URL | Placeholders are kept when the provider env does not resolve them. |
| `providers/cloudflare-auth.ts` | Cloudflare account/gateway resolution | |
| `providers/radius-config.ts` | Radius gateway config + `DEFAULT_RADIUS_GATEWAY` | |
| `providers/radius.ts` | Radius provider | Ships a **static public catalogue** for the default gateway and overlays the cached/refreshed catalogue only for the *configured* gateway; an organisation that disabled all models exposes none. |
| `providers/images/register-builtins.ts` | Registers the built-in image providers | |
| `providers/data-json.d.ts` | `declare module "*.json"` | |

### 1.7 `scripts/` — 9 files

| File | Purpose | Notable |
| --- | --- | --- |
| `scripts/generate-models.ts` (131 KB, 3632 lines) | The catalogue generator | Hand-written source. It fetches models.dev (fanned out to ~25 providers), models.dev's decision list, three parallel OpenRouter listings, Vercel AI Gateway, NVIDIA NIM and the Radius gateway; hardcodes a few catalogues (OpenAI standard prices, Codex, DeepSeek, Ant-Ling, OpenCode/Workers-AI/OpenAI classifiers). It filters models.dev entries to `tool_call === true`, drops `status === "deprecated"`, keeps only OpenRouter models that advertise `tools`, and cross-checks NVIDIA ids against the live NIM list. It emits `src/providers/data/<provider>.json` (grouped by API, keyed `type:id`), a `.manifest.json` (schemaVersion 6, `generatedAt`, a **structure hash**, per-file SHA-256), the `*.models.ts` shards and `src/models.generated.ts`. `--strict` flips degradation into failure: every fetch throws, the OpenRouter image catalogue must be non-empty, and allowlist ids must match exactly. Provider-specific flags come from two layers: heuristic detection (sniffing the provider id **or** the baseUrl) that emits a **delta against the runtime defaults**, then model-family rules (regexes and allowlists, plus explicit *deny* lists for NVIDIA NIM, xAI built-ins and Bedrock inference-profile-only models, and *verified-fallback* sets for Fireworks). |
| `scripts/model-data.ts` (336) | The validator for the generated catalogue | `MODEL_DATA_SCHEMA_VERSION = 6`. `readModelDataStructure` reads the provider list **out of the aggregator source** with a regex and asserts the aggregator's imports and the `*.models.ts` shard set are equal. `validateModelDataDirectory` checks: the file set, the manifest schema version, a parseable timestamp, the structure hash, every file's SHA-256, and per model — id/provider/api must equal the key, a non-empty name, a `baseUrl` string, valid input modalities, `output` only on image models, a boolean `reasoning` on chat models, finite positive `contextWindow`/`maxTokens`, four finite cost fields, no model in two API groups, the key must equal `type:id`, and the model-id sets must match exactly. Errors are reported as a list, first 30 shown, with a count of the rest. `assertExactModelIds` is the strict-mode allowlist gate. Divergence is reported as a **set difference** (`missing: …; extra: …`), not a content diff. |
| `scripts/hydrate-model-catalog.ts` (127) | Publishes the catalogue **atomically** | Stage into a `mkdtemp` directory, validate, then `renameSync` — a failure restores the previous data dir, shards and aggregator and prunes stale shards. |
| `scripts/check-model-data.ts` (20) | The CI gate | Runs the validator; non-zero exit on failure. |
| `scripts/ai-gateway-pricing.ts` (88) | Vercel AI Gateway price mapping | |
| `scripts/openrouter-catalog.ts` (158) | The OpenRouter listing fetch | |
| `scripts/openrouter-reasoning-options.ts` (42) | OpenRouter's reasoning-effort options | |
| `scripts/models-dev-reasoning-options.ts` (46) | `getEffortThinkingLevelMap` | Exposes only **verified** effort values plus `none`, and deliberately does **not** infer "thinking off" from an effort list — that inference was wrong for several models. |
| `scripts/generate-test-image.ts` (35) | Writes the test PNG | |

### 1.8 Docs — 2 files

| File | Purpose | Notable |
| --- | --- | --- |
| `packages/ai/README.md` (1995 lines) | The package manual | Read in full. The most valuable sections for August: **Auth** (the resolution order, `transformHeaders` and the exact merge order `provider auth headers → model.headers → explicit options.headers → transformHeaders → Provider.stream*()`), **Tools / Constrained Sampling** ("prefer" vs "require", and the named offending keyword), **Telemetry** (the content-free schema), **Error Handling** (request failures after a stream is returned *never throw*; setup failures may emit `error` without `start`), **Cross-Provider Handoffs** (thinking blocks dropped on a model switch), **System Messages** (sections, `toolsAdded`/`toolsRemoved`, `collapseSystemMessages`, and the four different mid-conversation tool strategies per provider family), **Bundling and Tree Shaking** (which subpath pulls what), and the **Adding a New Provider** checklist, which names the exact test files a new provider must satisfy. |
| `packages/ai/CHANGELOG.md` (2379 lines) | The release history | Too large to read line by line (see the status TSV). Read the `[Unreleased]`, 1.4.0, 1.3.0, 1.2.0 and 1.1.0 entries in full plus the complete version index. The recent entries are a catalogue of real provider quirks: HTTP 413 counted as context overflow; whitespace-only tool output replaced by a placeholder because some providers 400 on it; the digit-vs-status-code regex bug (`req_011CU503xyz` read as a status); OpenAI Responses tool removals rewriting the prompt-cache prefix; "thinking blocks from a different model are dropped, not sent as text". |

### 1.9 `test/` — 185 files

Read at tier 2: each file was opened and its `describe`/`it` titles extracted. The table below is what each file pins.

| File | What it pins |
| --- | --- |
| `abort.test.ts` | Mid-stream and immediate abort for Gemini, OpenAI Completions/Responses, Azure, Anthropic OAuth and Mistral — all gated on live credentials. |
| `anthropic-adaptive-thinking-models.test.ts` | Which built-in Anthropic models are marked as adaptive-thinking. |
| `anthropic-auth-token.test.ts` | `ANTHROPIC_AUTH_TOKEN` becomes a bearer header; `ANTHROPIC_OAUTH_TOKEN` keeps OAuth request shaping; explicit headers win; the default User-Agent and beta-header replacement/suppression. |
| `anthropic-cache-write-1h-cost.test.ts` | The 1h cache-write portion is priced at 2× input and the rest at the 5m rate; the fallback when no breakdown is reported. |
| `anthropic-eager-tool-input-compat.test.ts` | Per-tool `eager_input_streaming` by default; the legacy fine-grained streaming beta when disabled; no beta when there are no tools. |
| `anthropic-eager-tool-input-e2e.test.ts` | Live eager tool-input streaming against the Anthropic API. |
| `anthropic-empty-thinking-signature-compat.test.ts` | An empty thinking signature is preserved for replay rather than dropped. |
| `anthropic-error-tool-result-images.test.ts` | Images in an *error* tool result are sent after the turn's tool results so the model still sees them. |
| `anthropic-federation-sdk.test.ts` | Workload-identity federation end to end against the Anthropic SDK. |
| `anthropic-federation.test.ts` | The federation env ids are resolved as provider config, not auth. |
| `anthropic-force-adaptive-thinking.test.ts` | Adaptive thinking can be forced on. |
| `anthropic-long-cache-retention-e2e.test.ts` | 1h cache retention against the live API. |
| `anthropic-mid-conversation-effort.test.ts` | The thinking level can change mid-conversation. |
| `anthropic-oauth.test.ts` | The Claude Pro/Max OAuth login and refresh. |
| `anthropic-opus-4-8-smoke.test.ts` | A live Opus 4.8 turn: thinking block present, signature present, answer text correct. |
| `anthropic-sse-parsing.test.ts` | The Anthropic SSE event grammar. |
| `anthropic-strict-tool-fallback.test.ts` | A provider that rejects the strict tool set is retried once with `strict: 'prefer'` tools non-strict, while `strict: 'require'` tools stay strict. |
| `anthropic-strict-tool-schema.test.ts` | The derived strict schema does not change the tool definitions. |
| `anthropic-temperature-compat.test.ts` | Temperature handling. |
| `anthropic-thinking-binding-e2e.test.ts` | `thinking.block_binding` against the live API. |
| `anthropic-thinking-disable.test.ts` | Turning thinking off sends `thinking: {type: "disabled"}` with no effort settings. |
| `anthropic-tool-name-normalization.test.ts` | Tool names are normalized to Claude Code's canonical casing and back. |
| `azure-openai-base-url.test.ts` | Root Azure endpoints are normalized to `/openai/v1`; the deployment map is parsed. |
| `azure-openai-completions.test.ts` | Azure against the Chat Completions API. |
| `azure-openai-responses-reasoning-replay.test.ts` | Encrypted reasoning replays on Azure. |
| `azure-openai-tool-choice.test.ts` | Tool choice on Azure. |
| `azure-utils.ts` | Test helper: credential detection + deployment-name resolution. |
| `baseten-models.test.ts` | The Baseten catalogue. |
| `bedrock-cache-write-1h-cost.test.ts` | The 1h cache-write cost on Bedrock. |
| `bedrock-convert-messages.test.ts` | The Bedrock message conversion. |
| `bedrock-credentials.test.ts` | Credential-source detection (profile, IAM keys, bearer token, ECS/web-identity). |
| `bedrock-custom-headers.test.ts` | Custom headers reach Bedrock. |
| `bedrock-endpoint-resolution.test.ts` | Endpoint and region resolution. |
| `bedrock-error-metadata.test.ts` | Bedrock error metadata is preserved. |
| `bedrock-models.test.ts` | The Bedrock catalogue. |
| `bedrock-raw-stop-reason.test.ts` | The raw Bedrock stop reason is preserved alongside the normalized one. |
| `bedrock-redacted-reasoning.test.ts` | Redacted reasoning is base64'd in slices and decoded back. |
| `bedrock-response-headers.test.ts` | Bedrock response headers reach the caller. |
| `bedrock-thinking-payload.test.ts` | The thinking payload shape on Bedrock. |
| `bedrock-utils.ts` | Test helper: AWS credential detection. |
| `cache-retention.test.ts` | Cache-retention resolution: explicit → `PI_CACHE_RETENTION` → `"short"`. |
| `classifier-images-live.test.ts` | Live classifier image input. |
| `classifier-models.test.ts` | The classifier catalogue and per-API routing. |
| `cloudflare-ai-binding.test.ts` | The AI-binding fetch: untouched pass-through, construction-time failure when `fetch` is missing, and the SDK placeholder auth kept off the wire when paired with `null` auth headers. |
| `cloudflare-stream.test.ts` | The model endpoint is materialized before dispatch; placeholders stay when the env does not resolve them. |
| `cloudflare-utils.ts` | Test helper: Cloudflare credential detection. |
| `cloudflare-workers-ai-system-one.test.ts` | Jev/Clef routing, image forms, the four-image limit for Clef, and envelope-error reporting. |
| `codex-websocket-cached-probe.ts` | A live probe script (not a test): drives the Codex websocket-cached transport and prints the debug stats. |
| `compat-env.test.ts` | An unknown provider is dispatched through the legacy API registry. |
| `compat-schema.test.ts` | The provider superset preserves property types and does **not** assign API-specific defaults to it. |
| `constrained-sampling.test.ts` | Constraint conversion and fallback, strict schemas, grammar replay as custom Responses items, append-only grammar JSON deltas. |
| `context-estimate.test.ts` | The 3.5-chars-per-token reservation and the stale-usage rule. |
| `context-overflow.test.ts` | `isContextOverflow` across Anthropic, Copilot, OpenAI, Azure, Google, Codex, Bedrock and xAI. |
| `cross-provider-handoff.test.ts` | Switching providers mid-conversation preserves text, tool calls and results, and drops the other model's thinking. |
| `data/red-circle.png` | A binary test image (2.5 KB). **Skipped — binary asset.** |
| `empty.test.ts` | Empty-message handling across providers. |
| `env-api-keys.test.ts` | The env-var name constants. |
| `error-body.test.ts` | Provider error-body normalization and formatting. |
| `event-stream.test.ts` | The stream protocol: push/end/result and the monotonic `durationMs`. |
| `faux-provider.test.ts` | The faux provider: scripted responses, streaming blocks, aborts, deferred fetches, cancelled deferreds, cache simulation. |
| `fetch-option.test.ts` | A custom `fetch` is honoured (and rejected where the adapter cannot support it). |
| `fireworks-model-generation.test.ts` | The Fireworks generator rules. |
| `fireworks-models.test.ts` | The Fireworks catalogue. |
| `generate-models-strict.test.ts` | `--strict` turns every degradation into a failure. |
| `github-copilot-anthropic.test.ts` | Copilot's Anthropic path. |
| `github-copilot-oauth.test.ts` | The Copilot device flow, the model-policy filtering and the per-account base URL. |
| `github-copilot-request-size-overflow.test.ts` | HTTP 413 is classified as context overflow. |
| `google-raw-stop-reason.test.ts` | The raw Google stop reason is preserved. |
| `google-shared-convert-tools.test.ts` | Google's tool conversion, including `StringEnum` (not `Type.Enum`, which Google rejects). |
| `google-shared-gemini3-unsigned-tool-call.test.ts` | An unsigned Gemini 3 tool call. |
| `google-shared-image-tool-result-routing.test.ts` | Image tool results are routed to the right Google API. |
| `google-shared-retry.test.ts` | The Google retry. |
| `google-shared-signed-empty-blocks.test.ts` | The signed empty blocks Google requires. |
| `google-thinking-disable.test.ts` | Disabling thinking on Google. |
| `google-thinking-level-map.test.ts` | The thinking-level map to Google level. |
| `google-thinking-signature.test.ts` | The thought signature is retained. |
| `google-vertex-api-key-resolution.test.ts` | Vertex API key and ADC resolution, including project/location. |
| `identity.test.ts` | Client identity: User-Agent shapes, attribution headers, and field-by-field merging. |
| `image-model-data.test.ts` | The generated image-model data. |
| `image-tool-result.test.ts` | Images inside tool results. |
| `images-models.test.ts` | The image catalogue and the image API registry. |
| `images.test.ts` | `generateImages` never rejects; it returns an error-shaped result. |
| `interleaved-thinking.test.ts` | Anthropic's interleaved-thinking mode. |
| `json-parse.test.ts` | Streaming-JSON parsing and the malformed-argument path. |
| `kimi-coding-oauth.test.ts` | The Kimi Code device flow. |
| `lax-message-content.test.ts` | Lax message content. |
| `lazy-module-load.test.ts` | The lazy API wrappers load on first use and fail into an error event. |
| `llama-cpp-classify.test.ts` | The llama.cpp classifier: label tokens, the softmax over label log-probabilities, the readout escalation and the shared-prefix prompt. |
| `max-thinking.test.ts` | The `max` thinking level. |
| `message-types.test.ts` | The `Message` union and its JSON-compatibility guarantee. |
| `meta-oauth.test.ts` | The Meta device grant and the key-mint exchange. |
| `mistral-http-transport.test.ts` | Mistral's hand-rolled HTTP transport, timeouts and error truncation. |
| `mistral-raw-stop-reason.test.ts` | The raw Mistral stop reason is preserved. |
| `mistral-reasoning-mode.test.ts` | Mistral's reasoning mode. |
| `mistral-tool-schema.test.ts` | Mistral tool schemas. |
| `model-catalog-types.test.ts` | The literal types derived from the generated catalogue. |
| `model-cost-tiers.test.ts` | Cost tiers: the highest matching tier applies to the whole request. |
| `model-data-validation.test.ts` | The catalogue validator: manifest version, structure hash, per-file SHA-256, per-model rules. |
| `model-types.test.ts` | `Model.type` defaults to `"chat"`; `isModelType`/`getModelType` narrowing. |
| `models-entry.test.ts` | The package entrypoint surface. |
| `models-runtime.test.ts` (40 KB) | The `Models` collection: refresh (offline restore then network), generation-checked publication, abort semantics, the credential lock, `getAuth`, `login`/`logout`. |
| `node-http-proxy.test.ts` | `NO_PROXY` handling, proxy resolution, scoped env aliases, explicit SOCKS/PAC rejection. |
| `oauth-auth.test.ts` | The OAuth adapters: `toAuth` per provider, subscription detection, refresh, and the lazy-load chain through `Models.getAuth`. |
| `oauth-callback-server.test.ts` | The callback server: stray requests, state checking, first-callback-only, cancel, abort, timeout, and the manual-paste race. |
| `oauth-device-code.test.ts` | The RFC 8628 poller, including `slow_down`. |
| `oauth.ts` | Test helper: resolves a key from `~/.pi/agent/auth.json`, refreshing OAuth and writing the file back with `0600`. |
| `openai-chatgpt-oauth.test.ts` | The user-owned client registration, scope storage and refresh-token rotation. |
| `openai-codex-cache-affinity-e2e.test.ts` | Aligned cache-affinity identifiers on SSE requests. |
| `openai-codex-oauth.test.ts` (17 KB) | The Codex device-code and browser logins, the JWT claim path, the token exchange and the base URL. |
| `openai-codex-stream.test.ts` (87 KB) | The Codex stream, WebSocket pool, delta requests and fallbacks. |
| `openai-completions-cache-control-format.test.ts` | Anthropic-style `cache_control` on the OpenAI-compatible API. |
| `openai-completions-empty-tools.test.ts` | An empty tool list is not sent. |
| `openai-completions-prompt-cache.test.ts` | `prompt_cache_key` clamping. |
| `openai-completions-provider-stream-event.test.ts` | `onProviderStreamEvent` sees the raw provider event. |
| `openai-completions-raw-stop-reason.test.ts` | The raw stop reason is preserved. |
| `openai-completions-reasoning-details.test.ts` | Reasoning-detail fields. |
| `openai-completions-response-model.test.ts` | The model that actually answered is reported (`responseModel`). |
| `openai-completions-retry.test.ts` | The retry classifier on the Completions API. |
| `openai-completions-thinking-as-text.test.ts` | `requiresThinkingAsText`. |
| `openai-completions-thinking-token-budget.test.ts` | The top-level reasoning-token cap (`thinking_token_budget` / `thinking_budget` / `thinking_budget_tokens`). |
| `openai-completions-tool-choice.test.ts` (53 KB) | Tool choice across the compat matrix. |
| `openai-completions-tool-result-images.test.ts` | Images in tool results. |
| `openai-completions-vllm-priority.test.ts` | The vLLM scheduler `priority` field. |
| `openai-decisions.test.ts` | The Decisions API: choice/score/bool mapping, the image form, and the credential gating that hides `gpt-6-luna` from OAuth. |
| `openai-responses-cache-affinity-e2e.test.ts` | Cache-affinity identifiers on the Responses API. |
| `openai-responses-chatgpt-sign-in.test.ts` | A ChatGPT access token is recognised as a sign-in, not an API key. |
| `openai-responses-compat.test.ts` (18 KB) | The Responses compat flags. |
| `openai-responses-empty-tool-result.test.ts` | An empty tool result uses the placeholder. |
| `openai-responses-foreign-toolcall-id.test.ts` | A foreign tool-call id is dropped when replaying. |
| `openai-responses-message-id.test.ts` | `responseId` on the Responses API. |
| `openai-responses-mid-convo-effort.test.ts` | The thinking level changes mid-conversation via `configuration_update` items, preserving the prompt cache. |
| `openai-responses-namespace.test.ts` | The Responses namespace. |
| `openai-responses-partial-json-cleanup.test.ts` | The `partialJson` scratch buffer is never persisted. |
| `openai-responses-reasoning-replay-e2e.test.ts` | Encrypted reasoning replays on the Responses API. |
| `openai-responses-terminal-event.test.ts` | The stream must end with a terminal event. |
| `openai-responses-tool-result-images.test.ts` | Images in tool results on Responses. |
| `openai-responses-usage-limit.test.ts` | The ChatGPT workspace usage limit is **not** retried and names the admin path. |
| `opencode-provider-headers.test.ts` | The OpenCode session headers. |
| `openrouter-cache-control-models.test.ts` | Which OpenRouter models take `cache_control`. |
| `openrouter-cache-write-repro.test.ts` | Reproducing the cache-write accounting. |
| `openrouter-images.test.ts` | Image generation through OpenRouter. |
| `openrouter-oauth.test.ts` | The OpenRouter PKCE flow that mints a permanent key. |
| `openrouter-reasoning-options.test.ts` | OpenRouter's reasoning-effort options. |
| `openrouter-user-models.test.ts` | `personalizeOpenRouterCatalog` against `/models/user`. |
| `overflow.test.ts` | The overflow patterns and `isRecoverableLength`. |
| `pi-messages.test.ts` | The pi-messages protocol, including the rewrite-impact summary. |
| `pre-generation-error.test.ts` | A failure before generation emits `error` without `start`. |
| `provider-error-body-passthrough.test.ts` | The provider's error body reaches the caller. |
| `provider-error-body-regression.test.ts` | Regression coverage for error-body handling. |
| `provider-retry.test.ts` | The retry loop's mechanics. |
| `providers.test.ts` (31 KB) | Every provider: listing, auth resolution, model catalogues. |
| `qwen-token-plan-models.test.ts` | The Qwen Token Plan catalogues, the thinking maps and the exclusions. |
| `radius-oauth.test.ts` | The Radius browser and device logins. |
| `radius-provider.test.ts` | The Radius catalogue rules (static vs configured gateway, org-disabled models). |
| `radius-thinking-replay-e2e.test.ts` | Replayed Claude thinking stays in context across the gateway. |
| `reasoning-options.test.ts` | `getEffortThinkingLevelMap` exposes only verified values and does not infer "off". |
| `responseid.test.ts` | `responseId` across Google, Vertex, OpenAI, Anthropic, Azure, Mistral, Copilot and Codex. |
| `retry.test.ts` (14 KB) | The retry/non-retry classifiers, including the digit-vs-status-code rule and the ChatGPT limits staying non-retryable. |
| `sampling-options.test.ts` | Per-thinking-level sampling params. |
| `scratch.ts` | A runnable example script for the `Models` API (not a test). |
| `stream.test.ts` (57 KB) | The base streaming contract across providers. |
| `supports-xhigh.test.ts` | Which models expose `xhigh`/`max`. |
| `system-message-replay.test.ts` | The system-message replay algebra: sections patched by name, tools added and removed. |
| `telemetry-options.test.ts` | Telemetry span plumbing through the options. |
| `telemetry.test.ts` (16 KB) | The telemetry schema: content-free attributes, `first_chunk`, block sizes, the 500-char error truncation, and `aborted` keeping status `ok`. |
| `text.test.ts` | The text helpers. |
| `together-models.test.ts` | The Together catalogue and its reasoning toggles. |
| `tokens.test.ts` (14 KB) | Token usage reporting. |
| `tool-call-id-normalization.test.ts` | Tool-call id normalization across providers. |
| `tool-call-without-result.test.ts` (14 KB) | An orphaned tool call. |
| `total-tokens.test.ts` (30 KB) | Token counting accuracy. |
| `transcript-tool-changes.test.ts` (24 KB) | The four mid-conversation tool strategies (Anthropic native blocks, OpenAI `additional_tools`, tool-search anchoring, top-level list). |
| `transform-messages-copilot-openai-to-anthropic.test.ts` | OpenAI → Anthropic message transformation. |
| `transform-messages-cross-model-thinking.test.ts` | Thinking blocks are dropped when the model changes. |
| `typesafe-system-one.test.ts` (15 KB) | The TypeSafe System One wire format. |
| `unicode-surrogate.test.ts` (28 KB) | Lone surrogates are stripped before the wire. |
| `uuid.test.ts` | `uuidv7` ordering and uniqueness. |
| `validation.test.ts` | The tool-argument validator, including the error that carries the model's raw text. |
| `xai-oauth.test.ts` | The xAI OAuth flow. |
| `xai-responses.test.ts` | xAI on the Responses API. |
| `xhigh.test.ts` | The `xhigh` thinking level. |
| `xiaomi-models.test.ts` | The Xiaomi catalogue and its on/off thinking toggle. |
| `xiaomi-token-plan-ams-anthropic-empty-signature-smoke.test.ts` | Reproduces empty thinking signatures and preserves them for replay. |
| `zai-coding-plan-models.test.ts` | The Z.AI Coding Plan catalogue and its reference costs. |
| `zen.test.ts` | An OpenCode Zen smoke test. |

---

## 2. Ideas worth stealing

Ordered by expected value to August Trading. Each names the file that proves it.

1. **One canonical place that answers "was this a context overflow?", "was this worth retrying?" and "what does this error cost me?"** `packages/ai/src/utils/{overflow,retry,error-body}.ts`. August has `toFriendlyProviderError` (the ancestor of `error-body.ts`) but no overflow classifier and no retry classifier. The overflow classifier is the one that matters: August's `resolveContextWindow()` + `compactForWire()` need a *reliable* signal that a request was rejected for length, and `isRecoverableLength` — "did the stop end below the caller's intended output limit?" — is the signal that a bounded compact-and-retry is worth attempting. **UNIQUE.**
2. **A retry classifier that separates "transient" from "your quota is gone", with the HTTP-status regex guarded against digits.** `utils/retry.ts`. Two pattern sets: retryable (overloaded, 429/500/502/503/504/520/524, "temporarily unavailable", "upstream request failed", "stream was interrupted", network/fetch failures, premature stream endings) and **non-retryable** (quota/budget/billing exhaustion, `insufficient_quota`, subscription usage limits). The lookarounds `(?<![a-z0-9])(?:429|500|…)(?![a-z0-9])` exist because a request id (`req_011CU503xyz`) or a byte count was being read as a status code. August's transport retries once on a context-length rejection; it has nothing to classify the *other* failures. **UNIQUE.**
3. **A tool-argument validator that coerces, then reports the model's own broken text back to it.** `utils/validation.ts` + `utils/json-parse.ts`. The error carries the received arguments *and* the raw text, so the model can retry. August's zod boundary throws away the original text. Keeping it is a one-line change with a real payoff: the model can see and fix its own malformed JSON. **UNIQUE.**
4. **"Prefer" vs "require" constrained sampling, with the offending keyword named.** `api/constrained-sampling.ts`. `strict: 'prefer'` degrades to a normal tool call; `strict: 'require'` fails loudly; the error names the exact schema keyword the provider would not accept. August's schemas are strict, and a `$ref` in a tool schema would hard-fail against a strict provider with an opaque 400. **UNIQUE.**
5. **A telemetry schema declared as data, with content never recorded — but block sizes and time-to-first-chunk always recorded.** `telemetry.ts`. `pi.ai.first_chunk` marks the first normalized event; `pi.ai.block` carries `type`/`index`/`chars`; the error message is truncated to 500 characters; **cancellation keeps status `ok` with `stop: "aborted"`** (an abort is not a provider error). August's `WireAuditRow` is the same idea; the block-size and first-chunk metrics are the missing half. **UNIQUE.**
6. **An error that terminates the *stream* rather than rejecting the promise, with partial content and partial usage preserved.** `types.ts` (`ProviderStreams` contract), `api/lazy.ts`, `utils/event-stream.ts`. "Request failures after a stream is returned never throw: the streaming API emits an error event and the final message carries the details." Setup failures may emit `error` *without* `start`. August's provider errors already map to user-safe messages, but the *shape* — a settled assistant message with `stopReason: "error"`, partial content and partial token counts — is what makes a failed turn renderable rather than a thrown exception that unwinds the transcript. **UNIQUE.**
7. **The transcript as a replayable algebra, not a mutable prompt.** `utils/transcript.ts`. `Context.systemPrompt` + `Context.tools` are shorthand for a leading system message; the prompt is a *sequence* of system messages, each with named `sections` (patched by name, `null` removes) and `toolsAdded`/`toolsRemoved`. Replaying the sequence yields the current prompt and the current tool set. August already has `constants/promptRegistry.ts` and `utils/composePrompt.ts`; the missing piece is that a prompt *revision* should be a transcript entry, not an overwrite — so "what was the prompt when this analysis ran?" is answerable. **UNIQUE.**
8. **The thinking blocks of one model are dropped, not downgraded, when the model changes.** `api/transform-messages.ts` + README "Cross-Provider Handoffs". The reason is stated: a signature only works for the model that produced it, and *readable* thinking sent as plain text makes the new model treat it as part of the reply — so the new model starts writing its own reasoning into the visible answer. August's agents/desk seats switch models; the same trap applies. **UNIQUE.**
9. **Session affinity as a first-class request concept.** `types.ts`; the session id becomes `x-session-id` / `session_id` / `x-client-request-id` / `x-affinity` depending on the provider, so the upstream routes related requests to the same replica and the prompt cache hits. August's long analysis sessions would benefit from a stable cache-affinity id. **UNIQUE.**
10. **A "faux" provider that is a real implementation of the stream protocol, with scripted responses, deferred fetches, and cache-read accounting from the common prompt prefix.** `providers/faux.ts`. August's `scripts/mock-provider.cjs` is a loopback HTTP server; a first-class in-process faux provider would let the unit tests exercise the real stream path, the real cost path and the real abort path — including the *partial* content of an aborted turn. **UNIQUE.**
11. **Atomic, rollback-safe publication of generated data.** `scripts/hydrate-model-catalog.ts` — stage in `mkdtemp`, validate, then `renameSync`; a failure restores the previous data dir and prunes stale shards. *Why it transfers:* any generator that writes files August depends on. **UNIQUE.**
12. **A generated catalogue with a manifest, a structure hash, per-file SHA-256 and a validator that fails the build.** `scripts/model-data.ts` + `scripts/check-model-data.ts`. Divergence is reported as a **set difference** (`missing: …; extra: …`) plus the sorted-structure hash, not as a content diff. August's `constants/models.ts` is hand-edited; a manifest + validator would make "the catalogue is stale" a build failure rather than a support ticket. **UNIQUE.**
13. **A compat merge that refuses to drift.** `providers/compat-schema.ts`. Duplicated properties across the API schemas require an *explicit* override, and an override that resolves nothing is an error. Every boolean in the schema carries a description that states its default — the description is what a human reads when a provider behaves unexpectedly. August has the same class of problem (three copies of "the same setting with a different default"). **UNIQUE.**
14. **Cost tiers: a rate can change above an input-token threshold, and the highest matching tier applies to the whole request.** `models.ts` (`calculateCost`) + `providers/model-schema.ts`. August computes R:R and cost in several places; a tiered cost model with one owner would stop the numbers drifting. **UNIQUE.**
15. **"Offer more than you have" on the thinking level, and clamp up before down.** `models.ts` (`clampThinkingLevel`). Asking for a tier the model lacks yields the nearest *higher* supported tier, not the nearest lower one — asking for "high" and silently getting "off" is a worse failure than asking for "high" and getting "max". `getSupportedThinkingLevels(model)` is the one reader; `xhigh`/`max` are opt-in per model. **UNIQUE.**
16. **A generated model catalogue that filters to *tool-capable* models only.** `scripts/generate-models.ts`. "The chat catalog only includes models that support tool calling, as this is essential for agentic workflows." August's model list mixes chat and reasoning models with no such filter. **UNIQUE.**
17. **A catalogue that lists only what one key may use.** `providers/openrouter.ts` (`personalizeOpenRouterCatalog`). The key's own context size, max output and prices come from the provider, not from a shared table. *Why it transfers:* August's `ProviderConfigService` could show the trader only the models their key can actually run, with that key's real context window and price. **UNIQUE.**
18. **A generation-checked publication path: a slow refresh can never overwrite a newer one.** `models.ts`. `supersedeProviderRefresh` bumps a per-provider generation counter and aborts the previous controller; `publishProviderModels` refuses to write if the generation moved. August's model refresh / settings writes have no equivalent guard. **UNIQUE.**
19. **Refresh in two phases: restore the cached catalogue first (no network), then refresh.** `models.ts`. Offline boot still shows the last-known models. *Why it transfers:* August's `ProviderConfigService` and `models-store` equivalent could boot with the last-known catalogue and refresh behind it. **UNIQUE.**
20. **An OAuth flow that races the loopback callback against a manual paste prompt, and a device-code poller that implements RFC 8628's `slow_down` and names WSL clock drift.** `auth/oauth/callback-server.ts`, `auth/oauth/device-code.ts`. *Why it transfers:* if August ever offers a "sign in with ChatGPT"-style subscription login, this is a ready blueprint. **UNIQUE.**
21. **A credential store with exactly ONE write path (`modify`), so OAuth refresh inside a request cannot double-refresh a rotated token.** `auth/types.ts`, `auth/resolve.ts`. *Why it transfers:* August's `ProviderConfigService` writes keys from several places; one serialized write path is a small change that removes a whole class of race. **UNIQUE.**
22. **"Any HTTP 413 counts as context overflow."** `utils/overflow.ts` + the CHANGELOG entry that added it. GitHub Copilot rejects large request bodies with `413 failed to parse request`, which is a context problem wearing a different hat. August's overflow detection keys on specific provider strings; a status-code rule catches the rest. **UNIQUE.**
23. **A rewrite-impact summary so a gateway cannot silently rewrite the prompt.** `api/pi-messages.ts` (`PiMessagesRewriteImpact`: policy id, policy version, changed?, token-count delta, message-count delta, system-prompt-changed?). *Why it transfers:* if August ever fronts a model with a proxy that rewrites prompts, the trader should be able to see that it happened. **UNIQUE.**
24. **Wholly-owned and partly-owned parts of one reply are distinguished by identity, not by content.** The faux provider's tool-name normalization (`anthropic-messages.ts`) and the "thinking blocks are dropped for a different model" rule are the same idea: the *provenance* of a piece of text decides whether it may travel. August's `harnessMarks.ts` already does this for its own insertions; the extension to "text produced by a different model" is the same move. **UNIQUE.**
25. **A stream protocol that is ONE class, with `result()` and `end()` on it, so the same object is both the iterator and the terminal result.** `utils/event-stream.ts`. August's `Message.toolEvents` / `liveToolEvents` split exists because the transcript holds two lines per call; one event stream with a terminal result removes the pairing problem at the source. **UNIQUE.**

## 3. Trading-specific findings

1. **The failure taxonomy is the part that transfers most cleanly, and August is missing two thirds of it.** August's `toFriendlyProviderError` maps a provider error to a friendly sentence; pi has three separate classifiers — *context overflow* (retry by compacting), *transient* (retry the same request), *quota exhausted* (do not retry, tell the trader their key is spent). A trading app's most expensive failure is not a crash — it is a *silent* wrong answer or a retried request that bills twice. August's transport "retries once on a context-length rejection"; it has no answer to "is this worth retrying?" and no answer to "was this rejected for length or for quota?", which are different user-facing outcomes.
2. **Partial output on failure is a trading feature.** pi's rule is that a failed request still produces a settled assistant message carrying the partial content, the partial token counts and the partial cost. For a trading desk, a run that died at 90% of a multi-tool analysis (order book read, then the chart tool failed) should keep the order-book read. August's transcript drops the turn.
3. **Cost accounting that includes cache writes and cache reads, and prices a 1-hour cache write at 2×.** `usage.cacheRead` / `usage.cacheWrite` / `usage.cacheWrite1h`, and `calculateCost` mutating one `Usage` object. A trading app that sends the same candles and the same journal history on every analysis turn is a cache-pricing consumer; August's cost numbers do not distinguish a cached read from a fresh input.
4. **The `abort` path is a first-class outcome, not an error.** `stopReason: "aborted"` keeps the telemetry status `ok`; an aborted message can still be added to the conversation and continued. For a scheduled or long-running analysis, "the trader cancelled" and "the provider failed" are different events and must not be recorded as the same thing in a trade log.
5. **There is no scheduler, no cron and no trade-log in this shard** — it is the transport layer only. But the transport layer is exactly what a trading app's *scheduled* work needs to be honest about: the `refresh()`-in-two-phases pattern (restore the cached catalogue offline, then refresh), the `usage`/`cost` on every settled message, and the `responseId` (a provider-side id that lets a run be tied to a specific upstream response for audit).
6. **The `Usage.reasoning` subset and the `pi.ai.block` per-block character counts** make it possible to answer "how much of this turn was the model thinking versus answering?" — the number a trading app needs to know whether an expensive run was spent thinking or acting.

## 4. Weak spots

1. **The compat surface is large and only nominally deprecated.** `src/compat.ts` (302 lines) + `src/legacy-api-aliases.ts` (108) + `src/image-models.ts` (50) + `src/oauth.ts` (10) = ~470 lines of migration scaffolding, still exported and still listed in `package.json`'s `sideEffects`. The header says it is "deleted with the coding-agent ModelManager migration" — a migration that is not visible from this package, so the end date is unenforceable from here. Lesson for August: name the deletion event.
2. **The `ProviderStreams` contract is prose, not types.** "Must not throw", "never rejects", "error termination must produce an AssistantMessage with stopReason 'error' or 'aborted'" — all of it in doc comments, none of it enforced by the type system. A provider written by a third party can violate it silently.
3. **One giant generated file and one giant generator.** `scripts/generate-models.ts` is 3632 lines and `packages/ai/CHANGELOG.md` is 2379; both are hard to review. The generator also carries ~40 hand-maintained model-id allow/deny lists (`XAI_BUILTIN_EXCLUDED_MODEL_IDS`, `NVIDIA_NIM_UNSUPPORTED_MODELS`, `BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS`, `QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS`, …) that are, in effect, an undocumented second catalogue that will silently rot.
4. **Compat-flag sprawl.** `OpenAICompletionsCompat` alone has ~25 flags, several of which are auto-detected from the `baseUrl` and several of which exist only for one provider. The detection is duplicated across `openai-completions.ts`, `openai-responses.ts` and the generator — three places that can disagree about the same provider.
5. **A generated catalogue that ages badly.** The generator hardcodes "temporary overrides until upstream model metadata is corrected" for Copilot, Anthropic and Qwen model ids, with hardcoded dates in the comments ("advertised these models on 2026-09-22"). The manifest detects *structural* drift, never *semantic* drift — a model whose price changed upstream is invisible until someone notices.
6. **`compat.ts` re-exports the whole built-in catalogue surface**, so a browser bundle that imports the compat path ships every provider's SDK. The README warns about it; the type system does not prevent it.

## 5. Trading questions this shard answers (and the ones it does not)

**Answers, in this shard:**
- *How do you tell a context-length rejection from a quota rejection?* — `utils/overflow.ts` and `utils/retry.ts`, two disjoint pattern sets plus a status-code rule, and a "recoverable length" predicate that says whether one compact-and-retry is worth attempting.
- *How do you keep a failed turn from unwinding the transcript?* — the stream protocol: a settled `AssistantMessage` with `stopReason: "error" | "aborted"`, partial content, partial usage.
- *How do you price a request?* — one `Usage` object with input/output/cacheRead/cacheWrite, a `cost` block the provider's own `calculateCost` mutates, and cost tiers.

**Not answered here (they live in the agent-loop shards):**
- *How are trades logged so the model can query them later?* — nothing in `packages/ai` stores anything; `ModelsStore` stores *model catalogues*, not trades.
- *How do you run several agents and combine them?* — no debate, no multi-agent, no scheduler in this package.
- *How do you keep a prompt from accumulating stale rules?* — the transcript replay (`sections`, `toolsAdded`/`toolsRemoved`) is the *mechanism*, but the policy of when to retire a rule is the caller's.
- *How do you validate a trade plan against the live market?* — out of scope; this package knows nothing about markets.
