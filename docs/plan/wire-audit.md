# E-53 — The wire audit: what the provider was actually asked, and why there is no trace

**Status:** LANDED — **committed 2026-10-21** (`implementation-record.md` §23).
The §0 scan below describes the tree BEFORE this work and is kept as written,
because it is the measurement the plan was built on: `WireAuditEntry` was
declared in a service, the transport emitted it on every call, and nothing
collected it.
**Owner:** the trader. **Covers:** **O-132**, and **G-5** and the actionable
half of **G-3** from `docs/plan/transcript-redesign.md` (E-52), which this
proposal was carved out of.
**Reference:** the owner's question — *"what should we do to the one you did
not close?"* — after E-52's eight phases landed.
**Depends on:** nothing. **Blocks:** nothing.
**Written:** 2026-10-21 · working tree at `f8a269fd`.

> Every `file:line` below was read at the tip named. The symbol is the durable
> anchor; the line is a snapshot.

---

## 0. The scan — the data existed, and nobody carried it

**The transport has always known. The transcript never did.**

| # | gap | evidence at `f8a269fd` |
|---|---|---|
| **G-5** | `onWireAudit` is declared on the pipeline's options and **supplied by nobody** — the only occurrence outside the transport and the learning store. The hook that could report what went on the wire was a promise the app never kept. | `hooks/useAnalysisPipeline.ts:328` |
| **G-3** | A turn that returned no trace and a turn whose trace was never asked for were the same silence. The work card's early return drew nothing at all, so the trader could not tell "the model didn't think" from "the model was never asked to". | `components/trade/panels/ChatWorkTimeline.tsx:79` (`if (!hasWork && !hasActions)`) |

**And the data was already there.** The transport decides, per request, which
capability route it applied — and says why when it applies none:

| emitter | route | the reason it carries |
|---|---|---|
| `services/providers/GenericProviderService.ts:883` (messages) | `anthropic-thinking` \| `none` | "no thinking block: jsonMode excludes thinking" · "maxTokens below the 1024 thinking floor" · "thinkingCapable override = off" · "model id not recognized as thinking-capable (set the override in Settings)" |
| `services/providers/GenericProviderService.ts:969` (chat_completions) | `openai-effort` · `xai-effort` · `glm-thinking` · `deepseek-thinking` · `none` | the vendor's own knob, or "no verified reasoning route for this wire shape (fail closed)" |
| `services/providers/GenericProviderService.ts:1043` (google) | `gemini-thinking` \| `none` | the thinking config that was sent |

**So E-53 was never a feature.** It was a pipe: the decision was computed on
every call and dropped on the floor. The learning store reads its own copy
(`services/learning/harnessLessons.ts:229`); the trader read nothing.

**The shape lived in the wrong layer.** `WireAuditEntry` was declared inside
`services/providers/reasoningControls.ts:191` — so a `Message` that wanted to
carry it would have had to depend on a service, which is the dependency
`types/provider.ts` exists to prevent.

---

## 1. What landed

1. **The type moved to the wire vocabulary.** `types/provider.ts` owns
   `WireAuditEntry` and `WireAuditRoute`; `reasoningControls.ts` RE-EXPORTS
   them, so every existing import keeps working and there is one shape, not one
   per layer that mentions it. The same shape of fact as `ReasoningEffort`.
2. **The turn collects it, per call**, the way it collects usage — and it
   rides out on the outcome beside the tier. One return, every path shares.
3. **Both homes write it** — the dock's settle and the pipeline's settled
   `Message` — and both read it from the same field.
4. **`components/shared/WireAuditRow.tsx` draws it.** A turn with no trace says
   WHY, in the transport's own words. A turn with a trace shows the route that
   was applied; the disclosure lists every call the turn made.

**Where it stays quiet, on purpose.** Inside the folded work card when the
turn did work — the card folds itself shut the moment the answer lands, so the
record stays out of the way. On its own line ONLY in the case silence
misleads: a settled turn with no trace AND no route applied. And a STREAMING
turn is never said to have no trace: the trace may still be on its way, and
claiming otherwise is a lie the trader would act on.

---

## 2. What this does NOT close

- **G-3's other half.** "The model thought and the provider did not return the
  trace" is still indistinguishable from "the model returned no trace" —
  though with the route applied, the second is now the only remaining
  possibility, which is itself an answer.
- **G-12** (a long bot turn is a wall) — untouched; it is a live-card problem.
- **G-15** (per-provider thinking joined flat) — untouched, and still a
  row-model question: the traces are already a map, but the desk's tool
  markers are interleaved into the joined text and the tool rows are matched
  positionally, so labelling per seat needs the seat identity carried on the
  trace AND on the tool calls.
