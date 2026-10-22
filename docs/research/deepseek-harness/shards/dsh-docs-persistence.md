# deepseek-harness :: dsh-docs-persistence

**Files in shard:** 195 (read: 100, skipped with reason: 95)
**What this shard covers:** `docs/persistence-changes/**` in the deepseek-harness repo — the
**persistence-type history subsystem** for the *Session* format (the JSONL transcript DSH writes to
disk). It is not feature documentation; it is the machine-checked *audit trail* for every structural
change to that format. The shard contains four artefacts per change record (an English
acknowledgement, a Chinese mirror, a generated bilingual-pairing sidecar, a generated schema
snapshot), a **finalization checkpoint** (`finalized/v4.json`) that freezes an accepted baseline, a
26-tag **prerelease archive** that reconstructs the format across historical alpha/RC tags, and a
per-format reference set (V0–V3) carrying complete type inventories. The engineering value is
almost entirely in the *policy*: what counts as a compatible change, who must acknowledge it, how
"older readers behave" is argued in prose, and how the whole thing is verified **offline — no Git,
no network, no old checkouts**.

---

## 1. File-by-file

This shard contains **no Tier-1 source files**. Every file is either a `docs` record (Tier 2) or a
`generated-vendored` artefact (Tier 3: `.schema.json` snapshots, `.i18n.yaml` pairing sidecars).

### Tier 2 — bulk: docs

#### Framework / index documents (6 files)

| File | What it is / what it pins |
| --- | --- |
| `docs/persistence-changes/README.md` | The rulebook for the whole subsystem. Pins the four-file record layout (`.md` + `.zh.md` + `.i18n.yaml` + `.schema.json`) at `README.md:37-44`; the **compatibility table** (`README.md:53-61`) naming which detected change may stay `same-version`, which needs a compatibility review, and which forces `version-bump`; the rule that "older readers must refuse unsupported required data **before execution, mutation, or recovery truncation**" (`README.md:49`); the `@persistenceSource` / `@persistenceAttribution` / `@persistenceReserved` annotation vocabulary (`README.md:63-71`); the requirement that "the verifier reads the machine declaration once from the English file and checks the Chinese declaration for equality" (`README.md:44`); and the digest-normalisation rules, including "ordinary comments, source locations, alias names, and harmless declaration reordering do not affect them" but "compatibility annotations are recorded policy data and do affect digests" (`README.md:80`). |
| `docs/persistence-changes/README.zh.md` | The Chinese mirror of the above. Verified to carry the identical rules and the identical machine table; the "Dev Note" and section anchors are the same set. (Existence of a *machine-checked* bilingual mirror is itself the point — see §4.) |
| `docs/persistence-changes/finalized/v4.json` | The **finalization checkpoint** for session format V4: `schemaVersion: 1`, `sessionFormatVersion: 4`, a `roots` map of 65 roots each with `kind` (header / envelope / event), `digest`, and for events the `event` name plus a `surface: boolean`, and an `acceptedRecords` map (`finalized/v4.json:372`) of five accepted change records keyed by their semantic hashes. This is the machine file that lets a later record prove the 3→4 transition was already accepted and may not be reused. |
| `docs/persistence-changes/releases/README.md` | Index + scope of the 26-tag prerelease archive, with the generated `<!-- persistence-release-index:start/end -->` table (tag → date → session version → roots/types → changed roots). Pins the rule that the *first* entry's change count includes every root, the honest admission that "historical version 0 did contain structural changes without version increases" (`releases/README.md:68`), that "an unchanged digest does not establish unchanged behavior" (`releases/README.md:79`), and that the check runs "without Git, network access, or old-version checkouts" (`releases/README.md:84`). Also pins that no captured tag ever used writer version 1 (`releases/README.md:77`). |
| `docs/persistence-changes/releases/README.zh.md` | The Chinese mirror of the archive index. Carries the same generated 26-row tag table (each row's link retargeted to the `.zh.md` sibling), the same extraction-limitations section — including the same admission that "历史上的 version 0 确实出现过不升版本的结构变化" — and the same offline-verification claim. Read in full; the machine data (the manifest) is shared, not duplicated. |
| `docs/persistence-changes/releases/manifest.json` | The machine source of truth for the archive: 26 tag records with `tag`, `sourceDate`, `publishedAt` (null for the 10 pre-release tags) and `sessionFormatVersion` (0, 2 or 3). |

#### Dated change records — the acknowledgement chain (32 files, 16 records × EN/中文)

Each record is `kind: persistence-change` with a YAML block naming, per root: the predecessor
record, the new SHA-256 digest, and the `decision` (`same-version` / `version-bump`).

| File | What it is / what it pins |
| --- | --- |
| `docs/persistence-changes/2026-09-11-initial.md` | The **baseline**. 65 roots declared at once (3 headers/envelope + 62 event roots) with `previous: null` and `decision: same-version`, each pinned to a digest. Its Compatibility section is deliberately empty of claims: it "initializes type history without asserting relationships to earlier formats or changing the Session writer version or runtime behavior" (`2026-09-11-initial.md:270`). |
| `docs/persistence-changes/2026-09-11-initial.zh.md` | Chinese mirror with a byte-identical YAML declaration. |
| `docs/persistence-changes/2026-09-12-auto-review-error-metadata.md` | Adds optional structured error metadata to `tool/ptc-dispatch` and an optional user-facing `reason` to `tool/result`. The safety argument is precise: "PTC dispatch events do not enter model history; native tool-result replay projects `data.message` and does not include error metadata" (`2026-09-12-auto-review-error-metadata.md:42`) — the added field is invisible to the model, so old readers replay identically. |
| `docs/persistence-changes/2026-09-12-auto-review-error-metadata.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-13-working-directory.md` | New root `event:working-directory/change`. Notably honest: the new event is **required on read** ("older builds that do not know working-directory/change refuse logs containing it"), and the record calls that a *vocabulary growth*, not a format change. |
| `docs/persistence-changes/2026-09-13-working-directory.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-14-image-offload.md` | 13 roots touched by one feature — the record shows how a single behavioural change fans out across every root that embeds the shared `Message`/`ContentBlock` declarations. Adds `event:image/offload`; the offloaded mark is *derived through the owning plugin's message projection* rather than stored twice. |
| `docs/persistence-changes/2026-09-14-image-offload.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-14-workspace-changes-event.md` | Adds the **log-only** `event:workspace/changes`. Pins the rule that it is "never model-visible" and that the Web changed-files card "reads the latest event per turn" (`2026-09-14-workspace-changes-event.md:38`) — a log as a UI source of truth, decoupled from the model. |
| `docs/persistence-changes/2026-09-14-workspace-changes-event.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-16-session-format-v4.md` | The **version-bump** record (3→4). 15 roots changed at once. The most valuable prose in the shard: the tool-role declaration changes ten event roots "because inbox entries, message events, compaction summaries, title requests, team messages, and PTC dispatches embed the shared `Message` or `ContentBlock` declarations" (`2026-09-16-session-format-v4.md:90`) — one type change, not ten protocols. The V3→V4 migration contract: lifting released user-role tool results into tool-role messages (`…:94`), "conflicting identities, timestamps, or modes refuse migration without publication" (`…:94`), "historical read opens prepare the result in memory. Write opens revalidate child membership and revisions before publishing" (`…:94`), and "Delivery-generation checks keep historical acknowledgements from becoming active V4 watermarks" (`…:94`). The retired-key rule: `request/header` "records the retired `system` key as forbidden" so permitting it later is a *type change*, not an ordinary optional-field addition (`…:96`). And a shipping-honesty note: "No shipped profile emits developer records; provider serialization, automatic emission and UI support remain deferred" (`…:102`). |
| `docs/persistence-changes/2026-09-16-session-format-v4.zh.md` | Chinese mirror, identical declaration and identical migration contract. |
| `docs/persistence-changes/2026-09-18-schedule-optional-title.md` | Makes the stored `title` optional on the `after`/`at`/`every` variants of `schedule/change`. Pins the asymmetry: the *event* tolerates a missing title, but "The Host task record still requires the member: the storage decoder rejects a stored task without it, and creation, update, and the schedule tools still require it" (`2026-09-18-schedule-optional-title.md:38`). |
| `docs/persistence-changes/2026-09-18-schedule-optional-title.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-19-external-subagent-catalog.md` | Adds `mode: external` to parent catalog entries for children with no local Session. Pins a **monotonic payload version** rule: new external executions write payload `version: 2` with `mode external` "without a separate marker" (`2026-09-19-external-subagent-catalog.md:38`); creation writes one membership fact and execution/cleanup do not update it; duplicate child ids remain invalid. |
| `docs/persistence-changes/2026-09-19-external-subagent-catalog.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-20-unknown-child-catalog.md` | Adds `mode: unknown` so unreadable historical children are *retained* rather than dropped. Pins the payload-version-widening rule: v0 stays byte-identical, v1 adds a mode, migration emits v1 for unknown children only, older readers reject v1 — and the classifier allows a higher payload version "only when all old payload alternatives remain unchanged" (`2026-09-20-unknown-child-catalog.md:38`). |
| `docs/persistence-changes/2026-09-20-unknown-child-catalog.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-21-user-question-reply.md` | A **qualified message source** (`dsh-user-questions`) for a late answer to a continued `ask_user_question`. Pins the "unknown reader keeps the data" promise: readers without the feature "preserve the message and derive history from its content" (`2026-09-21-user-question-reply.md:50`); only the `userQuestions` projection reads the source; the answer RPC is the only producer. |
| `docs/persistence-changes/2026-09-21-user-question-reply.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-09-30-job-session-lifecycle.md` | Adds `event:job/registered` and `event:job/settled` for owned background jobs. Pins: kind-prefixed UUID `JobId` used for both live control and durable pairing; "historical sessions receive no fabricated job history" (`2026-09-30-job-session-lifecycle.md:42`); and the honest distinction that `producerReported` "describes completion-promise fulfillment, not verified resource release" (`…:42`). |
| `docs/persistence-changes/2026-09-30-job-session-lifecycle.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-10-05-ptc-operation-metadata.md` | Adds optional **pure presentation** metadata to persisted nested PTC tool results so history retains operation-time directories and file targets. Pins that the field "does not change canonical program values, model-visible content, tool identities or message ordering" and that "Historical calls without a recorded relative target keep safe unavailable navigation" (`2026-10-05-ptc-operation-metadata.md:38`) — a missing affordance degrades to disabled, never to a wrong link. |
| `docs/persistence-changes/2026-10-05-ptc-operation-metadata.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-10-05-working-directory-attribution.md` | Adds producer-owned working-directory notice attribution. The new source kind "is attribution only; the declared source policy preserves unknown attribution without interpreting it" (`2026-10-05-working-directory-attribution.md:50`). |
| `docs/persistence-changes/2026-10-05-working-directory-attribution.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-10-07-title-reasoning-effort.md` | Records the concrete reasoning effort selected for auxiliary session-title requests. Optional field; "Prepared title requests write the resolved effort when the route exposes selectable reasoning; no Session format bump is required" (`2026-10-07-title-reasoning-effort.md:38`). The SDK snapshot pins a *low* effort selected from a route whose default is *high*. |
| `docs/persistence-changes/2026-10-07-title-reasoning-effort.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-10-13-deepseek-search-thinking.md` | Adds the optional `thinking` member to the logged DeepSeek search request body, recording that the auxiliary search turn disables thinking. Pins that the event "is log-only; no reader replays or interprets the body for behavior" (`2026-10-13-deepseek-search-thinking.md:38`) and that absence means "the request omitted the field and DeepSeek applied its default". |
| `docs/persistence-changes/2026-10-13-deepseek-search-thinking.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/2026-10-13-user-rpc-principal.md` | Adds an optional `principal` to the user-rpc message source for prompts submitted by a caller other than the owner. Pins the "absent means owner" default, the "older reader ignores it and treats the message as an ordinary user message, because the kind stays 'user'" rule, and — the load-bearing one — "The field is not part of any model request: provider adapters read only the model-visible message content" (`2026-10-13-user-rpc-principal.md:50`). |
| `docs/persistence-changes/2026-10-13-user-rpc-principal.zh.md` | Chinese mirror, identical declaration. |

#### Historical-format references (10 files)

| File | What it is / what it pins |
| --- | --- |
| `docs/persistence-changes/historical-formats/README.md` | The V0–V3 format index (generated table at `historical-formats/README.md:35`: V0 from `dsh-v0.1.2-rc.1` 54/415, V1 from PR #3349 54/415, V2 from `dsh-v0.1.3-alpha.2` 56/435, V3 from PR #4320 60/467, V4 current 65/614) plus the **archiving procedure**: `verify-persistence-formats --archive N` creates `vN.schema.json` from the live inventory *before* the writer advances, "retains exactly the types reachable from its roots, and removes source line numbers", and "refuses an existing destination, a version other than the current writer, invalid or incomplete schemas, and combination with `--write`" (`historical-formats/README.md:60`). Also: "Every older integer needs its own complete record" (`…:51`) — no gaps allowed. |
| `docs/persistence-changes/historical-formats/README.zh.md` | Chinese mirror; machine-declaration block verified byte-identical to the English. |
| `docs/persistence-changes/historical-formats/v0.md` | The complete V0 type inventory at `dsh-v0.1.2-rc.1` (writer 0). Format characteristics: `SessionHeader.version` is a broad `number` ("the source writer constant establishes V0; the numeric type alone does not restrict values to 0"), the logical header requires `isSeeded` while the *physical* JSONL header stores optional `seedLength` (`historical-formats/v0.md:43`), `assistant/chunk` is a top-level event and `assistant/message` has no embedded `stream`. Documents the **packed physical row encoding** (`text-chunks` / `reasoning-chunks` / `tool-call-chunks` with `seq0`, `time0`, `dt` gap arrays that "may be negative") and states the crucial boundary: the codec owns packed bodies, "These physical body encodings are not additional roots in this declared-type inventory" (`historical-formats/v0.md:28`). |
| `docs/persistence-changes/historical-formats/v0.zh.md` | Chinese mirror; machine-declaration block verified byte-identical to the English (5089 chars, equal). |
| `docs/persistence-changes/historical-formats/v1.md` | The complete V1 inventory — an **intermediate format with no release tag**. Source is "the last V1 tree before the first V2 writer change in the ancestry of `dsh-v0.1.3-alpha.1`, associated with PR #3349" (`historical-formats/v1.md:28`); the record explicitly refuses to invent a product release for it. `SessionHeader.version` resolves to the literal 1. |
| `docs/persistence-changes/historical-formats/v1.zh.md` | Chinese mirror; machine-declaration block verified byte-identical (5086 chars, equal). |
| `docs/persistence-changes/historical-formats/v2.md` | The complete V2 inventory at `dsh-v0.1.3-alpha.2` (writer 2). `assistant/chunk` is gone; `assistant/message.data` and the log-only `assistant/attempt.data` both require an embedded `stream`; surface replacement keeps `start`/`end`; system prompt text still lives in `request/header.data.header.system`. Documents the inherited-cut rule: "the last `session/end-seed` event carrying `data.inherited: true` identifies the inherited cut by its sequence position" (`historical-formats/v2.md:43`). |
| `docs/persistence-changes/historical-formats/v2.zh.md` | Chinese mirror; machine-declaration block verified byte-identical (5291 chars, equal). |
| `docs/persistence-changes/historical-formats/v3.md` | The complete V3 inventory captured before the V4 writer change in PR #4320, from "the initial tree of PR #4320 on `release/session-log-v4`, recorded by the empty commit dated 2026-09-16" (`historical-formats/v3.md:28`) — a commit, not a release. `system/message`, `user/message`, `assistant/message` and `tool/result` all require `surfaceOp`; replacement endpoints are `startSeq`/`endSeq`. |
| `docs/persistence-changes/historical-formats/v3.zh.md` | Chinese mirror; machine-declaration block verified byte-identical (5656 chars, equal). |

#### Prerelease archive — release records (52 files = 26 records × EN/中文)

Each record is `kind: persistence-release` with a `yaml persistence-release` declaration (tag,
predecessor, observed writer version, per-root before/after digests) and a generated structural-change
table. Eleven of the twenty-six records have **empty** `changes: []` — the format did not move.

| File | What it is / what it pins |
| --- | --- |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.1.md` | The historical baseline: 42 roots / 341 types, writer 0, every root declared with `before: null` ("establishes the historical baseline", `releases/dsh-v0.0.1-rc.1.md:12`). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.2.md` | Envelope gains optional `ignorable`; adds `schedule/change` and four `tool-workflow/*` events; 45 changed roots / 48 structural differences, writer still 0. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.3.md` | `compact/*` event keys renamed to `compaction/*`; user-message source kind `workspace-instructions` → `agent-instructions`; hook dialect `claude` → `claude-code` — all with the writer version **unchanged at 0** (`releases/dsh-v0.0.1-rc.3.md:12`). The archive's own text admits this would not pass today's rules. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.3.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.4.md` | No structural change (47 roots / 374 types), writer 0. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.4.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.5.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.5.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.1.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.2.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.3.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.3.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.5.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.5.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.6.md` | No structural change, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.6.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.7.md` | `assistant/chunk.data.chunk.replayState` changes from `unknown` to an object with required `response` and optional `blocks`; 1 changed root, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.7.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.8.md` | Adds four `team/*` events plus the `team-message` user-source variant; `assistant/message` gains optional `interrupted`; 8 changed roots, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.8.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.1.md` | `permission/preset` gains optional `origin` with `default` / `selection` / `inferred` values; 1 changed root, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.2.md` | `permission/preset` **removes** `origin`; attachment records gain optional `originalDimensions` across nine payload paths (inbox, assistant chunk, assistant message, compaction summary ×2, title request, team message, code dispatch, tool result, user message); 10 changed roots / 11 diffs, writer 0. A field added and removed within two tags. |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.1.md` | Envelope removes `ignorable`; `request/header` gains optional `startsSeries` and the `series` reason; adds `model/selection`, `subagent/model-selection-policy` and `session-log-deepseek/delivery-accepted`; 52 changed roots / 61 diffs — "The writer format remains 0 despite these structural changes" (`releases/dsh-v0.1.2-alpha.1.md:12`). The archive's clearest example of a historical non-compliance. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.2.md` | The envelope **restores** optional `ignorable` — alpha.2 is effectively a revert of alpha.1; 52 changed roots, writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.3.md` | No structural change (54 / 417), writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.3.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.4.md` | The logical `SessionHeader` replaces optional `seedLength` with **required** `isSeeded` while the physical JSONL header still declares `seedLength`; the `subagent-report` and `coordinator` user-source variants become `agent-message`; 4 roots / 5 diffs, writer still 0 (`releases/dsh-v0.1.2-alpha.4.md:12`). Two headers, two different shapes. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.4.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.5.md` | No structural change (54 / 415), writer 0. |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.5.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.2-rc.1.md` | No structural change (54 / 415), writer 0. **This is the tag the V0 format snapshot was taken from.** |
| `docs/persistence-changes/releases/dsh-v0.1.2-rc.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.1.md` | Writer version **0 → 2** across these tags: the JSONL header replaces `seedLength` with required `isSeeded`; `session/end-seed` gains optional `inherited`; `assistant/chunk` is removed and `assistant/attempt` added; `assistant/message` gains a **required** `stream` array; team event payload versions advance 1 → 2; 17 changed roots / 25 diffs (`releases/dsh-v0.1.3-alpha.1.md:12`). |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.2.md` | `feedback/message-put` and `feedback/message-delete` are added "without changing the existing persistence root digests"; 2 changed roots, writer 2 (`releases/dsh-v0.1.3-alpha.2.md:12`). **This is the tag the V2 format snapshot was taken from.** |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.1.md` | Writer version **2 → 3**: `system/message` is added and EpochHeader removes `system`; surface replacement fields change from `start`/`end` to `startSeq`/`endSeq`; the `tool/code-dispatch*` event keys become `tool/ptc-dispatch*`; 12 changed roots / 25 diffs (`releases/dsh-v0.1.5-alpha.1.md:12`). |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.2.md` | `deliverables/presented` and `subagent/catalog` are added; feedback records gain optional `category` and `feedback/record.text` becomes optional; 4 roots / 5 diffs, writer 3. |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.2.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.1.md` | No structural change (59 / 462), writer 3. |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.1.zh.md` | Chinese mirror, identical declaration. |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.2.md` | No structural change (59 / 462), writer 3. The last captured tag. |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.2.zh.md` | Chinese mirror, identical declaration. |

### Tier 3 — skipped with a reason (95 files)

All 95 are `generated-vendored`. None is binary. Each was opened and its head read to confirm what
it is; none was read line by line, and none is summarised from its name alone.

**Group A — generated bilingual-pairing sidecars for the change records (16 files).** Each is a
`# Bilingual-pair consistency record for <record>.md` YAML file that, per heading section, records a
hash of the English and Chinese blocks outside code blocks and generated regions, plus the exact
command to re-record it (`pnpm run verify-translation-pairing --write <path>`). Sizes 1 004–1 148
bytes. Not read line by line: generated pairing hashes, not prose.

| File | Why not read line by line |
| --- | --- |
| `docs/persistence-changes/2026-09-11-initial.i18n.yaml` | Generated per-section EN/ZH hash record (1 055 B) — head confirmed the format; hashes are not prose. |
| `docs/persistence-changes/2026-09-12-auto-review-error-metadata.i18n.yaml` | Generated per-section EN/ZH hash record (1 121 B). |
| `docs/persistence-changes/2026-09-13-working-directory.i18n.yaml` | Generated per-section EN/ZH hash record (1 040 B). |
| `docs/persistence-changes/2026-09-14-image-offload.i18n.yaml` | Generated per-section EN/ZH hash record (1 004 B). |
| `docs/persistence-changes/2026-09-14-workspace-changes-event.i18n.yaml` | Generated per-section EN/ZH hash record (1 094 B). |
| `docs/persistence-changes/2026-09-16-session-format-v4.i18n.yaml` | Generated per-section EN/ZH hash record (1 040 B). |
| `docs/persistence-changes/2026-09-18-schedule-optional-title.i18n.yaml` | Generated per-section EN/ZH hash record (1 094 B). |
| `docs/persistence-changes/2026-09-19-external-subagent-catalog.i18n.yaml` | Generated per-section EN/ZH hash record (1 112 B). |
| `docs/persistence-changes/2026-09-20-unknown-child-catalog.i18n.yaml` | Generated per-section EN/ZH hash record (1 076 B). |
| `docs/persistence-changes/2026-09-21-user-question-reply.i18n.yaml` | Generated per-section EN/ZH hash record (1 058 B). |
| `docs/persistence-changes/2026-09-30-job-session-lifecycle.i18n.yaml` | Generated per-section EN/ZH hash record (1 076 B). |
| `docs/persistence-changes/2026-10-05-ptc-operation-metadata.i18n.yaml` | Generated per-section EN/ZH hash record (1 085 B). |
| `docs/persistence-changes/2026-10-05-working-directory-attribution.i18n.yaml` | Generated per-section EN/ZH hash record (1 148 B). |
| `docs/persistence-changes/2026-10-07-title-reasoning-effort.i18n.yaml` | Generated per-section EN/ZH hash record (1 085 B). |
| `docs/persistence-changes/2026-10-13-deepseek-search-thinking.i18n.yaml` | Generated per-section EN/ZH hash record (1 103 B); read in full and its structure recorded in §4. |
| `docs/persistence-changes/2026-10-13-user-rpc-principal.i18n.yaml` | Generated per-section EN/ZH hash record (1 049 B). |

**Group B — generated bilingual-pairing sidecars for the three READMEs (3 files).**

| File | Why not read line by line |
| --- | --- |
| `docs/persistence-changes/README.i18n.yaml` | Generated per-section EN/ZH hash record (1 042 B). |
| `docs/persistence-changes/historical-formats/README.i18n.yaml` | Generated per-section EN/ZH hash record (1 024 B). |
| `docs/persistence-changes/releases/README.i18n.yaml` | Generated per-section EN/ZH hash record (1 229 B). |

**Group C — generated per-change schema snapshots (16 files).** Each is a JSON document
`{ "formatVersion": 1|2, "roots": [ { key, kind, event, surface, digest, schema: { root, nodes[] } } ], "types": [] }`
— a node-graph encoding of the affected roots after the change. `formatVersion: 2` appears from
2026-09-16 onward (the policy-bearing inventory). Sizes 1 621 B – 381 958 B. Not read line by line:
generated type graphs; the one small example was read in full to confirm the shape.

| File | Why not read line by line |
| --- | --- |
| `docs/persistence-changes/2026-09-11-initial.schema.json` | Generated type-graph snapshot, 319 585 B — head confirmed `formatVersion: 1` + `roots[]`. |
| `docs/persistence-changes/2026-09-12-auto-review-error-metadata.schema.json` | Generated type-graph snapshot, 21 231 B. |
| `docs/persistence-changes/2026-09-13-working-directory.schema.json` | Generated type-graph snapshot, 1 728 B. |
| `docs/persistence-changes/2026-09-14-image-offload.schema.json` | Generated type-graph snapshot, 200 046 B. |
| `docs/persistence-changes/2026-09-14-workspace-changes-event.schema.json` | Generated type-graph snapshot, 1 621 B. |
| `docs/persistence-changes/2026-09-16-session-format-v4.schema.json` | Generated type-graph snapshot, 381 958 B — `formatVersion: 2` (the policy-bearing inventory). |
| `docs/persistence-changes/2026-09-18-schedule-optional-title.schema.json` | Generated type-graph snapshot, 7 071 B. |
| `docs/persistence-changes/2026-09-19-external-subagent-catalog.schema.json` | Generated type-graph snapshot, 6 865 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-09-20-unknown-child-catalog.schema.json` | Generated type-graph snapshot, 5 909 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-09-21-user-question-reply.schema.json` | Generated type-graph snapshot, 269 084 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-09-30-job-session-lifecycle.schema.json` | Generated type-graph snapshot, 6 929 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-10-05-ptc-operation-metadata.schema.json` | Generated type-graph snapshot, 10 610 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-10-05-working-directory-attribution.schema.json` | Generated type-graph snapshot, 270 715 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-10-07-title-reasoning-effort.schema.json` | Generated type-graph snapshot, 70 782 B — `formatVersion: 2`. |
| `docs/persistence-changes/2026-10-13-deepseek-search-thinking.schema.json` | Generated type-graph snapshot, 5 395 B — `formatVersion: 2`; **read in full** (it is small) to confirm the node-graph shape and that the added `thinking` member is `optional: true`. |
| `docs/persistence-changes/2026-10-13-user-rpc-principal.schema.json` | Generated type-graph snapshot, 272 737 B — `formatVersion: 2`. |

**Group D — generated format-archive sidecars for V0–V3 (8 files).**

| File | Why not read line by line |
| --- | --- |
| `docs/persistence-changes/historical-formats/v0.i18n.yaml` | Generated per-section EN/ZH hash record, 64 636 B (the format references are ~5 000 lines, so the sidecar is large). |
| `docs/persistence-changes/historical-formats/v0.schema.json` | Generated complete type-graph snapshot, 1 154 545 B — head confirmed `formatVersion: 1` + `roots[]`. |
| `docs/persistence-changes/historical-formats/v1.i18n.yaml` | Generated per-section EN/ZH hash record, 64 636 B. |
| `docs/persistence-changes/historical-formats/v1.schema.json` | Generated complete type-graph snapshot, 1 157 402 B. |
| `docs/persistence-changes/historical-formats/v2.i18n.yaml` | Generated per-section EN/ZH hash record, 68 024 B. |
| `docs/persistence-changes/historical-formats/v2.schema.json` | Generated complete type-graph snapshot, 1 323 945 B. |
| `docs/persistence-changes/historical-formats/v3.i18n.yaml` | Generated per-section EN/ZH hash record, 72 634 B. |
| `docs/persistence-changes/historical-formats/v3.schema.json` | Generated complete type-graph snapshot, 1 436 355 B. |

**Group E — generated release-archive sidecars (52 files).** Each `.i18n.yaml` is the per-section EN/ZH
hash record for the corresponding release record (1 178–1 208 B, all nine sections hashed). Each
`.schema.json` is the release's generated type-graph snapshot; the **55-byte** ones are
`{ "formatVersion": 1, "roots": [], "types": [] }` — the empty snapshot for a release with no
structural change — and the large ones carry only the *changed* roots.

| File | Why not read line by line |
| --- | --- |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.1.schema.json` | Generated type-graph snapshot, 929 546 B (all 42 roots). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.2.schema.json` | Generated type-graph snapshot, 1 011 889 B (45 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.3.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.3.schema.json` | Generated type-graph snapshot, 458 135 B (12 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.4.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.4.schema.json` | Generated **empty** snapshot (55 B): `formatVersion 1, roots [], types []` — read in full. |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.5.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.0.1-rc.5.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.1.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.2.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.3.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.3.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.5.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.5.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.6.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.6.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.7.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.7.schema.json` | Generated type-graph snapshot, 124 115 B (1 changed root). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.8.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.0-rc.8.schema.json` | Generated type-graph snapshot, 499 611 B (8 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.1.schema.json` | Generated type-graph snapshot, 10 227 B (1 changed root). |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.1-rc.2.schema.json` | Generated type-graph snapshot, 697 372 B (10 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.1.schema.json` | Generated type-graph snapshot, 1 133 518 B (52 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.2.schema.json` | Generated type-graph snapshot, 1 155 435 B (52 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.3.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.3.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.4.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.4.schema.json` | Generated type-graph snapshot, 417 106 B (4 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.5.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-alpha.5.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-rc.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.2-rc.1.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.1.schema.json` | Generated type-graph snapshot, 910 508 B (17 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.3-alpha.2.schema.json` | Generated type-graph snapshot, 19 642 B (2 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.1.schema.json` | Generated type-graph snapshot, 577 671 B (12 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 208 B). |
| `docs/persistence-changes/releases/dsh-v0.1.5-alpha.2.schema.json` | Generated type-graph snapshot, 50 538 B (4 changed roots). |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.1.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.1.schema.json` | Generated empty snapshot (55 B). |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.2.i18n.yaml` | Generated per-section EN/ZH hash record (1 178 B). |
| `docs/persistence-changes/releases/dsh-v0.1.5-rc.2.schema.json` | Generated empty snapshot (55 B). |

---

## 2. Ideas worth stealing

1. **A per-change "compatibility acknowledgement" record with a machine declaration, a digest
   chain, and a prose argument.** Every structural change to the persisted format gets a dated
   record naming each affected root, its predecessor record, its new SHA-256 digest, and a
   `same-version` / `version-bump` decision, plus a *Compatibility* section arguing in both
   directions how old and new readers behave, plus a *Verification* section listing the checks
   actually run. `docs/persistence-changes/README.md:37-81`,
   `docs/persistence-changes/2026-09-16-session-format-v4.md:90-102`.
   **Why it transfers to August Trading:** the app persists trades, analyses, journals, skills and
   agent memory in IndexedDB/SQLite/Preferences and backs them up. A dated "persistence-change"
   record per schema change — with a digest of the affected record shape, an explicit decision
   (`same-version` / `version-bump` / `refuse`), and prose arguing what an *older installed build*
   does with the new row — is exactly the artefact that prevents a silent migration bug when a
   trader upgrades the desktop app. **CONVERGENT** (the same "record the decision, not just the
   code" discipline appears in the other two reference repos' notes/audit trees).

2. **A published compatibility *table* that a machine can apply, with the "hard" cases explicitly
   requiring a human.** `docs/persistence-changes/README.md:53-61` lists each detected change class
   and the decision it demands. Crucially the classifier "identifies established same-version cases
   and changes requiring compatibility review; it cannot decide semantic safety" — those need an
   explicit `--decision same-version` flag, and CI accepts the recorded decision but "cannot establish
   how the record was authored or whether a human reviewed it" (`README.md:61-63`).
   **Why it transfers:** August Trading can encode the same split — most additive changes are
   auto-compatible, but "make a required field optional", "add a required field", "change an
   existing type", "remove/rename" must force an explicit human decision that is recorded in the
   commit. **CONVERGENT.**

3. **Refuse, don't truncate.** The rule is that an unsupported required feature needs "an effective
   refusal signal" and that "unsupported-feature refusal must not become corruption recovery or
   tail truncation" (`docs/persistence-changes/README.md:69`). Every change record in this shard
   phrases safety as "older builds refuse logs containing it".
   **Why it transfers:** a trade journal or a skill notebook that a newer build wrote must not be
   *silently shortened* by an older build — it must refuse with a clear message. **CONVERGENT.**

4. **"Unknown readers keep the data" as a first-class promise.** The `@persistenceAttribution`
   annotation makes a producer *promise* that "an unknown kind and its JSON metadata survive
   reading without the producer, and that the kind imposes no validation, replay, or authority
   requirement" (`docs/persistence-changes/README.md:63-67`). The working example is
   `dsh-user-questions`: "readers without dsh-user-questions preserve the message and derive
   history from its content" (`2026-09-21-user-question-reply.md:50`).
   **Why it transfers:** August Trading's stored `Message`/`TradeAnalysis` rows carry a `source`
   field. Making the *unknown-source* case an explicitly written, tested promise (a plugin writes
   `source.kind: 'x'`; a build that has never heard of `x` still renders and replays the row) is
   a clean way to let features ship without a central registry of every source kind.
   **UNIQUE** to this repo.

5. **The retired-field trick: a field the reader refuses is declared `optional never` + a reserved
   marker, so re-allowing it later is a *type change* and cannot slip through as an ordinary
   optional-field addition.** `docs/persistence-changes/README.md:71`; the live example is the
   retired `system` key in `request/header` (`2026-09-16-session-format-v4.md:96`).
   **Why it transfers:** August Trading has retiring fields too (`Message.provider`, `modelUsed`
   fallbacks, `geminiModelUsed` read-only legacy). Declaring the retired field explicitly — and
   having the type system say "this may never hold a value again" — makes the *intent* survive
   the code. **UNIQUE.**

6. **A "finalization checkpoint" that freezes an accepted baseline so it cannot be quietly
   rewritten.** `docs/persistence-changes/finalized/v4.json:372` lists the five accepted records by
   semantic hash; the README says "Finalized records remain immutable, so a later record cannot
   reuse the accepted 3→4 transition" and "the checkpoint protects accepted machine declarations
   and after schemas even after the writer advances, while excluding prose, aliases, and source
   locations from record hashes" (`README.md:40-44, 61`).
   **Why it transfers:** the "live schema may evolve compatibly, but the *agreed* trade-log shape
   at a point in time is frozen" idea applies to any long-lived store. **UNIQUE.**

7. **Archive a format snapshot *before* the writer advances, and never overwrite it.** The
   procedure is explicit: run `verify-persistence-formats --archive N` while the writer and the
   current schema still describe the old version; it "retains exactly the types reachable from its
   roots, and removes source line numbers", and "refuses an existing destination, a version other
   than the current writer, invalid or incomplete schemas" (`historical-formats/README.md:60`).
   **Why it transfers:** a migration for August Trading's trade rows should be *archivable and
   re-runnable*; a migration that is only documented in prose is a migration nobody can re-verify.
   **UNIQUE.**

8. **The "one fact, one home" discipline in the schema graph: a change to a shared type moves many
   roots, and the record says so instead of pretending it was one event.** `2026-09-16-session-format-v4.md:90`
   — removing `tool-result` from the shared `ContentBlock` union "changes those reachable schemas
   without adding ten independent event protocols". **Why it transfers:** the same discipline
   August Trading already states in its AGENTS.md ("canonical single-source modules") is *enforced*
   here by a digest that mechanically propagates. **CONVERGENT.**

9. **A generated bilingual-pairing record as a CI gate.** Every document carries an `.i18n.yaml`
   with a hash of each section's English and Chinese blocks; editing one side without the other
   fails `pnpm run verify-translation-pairing`. The English file is the single source of the
   machine declaration and the verifier checks the Chinese declaration for *equality*.
   **Why it transfers:** if August Trading ever publishes user-facing docs, this is a cheap,
   machine-enforced way to keep two languages from drifting. **UNIQUE** (as an enforcement
   mechanism; the *idea* of mirroring is common).

10. **An honest, machine-checked limitation section in every document.** Each record says plainly
    what it does *not* prove: "an unchanged digest does not establish unchanged behavior"
    (`releases/README.md:79`), "Verification cannot establish how the record was authored or
    whether a human reviewed it" (`README.md:63`), "Opaque types such as `unknown` expose no hidden
    structure to compare" (`README.md:80`), "old applications were not replayed, complete codec
    behavior was not validated, and migration safety was not proved" (`releases/README.md:79`).
    **Why it transfers:** August Trading's own plan documents are careful about this, but the
    *placement* — a mandatory Limitations section inside the machine-checked artefact itself — makes
    it a gate rather than a courtesy. **CONVERGENT.**

11. **Degrade, never guess.** "Historical calls without a recorded relative target keep safe
    unavailable navigation" (`2026-10-05-ptc-operation-metadata.md:38`); "an absent principal means
    the owner" (`2026-10-13-user-rpc-principal.md:50`); "Readers that require a name treat an
    absent title as an unnamed task" (`2026-09-18-schedule-optional-title.md:38`).
    **Why it transfers:** a missing optional field must always have a *defined* fallback that is
    safe, and the fallback should be written in the change record, not invented at the read site.
    **CONVERGENT.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: the schedule's *persisted* shape is versioned
  separately from its *behaviour*, and the two are deliberately allowed to differ.**
  `docs/persistence-changes/2026-09-18-schedule-optional-title.md:38` makes the stored `title`
  optional on the `after`/`at`/`every` variants of `schedule/change` so a version-1 event written
  before titles existed "decodes and folds without one instead of being refused" — while "the
  Host task record still requires the member: the storage decoder rejects a stored task without it,
  and creation, update, and the schedule tools still require it." **Lesson for August Trading's
  `services/automation` cron store:** a persisted schedule row and the in-memory task model can
  have *different* requiredness, and the record that says so is the thing that stops the two
  from drifting. There is no evidence in this shard of catch-up, idempotency or a breaker — that
  lives in the `dsh-workflow-jobs-schedule` shard.

- **Human-in-the-loop approval: approvals are first-class persisted events, and the decision
  record survives independently of the conversation.** The root set includes
  `event:approval/asked`, `event:approval/decided` and `event:approval/policy` — three separate
  roots for *asking*, *deciding*, and the *policy* in force. They are in the V4 baseline
  (`2026-09-11-initial.md`) and unchanged through V4 (`finalized/v4.json`). The record is
  append-only event history, and the *policy* is its own event, so a decision can be audited
  against the policy that was actually active at the time. **Lesson for August Trading's
  `services/validation` and proposal-approval flow:** model the policy as a persisted fact, not as
  a code constant, and the decision is then self-evidencing.

- **Post-mortem / reflection loops: "don't fabricate history" is an explicit, recorded rule.**
  The job-lifecycle record says "historical sessions receive no fabricated job history"
  (`2026-09-30-job-session-lifecycle.md:42`) — a session that predates the feature gets no
  back-filled job rows. The unknown-child catalog does the same for *unreadable* history: children
  whose logs cannot be read are **retained** as `mode: unknown` rather than dropped
  (`2026-09-20-unknown-child-catalog.md:38`). **Lesson for August Trading's learning/reflection
  store:** a trade journal that cannot be parsed should become an explicit `unknown` row, not a
  gap — and back-filling "what probably happened" is forbidden.

- **Multi-agent: the subagent catalog is a *versioned membership log*, and the mode is part of the
  payload version, not a side-channel flag.** `mode: external` (child with no local session) and
  `mode: unknown` (child whose log is unreadable) are payload **version 2** alternatives; payload
  v0 is unchanged and migration emits v1 only for unknown children
  (`2026-09-20-unknown-child-catalog.md:38`, `2026-09-19-external-subagent-catalog.md:38`).
  The record also pins that "Creation writes one membership fact; execution and cleanup do not
  update it" — so a child's row is stable, and later behaviour is derived, not re-written.
  **Lesson for August Trading's `services/agents` roster:** a child's *state* is a projection; the
  roster row records *membership* once. Debate-vs-subagent efficiency is not covered in this
  shard.

- **Structured logs the model can query: the log is an append-only, typed event stream with a
  machine-readable inventory, and some events are deliberately *not* model-visible.**
  `event:workspace/changes` records the files a top-level turn changed and is "never model-visible;
  the Web changed-files card is its only consumer and reads the latest event per turn"
  (`2026-09-14-workspace-changes-event.md:38`). `event:web/deepseek-search-llm-request` is
  "log-only; no reader replays or interprets the body for behavior"
  (`2026-10-13-deepseek-search-thinking.md:38`). The storage here is JSONL on disk (the physical
  `JsonlHeaderLine` header plus one line per event) — no database. **Lesson for August Trading:**
  the trade journal is already an append-only row store; the transferable idea is the *separation*
  — mark a row as "for the human/UI, not the model" and keep it out of the model's context, exactly
  as `workspace/changes` and the DeepSeek search body are kept out.

- **Staying simple as features accumulate: the "same-version" whitelist is the anti-feature-creep
  mechanism.** The compatibility table is a *closed list* of changes that may happen without a
  format bump, and anything not on it demands a review. The corollary is stated too: "The
  classifier identifies established same-version cases and changes requiring compatibility review;
  it cannot decide semantic safety" (`README.md:61`). A second simplicity device is the
  `Dev Note` block that every record carries and that is "None." in all 100 documents — a small
  space reserved for maintainer context, kept separate from the machine data so it can never
  affect a digest (`README.md:80`).

---

## 4. Non-obvious decisions and gotchas

1. **A "same-version" decision is not automatically safe, and the tool will not make it for you.**
   The classifier flags the risky classes; a human must pass `--decision same-version` explicitly
   (`README.md:61-63`). And the CI check accepts a hand-edited record just as readily as a generated
   one — "Verification cannot establish how the record was authored or whether a human reviewed
   it." So the *process* is the control, not the tool.

2. **The archive deliberately shows history that today's rules would reject.**
   `releases/README.md:68` — "historical version 0 did contain structural changes without version
   increases" — and the backfilled records are explicitly "calculated using current rules for
   comparison only; it does not assert historical compliance, migration correctness, or runtime
   compatibility." A reader who sees `dsh-v0.1.2-alpha.1` change 52 roots at writer version 0 must
   not conclude the current process allows that.

3. **The two headers are not the same header.** The *logical* `SessionHeader` and the *physical*
   `JsonlHeaderLine` are separate roots with separate digests, and they genuinely diverge:
   V0's logical header requires `isSeeded` while the physical header stores optional `seedLength`
   (`historical-formats/v0.md:43`); V0 declares `version` as a broad `number`, not the literal 0.
   A reader who assumes one header will mis-read the other.

4. **A digest is a *declared type* digest, not a behaviour digest.** "Digests describe declared
   persistence types, not runtime validation or behavior" (`README.md:80`); comments, source
   locations, aliases and harmless reordering do not move it, but *compatibility annotations do*
   (they are recorded policy data). Unannotated version-1 snapshots keep their original
   fingerprint domain; policy-bearing graphs use a separate one — which is why `formatVersion: 2`
   appears in the schema snapshots from 2026-09-16 onward.

5. **The `types: []` array in most snapshots is not a bug.** Snapshots carry `roots` and a `types`
   pool; for the per-change records the changed roots' reachable types are inlined into the root's
   own node graph, so `types` is empty. The 55-byte release snapshots are
   `{ "formatVersion": 1, "roots": [], "types": [] }` — a *release with no structural change*.

6. **"Required on read" is a real, accepted cost.** `2026-09-13-working-directory.md` and
   `2026-09-14-image-offload.md` both add a new event root and both say older builds *refuse* such
   logs. The subsystem accepts that a new event type is a breaking change for old readers, and
   pays for it by having the format version stay put. The alternative — silently ignoring an
   unknown event — would lose data.

7. **A migration may be refused, and refusal is not a failure.** In the V3→V4 migration, "Missing,
   multiple, or unknown-version child descriptors skip that child's backfill; conflicting
   identities, timestamps, or modes refuse migration without publication"
   (`2026-09-16-session-format-v4.md:94`). Also: "Historical read opens prepare the result in
   memory. Write opens revalidate child membership and revisions before publishing" — a read must
   never mutate, a write must never publish a stale derivation.

8. **The bilingual mirror is machine-checked but the *prose* is not.** The English file is the
   single source of the machine declaration; the verifier checks the Chinese declaration for
   equality, and the `.i18n.yaml` sidecar records a per-section hash of both prose sides. The
   hashes detect *edits*, not *equivalence of meaning* — a human still has to keep the two in
   step. I verified the four `historical-formats` EN/ZH machine blocks are byte-identical
   (5089 / 5086 / 5291 / 5656 chars).

9. **The `SessionHeader.version` number and the `SESSION_FORMAT_VERSION` constant are different
   things.** "A broad `number` declaration cannot supply that constant"
   (`releases/README.md:77`); the release records cite the constant's source location
   (`packages/core/session/src/types.ts`: `export const SESSION_FORMAT_VERSION = 0`) as the
   evidence, not the type.

10. **There is no writer version 1 in the archive.** The captured tags use 0, 2 and 3
    (`releases/README.md:77`), so V1 is reconstructed from an intermediate PR tree
    (`historical-formats/v1.md:28`) — and that record explicitly says "no product release is
    invented for this record."

11. **A finalized checkpoint protects the *accepted* history but cannot prove it was never
    rewritten.** "Verification checks retained checkpoint hashes; it does not prove that the
    checkpoints and their authority record were never edited together" (`README.md:76`). Honest
    about its own limit.

12. **A record may be refreshed, but only under narrow conditions.** "An unaccepted terminal record
    can be refreshed explicitly; the command rejects baselines, records with dependants, and
    checkpoint-locked records before producing artifacts" (`README.md:76`). And "Two changes to the
    same predecessor require a single ordered history after integration" — the chain is a DAG with
    at most one successor per root.

13. **Physical encoding is deliberately *outside* the type inventory.** The packed Assistant rows
    (`text-chunks` / `reasoning-chunks` / `tool-call-chunks` with `seq0`, `time0` and a `dt` gap
    array where "For N members, `dt` has N−1 time gaps, which may be negative") are owned by a
    codec package, and the format record says so: "These physical body encodings are not additional
    roots in this declared-type inventory" (`historical-formats/v0.md:28`). The digest chain
    therefore says nothing about the physical layout — a reader must not conclude the on-disk bytes
    are covered.

---

## 5. Weak spots

1. **The digest is a weak proxy for "safe", and the subsystem knows it but leans on it anyway.**
   Every "same-version" decision ultimately rests on a *type* digest plus a prose argument, and
   the prose explicitly cannot be verified: "Verification cannot establish how the record was
   authored or whether a human reviewed it" (`README.md:63`); "Digests describe declared
   persistence types, not runtime validation or behavior" (`README.md:80`); "Opaque types such as
   `unknown` expose no hidden structure to compare." A payload hidden inside an `unknown` can
   change shape with no digest movement. A type-level gate is a *necessary*, not a *sufficient*,
   compatibility check.

2. **The historical archive is a self-inflicted mess of exactly the drift the current rules exist
   to prevent.** Writer version 0 saw 52-root structural changes, an event-key rename
   (`compact/*` → `compaction/*`), a source-kind rename
   (`workspace-instructions` → `agent-instructions`), a hook-dialect rename, a field added and
   removed within two tags (`permission/preset.origin`), and an envelope field added then removed
   (`ignorable`). The archive's own text admits it. Reading it is instructive, but it also means
   the 26-tag archive is a record of a period when the format was not disciplined — so a reader
   who treats "the archive says it was fine" as evidence will be misled, and the docs have to keep
   repeating that caveat.

3. **The scale of the machinery is disproportionate to the size of the thing being protected.**
   195 files, ~16.7 MB, 100 prose documents and 95 generated artefacts, 26 language-mirrored
   records, a finalization checkpoint, a four-file record format, three annotation markers, two
   inventory format versions, and a two-level digest (root + reachable type) — all to protect a
   JSONL transcript of a single-process desktop agent. For a project with a smaller surface (a
   trading app with a handful of record shapes) this is a lot of ceremony; the transferable core
   is the *acknowledgement record with an explicit decision*, not the whole apparatus. Note also
   that the 55-byte empty snapshots and the 64 KB bilingual hash sidecars are pure overhead.

4. **A few rules are stated but not obviously enforced.** The README says the CLI "requires that
   explicit choice before generating a flagged same-version record" and that CI accepts the recorded
   decision "whether the record was generated or edited manually" — so a hand-written record can
   assert `same-version` where the classifier wanted a review, and the tool will take it. And
   "the verifier reads the machine declaration once from the English file" — the Chinese file's
   declaration is compared, but the *prose* that constitutes the actual compatibility argument
   exists in two independently-edited copies whose only link is a hash, not a semantic check.

5. **Two facts are carried in prose that a machine could carry.** The *observed writer version* is
   recorded as free text in each release's evidence table and cited by source path
   (`packages/core/session/src/types.ts`: `export const SESSION_FORMAT_VERSION = 0`), rather than
   being captured from the source by the extractor — so a wrong constant would be faithfully
   recorded. Likewise "Historical source references retain file paths without line numbers" and
   "Source locations below refer to that historical tree, not to current files"
   (`historical-formats/v0.md:28`): a reader following a `path#TypeName` link has to know it points
   into a tree that no longer exists.
