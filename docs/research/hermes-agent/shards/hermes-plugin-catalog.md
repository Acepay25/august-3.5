# hermes-agent :: hermes-plugin-catalog

**Files in shard:** 763 (read: 763, skipped with reason: 0)
**What this shard covers:** the Hermes plugin *catalog* — 762 YAML manifests plus the
catalog `README.md` that defines them. Every YAML is one third-party (or
Nous-official) plugin entry: a pinned `repo` + 40-hex `sha`, a one-paragraph
`description` that doubles as a **disclosure** (what the plugin sends where, what
it spends, what it writes), a `maintainer`/`tier`/`category`, optional
`requires_hermes` / `known_issues` / `screenshots`, and a `capabilities:` block
declaring exactly which tools, hooks, middleware and env vars the plugin
registers. There is no code in this shard — it is the **registry and its
admission policy**, the place where a harness decides what third-party code it
is willing to run at all. The README's 17 numbered admission rules are the
load-bearing artefact: exact-SHA pins, no self-updating code, declared
capabilities must match reality, secrets only through Hermes's own routes, and
a `removed.yaml` blocklist that outlives the file's deletion.

## 1. File-by-file

The shard is overwhelmingly **Tier 2** (config): 762 machine-read manifests plus
one document. The set is the unit of understanding, so §1.1 explains the schema
and the policy, §1.2 is the per-file ledger (every file, one row), and §1.3
lists the handful of files that deserve more than a line.

### 1.1 What the catalog is, and the rules that make it mean something

`plugin-catalog/README.md:1-11` — "Curated, Nous-approved Hermes plugins…
Presence in this directory **is** the trust signal." The catalog is not a
search index; it is an allow-list. Every entry answers four questions a
consumer can act on without reading the plugin's source: *what is it*, *who
stands behind it*, *exactly which code* (the SHA), and *what does it reach*
(the `capabilities` block plus the disclosure paragraph).

`plugin-catalog/README.md:156-187` — the entry schema. Every field is either
**load-bearing** or explicitly cosmetic:

- `name` — the catalog key, `[a-z0-9_-]{1,64}`; also what the user searches,
  installs, and — for memory providers — what goes in `memory.provider`
  (`README.md:231-238`).
- `repo` + `sha` — the only fields that decide *what runs*. `sha` is a
  mandatory 40-hex exact pin; branches, tags and short SHAs are rejected by the
  loader (`README.md:18-21`).
- `description` — the *disclosure*. It is not marketing copy: admission rule 13
  requires network calls, reads outside the plugin's own data, shell commands,
  background processes and stored credentials to be stated here.
- `maintainer` / `tier` — `official` (NousResearch) / `verified` (Nous-verified
  vendor) / `community` (everything else). Only maintainers may set the first
  two, and **no CI check inspects the value** — the `/plugin-catalog/`
  CODEOWNERS review *is* the gate (`README.md:189-195`).
- `category` — the shelf: `desktop | memory | platform | web | tools | voice |
  automation | models | general` (`README.md:169-170`).
- `requires_hermes` — a SemVer floor; the loader **skips** the plugin on an
  older Hermes (`README.md:118-120`, rule 14).
- `version`, `image`, `screenshots`, `readme` — **cosmetic**. "none is parsed or
  used to pick what installs. The sha stays the release" (`README.md:197-198`).
- `capabilities` — `provides_tools` / `provides_hooks` / `provides_middleware` /
  `requires_env` (`README.md:182-186`). Rule 6 makes this a *security*
  declaration: validation fails the entry if the block does not match what the
  plugin actually registers at the pinned commit.

The 17 admission rules (`README.md:13-150`) are the interesting part, because
they are a *threat model written as a contribution guide*. The load-bearing
ones:

| # | Rule | What it forecloses |
| --- | --- | --- |
| 1 | Human-merged gate; no self-serve registry, no automated ingestion | supply-chain injection by a script |
| 2 | Exact 40-hex SHA pins are mandatory; branches/tags rejected | "latest" installs that can change under you |
| 3 | **No self-updating code** — no in-app updater, no signed-release downloader, no remote `plugin.js` loader | the pin becoming theatre: a self-updater lets an installed copy move to a commit nobody reviewed |
| 4 | SHA bumps are new PRs, re-reviewed like any other change | "routine" dependency bumps as a backdoor channel |
| 5 | Owner-or-major-contributor submissions, or a reviewed maintainer sweep | drive-by listings of unrelated repos |
| 6 | **Declared capabilities must match reality** — validation fails the entry otherwise | undeclared capability creep, treated as a security issue |
| 7 | The install scanner runs **at admission**: `dangerous` fails, `caution` warns and a human reads it | merging past an unreviewed warning |
| 8 | Desktop plugins stay inside the SDK surface — no prototype patching, no `eval`/`new Function`, no `import()` of anything but `@hermes/plugin-sdk`/`react`, no script injection, no reaching into the app's own markup (`data-slot`, `data-tour`, `data-testid`) | a renderer plugin with the app's full authority rewriting the UI |
| 9 | **No runtime overrides of Hermes core** — no `AIAgent.<method> = ...`, no `setattr(server, ...)`, no `sys.modules[...]`, no writes into a core module's tables | two plugins silently breaking each other on the same seam; every core release breaking both |
| 10 | Dependency security policy is the *plugin's*; Hermes's own 3-day `exclude-newer` age check does not cover plugin deps; bare floors (`>=X`, no upper bound) get asked for a floor + ceiling | a plugin's fresh dependency becoming Hermes's problem |
| 11 | **Credentials come through Hermes, never from files** — `agent.secret_scope.get_secret(NAME)`, `credentialed_provider_request` with `requires_auth`, OAuth declared under `oauth:` and signed in via `hermes auth add`; never read `.env`, `auth.json`, a vendor CLI's token file or a keychain | cross-profile secret bleed under multiplexing; a plugin becoming a second credential store |
| 12 | **Approvals and unattended runs are respected** — no auto-approving, no disabling guards, no spawning children that inherit YOLO / non-interactive mode; anything waiting for a person must fail cleanly or time out under cron | a plugin that hangs the cron runner or bypasses the human gate |
| 13 | Risky behaviour is disclosed | — |
| 14 | Compatibility metadata is truthful (`requires_hermes` is a SemVer floor, never a CalVer date, never newer than the current release) | a plugin that installs but cannot work |
| 15 | No skins or forks of bundled plugins; vendor-lookalike skins are not listed | brand confusion |
| 16 | One listing per plugin lineage — a fork only if materially different, and it must name its origin ("Derived from \<entry\>") | catalog bloat with renamed duplicates |
| 17 | **No unscannable executable payloads** — no ELF/Mach-O/PE/WASM, no committed `.pyc`/`.pyo` (including sourceless or hash-forged caches), no archives whose members are not reviewable source; native components must be built by the plugin repo's own public GitHub Actions and carry a build attestation verified against the pinned commit | a reviewer approving source they cannot read |

Three of these are unusually transferable to a single-seat trading app:
**rule 6** (declared capabilities must match reality — a manifest the runtime
enforces, not a comment), **rule 11** (one credential route, never a file
read), and **rule 12** (unattended runs must fail cleanly rather than hang).
`README.md:104-109` is the sentence a scheduled job in August Trading would
need written on its wall: *"Anything that waits for a person (a prompt, an OAuth
browser flow) fails cleanly or times out under cron, the messaging gateway and
other unattended runs instead of hanging the agent."*

**`removed.yaml` — the blocklist** (`README.md:214-229`) is a separate lifecycle
from delisting. A *removed* entry (security or policy) is recorded with a
reason and a date; the installer then refuses to install anything matching its
name or repo URL, a plugin that lands on the list after a user installed it
stops updating, cannot be enabled and is refused at load time. A *delisted*
entry (unmaintained, superseded, squatting a name, no longer meeting a rule) is
just a deleted file — users who already installed it are unaffected, and it is
welcome back once fixed. The distinction is the interesting design: **bad
things stay remembered, stale things do not.** A "delete the row" audit trail
would have left the malicious identity re-installable; a "keep the file forever"
policy would have punished every unmaintained plugin the same as a malicious
one.

The final README section, **Names** (`README.md:231-238`), is a whole namespace
collision lesson in one paragraph: a `memory`/`exclusive` entry must not reuse
another provider's name or a well-known upstream project's name, because two
providers registering the same `register_memory_provider` name make
`memory.provider` ambiguous — *whichever loads last wins*. Reviewers check the
**registered** provider name, not the file name.

### 1.2 Per-file ledger

One row per file: what the entry registers, what it reaches, and the one thing
worth stealing (if any). Paths are relative to the repo root.

| File | What it is / what it pins |
| --- | --- |
| `plugin-catalog/README.md` | The catalog contract: 17 admission rules (exact-SHA pins, no self-updating code, declared capabilities must match reality, one credential route, no core overrides, no unscannable binaries), the entry schema, and the `removed.yaml` blocklist. The single most valuable document in the shard. |
| `plugin-catalog/0bull.yaml` | Remote iPhone control + TikTok/YouTube posting via a hosted MCP; no code, skills only. Disclosure admits the server exposes money-spending rental tools that the skills tell the model never to call "but Hermes does not block". |
| `plugin-catalog/aave-mcp.yaml` | Aave V3/V4 over Aave's official hosted MCP; five workflow skills. Marked `untrusted`, so Hermes asks before the two write tools and refuses them in unattended runs. |
| `plugin-catalog/abstract-provider.yaml` | Model provider (GLM-5.3, DeepSeek-V4-Flash, Kimi-K3) over the OpenAI Responses API. Registers one provider and nothing else — the minimal possible plugin surface. |
| `plugin-catalog/accent-picker.yaml` | `official`: OKLCH accent picker for the Desktop status bar; live theme retint, colour is scratch state, never persisted. |
| `plugin-catalog/account-pool.yaml` | Multi-account credential pool (anthropic + openai-codex): fill-first rotation, a 5-minute balance timer, parking on a schedule, Telegram alerts on dead logins. Its `known_issues` are the most honest in the shard: "Hermes can let a parked account back into rotation early". |
| `plugin-catalog/account-switcher.yaml` | Windows-only: switches which Codex/Claude login every profile uses; refuses while any profile is busy, restores the previous selection if a step fails, and **writes a receipt saying whether the switch took effect**. |
| `plugin-catalog/acedatacloud-media.yaml` | 32 media-generation tools (Suno, Veo, Seedance, Midjourney, Flux…). One-line JSON manifest. Disclosure: each call spends credits **with no Hermes approval prompt** and the model may pick the costly option. |
| `plugin-catalog/acedatacloud.yaml` | Ace Data Cloud GPT model provider with streaming + tool calling; `known_issues` admits the picker still only offers gpt-4.1-mini/gpt-4.1. |
| `plugin-catalog/adaption.yaml` | Dataset import/augmentation/translation/fine-tuning via a hosted MCP; skill-only. "the skills request a cost estimate first, Hermes does not enforce it" — admission rule 6 in action. |
| `plugin-catalog/adspirer.yaml` | Google/Meta/TikTok/LinkedIn/Amazon ad campaigns via hosted MCP. "confirm-before-spend is enforced by skill instructions, not by Hermes" — the same honesty as adaption. |
| `plugin-catalog/advisor.yaml` | **A persistent second model reviews every agent turn** and emits `[NIT]`/`[CONCERN]`/`[BLOCKER]` notes, *held back until a later review repeats them* so one-off remarks don't interrupt the primary agent. One extra model, not a committee. |
| `plugin-catalog/adwhispr.yaml` | Competitor-ad research + ad cloning + paused campaign launches. Server marked untrusted → Hermes asks before every write/spend tool and refuses them in cron. Campaigns always created paused, two-step confirm server-side. |
| `plugin-catalog/afterforge.yaml` | **Local-first regression workbench turning agent failures into reviewed, evidence-backed checks** — 8 `fixlab_*` tools + `post_tool_call`/`on_session_end`/`pre_verify` hooks. The clearest "post-mortem becomes a test" design in the shard. |
| `plugin-catalog/agent-analytics.yaml` | Dashboard-only read plugin; declares zero tools/hooks. Smallest possible surface. |
| `plugin-catalog/agent-batch.yaml` | Parallel task orchestrator: Hermes phases a task list into dependency-ordered groups, each phase dispatches one coding agent per task to a GitHub Actions workflow. Dispatch is always a confirmed click in the panel — the model may plan, never dispatch. |
| `plugin-catalog/agent-hint.yaml` | Injects an `X-Agent-Hint` header (base64url JSON: session id, call index, lifecycle state, soft priority, cache-pinning hint) on main LLM requests. Request bodies are never modified. Lets a scheduler pin a session to the instance already holding its KV cache. |
| `plugin-catalog/agent-hold-em.yaml` | Poker against three isolated zero-tool Hermes profile agents. Each opponent is a real agent that spends the user's provider tokens. |
| `plugin-catalog/agent-importers.yaml` | `official`: imports an OpenClaw / Claude Code / Codex CLI / Cursor setup into Hermes. **Always previews first and asks before applying**; secret-looking MCP env vars are stripped and listed, not imported. Writes a migration report with item backups + a zip restore point. |
| `plugin-catalog/agent-janitor.yaml` | Finds background processes the agent left behind, attributing them to the originating tool call via `agent-ledger`. **Dry-run by default** — nothing is killed until `policy_mode=enforce` is written by hand; each kill re-reads the cmdline first (PID-reuse check); exempt list + user whitelist; fails open. |
| `plugin-catalog/agent-ledger.yaml` | **Write-ahead ledger for agent side effects** in local SQLite; records args (≤4000 chars) + a 300-char result digest of every state-changing tool call; injects a warning listing this session's unconfirmed calls into the next turn; optional policy engine (off by default) can refuse matching calls before they run. |
| `plugin-catalog/agent-log.yaml` | Readable `agent.log` viewer in the desktop status bar: live colour-coded feed of API calls, tools, turns, fallbacks, warnings, errors, with per-call tokens/latency/cache. |
| `plugin-catalog/agent-mail-gateway.yaml` | Skill-only email over a self-hosted gateway: reading, replying, forwarding, attachments, calendar invitations — and a skill for **prompt injection in email content**. Gateway enforces per-mailbox allow lists. |
| `plugin-catalog/agent-station.yaml` | Read-only Desktop page for the focused chat: main agent + subagents, background commands, and a **Replay of file edits**. Reads `state.db` read-only. |
| `plugin-catalog/agent_memory_es.yaml` | Three memory tools — `recall`, `retain`, `reflect` — over episodic/semantic/procedural tiers with hybrid BM25+kNN, and server-enforced private/team/common visibility. |
| `plugin-catalog/agentchat.yaml` | Peer-to-peer agent messaging. "Send is a tool call, never automatic"; the agent decides whether to reply. |
| `plugin-catalog/agentplaybooks-memory.yaml` | Private hosted memory: native recall, explicit write mirroring, archive, history. Each turn's query is sent to agentplaybooks.ai. |
| `plugin-catalog/agentplaybooks-tools.yaml` | Connects hosted playbooks as MCP/OpenAPI tools; the `apb` CLI does the work and **local writes require `--apply`**; `apb push --apply` uploads config (secret *references*, not values). |
| `plugin-catalog/agentwalletapi.yaml` | Custodial EVM/Solana wallet bridge. Disclosure: the model can create wallets and send transfers **with no Hermes confirmation prompt**, and `wallet_create` ships the export passphrase to a third-party API. |
| `plugin-catalog/agora.yaml` | **Self-driving multi-agent team**: each role is a real Hermes profile with its own SOUL.md; they discuss and *vote*, and the adopted conclusion becomes execution tasks parented to the motion so context reaches workers via Hermes's own parent handoff. A heartbeat cron wakes the leader. `--yolo --accept-hooks` only when the project explicitly opted in; default off means flagged writes fail closed. |
| `plugin-catalog/ai-usage-tracker.yaml` | Live subscription-quota windows for every routable provider, as a desktop page + status-bar chip, with a per-profile picker. |
| `plugin-catalog/aichipmunk.yaml` | Pairs the machine's bots with a mobile app: a scannable code carries host, profile and API key. The full key is returned only to an authenticated dashboard caller; masked in lists. |
| `plugin-catalog/aihubmix.yaml` | One OpenAI-compatible provider over 400+ models; the `/model` picker is **filtered to tool-capable routes**. |
| `plugin-catalog/aistupidlevel.yaml` | Smart router: `auto-tooling` sends each request to whichever model currently scores best on continuously re-run benchmarks, using the user's own provider keys. |
| `plugin-catalog/alans-way-computer.yaml` | Computer-use provider: a router child over stdio drives the user's desktop; **every input action still goes through the approval gate**; captures keep element numbers stable across replies and "a truncated list never treats unseen controls as removed". Screenshot omitted from the model when named controls cover ≥35%. |
| `plugin-catalog/alans-way.yaml` | The single richest entry (30 KB of disclosure). Idle check-ins with exponential backoff, opt-in morning briefs with jitter, a browser **commit-approval gate** bound to a single-use receipt, `commit-decisions.jsonl` audit log, cross-bot proactivity with bounded digests + 0600 files + 48 h hash retention, and a hard "operator enables / model may only narrow" rule. |
| `plugin-catalog/alice-voice.yaml` | Yandex Alice voice input → Telegram. The secret URL path is the *only* authentication ("Yandex request signatures are not checked") and the disclosure says so. `known_issues` admits "no durable queue, exactly-once guarantee, or built-in global rate limiter". |
| `plugin-catalog/ample.yaml` | Deploy built sites to public HTTPS URLs + read build/runtime logs. A `pre_tool_call` hook sends **every delete and the first publish of each folder** to the approval gate; already-published folders (recorded in plugin state) skip it. |
| `plugin-catalog/anatomy-museum.yaml` | Gallery of community figures; "Open figure" downloads third-party HTML and runs its JS inside the **Desktop SDK sandbox (opaque origin, scripts only)**. |
| `plugin-catalog/ando-platform.yaml` | Agent-to-agent platform: authorized messages become Hermes turns, the final reply + attachments go back via short-lived single-use links; the agent key file is mode 600. |
| `plugin-catalog/android-emulator.yaml` | Headless Android emulator control: 18 tools incl. `emu_shell`, `emu_gps`, `emu_battery`, `emu_network` (simulation knobs, not just observation). |
| `plugin-catalog/antenna.yaml` | Signed agent-to-agent messaging. Background delivery runs **only in non-YOLO sessions**; peer identity keys and holds live in 0700/0600 files; "policy and storage commands rewrite config.yaml (comments and formatting are lost)". |
| `plugin-catalog/antigravity-agy.yaml` | Runs Hermes on a Google subscription through the official `agy` CLI; Hermes tools are exposed to `agy` via an **inventory-only MCP server** and every tool call is handed back to Hermes. "Fails closed on any non-Hermes tool step or silent agent fallback." |
| `plugin-catalog/antigravity-oauth.yaml` | Same idea via OAuth. When the model reaches for an `agy`-native tool, the call is re-issued as the matching Hermes tool so it runs under Hermes approvals; "agy never executes tools on the host, and unmapped native tools are blocked". |
| `plugin-catalog/antigravity-subscription-directsdk.yaml` | Direct-SDK path: streams tokens, persists multi-turn trajectories, maps thinking effort, reports quota in `/usage`, aborts reported native tools. **Strips credential-looking env vars before spawning the child** (`ANTIGRAVITY_ENV_STRICT` for an allow-list). |
| `plugin-catalog/anyapi.yaml` | Third-party relay over 400+ models; `/model` picker filtered to tool-capable routes. Disclosure says the relay sees prompts, tool results and the API key. |
| `plugin-catalog/anyrouter.yaml` | Another model gateway; `anyrouter/hermes` is **AnyRouter's own meta-model, not a Nous Research model** — a naming disambiguation in the entry itself. |
| `plugin-catalog/anysearch.yaml` | Web search + extraction with **two real-time fallback chains**: when the primary backend fails (Exa quota, Firecrawl timeout) the same call is served by a 1,000/day free tier. |
| `plugin-catalog/aphrodite.yaml` | CCR compression plugin: 28-type classifier, 13 tools, TOML-driven templates. `pre_tool_call` auto-backgrounds long terminal commands; `aphrodite_prefetch` reads named files into its store but **refuses `.env`, `auth.json`, `~/.ssh` and the Hermes home**. |
| `plugin-catalog/apify.yaml` | Apify marketplace: discover / run / collect Actors, plus a backend for the built-in `web_search` and `web_extract` tools. |
| `plugin-catalog/approval-ledger.yaml` | **JSONL ledger of every approval prompt** (rule label, surface, answer, timings; no command text, no session key) → how often each rule asked, approved/denied/unanswered, and how long a human took, per rule/surface/day. Trimmed to 5,000 rows past 2 MB. Observer only. |
| `plugin-catalog/ard-kit.yaml` | Agentic Resource Discovery: search a local tool catalog by *intent*, inspect an entry to get its invoke command. No catalog ships — the first call returns an explicit error naming the command that builds one. |
| `plugin-catalog/artifact-relay.yaml` | Publish/read private Markdown or HTML reports through a self-hosted Artifact Relay server (2 tools, 1 token). |
| `plugin-catalog/artifacts.yaml` | Private library of finished documents with **explicit, expiring, revocable guest links per artifact**. `artifact_download` refuses approval-required paths even with `overwrite=true` and writes atomically through a temporary sibling. "Revocation cannot recall copies." |
| `plugin-catalog/aside-browser.yaml` | Uses the signed-in Aside browser as Hermes's browser. `pre_tool_call` hook *blocks Hermes's built-in browser tools* while Aside is ready — one browser, one policy. |
| `plugin-catalog/author-feed.yaml` | **Watch one account** (cron): first run only records what is already there; one run reads at most the latest 3 pages; a "possible-miss notice" fires **at most once in 24 hours**; under `plugins.isolation: host` the watch cannot run and says so on every run; a leftover job after uninstall must be removed by hand. |
| `plugin-catalog/auto-pin.yaml` | Auto-pins new interactive sessions and forks; cron/one-shot/subagent/messaging sessions are left alone. Each automatic pin is recorded in `auto-pin/ledger.txt`. |
| `plugin-catalog/aux-ledger.yaml` | **JSONL ledger of Hermes's auxiliary LLM calls** (titling, compression, vision, approval): tokens, time and failures per task/model/provider/day. Metadata only — ids, models, timings, token counts, no prompt or response text. Same 5,000-rows/2 MB trim. |
| `plugin-catalog/background-review-watch.yaml` | Status-bar chips for the background self-improvement review and batch compaction: running/done/**stale** with live elapsed time, a turn-countdown fill bar, a compaction chip carrying the committed reduction or the failure class, and review-overlap diagnostics. |
| `plugin-catalog/beam.yaml` | End-to-end encrypted data/messaging between agents on a Bittensor subnet, with transfer **estimate / start / status / list / cancel**. |
| `plugin-catalog/bento.yaml` | Email marketing with **three write tiers** (T1 ungated, T2 token-gated, T3 dry-run-confirm + hard guards) and a `pre_tool_call` approval hook. Disclosure admits the approval prompt asks no human under YOLO / approvals off / cron. |
| `plugin-catalog/better-session-appearance.yaml` | Per-session colour + an idle glyph so rows are scannable. Pure presentation plugin. |
| `plugin-catalog/betterdb.yaml` | Long-term memory on Valkey: completed turns are embedded; the next turn recalls by a **composite similarity/recency/importance score**. `remember` / `recall` / **`forget`** tools. Plaintext `http://` to a remote host is refused. |
| `plugin-catalog/bharatcode-provider.yaml` | Free-tier OpenAI-compatible provider — and the disclosure states that outside paid Pro it may retain private prompt/response logs, and that a flagged account gets up to 100 prompts sampled. |
| `plugin-catalog/bilinc.yaml` | Hosted memory **with a full history: what the agent remembered, when it changed and why** — `recall` / `remember` / **`revise`** / `forget`. Secret-looking strings are redacted before sending. |
| `plugin-catalog/billing.yaml` | Status-bar usage widget: remaining credits + plan-usage percentage. |
| `plugin-catalog/biomimetic-brain.yaml` | 25 subsystem state files folded into one `brain-state.json`, 4 maintenance passes, and a **read-only PROCEED/CAUTION/VETO gate whose refusals name the numbers behind them**. A subsystem that stopped updating reports *stale* rather than asserting an old number. |
| `plugin-catalog/birkin-mnemosyne.yaml` | Local Markdown memory provider, multilingual lexical recall, profile-local durable notes. **Create-only writes are limited to primary agent contexts** — subagents may read but not write. |
| `plugin-catalog/blackbox.yaml` | **Checks every tool call and model request against a threat graph** (prompt injection, dangerous commands, malicious packages, phishing, drainer indicators) plus local rules that keep the agent away from **wallet stores, seed phrases, private keys and exchange API keys**. Audit mode records; block mode refuses. Community findings only ever flag. |
| `plugin-catalog/blender.yaml` | `official`: Blender Lab MCP over stdio pinned to upstream v1.0.3. "Server discovery does not prove scene readiness." |
| `plugin-catalog/blinkenbar.yaml` | Supercomputer light banks driven by system telemetry and live agent activity. Pure showpiece. |
| `plugin-catalog/boardstate.yaml` | Agent-built live board: tabs, KPI cards, charts, live Hermes data, 19 `boardstate_*` tools **including `boardstate_undo`**. Local Node sidecar on loopback with a per-spawn nonce. |
| `plugin-catalog/bot-cabinet-v2.yaml` | Suggests the smallest setup that solves a job (one chat / a skill / a routine / a Bot / a crew) and **shows which answers led there**. "Deletes only profiles it created that you have not changed" (it hashes profile files to track what it made). |
| `plugin-catalog/bot-forge.yaml` | "Say *make me a \<role\>*" → a complete Bot Mode Bot (SOUL.md, memory, tools, skills, routines, gateway), tested **with rollback**; then a crew in one call. The companion hook is installed into each managed profile, never the root profile. |
| `plugin-catalog/brain-graph.yaml` | Local Markdown vault for Desktop: notes, wikilinks, search, recycle bin, interactive graph. |
| `plugin-catalog/brave-search.yaml` | Brave Search API as one live web-search tool. (Note: its `requires_env` is `[{name: <literal>}]` — a malformed entry, see §5.) |
| `plugin-catalog/brethof-brain.yaml` | Memory provider that puts **the memory's briefing in the system prompt at session start**, recalls ambiently every turn, and archives every turn. One memory shared across the user's other agents. |
| `plugin-catalog/bridge-adapter.yaml` | JSON-file bridge: services write to `inbox/`, the agent writes to `outbox/`. **Presence of a registry/manifest = registered; `rm` = unregistered** — registration without a daemon. |
| `plugin-catalog/browser-toggle.yaml` | One titlebar button that opens/hides the built-in browser by pressing the shortcut. Front-end only, no agent calls. |
| `plugin-catalog/browserless.yaml` | Cloud browser provider: **one browser per task**, a local CDP multiplexer shares it, the browser is reconnected after network drops and closed when the task ends. Falls back to a local browser if the session can't start. |
| `plugin-catalog/browserpaw.yaml` | Drives the user's *real* Chrome profile (logged-in sessions, cookies) through 16 tools. The README sample enables the full 50-tool profile — in-page JS, HttpOnly cookie reads, raw CDP — as native Hermes tools. |
| `plugin-catalog/bubblewrap.yaml` | `official`: every terminal command runs in its own `bwrap` sandbox — read-only root, writable workdir, SSH keys / cloud credentials / Hermes home hidden, agent and docker sockets masked, per-command memory/CPU/process limits. Honest limit: "File tools … still run on the host and are not confined". |
| `plugin-catalog/bunny_space-platform.yaml` | Chat-platform gateway. **Refuses to dispatch third-party content unless the platform's effective toolset is restricted to read-only** (including MCP and plugin toolsets). `BUNNY_SPACE_ALLOW_ALL_USERS` makes the connector refuse to connect at all. |
| `plugin-catalog/burnclock.yaml` | Status-bar chip with provider balance and **runway**, read from a separate CLI's local cache; polls a read-only `cat` every 60 s. |
| `plugin-catalog/by2kb.yaml` | Intercepts gateway messages containing a video URL; a *bare number reply* within 1 h of a recommendation list is treated as a selection. |
| `plugin-catalog/camofox-human-auth.yaml` | Human-controlled authentication (login, SSO, MFA, OTP, CAPTCHA, device confirmation) in the browser. Never changes an existing browser provider automatically. |
| `plugin-catalog/carbonvoice-platform.yaml` | Chat gateway with Socket.IO + REST-polling fallback. **Persists a cursor to disk so messages received while Hermes was offline are processed on the next startup.** (Its own `description` is truncated mid-word in the repo and its `requires_env` is a literal `- name` — see §5.) |
| `plugin-catalog/cashew.yaml` | Persistent thought-graph memory with local embeddings, **organic decay**, and autonomous "think cycles". |
| `plugin-catalog/cdp-manager.yaml` | Local Chrome CDP debug ports in the status bar (probe, launch, stop, recheck), plus a managed port Hermes keeps alive; detects and repairs a wedged Chrome profile-picker launch. |
| `plugin-catalog/channel3.yaml` | Product search across 100M+ items; a server-issued `thread_id` links searches within one conversation. Buy buttons open redirect links in the browser; nothing is purchased in-app. |
| `plugin-catalog/chat-studio.yaml` | Offline chat customisation. Disclosure: "injects a stylesheet that restyles the Desktop chat transcript … keyed on app data-slot selectors, so a Desktop update can break the styling" — a direct rule-8 near-miss, admitted. |
| `plugin-catalog/chatto-platform.yaml` | Chatto team-chat gateway (ConnectRPC out, binary-protobuf WebSocket in). (Also carries the malformed `- name` `requires_env` and a truncated description.) |
| `plugin-catalog/cheatsheet.yaml` | Title-bar cheatsheet: describes what you want to do and points to a **real command or a cited passage**; live slash commands, plugins, MCP servers, plus passages from *this install's* docs. |
| `plugin-catalog/chronicle.yaml` | Local-first memory **and memory-aware context compression** in SQLite: every turn captured, beliefs extracted **with provenance**, answers with raw-tier fallback and **abstention**, scoped conclusions, and **lossless context compression with a restorable record**. One shared core registers both the memory-provider and context-engine slots. |
| `plugin-catalog/chutes-provider.yaml` | Chutes model provider (API key) with a `/models` catalog probe. |
| `plugin-catalog/cjk_sanitizer.yaml` | A `transform_llm_output` hook that strips unwanted Chinese/Cyrillic from model output while preserving Hangul and Kana. Output sanitation as a hook, not a per-call site. |
| `plugin-catalog/claude-code-theme.yaml` | Unofficial Claude Code lookalike theme with a **context-window meter beside the model switcher**, reading `session.usage` through the SDK. |
| `plugin-catalog/claude-subscription-directsdk.yaml` | `official`: runs turns on a Claude Pro/Max subscription via the official Claude Code CLI. "Checks for it at load, in `hermes model`, in the pickers and **before every request**, and refuses cleanly with the install hint when it is missing." |
| `plugin-catalog/clinepass.yaml` | Model provider with live model discovery plus a curated fallback catalog. |
| `plugin-catalog/cliproxyapi-provider.yaml` | Discovers each CLIProxyAPI provider group and registers one profile per group on the wire that group accepts. Known limit: Hermes strips only the key env vars a *registered provider* declares, so the management key stays readable by agent shells. |
| `plugin-catalog/cloudflare-sandbox.yaml` | Terminal/file/`execute_code` run in Cloudflare Containers; the workspace is saved to a snapshot when idle. Host env vars, skills and credentials are **not** copied in; dangerous-command approval stays on. |
| `plugin-catalog/cloudflare-web-search.yaml` | Backend for the *existing* `web_search` tool (Ceramic/Exa/Linkup). Its `known_issues` is a real cache bug: "the shared search cache omits profiles and routing settings, so repeated queries can reuse another profile's result or an earlier provider, account, gateway, or BYOK route" → set `web.cache_enabled: false`. |
| `plugin-catalog/cloudflare-workers-ai-provider.yaml` | Workers AI as a model provider: 16 models with function calling, Cloudflare's own context windows, reasoning effort per model, and "a clear message when a free-plan account picks a paid-plan model". |
| `plugin-catalog/coder.yaml` | Runs terminal commands inside an existing remote Coder workspace; starts a stopped workspace automatically; **forwards only the env vars you list**. |
| `plugin-catalog/codex-chat-look.yaml` | Catppuccin theme with gateway/profile switching; a palette command rewrites a *native* setting instead of overriding layout. |
| `plugin-catalog/codex-truly.yaml` | **Gives a model the context window the backend actually accepts, not the one its catalog advertises.** Writes scoped `model_overrides.<provider>.<model_id>.context_window` entries through a documented resolution step (no core patch) and ships a probe that bisects the API, "because the refusal is a late SSE event, not an HTTP error". Defaults to 900,000 and **clamps to 918,000 rather than promising more**. |
| `plugin-catalog/cognee.yaml` | Knowledge-graph memory shared across the user's other agent plugins; `on_pre_compress` / `on_memory_write` hooks; **turns the server could not take are queued** in `~/.cognee-plugin`. |
| `plugin-catalog/cognition.yaml` | Session-end memory: facts regex-extracted at session end into a local SQLite queue + JSON commit log, with **fetch-first merge, per-entry provenance and budgeted prefetch**; a read-only `cognition_dream` consolidation pass. |
| `plugin-catalog/colorado-traffic.yaml` | Live highway events with no API key. "Separates incidents happening now from scheduled work and unverified Waze reports" — data-confidence tiers, not one flat feed. |
| `plugin-catalog/command-ledger.yaml` | JSONL ledger of the slash commands you run: how often each was used, its share, in how many sessions, per command/platform/surface/day. Stores a **12-digit hash of the session key**, never the key itself, and no arguments. |
| `plugin-catalog/command-tray.yaml` | Tray of the terminal commands the agent ran, with exit code, workdir and a **160-char redacted output preview**. |
| `plugin-catalog/commandcode-oauth.yaml` | CLI-key model provider with a live OAuth catalog bridge, plan limits and **failover classification**. |
| `plugin-catalog/comment-scraper.yaml` | Reads JSON exports of Reddit/HN threads from `~/Downloads` via a local stdio MCP; never writes, no network. |
| `plugin-catalog/compartment.yaml` | Encrypted, fully offline memory (AEAD vault incl. vectors), bundled embedding model, exact hybrid search, one vault shared with any MCP client. |
| `plugin-catalog/completion-sound.yaml` | Picks the turn-complete sound, with a different one at night. Known issue: Hermes's own sound still plays alongside until core gains a way to turn it off. |
| `plugin-catalog/composer-modes.yaml` | Ask/agent/plan/debug modes. "The mode's operating note reaches the model **inside the turn's model-facing bytes, never the bubble, transcript or session titles**", and ask mode is **enforced read-only on the tool side**. |
| `plugin-catalog/context-audit.yaml` | **Context-window forensics**: per-turn token estimates, the single largest tool output per turn, oversized tool calls (args > 50 KB), compaction events — metadata only (tool name, byte length, ids, timestamps), never args or results. `/context-audit` prints the top 5 context eaters **with one mitigation per entry**. |
| `plugin-catalog/corpus.yaml` | US-law search over 571k+ provisions + LLC/nonprofit formation. "Checkout requires **exact-amount confirmation from the user in the current turn**." Filing stays human-gated. |
| `plugin-catalog/cortexlayer.yaml` | Page-linked long-term memory wired into per-turn recall; adds a **pre-compress checkpoint so evidence the compaction would drop is saved first**. |
| `plugin-catalog/covision.yaml` | Read-only meeting / assigned-task / published-knowledge tools over a hosted MCP. No key stored in the plugin. |
| `plugin-catalog/crawl4ai.yaml` | Self-hosted Crawl4ai extraction backend. |
| `plugin-catalog/crew.yaml` | One `/crew` message becomes verified work on a kanban board: a coordinator owns each card **until its proof command exits 0** — one writer per card, an independent verifier, a **hard token budget per card**. Flagged or changed proofs wait for the owner (`/crew-proof`). Agent-written per-role lessons are injected into later crew turns. |
| `plugin-catalog/cron-bulletin.yaml` | A central Desktop inbox for reports produced by local cron runs. |
| `plugin-catalog/crypto-prices.yaml` | Live crypto ticker in the status bar (CoinGecko, no key). |
| `plugin-catalog/cua-spaces.yaml` | `verified`: runs terminal/file/code (and on 0.22.3+ Bot Desktop, computer_use, browser) inside an isolated, watchable Space. Default `space: create` = a fresh disposable Space per session, deleted at exit — **and a disposable sandbox skips the dangerous-command prompts**; a Space you name is never deleted and keeps them. |
| `plugin-catalog/cursor-acp.yaml` | Cursor subscription models via the Cursor CLI's ACP server. Rewrites `.cursor/cli.json` in a private workspace every run with a **deny-all list** (Read/Write/Shell/WebFetch/Mcp) so Cursor's own tools cannot reach host files, and **reports `usage=None` so proactive context compression keeps working**. |
| `plugin-catalog/cursor-provider.yaml` | Cursor model provider via the proprietary SDK; "Cursor built-in tools and MCP are requested off and **Hermes keeps tool execution and approvals**". |
| `plugin-catalog/cursor-sdk.yaml` | Experimental Cursor Agent SDK transport. "Cursor-native shell/file tools are denied by a fail-closed project hook and the run is cancelled if one fires, but **that enforcement is not proven in every Cursor runtime**." Per-request workspace and conversation state stay on disk under `runtime/`. |
| `plugin-catalog/custodian.yaml` | **Autonomous operations monitor**: scans gateway logs, cron jobs, skill journals and data dirs, classifies findings against a **27-fingerprint registry, auto-repairs Tier 1 problems, escalates the rest, and keeps an append-only issue ledger**. `/custodian init` registers 3 recurring cron jobs (deep scan 4×/day, cron-health 4×/day, escalation runner every 30 min on weekdays). No network I/O, no credentials. |
| `plugin-catalog/custom-dangerous-patterns.yaml` | User-defined regexes over the approval system: **block** patterns go to the human approval gate, **deny** patterns block immediately. "Modifies no Hermes internals." |
| `plugin-catalog/darkmoon.yaml` | Triage a pentest findings file (JSON/SARIF): filter by severity and proof status, severity-sorted summary, and a **pass/fail gate for a release**. Read-only, offline, stdlib only, 10 MB cap. |
| `plugin-catalog/dashboard-auth-feishu.yaml` | Feishu/Lark OAuth for the web dashboard, admitted by tenant + open_id allow-list. Stores only tenant/open_id/display name in a 0600 SQLite file (no upstream tokens); upstream PKCE is not used (confidential client with single-use cookie-bound state). |
| `plugin-catalog/dashboard-auth-ldap.yaml` | LDAP/AD password login verified by an LDAP bind; never stores passwords; requires `ldaps://` or StartTLS. Honest limits: "logout cannot revoke them; group removal and disabled accounts are not re-checked until the refresh token expires". |
| `plugin-catalog/dashboard-button.yaml` | One-click access to the web dashboard (sidebar row, self-loading page, live-dot status chip). |
| `plugin-catalog/dashscope-image.yaml` | Wan image generation via Alibaba Cloud Model Studio; token-plan and PAYG keys. |
| `plugin-catalog/dashscope-video.yaml` | HappyHorse video generation via the async task API. |
| `plugin-catalog/davinci-resolve.yaml` | 14 Resolve tools: timelines, markers, media import, render status, FCPXML/CSV export. |
| `plugin-catalog/day-panel.yaml` | A "Today" page built from a YAML list of sources (your own JSON-printing programs, `gh` PRs, one read-only MCP tool, provider limit windows). Merging a PR is off by default and needs a preview plus a **confirmation pinned to the head commit**. |
| `plugin-catalog/deadbolt.yaml` | Reviewed artifact writes through a local sidecar: **new files only, existing parent directories, 32 KiB request limit, five-minute exact approvals**. Boundary stated: only this plugin's commit route is gated. |
| `plugin-catalog/debug-desk.yaml` | Today's git digest plus the last failed terminal command, with an optional local LLM summary. |
| `plugin-catalog/deepgram-voice.yaml` | Deepgram Aura TTS and Nova STT as voice providers. |
| `plugin-catalog/deepinfra-sandbox.yaml` | Terminal backend in billable DeepInfra microVMs. Disclosure: it uploads the Hermes skills, cache and **skill-registered credential files** to the sandbox, and dangerous-command approval is skipped inside it. |
| `plugin-catalog/deepseek-search-fetch.yaml` | Backend for the built-in `web_search`/`web_extract`. Its `known_issues` states the deadline contract precisely: multi-URL extracts run sequentially to `min(extract_deadline, web.extract_timeout - 1.5s)`, bodies are aborted at the deadline, and **the pages already fetched are returned**. |
| `plugin-catalog/deepseek-whale.yaml` | Live DeepSeek peak/off-peak pricing in the titlebar: blue ×0.5 off-peak, grey PEAK at full price, countdown on click, 30 s repaint, no key. |
| `plugin-catalog/deferred-questions.yaml` | **Durable non-blocking questions with exact answer binding**; a question marked `continue_agent` resumes that chat's agent with the user's answer. Only `dq <id> …` answers are consumed from the stored recipient. |
| `plugin-catalog/degeneracy-guard.yaml` | Asks the user to confirm a tool call whose arguments look like a **repetition loop rather than data** — through the approval gate, where **denied or unanswered means refused**. Flagged output is replaced with a short notice; long sessions warn. |
| `plugin-catalog/deja-memory.yaml` | Memory harvested from the coding sessions already on the machine (Claude Code, Codex, Cursor, Hermes), including history from before it was installed. No model, no key, no server; nothing leaves the machine. |
| `plugin-catalog/desensitize.yaml` | **Reversible placeholder masking**: PII and business-sensitive entities (names, companies, addresses, file paths, magnitude figures) are replaced *before* the message reaches the model and restored in the reply. Two layers — optional LLM semantic pass plus a **sub-millisecond regex fallback that keeps the conversation working when the model is unavailable**. |
| `plugin-catalog/deskrpg.yaml` | Virtual-office gateway (profiles, kanban, cron, artifacts, NPC skills). Honest: one feature "needs a review-policy API that upstream Hermes does not ship … and that feature stays inert on upstream". |
| `plugin-catalog/devin.yaml` | Delegates coding to the Devin CLI with live progress cards. Every model-initiated launch goes through Hermes approval; **unanswered card prompts are denied after 300 s by default**; provider/bot/tool secrets are stripped from the child environment. |
| `plugin-catalog/devkit.yaml` | A scratchpad of named buffers the agent edits in place instead of writing a new temp file per revision; promoted to real files only through `write_file`; removed when the chat is deleted, plus idle folders older than `idle_days` (default 90). "Adds a short placement rule (**about 120 tokens**) to each turn's user message." |
| `plugin-catalog/dexio.yaml` | Shared-wiki memory: matching wiki pages are injected before each turn; search/read/write/edit/append tools. "Nothing is captured automatically: no transcripts or turn logs." |
| `plugin-catalog/diaktoros.yaml` | Unattended PR review between **two different agents** (one pushes fixes, another reviews): rounds are capped in verdicts, a watchdog reports silent stalls, and **the loop never merges**. Runs agent turns inside bubblewrap (no network, no credentials); "Nothing runs until you arm a loop." |
| `plugin-catalog/diff-review.yaml` | Scans git diffs for debug prints, hardcoded secrets, bare excepts, unresolved TODOs. |
| `plugin-catalog/digital-marketing-pro.yaml` | One listing, **207 skills** in three groups. "For writes the plugin sends itself, the script creates a **single-use approval record** when it prepares the write, and the agent approves that record after the yes, so Hermes does not prompt before those script runs." |
| `plugin-catalog/discord-tps.yaml` | Live tokens-per-second and the active model in the Discord bot's presence. Honest: the figure is "visible to anyone who can see the bot". |
| `plugin-catalog/doc-markdown.yaml` | MarkItDown file→Markdown converter. Extraordinarily candid resource contract: "on macOS the plugin runs `ps` about every 10 ms to watch that child's memory. It stops 8 seconds after its converters load, at 60 seconds if loading never finishes, or above 922746880 bytes. **It is not a sandbox**." |
| `plugin-catalog/doctorpack.yaml` | Local-first diagnostics, safety audit, and **incident postmortems** (3 tools). |
| `plugin-catalog/document-reader.yaml` | Profile-scoped document OCR with a guarded per-profile Windows service. |
| `plugin-catalog/done-bell.yaml` | Ring when a turn finishes; busy/done chip; an optional "needs you" state when approval is waiting (`pre_approval_request` / `post_approval_response` / `agent_loop_stopped` hooks). |
| `plugin-catalog/draft-cards.yaml` | Email/chat drafts as reviewable cards; each revision's changed words are highlighted. "The plugin never sends anything: pressing Send **records approval of that exact version** and posts it to the chat", then the agent sends it with the user's own tools. |
| `plugin-catalog/drag-to-pin-session.yaml` | Pin/unpin sessions from their row via supported desktop SDK actions. |
| `plugin-catalog/duty-board.yaml` | Read-only duty board for **waiting conversations, unanswered messages, running turns, undelivered background results and failing cron jobs**, with model-free `/duty` summaries. Opens `state.db` in SQLite `mode=ro`; "shared-chat summaries default to counts only". |
| `plugin-catalog/eatwise.yaml` | Local-first dietary coach over a bundled food database; the profile schema **rejects name/phone/ID/medical fields by design**. |
| `plugin-catalog/echarts-in-chat.yaml` | The model emits `::echarts{labels=… values=…}` and the plugin mounts an interactive inline SVG chart (dataZoom, click-to-filter legend) in the transcript-directive slot. No third-party library. |
| `plugin-catalog/edit-ledger.yaml` | JSONL ledger of turns that changed files: file counts, median per turn, most-changed extension, per model/platform/day. "A turn another plugin keeps going is **counted once**." Stores no path, file name or answer text. |
| `plugin-catalog/effortless-hermes.yaml` | **Picks the reasoning effort for every prompt**: a fast judge reads the next message once per turn and rewrites the request's effort *before it ships* — easy questions run cheap, hard jobs get high. An `llm_request` middleware, not a per-call-site decision. |
| `plugin-catalog/empiriolabs-media.yaml` | Backends for `image_generate` / `video_generate` / `text_to_speech`; polls a job endpoint while a video renders (up to 15 min) and downloads the result into the Hermes cache. |
| `plugin-catalog/empiriolabs.yaml` | Model provider from a live catalog: each model's context window, image input and reasoning support declared to Hermes; the model catalog is cached in memory for an hour. |
| `plugin-catalog/enchanted-composer.yaml` | Full-duplex voice + prompt libraries + undo/redo. "Spoken requests the voice model delegates run as Hermes agent turns with tools in the chat where voice started; **runs that need approval are stopped, not approved**." |
| `plugin-catalog/entropicmem.yaml` | SQLite FTS5 facts with **cited, explainable recall**; write policy **auto-redacts high-confidence secrets at write time** (other PII types are warn-only); stored-content **injection screening flags and warns** on recall/prefetch payloads — "fail-open by design, not a blocking filter". Destructive-op gates with automatic backups and an **append-only audit log**. |
| `plugin-catalog/epistemic-harness.yaml` | **Record a provisional claim or uncertainty before an evidence-gathering step, then link the actual observation to it.** Two tools + a `tool_execution` middleware. |
| `plugin-catalog/error-ledger.yaml` | JSONL ledger of failed provider calls: attempts failed per model/provider/cause, **how many Hermes could retry**, the most common HTTP status. Records the failure class and exception class name but **no error message, request or prompt text**. |
| `plugin-catalog/evalroute.yaml` | **Routes a task to the right (model, reasoning effort) arm before you start**: classifies the task into a lane, prints a **provenance-carrying route card**, installs per-model effort defaults. "Strong rules run locally; weak-signal classification calls the host LLM" — an optional local 146 MB encoder replaces that LLM call offline. Dispatched workers "never inherit `--yolo`; their approvals follow `approvals.single_query_mode`, **default deny**". |
| `plugin-catalog/event-read.yaml` | CalDAV calendar reader + a self-created cron watch. Its error-reporting contract is the useful part: "it reports a problem **on the first run, when the cause changes and again after 23 hours**, or on every run when its data directory cannot be written". Each request gives up after 20 s without data; a whole call has no time limit. |
| `plugin-catalog/excel_line.yaml` | Excel-backed hierarchical long-term memory tree (10-row cap per workbook, dynamic branching, leaf pointers). |
| `plugin-catalog/field-academy.yaml` | A learning curriculum: four paths × three levels + a capstone, practice labs on made-up data, **one real service run by a scheduled job for several days, a recovery drill**, and a review signed by a reviewer you choose. "Passed missions come back for **short spaced reviews**." |
| `plugin-catalog/file-tray.yaml` | Session file tray: the paths the agent touched via read/write/patch. |
| `plugin-catalog/filebox.yaml` | Dual-panel file browser: **whitelist-guarded** file CRUD, copy/move/symlink, media preview, multi-select, rename, trash. No network, no model tokens. |
| `plugin-catalog/financial-datasets.yaml` | 27 market-data tools: statements, prices, SEC filings, insider and institutional ownership, KPIs, macro data, news, and a stock screener with a filter catalogue. |
| `plugin-catalog/fish-audio.yaml` | Expressive TTS (80+ languages), transcription, voice cloning, voice design, plus a Voices page and live dictation. Approval-gated cloning/deletion; the Voices page confirms by a **speaker-consent box and a typed voice name** instead of the approval gate. |
| `plugin-catalog/fleet-policy.yaml` | **Measures cron cost per job — runs, empty runs, $/day, gate present** — and ships `watch`, a generic wake gate that replays one read tool and **wakes the agent only when new item ids appear** (no LLM call otherwise). |
| `plugin-catalog/fluxer-platform.yaml` | Fluxer gateway adapter (REST out, WebSocket in) with edits, reactions, pins, reply refs, media, directory enumeration. (Also carries the malformed `- name` `requires_env` and a truncated description.) |
| `plugin-catalog/fmsg-platform.yaml` | fmsg platform adapter: WebSocket in, JSON REST out, API key exchanged for a short-lived JWT. (Same malformed `requires_env` + truncated description.) |
| `plugin-catalog/foresee.yaml` | Insurance-quote comparison over a hosted MCP; the identity submit happens only "after the user's **in-chat consent recorded verbatim**". |
| `plugin-catalog/freight-reconciliation.yaml` | Payer-side reconciliation into a deterministic local SQLite core, producing **evidence-linked difference lists for human review**. "**Never approves payments, sends messages or writes back to ERP/TMS; final confirmations route through a local admin page the model cannot reach.**" |
| `plugin-catalog/freshdesk.yaml` | Freshdesk API v2 connector. "The two write tools escalate to Hermes human approval and **fail closed when no person is present**." Attachments download only from that ticket's own attachment hosts. |
| `plugin-catalog/frihet.yaml` | Zero duplicated tools: the canonical 158-operation surface stays in the vendor MCP and the plugin adds a skill, a `pre_tool_call` hook that escalates irreversible operations, and a `/frihet` command. Its comment block is a design log: "**`tools.default_enabled` reduced to 39 read-only operations** — every `create_*` was removed because the canonical contract declares them under `externalSideEffects`". |
| `plugin-catalog/fusion.yaml` | Multi-model fusion router: detects the model fleet the harnesses actually have installed and builds a **Frontier → Middle Manager → Frontier** structure with pinned models and **provenance from execution records**. |
| `plugin-catalog/fxmacrodata.yaml` | 72 macro/FX tools: official-source releases, calendars, policy rates, curves, COT positioning, commodity and FX data, **with source citations**. Also `known_at_time`, `release_risk_score`, `portfolio_risk_engine`, `macro_regime_classifier`, `fx_trade_setup`, `fx_backtest`, `event_impact_replay`. The API key is optional — the catalogue, calendar and recent releases still work without it. |
| `plugin-catalog/gadget.yaml` | ESP32 devices as chats: pairing code required for a new device, a paired device answers the agent's approvals **for its own chat**, firmware updates verified by size + SHA-256 against a release manifest. |
| `plugin-catalog/game-dev.yaml` | Read-only project inspection and asset audits; lists file names/sizes under a supplied path, **skipping hidden, symlinked and credential-named entries**. |
| `plugin-catalog/gbrain-plugin.yaml` | A `/gbrain status` command and a Desktop pane over a user-installed GBrain; the plugin itself does nothing else. |
| `plugin-catalog/gbrain-pointer.yaml` | Read-only `memory.provider`: after each non-trivial turn it searches GBrain and injects up to 3 (cap 10) `[source:slug] title` **pointers** into the next turn as **fallible background context**. Rows GBrain flags as suspected injection are skipped. |
| `plugin-catalog/gbrain-retrieval-reflex.yaml` | A `pre_llm_call` hook that injects ambient context before each turn; **silent no-op when GBrain is unreachable or no token is set**. |
| `plugin-catalog/gemini-live-bridge.yaml` | Realtime duplex voice: the backend owns the upstream socket and the key; the UI only gets **single-use ephemeral tokens** and talks to localhost. |
| `plugin-catalog/genealogy-research-recipes.yaml` | Fact-checked research instructions with recipe sources and an offline lookup helper; read-only, no tools. |
| `plugin-catalog/gh-ref.yaml` | `@gh:owner/repo#123` context references: attach a public issue or PR to a message (title, state, labels, latest comments; for PRs also branches, merge state, change size). |
| `plugin-catalog/gigamail.yaml` | Thin stdio launcher for a local GigaMail MCP; send/delete/calendar writes are gated by the *backend's* out-of-band approval, not by Hermes. |
| `plugin-catalog/git-autosave.yaml` | Before a mutating tool call it saves the repo's working state to a **private shadow ref** (`refs/hermes-autosave/<branch>` with reflog) through a private index; `autosave find`/`restore` recover a pre-edit version. **Skips credential stores** (.env, auth.json, .ssh, .aws, .kube, gh/gcloud/azure). "It observes only and never blocks or approves a tool call." |
| `plugin-catalog/git-hook.yaml` | Auto fetch/pull before reads; commits and pushes only the files each turn changed. "A branch whose direct push the remote refuses on policy grounds … is never committed to again: the hook drops its own unpushed commit, leaves the edit staged and dirty, and **reports it once**." |
| `plugin-catalog/git-review.yaml` | Read-only diff pane that **cites changed lines into the composer as `@line:` references**; external diff/textconv drivers disabled; polls the local backend every 3–5 s while open; writes only plugin-data. |
| `plugin-catalog/git-tasks.yaml` | Multi-repo GitHub issues/PRs in a Tasks view; one-click approve/close/reopen; creates worktrees and seeded sessions. |
| `plugin-catalog/githermes.yaml` | GitHub PRs/issues as a right-hand pane via the logged-in `gh` CLI. |
| `plugin-catalog/github_app.yaml` | GitHub App auth (key held in memory, never written or logged) with a token fallback, and "**reports which identity acted in every result**". Writes stay disabled until `allow_write_actions` and each goes through the human prompt — "an 'always' answer does not persist". "No tool argument can change the host." |
| `plugin-catalog/glasser.yaml` | Hosted MCP over 1,000+ paid data endpoints (enrichment, SEO, social, property, stock quotes), pay per call. |
| `plugin-catalog/gmail.yaml` | Desktop Gmail UI with preview-confirmed send/reply/archive/trash/label. Even with every review dialog skipped, "the **prepare ticket, account/profile binding, exact snapshot validation and readback verification** still run". Remote email images load only after the user allows them. |
| `plugin-catalog/go-whatsapp.yaml` | Outbound WhatsApp through a pinned GOWA service on loopback; device listing, pairing, removal. |
| `plugin-catalog/gondola-provider.yaml` | USDC-settled marketplace API for Venice AI inference. |
| `plugin-catalog/gonogo.yaml` | **Turns a pilot-scale eval score into a deployment decision**: Wilson intervals, a confidence threshold that **routes uncertain cases to a human**, and an honest **INSUFFICIENT EVIDENCE** verdict when the sample cannot support the claim. |
| `plugin-catalog/good-student.yaml` | Wrong-question diagnosis with a deterministic local SQLite core; host-model recognition is **gated by parent confirmation**. |
| `plugin-catalog/govee.yaml` | Light control. "Every command is checked against the model's advertised capabilities and ranges, then **confirmed by a state read-back**." |
| `plugin-catalog/greyridge-token-safety.yaml` | **Pre-trade safety check** on Base ERC-20 tokens (honeypot/sellability, transfer tax, owner/mint/pause flags, liquidity) returning a **SAFE/CAUTION/AVOID verdict**; "its verdict is a heuristic, not financial advice". |
| `plugin-catalog/grok-acp.yaml` | Grok subscription as a provider over ACP stdio; "Hermes provider secrets are stripped from the child environment". |
| `plugin-catalog/groq-provider.yaml` | Groq provider. "The model list leaves out Groq's … 4K-context models that **Hermes cannot run**" — the catalogue is filtered to what the harness can actually serve. |
| `plugin-catalog/gurusup-brain.yaml` | Company-wide memory over a hosted MCP (OAuth 2.1) with "**the sources behind each answer**"; write tools publish into the company workspace. |
| `plugin-catalog/ha-sidebar-navigator.yaml` | Sidebar navigator that bypasses the 3-session overview cap with searchable project trees and a timeline. |
| `plugin-catalog/hades-coding-workflows.yaml` | Workflow skills: dual-model harness, subagent-driven development, implementation planning. |
| `plugin-catalog/handflow.yaml` | Manus-style planning flow — the agent plans in steps and marks them as it works, with a live desktop pane. |
| `plugin-catalog/health-data.yaml` | Local health/daily-context data store (11 tools: sync, query, calendar peek, analysis catalog/plan). |
| `plugin-catalog/health-insights.yaml` | Deterministic local analysis of Apple Health data: weekly trends, rule-based concern checks, DRIs, an IOM energy target, lab results; personal modules off by default. |
| `plugin-catalog/healthcare.yaml` | Encrypted on-device health vault (AES-GCM), 24 scoped MCP tools, approval-gated deletes and a **tamper-evident audit chain**; the skill forbids diagnoses and dosage changes. |
| `plugin-catalog/healthrelay.yaml` | Read-only access to your own Apple Health data from a self-hosted receiver — ten read-only tools, **no raw SQL, no write tools**. |
| `plugin-catalog/heartbeat2.yaml` | **The single richest monitoring design in the shard.** Timed check-ins, recurring checks and deterministic watchers (file, process, URL, read-only command, Hermes event) that wake the *same* chat "on that chat's own model: no side model, cron session or subagent". "**Watchers decide without a model call**"; the agent answers each wake with a structured verdict (notify or stay silent, never a typed sentinel); a **no-op governor slows, then pauses pointless wakes and asks once**. Guardrails (quiet hours, daily caps, unanswered mute, floors, lifetimes) are user settings the agent "can never widen"; a one-time reminder bypasses the mute "only in a turn that carries your message". Arming returns a one-line receipt of when the wake will really fire, and a wake that could never fire before it expires is refused. Command watchers use an allowlist, a sanitized env and a 30 s process-group kill; URL watchers always refuse cloud-metadata and private addresses. |
| `plugin-catalog/hermes-aac.yaml` | Communication boards, switch scanning and reviewed AI proposals. Honest gaps: "No speech Stop, request-scoped cancellation, completion or later playback error tracking". |
| `plugin-catalog/hermes-activity.yaml` | Session analytics: annual heatmaps, token mix, model breakdowns, provider-reported usage. Reads `state.db` read-only; stores aggregates and **hashed key identifiers** locally. |
| `plugin-catalog/hermes-adaptive-effort.yaml` | A separate scorer sets each request's reasoning effort; keeps a **prompt-free effort-change history** (64 changes × 64 conversations), per-conversation overrides and **per-route cache verdicts built from provider token counters**; unsupported scorer formats "fail open (effort unchanged)". |
| `plugin-catalog/hermes-agent-builder.yaml` | Guided workspace for building specialists: tailored questions, reference files, editable instructions, version comparison, model-only trials. "Save agent" creates a new profile cloned from the active one. |
| `plugin-catalog/hermes-agent-mixer.yaml` | **Four enforced dials** — edits, write-scope globs, **per-turn line budget**, new-dependency policy — applied in `pre_tool_call` (block, or escalate "ask" to the approval gate) and surfaced to the model as a one-line rules context when a dial is off its default. |
| `plugin-catalog/hermes-anilist.yaml` | AniList tracker with a daily digest. Its comment block documents the catalog mechanics: "**Quote it: an all-digit SHA unquoted is a YAML number and the loader rejects it**", and why the pin is the docs-cleanup commit rather than the tag (the page renders the README *at the pinned sha*). |
| `plugin-catalog/hermes-asgard.yaml` | Twelve Norse-god Desktop themes, switched with `/skin <name>`; theme-only, no tools or hooks. |
| `plugin-catalog/hermes-atoll.yaml` | macOS notch monitor reading `state.db` read-only; sends session titles, stats and a ≤96-char redacted preview to a local app. |
| `plugin-catalog/hermes-auto-titler.yaml` | Topic-aware session titles that follow conversation changes and session close without touching the host's title-generation switch. |
| `plugin-catalog/hermes-beads.yaml` | Native work-graph plugin with a **fixed-argv adapter**, a scoped ready frontier, **claim with read-back**, guarded writes, and an honest exit-code map (incl. stale-13); "plain bd stays fully sufficient (escape hatch)". |
| `plugin-catalog/hermes-blogwatcher.yaml` | RSS inbox with themes, read controls and on-demand summaries that fetch public pages and send text to the model **after consent**. Summaries cached locally. |
| `plugin-catalog/hermes-board.yaml` | Miro-like board: one JSON document edited from both the agent's tools and a desktop pane. `board_apply` builds a whole diagram in one call; `board_watch` reports the user's pane edits back to the agent. |
| `plugin-catalog/hermes-boot-screen.yaml` | Six-act boot animation for Desktop. Honest: it "captures Enter/Space/Esc at the document level" while up. |
| `plugin-catalog/hermes-bot-hq.yaml` | Per-bot Home page published by the bot as JSON. Bot-declared action buttons run a script **only after the user approves that exact file (SHA-256)**, are **re-approved if it change**, and are limited to 30 s and to one folder. Approvals live under the Hermes root. |
| `plugin-catalog/hermes-call-ledger.yaml` | Per-call cost ledger: every model call recorded from the observer hooks (provider, model, tokens, duration, outcome, finish reason) and **paired with the charge the billing provider actually took**; with no billing account it falls back to Hermes's own price-book estimate. Records no prompt, response or tool-argument text. |
| `plugin-catalog/hermes-cloud-file-manager.yaml` | Remote file browser/editor for the agent's machine. Saves are **refused if the file changed since you opened it**; writes are staged as hidden `.cfm-*` temp files; "it has no delete action: it removes only its own staging files"; it never follows links out of the working folders. |
| `plugin-catalog/hermes-codex-resets.yaml` | Counts time since the last Codex usage reset and raises a card when a new one lands, with a history page. |
| `plugin-catalog/hermes-context-overview.yaml` | A status-bar button showing how full the focused conversation's context window is: **token budget and estimated allocation by category**, live during a running turn. Read-only, no backend. |
| `plugin-catalog/hermes-council.yaml` | Multi-agent debate: four fixed advisor seats answer in parallel, **anonymously review and rank each other**, and a Chairman synthesizes. Cost is stated: "**up to 2N+1 billed calls per turn**". |
| `plugin-catalog/hermes-cron.yaml` | **The cron operating skill.** Lifecycle rules (pause vs disable vs remove; `in 30m` vs `30m`), **four ways to avoid needless LLM runs (`no_agent`, `wakeAgent` pre-check, `monitor`, `[SILENT]`)**, verify-after-change, and a read-only doctor that "reports one error across several jobs as **one scheduler fault**" and flags a cron store that cannot be written. |
| `plugin-catalog/hermes-desktop-camera.yaml` | A camera button on the composer; the frame lands in the composer as an attachment. |
| `plugin-catalog/hermes-discord-rpc.yaml` | Discord Rich Presence: session title, model and token total published every 3 s (visible to other Discord users). Reads `state.db` read-only. |
| `plugin-catalog/hermes-dpapi-secrets.yaml` | Windows DPAPI-encrypted secret file resolved into env vars at startup. Threat model stated precisely: "the at-rest protection is a bar for backups, cloud sync and dotfiles, **not a boundary against code already running as the same user**". A wrong file, an undecryptable blob or a non-string-map payload is "reported as an error **with nothing injected**". |
| `plugin-catalog/hermes-dreaming.yaml` | **The reflection loop.** Nightly deterministic consolidation: corroborates candidate facts with **what humans actually said on distinct days**, proposes the few worth keeping **with a verbatim edit anchor**, asks whether stale entries still hold, and wakes the agent **only when there is work**. Trust rises only on facts people repeated **on two or more different days**, capped at **10 facts a night**; rejected facts lose trust; `forget` is **irreversible** and only a human's answer can trigger change/end/correct/forget. Secrets and instructions are screened before anything reaches memory, the report or the model. Installs two agent cron jobs with **only the memory toolset** plus a `no_agent` job (every 15 min, no model) that keeps a hash index and purges forgotten facts from the diary and from the dream's own prior output files. |
| `plugin-catalog/hermes-experientiallabs.yaml` | Multi-model gateway provider with a `/usage` wallet snapshot; calls limited to the gateway's chat, models and cost endpoints. |
| `plugin-catalog/hermes-federated-search.yaml` | Federated search: one query fanned to several backends in parallel, merged, deduplicated, relevance-ranked (keyword scoring, **optional LLM re-rank with automatic fallback**). Per-line credential pools with **automatic failover and host-aligned cooldowns**. The re-rank request pins thinking off and the card page says so. |
| `plugin-catalog/hermes-field-notes.yaml` | "Search known pitfalls before debugging and record new ones with root cause"; every local core edit is a **patch note with a declarative checks file**, verified read-only after each update as **OK / MISSING / UPSTREAMED / N/A / UNKNOWN with reason**, plus a list of core files changed outside the registry. Ships 42 pitfalls, 10 patch recipes; an hourly `no_agent` cron job. |
| `plugin-catalog/hermes-fleet-connector.yaml` | Phone pairing plus read-only Live Operations reporting. "Any messaging account you make an owner … can create pairing links and approve phones, so **that account's security is your host's security**." "Isolation is never downgraded"; host-isolated and multiplexed contexts fail closed. |
| `plugin-catalog/hermes-gemini-live.yaml` | Realtime duplex voice that delegates real work to Hermes. "**Three verbs rather than thirty schemas**." "A task that stops to ask permission reaches the user as a spoken prompt and a 'Hermes needs you' indicator; **only the user's press approves it, never the voice model**." One Live session plus a task board, not a session per task. |
| `plugin-catalog/hermes-gensyn-delphi.yaml` | Seven **read-only** prediction-market tools (markets, positions, subgraph, edge, buy/sell quotes). "No funds move and nothing is signed or sent." Each call is a local Node subprocess with a **25 s deadline, not a sandbox**. |
| `plugin-catalog/hermes-gensyn-ree.yaml` | Validate / verify / infer receipts. Verify re-executes on CPU. "They ask for Hermes approval on every call and **refuse under cron, yolo, approvals off, single-query, unattended runs, host isolation, or when the approval API is missing**." "Choosing 'always' adds one config.yaml allowlist line per call and never covers the next call." "The container is not a hostile-code sandbox." |
| `plugin-catalog/hermes-guide.yaml` | Read-only diagnostics that "**complement — never replace — hermes doctor**": eight health checks plus 21 troubleshooting skills; the sessions scope scans the tail of `agent.log` for runaway-session signatures. |
| `plugin-catalog/hermes-herald.yaml` | Cross-profile agent dispatch (12 tools): async dispatch with SSE completion, sync multi-turn chat, model-selectable subagents, a **durable SQLite run ledger**, **fail-closed per-target model-route discovery**, cancel and approve tools. Stated limitation: credential interpolation reads the process environment, "so origins are not isolated under multiplex mode". |
| `plugin-catalog/hermes-honcho-plugin.yaml` | Desktop workbench over the Honcho memory: read the newest conclusions, **trace their premises**, search messages, add confirmed corrections. Writes only after you confirm the target in a dialog. |
| `plugin-catalog/hermes-impossibl.yaml` | 100+ models behind one OpenAI-compatible API, as a model provider. |
| `plugin-catalog/hermes-insight.yaml` | Select any text → an AI definition **with sources** in a popup; a short-lived stateless CLI, no background process. |
| `plugin-catalog/hermes-iroh-interconnect.yaml` | Authenticated agent-to-agent tasks over Iroh QUIC. "Pairing is confirmed via the tool's `confirm=true` argument, **not a UI prompt**" — a weaker gate, admitted. Remote-triggered auto-fetch is off by default and confined to one directory. |
| `plugin-catalog/hermes-jailbreak-kernel.yaml` | An `llm_request` middleware that **replaces the system prompt** to remove refusals, dropping other plugins' prompt sections; ships a 276-check offline self-test and writes a per-session dump of the full system prompt. A useful negative example. |
| `plugin-catalog/hermes-jetstream.yaml` | NATS JetStream event bus: publish, fetch a batch, and wake on subject matches. Durable consumers, **manual ack, an idempotent wake ledger and rate rails**; the agent may add up to 16 durable wake routes, but the subject stays inside `subscribe_allowed` and cross-profile targets are refused. |
| `plugin-catalog/hermes-jina.yaml` | Jina Reader backend for `web_extract` (works without a key) and `web_search`. |
| `plugin-catalog/hermes-kame-api-rotation.yaml` | **API-key rotation sized from each key's own evidence**: "the healthiest key for every call, each 429 / RESOURCE_EXHAUSTED / quota refusal sized from its own evidence". While every key rests, chats wait (each key's rest capped) and **cron runs give up after 300 s** with the provider's refusal unless a total wait is set. |
| `plugin-catalog/hermes-kame-provider.yaml` | The provider half of the rotation plugin: re-registers Hermes's bundled API-key profiles unchanged except for the client factories. "No core override." |
| `plugin-catalog/hermes-kemet.yaml` | Twelve Egyptian-god Desktop themes. |
| `plugin-catalog/hermes-lang-ca.yaml` | Catalan UI pack. "Registering the pack **never changes `display.language`**, the user opts in via config." |
| `plugin-catalog/hermes-lang-el.yaml` | Greek UI pack (5,060 of 5,065 Desktop keys); missing keys fall back to English. |
| `plugin-catalog/hermes-lang-it-full.yaml` | Italian Desktop pack: 5,082 of 5,085 keys; "the 3 the pack format rejects are array/object leaves that fall back to English". |
| `plugin-catalog/hermes-lang-it.yaml` | Italian pack for core/TUI/Desktop. "Parser-safe: hard-parsed menu brackets and `[Y/n]` prompts stay verbatim; placeholders, URLs and CLI flags preserved." |
| `plugin-catalog/hermes-lang-ko.yaml` | Korean Desktop pack; "values identical to English are omitted so missing strings fall back to English". |
| `plugin-catalog/hermes-lang-pt-br.yaml` | pt-BR pack across all three surfaces. "**A weekly drift workflow reports when `main` adds or drops keys; nothing self-updates.**" Verified by its own `verify_pack.py` running as public CI. |
| `plugin-catalog/hermes-lang-th.yaml` | Thai pack, 9,719/9,725 keys (99.9%). |
| `plugin-catalog/hermes-lang-vi.yaml` | Vietnamese pack across every surface; parser-safe multi-line values. |
| `plugin-catalog/hermes-lcm-x.yaml` | **Lossless memory for long sessions**: every turn is kept in a local SQLite store instead of being compacted away, with a **recoverable DAG of summaries** over it and 15 `lcm_*` tools. Oversized tool outputs are written to files and "replaced in the model's context by **recoverable references**". Reads `state.db` read-only. |
| `plugin-catalog/hermes-ledgerline.yaml` | Inspect session costs and usage in the Desktop app. |
| `plugin-catalog/hermes-live-voice.yaml` | Full-duplex voice on a Codex subscription via the local app-server; spoken tasks are submitted as **messages in your focused chat**. |
| `plugin-catalog/hermes-loadout.yaml` | Save named loadouts of skills + MCP connections, review the change, apply it, and **undo the latest managed operation**. |
| `plugin-catalog/hermes-memory-pane.yaml` | See what the focused chat **remembered, updated or forgot**, and edit/delete/undo any entry without leaving the conversation. A `tool_execution` middleware diffs MEMORY.md/USER.md around each memory call to log entry-level changes. |
| `plugin-catalog/hermes-memory-ui.yaml` | Read-only inspector across built-in, holographic, Mem0, Honcho, Mnemosyne, Hindsight and ByteRover memory. "**No memory is written.**" |
| `plugin-catalog/hermes-memory-wiki.yaml` | `official`: browsable subject pages and daily logs derived from local session history, plus a read-only audit panel for MEMORY.md / USER.md. |
| `plugin-catalog/hermes-minimizer.yaml` | YAGNI guidance (reduce over-engineering, reuse existing behaviour, preserve requirements) as **one static prompt section, no tools or hooks**. Honest: "Guidance is advisory, not enforcement; existing session prompts may retain it after disabling." |
| `plugin-catalog/hermes-mobile.yaml` | WebSocket platform for your own mobile/web app: text, voice, images, approval/clarify cards answered from the app, streaming edits, cron delivery to a chosen device. "Anyone holding an unbound token can chat with the agent … and answer the approval and clarify cards of the device id they connect as." |
| `plugin-catalog/hermes-monitor.yaml` | Kanban worker health in the status bar with **stall and loop detection (same tool + same arguments repeated)**, plus a per-provider quota readout. "Zero model tokens." |
| `plugin-catalog/hermes-monitoring-dashboard.yaml` | Prompt-customisable desktop dashboard: host metrics, session activity, clocks, calendars, text widgets. |
| `plugin-catalog/hermes-mpp.yaml` | Pays HTTP 402 MPP challenges from a dedicated wallet. Disclosure: with `MPP_ALLOWED_ORIGINS` unset, **any** supported 402 challenge returned to core HTTPX traffic is auto-paid "with no per-payment cap or confirmation". |
| `plugin-catalog/hermes-muse-code.yaml` | Muse Spark billed to a monthly login (device-code, no API key). |
| `plugin-catalog/hermes-muse.yaml` | A proactive companion: follows goals (active/done/cancelled), prepares sourced research, maintains memory, assembles rolling 30-day or natural-month views. "Sources, authorization, quiet hours and **actual result/delivery receipts remain distinct**; partial coverage is not global availability." "New repeating watches (interval or cron) must be **at least 30 minutes apart**; one-off schedules are exempt." "Delegates are instructed to remain read-only under inherited permissions, **not sandboxed**." Retention is candid: "Unprocessed backlog can exceed 500 and has no fixed retention time." |
| `plugin-catalog/hermes-newswire.yaml` | Breaking-news ticker above the statusbar: per-source favicons, feed search, grouping modes, offline cache. "Zero API keys, zero model tokens." |
| `plugin-catalog/hermes-nous-prices.yaml` | Browse Nous Portal model prices and balances in Desktop. |
| `plugin-catalog/hermes-office.yaml` | View and manage Bot Mode agents in a shared office. |
| `plugin-catalog/hermes-openwhispr.yaml` | Local-first dictation history and shared notes via the OpenWhispr CLI and its authenticated loopback bridge; cloud is opt-in per action. |
| `plugin-catalog/hermes-opper.yaml` | EU-hosted AI gateway (700+ models) as a model provider. |
| `plugin-catalog/hermes-pantheon.yaml` | Eighteen Desktop themes in dithered classical marble. |
| `plugin-catalog/hermes-pets-all.yaml` | Browse the profile's installed "pets" in a pane, plus a read-only `list_pets` tool. |
| `plugin-catalog/hermes-pickup.yaml` | "Pick up where you left off": up to 10 cards of unfinished work from recent chats, project folders and files, each with where you stopped and a one-click next step. Requires explicit per-profile consent before it reads other profiles' session stores. |
| `plugin-catalog/hermes-pii.yaml` | Local Presidio + spaCy redaction of outgoing user text. **Fail-open: "detector errors, including a missing model, send original text."** Scope is explicit — "system prompts, tool outputs and tool-call arguments are preserved". |
| `plugin-catalog/hermes-plex-music.yaml` | Mini-Plexamp: statusbar player, likes, playlists, queue, sleep timer. "Zero API keys, zero model tokens." |
| `plugin-catalog/hermes-plugin-chrome-profiles.yaml` | Switch the browser tools to a named Chromium-family profile (Chrome, Edge, Brave), local or remote, over CDP. |
| `plugin-catalog/hermes-plugin-gen.yaml` | Generate, scaffold and extend plugins from descriptions: `plugin_add_skill`, `plugin_add_tool`, `plugin_scaffold`. |
| `plugin-catalog/hermes-plugin-guard.yaml` | **Static review of a candidate plugin — "target code is never executed."** |
| `plugin-catalog/hermes-plugin-netbox.yaml` | Change management: query objects, build a **reviewed field-level diff**, apply with a **journal and roll back**. |
| `plugin-catalog/hermes-pokemon.yaml` | A pixel-art companion garden; reacts to failures, other chats' turns, seasons and moon phases. "No runtime network requests, credentials, backend, or model calls." |
| `plugin-catalog/hermes-project-stewardship.yaml` | Durable project ownership: a `pre_llm_call` hook adds a project's saved **rules, decisions and facts** to that project's bots' turns; objective checks run allowlisted local programs **only at autonomy level 3+**; the optional HTTP API stays closed until a bearer token is set. |
| `plugin-catalog/hermes-pubky.yaml` | Setup helper that syncs agent state (conversation DB snapshots, portable config) to a remote Pubky homeserver. |
| `plugin-catalog/hermes-quest.yaml` | Pixel-art RPG view of real kanban and worker activity. "Registry and SSH remote connections **fail closed** until a public SDK connection-lifecycle hook is available." Profile names and task titles are hidden unless enabled. |
| `plugin-catalog/hermes-resetwatch.yaml` | Tracks subscription quotas and reset times in Desktop. |
| `plugin-catalog/hermes-rich-ui.yaml` | **Rich, evidence-backed answer cards** — tables, charts, metrics, timelines, sources — rendered inline in the desktop transcript. |
| `plugin-catalog/hermes-routines.yaml` | A minimal Routines page turning cron.manage into plain language for non-developers. "**No cron syntax, no service, no database; routine data stays in the host.**" |
| `plugin-catalog/hermes-rss.yaml` | Read RSS/Atom feeds and discuss articles; a **public-IPv4 SSRF guard** sits in front of the fetch path. |
| `plugin-catalog/hermes-rustpush-imessage.yaml` | Local-only iMessage platform over a launchd-supervised OpenBubbles RustPush sidecar on a same-user Unix socket. |
| `plugin-catalog/hermes-security-audit.yaml` | Approval-gated local security audit using Gitleaks, OSV-Scanner and Semgrep CE. |
| `plugin-catalog/hermes-self-healing-context.yaml` | "Intercepts runtime errors and dynamically patches the context window using local SQLite FTS5 memory for zero-downtime recovery." |
| `plugin-catalog/hermes-seo.yaml` | 45 SEO workflow skills over a credential-scoped runner. Honest: the tool "starts local subprocesses in the Hermes host process, **not a Docker terminal sandbox**, and model-supplied script arguments may name host paths". "Skills ask before paid or mutating calls but **the tool does not enforce approvals**." |
| `plugin-catalog/hermes-session-diff.yaml` | Persistent session file diffs, run comparisons and per-edit history in Desktop. |
| `plugin-catalog/hermes-session-reset-policy.yaml` | Opt-in idle/daily gateway resets: reads the existing `session_reset` block and "starts a fresh session **on the first inbound message past the boundary**. No timers, no background writes." |
| `plugin-catalog/hermes-session-warmer.yaml` | Opt-in bounded idle prompt warming for allowlisted OpenAI-compatible endpoints. "Sends potentially billable requests; no tool execution or conversation writes." |
| `plugin-catalog/hermes-sidepulse.yaml` | Lifecycle status backend forwarding event names, a **hashed agent id**, the raw session id and tool names to a local AF_UNIX socket and a 0600 JSONL log. |
| `plugin-catalog/hermes-slash-router.yaml` | Routes misspelled/meaning-based slash commands. "**Preserves drafts when unsure.**" Only the command catalog, prior routes and up to 8 saved corrections are sent — "message arguments and conversation content are not sent". |
| `plugin-catalog/hermes-snapcompact.yaml` | Context engine that archives history as dense bitmap PNG frames "that vision models read back at **~1/3 the token cost**". |
| `plugin-catalog/hermes-speech.yaml` | Guided TTS/STT setup with voice search, previews, model switching and spoken replies over 80+ speech models. |
| `plugin-catalog/hermes-ssh.yaml` | Manage SSH connections and remote workspaces in Desktop. |
| `plugin-catalog/hermes-structured-aux-models.yaml` | Routes approval / MCP-sampling / compression aux tasks through **bounded decision calls** instead of free-form chat prompts, "**failing open to the operator's own auxiliary provider** for anything it cannot express as a decision". "On any error approvals escalate to you, **never auto-approve**." "The default `decision_model` is a moving alias, **pin it**." |
| `plugin-catalog/hermes-stt-enhance.yaml` | Local STT (faster-whisper / Parakeet V3) with long-audio chunking and an optional bounded LLM enhancement pass that "**keeps the raw transcript on failure**". |
| `plugin-catalog/hermes-subscription-meter.yaml` | Provider-neutral quota matrix: each subscription window as one time × quota row (elapsed vs remaining), with per-provider show/hide. |
| `plugin-catalog/hermes-switchyard.yaml` | Jev-powered skill/model routing, typed assess, DOM/Cua computer use, adaptive effort **with a per-turn receipt line**, and FTS rerank. "Greetings and thanks are decided locally with no call"; "light turns … skip that hosted call by default"; without Hermes's redactor it sends metadata only. |
| `plugin-catalog/hermes-t3-control.yaml` | Bounded tools over local T3 coding threads; the comment notes that automatic completion callbacks "are experimental, disabled by default, and require separately patched host APIs; **this entry does not install that patch**". |
| `plugin-catalog/hermes-tabular.yaml` | Tabular ML skills that run Python on your data files. Honest: "Saved checkpoints are pickles: **load only ones you made**." |
| `plugin-catalog/hermes-tailscale.yaml` | Browse Tailscale devices and connect to remote Hermes instances. |
| `plugin-catalog/hermes-talk.yaml` | Realtime voice over terminal, Discord, dashboard and Desktop. Honest: it uses an **undocumented** endpoint "outside the vendor's published API terms and may change or stop working without notice". |
| `plugin-catalog/hermes-taskbar-badge.yaml` | Windows taskbar badge on turn completion, cleared on focus. No network, no data leaves the machine. |
| `plugin-catalog/hermes-teammates.yaml` | **Named subagents** with their own instructions, tools and model, which the agent assigns, checks and steers mid-task. "**The operator defines the roster; the model picks only a teammate name, and the operator's config decides what it means.**" "A delegated child cannot start teammates." Per-profile SQLite run ledger (goals, statuses, clipped summaries, role hashes, token receipts; no full transcripts). On a kanban lane it claims and heartbeats a card, moves it to review **without a reviewer**, or blocks it — "**it never completes a card**". |
| `plugin-catalog/hermes-telegram-business.yaml` | Observe-with-approval secretary bot: drafts reply to each customer DM and shows Send/Edit/Discard — "**nothing reaches a customer until you tap Send**". |
| `plugin-catalog/hermes-telemetry-dashboard.yaml` | Read-only dashboard over the locally collected shared metrics: metric families, drilldowns, milestone timeline, install snapshot, next package payload. "Send stays off." |
| `plugin-catalog/hermes-telemetry.yaml` | **Observability + budget guardrails** in local SQLite: tokens, cost, latency, tool calls per session **and per cron job**; `/stats` and `/budget`. Default enforce mode writes a $5/day, $100/month budget, and "a **hard breach blocks every tool call and pauses the over-budget cron job** until the window resets"; `mode: observe` records without enforcing. |
| `plugin-catalog/hermes-tenuo.yaml` | **Per-call authorization so a prompt injection cannot make the agent do more than you allowed.** Each call is checked against a **signed, expiring permission slip (a warrant)** before the handler runs, "down to the arguments (file paths, search queries, **spending limits**)", and every decision lands in a local audit log. Cron jobs, subagents and gateway users get **their own policy**. A no-op until a warrant is configured. |
| `plugin-catalog/hermes-terminal.yaml` | Run the Hermes terminal inside a Desktop workspace tab. |
| `plugin-catalog/hermes-token-speed.yaml` | Live decode tokens-per-second chip: 1-second sliding window while streaming, **tool-execution time excluded from decode seconds**, spinner frames never counted, **TTFT tracked separately**, and cumulative totals "calibrated against authoritative provider usage at turn end". |
| `plugin-catalog/hermes-toolsmith.yaml` | Local developer tools, transformation recipes and reviewed chat handoff in Desktop. |
| `plugin-catalog/hermes-town.yaml` | Pixel-art town where each session is a resident and each tool call walks to a building. Prompts and arguments never leave the process; a bounded event journal and rotated logs under `runtime/`; one resident per **enabled** cron job. |
| `plugin-catalog/hermes-tripo.yaml` | 3D generation tools. "Every credit-spending call goes through Hermes's approval prompt **with its estimated cost**, and a **per-chat limit makes it ask again past 100 credits**." Downloads never overwrite (a clash gets a " (2)" suffix). |
| `plugin-catalog/hermes-trove.yaml` | DAG context engine that never loses a message: FTS, semantic recall, **assertion-backed evidence compilation** and **pre-answer sufficiency gating**. Weak: "secret redaction OFF by default". |
| `plugin-catalog/hermes-vcc-engine.yaml` | Instant compaction with **no LLM call**, keeping exact commands, exit codes, errors and files "each linked back to its original message for recall via session_search". |
| `plugin-catalog/hermes-vcc.yaml` | Algorithmic compaction by deterministic regex extraction — "**zero-token, byte-reproducible**"; compacted turns stay searchable via `session_search`. |
| `plugin-catalog/hermes-verifier.yaml` | An **independent verifier model reviews each primary-agent turn delta** and raises note / caution / **blocker** findings, "and can **steer a blocker back into the session before the primary agent goes wrong**". A `VERIFIER.yml` roster of named specialists, each with its own model and tool grant; read-only tools are **off by default** ("measured across 216 reviews the reviewer made ~4 tool calls"). A phase gate can block an impending destructive call — "**it fails open**". Findings and gate decisions are logged (rotated at 8 MB). |
| `plugin-catalog/hermes-video-editor.yaml` | 45 local FFmpeg tools plus a visual editor. Honest: the local server "can read and write media and image files anywhere under your home folder"; files are replaced "only with `overwrite: true`". |
| `plugin-catalog/hermes-vision-inline.yaml` | Attaches the image to the session model directly instead of routing it through an auxiliary vision backend, so "the image stays in context and follow-ups do not reprocess it". Honest: "relies on Hermes private vision helpers, so after a Hermes update it may silently fall back". |
| `plugin-catalog/hermes-whatsapp-voice.yaml` | Live voice calls over WhatsApp; `whatsapp_call_owner` "has no destination parameter" and reports answered / no answer / declined, so the agent can fall back to another channel "including from cron". Warns the protocol is unofficial and reverse-engineered. |
| `plugin-catalog/hermes-wincred.yaml` | Windows Credential Manager as an env-var source; only the named generic credentials are read, "with no enumeration of the vault", and anything that does not decode to text is "skipped with a warning instead of being injected as a mangled key". |
| `plugin-catalog/hermes-windows-computer-use.yaml` | THEIA: virtual-desktop capture, fused stage observation, guarded caches, bounded dynamic workflows, persistent grounding. 40 computer-use tools. |
| `plugin-catalog/hermes-windows-ops.yaml` | Windows/WSL triage **skills** only (no tools): orphaned stdio MCP trees, WSL→Windows argv reaching `cmd.exe` as shell syntax, BOM/console-code-page traps, long-path errors. "The destructive diagnostics are marked and gated on asking the user first." |
| `plugin-catalog/hermes-workbench.yaml` | The Desktop app served in a browser for headless servers and VPSes. |
| `plugin-catalog/hermes-worker-monitor.yaml` | A **worker-only fork that removed the credential fan-out and every network call**, keeping one read-only route returning **counts only**; "Card identifiers, titles, assignees, and tool arguments never leave the backend, and arguments stay **hashed** inside it for stall and loop detection." |
| `plugin-catalog/hermes-workflows.yaml` | **Agent-owned workflow graphs**: a background runner executes a JSON DAG of agent nodes, fan-outs (quorum) and human/machine gates with **fingerprint replay-skip resume**, cooperative steer and typed failure events. The runner "survives session end, gateway restart and plugin disable" and "makes itself the **subreaper of its children**", SIGTERM/SIGKILLing anything a node leaves running. Honest hole: "a gate's `wait.until_argv` runs an agent-authored argv directly from the runner, **outside Hermes' tool-approval gate**". The `gate.held` wake only relays to the human; `run.done` tells the woken session to turn findings into tracked work. |
| `plugin-catalog/hermes-wsl-terminal.yaml` | Runs the terminal inside an existing WSL distro, translating host paths and asking the mount root once with `wslpath`. "This is a **full-access backend, not a sandbox** … dangerous-command approval stays on and Hermes never stops the distro." |
| `plugin-catalog/hermes-wslc-sandbox.yaml` | Terminal/file/`execute_code` in WSL Containers. Honest: "wslc rejects `--cap-drop`, `--security-opt`, `--pids-limit` … so this sandbox is **not capability-dropped** the way the Docker backend's is, `container_disk` is reported but not enforced, and **dangerous-command approval deliberately stays enabled** for this backend." |
| `plugin-catalog/hermes-xai.yaml` | The xAI surfaces core lacks; full-duplex Grok Voice in the composer. "The backend mints a 300 s xAI client secret so `XAI_API_KEY` never reaches the renderer." |
| `plugin-catalog/hermes-zh.yaml` | Simplified Chinese overlay for part of `approval.*` and `gateway.*`; placeholders match `en.yaml`. |
| `plugin-catalog/hermes_otel.yaml` | OpenTelemetry: sessions, LLM/API calls, tool calls, sub-agents and approvals as OTLP traces/metrics/logs. "With nothing configured it keeps a **local owner-only SQLite store** under `$HERMES_HOME` and sends nothing"; `content_capture` is full and unclipped by default (preview clips to 1200 chars, off sends none). |
| `plugin-catalog/hermetic.yaml` | Status-bar popover with three views: Costs (spend, cache, **pricing drift**, provider routing), AAI (skill changes, ratings, tests, replays) and HDR (**posture, destinations, sensitive paths, what runs on its own**). |
| `plugin-catalog/hicortex.yaml` | Shared fleet memory across harnesses. "Lesson blocks are delimited and carry an **explicit reference-data framing line and provenance header**." Weak: "the model can permanently update or delete shared fleet memories **without confirmation**". |
| `plugin-catalog/hindsight.yaml` | Knowledge-graph memory with entity resolution and multi-strategy retrieval; cloud / local external / local embedded modes. |
| `plugin-catalog/holographic.yaml` | The deepest fact-store design in the shard: SQLite FTS5 with 14 languages, **trust scores**, entity aliases, HRR recall. Since 0.8.0 it keeps the **history of every fact** (change / end / correct / revert, searchable `as_of` a date) and `forget` erases a fact with all its versions, keeping only an **HMAC tombstone** keyed by a random key in the same file. Since 0.16.0 a name guessed from a fact's text "**stays provisional until a second fact or a person confirms it**". "Subagents never write, but a cron job's explicit `fact_store` / `fact_feedback` calls do unless `cron_writes: false` (on by default)." Secret-looking facts and messages are **not sent** to the embedding endpoint. Known issue: "`forget` cleans the database file only: Hermes session history, `hermes backup` archives and copies other tools made are not rewritten." |
| `plugin-catalog/home-dashboard.yaml` | Personalizable draggable, resizable glass-widget Home page for Web and Desktop. |
| `plugin-catalog/homeassistant.yaml` | `official`: Home Assistant gateway platform — **state-change events in, persistent notifications and cron notify delivery out** — plus four tools. |
| `plugin-catalog/honcho.yaml` | Peer-representation memory (managed, local CLI, or self-hosted). Every request carries `X-Honcho-Host` / `X-Honcho-Plugin` headers that Honcho records for usage attribution. |
| `plugin-catalog/hopper.yaml` | Add and manage custom OpenRouter models **without modifying the core catalog**. |
| `plugin-catalog/hud-teach.yaml` | Click-through numbered marks on a live Mac window so the agent can be taught on the real UI. |
| `plugin-catalog/huddo.yaml` | Group chat where people and agents share a room. Honest: "Hermes does not ask before `huddo_send`/`huddo_whisper`/… run (the package does not set `trust: untrusted`)" and "the server tells the agent to keep calling `huddo_wait` (up to 50 s per call) … **which keeps spending model tokens until you stop it**". The paired human is marked with a **header tag that message text cannot imitate**. |
| `plugin-catalog/hwiki.yaml` | Markdown wiki memory (Obsidian-compatible, git-versionable) with local FTS5 + optional hybrid retrieval. "**Cron and subagent runs get read-only recall.**" Built-in memory writes are mirrored into the wiki folder by default. |
| `plugin-catalog/hyatlas.yaml` | 8-layer self-hosted memory on a pure-Go server: local embeddings, hybrid vector+keyword search, **bitemporal knowledge graph with source citations**. "It **supersedes (hides but keeps) the facts the model marks merged or stale, recording a reason for each drop**." "Turns written while the endpoint was unreachable … are extracted later by a **catch-up pass** (every 10 minutes; rows up to 7 days old)." The spawned server gets an allowlisted environment, not the agent's keys. |
| `plugin-catalog/hydradb.yaml` | Hosted long-term memory: relevant context recalled before each turn, completed turns saved in the background. |
| `plugin-catalog/icarus.yaml` | Self-memory and **replacement models**: brief, curate, eval, train, `train_status`, `rollback_model`, `switch_model`, export, telemetry. |
| `plugin-catalog/identity.yaml` | View and edit SOUL.md / MEMORY.md / USER.md / AGENT.md, switch the active profile, and see **per-line usage with colour-coded staleness timestamps**. The model-callable `identity_edit` rewrites those files and `identity_switch_profile` writes `HERMES_HOME/active_profile`. |
| `plugin-catalog/image-utils.yaml` | Inspect, resize, crop, rotate, convert and optimise images in-process with Pillow — no shell, no ImageMagick, no network. |
| `plugin-catalog/inbox.yaml` | **One read-only view of everything in flight**: failed or paused cron jobs, stalled or dropped delegations, orphaned background processes, blocked kanban tasks, running work, undelivered delegation results, upcoming cron runs, open sessions — with `--json` for scripts. "It **never writes, repairs or prunes them**." |
| `plugin-catalog/index-network.yaml` | Social layer between personal agents: intents → opportunities → negotiation, with the negotiator run as a Bun child over a loopback bridge under an allowlisted environment that "**never [carries] the session token**". |
| `plugin-catalog/index-search.yaml` | Search one index and watch one saved query. "Scheduling and unscheduling ask for Hermes approval every time and are **refused under cron, yolo, approvals off, unattended sessions and `plugins.isolation: host`**, where the watch only posts a notice that it cannot run, on every run." "The job stays after uninstall until you run `hermes cron remove`." |
| `plugin-catalog/infisical.yaml` | Secret source resolving env vars from an Infisical store at startup (mapped `inf://` and bulk sources). |
| `plugin-catalog/inkbox.yaml` | Email, SMS/MMS, iMessage, voice and A2A platform: 31 tools including triage, read/unread marking, A2A task ask/call/complete/fail and sent-task tracking. |
| `plugin-catalog/inline-platform.yaml` | Inline work-chat integration. Honest: the wizard "can, on explicit opt-in, download `install.sh` and **pipe it to `sh` without a checksum**", and connecting publishes your slash-command list and skill names to the vendor server. |
| `plugin-catalog/intelligent-tool-break.yaml` | `/break` aborts a stalled in-flight tool call, `/break {message}` sends a note, `/again` retries it **without cancelling the rest of the task**. |
| `plugin-catalog/intelligent_memory.yaml` | Local-first Arabic/English memory with canonical facts, conflict lifecycle, bounded recall and selective cloud enrichment. |
| `plugin-catalog/interim-ledger.yaml` | JSONL ledger of the messages models write **mid-turn** (the text that rides with a tool call): counts per model/provider/surface/day, median length, 12-digit hashes of the session and turn ids, never the text. "Counted even where `display.interim_assistant_messages` hides them." |
| `plugin-catalog/invinoveritas-receipts.yaml` | **Signed, independently checkable receipts** for approval verdicts (and for turns that stop on iteration exhaustion, recording whether the turn's todo ledger was complete). "Anyone can check for free at /verify-proof and the holder can later open [the context] with the salt kept locally. **Never approves, denies, delays, continues or blocks anything.**" Sends a salted SHA-256 of the context, never the command text. |
| `plugin-catalog/iowap.yaml` | Fleet control pane: node status, queue depth, capabilities per node, and a tasks page that tracks submitted tasks live (per-stage status dots, result previews, artifacts) through a local node-cli. |
| `plugin-catalog/iteration-budget-meter.yaml` | Status-bar chip for per-turn iteration usage (N/60) with a hover tooltip and a click popover of per-request stats. |
| `plugin-catalog/ja-writing-guard.yaml` | Rule-based Japanese proofreading as a `transform_llm_output` hook: report mode by default; **enforce mode rewrites a flagged answer and delivers the rewrite only if numbers, names, URLs, code and negation survive** and the score drops under the threshold. |
| `plugin-catalog/jackal-verified.yaml` | 41 catalog-derived verification tools (exact, numerical, certified bounds, claim replay) over a reproducible release. |
| `plugin-catalog/jekyll-hyde.yaml` | Context optimization and execution alignment across `pre_llm_call` / `post_llm_call` / `transform_llm_output`. |
| `plugin-catalog/jet-browser.yaml` | One bounded verification tool: startup, native input, DOM agreement and PNG capture inside a **network-isolated, digest-pinned** container. |
| `plugin-catalog/jev-agent-router.yaml` | A skill plus one stdio MCP server (`agent_route`); "Registers no Hermes tools or hooks". |
| `plugin-catalog/jev-approvals.yaml` | **A decision model as the smart-approval reviewer only** — "it cannot generate text and refuses every other task"; validates typed answers, redacts command credentials, records bounded structured audit logs, and "provider or validation failures **fail closed to ESCALATE**". |
| `plugin-catalog/jev-cron-gate.yaml` | **Skips cron runs that would do nothing**: a pre-run wake gate asks one yes/no question over a small state snapshot and prints `{"wakeAgent": false}` when it is confident. "**Fail-open on every error, forced wake after N consecutive skips.**" |
| `plugin-catalog/jev-curator.yaml` | Semantic governance of the skill curator: classifies relationships between complete skill packages, produces **content-hash-bound, fail-closed consolidation plans**, and guards destructive `skill_manage` calls. A **60-second lifecycle debounce** coalesces changes into dry refreshes; "**automatic refreshes never apply mutations**". |
| `plugin-catalog/jev-effort-router.yaml` | Per-turn model **and** reasoning-effort routing in one `llm_request` middleware. "**Every failure path leaves the request byte-identical to a plugin-disabled run.**" |
| `plugin-catalog/jev-judge.yaml` | A pre-tool gate — **shadow by default, enforce escalates** — asking destructive / exfiltration / impact questions about terminal, write_file and patch. "One JSONL line per decision **with the fail-open reason**, fail-open on every error path." |
| `plugin-catalog/jev-mcp-router.yaml` | A skill plus one stdio MCP server (`mcp_select`). |
| `plugin-catalog/jev-memory-selector.yaml` | A skill plus one stdio MCP server (`memory_select`). |
| `plugin-catalog/jev-model-router.yaml` | A skill plus one stdio MCP server (`model_route`). |
| `plugin-catalog/jev-skill-router-mcp.yaml` | A skill plus one stdio MCP server (`skill_select`) that "**suggests at most one skill per request**"; the roster is read live from the profile skills dir. |
| `plugin-catalog/jev-skill-router.yaml` | Names the one skill from the live roster that fits the turn, before the model call, via typed routing with both thresholds applied in code. "**Says nothing when nothing fits**; opt-in, fail-open." |
| `plugin-catalog/jev-typesafe.yaml` | Typed decision tools — atomic yes/no checks, routing, rubric scoring, calibrated probabilities — for triage, routing and review gating. |
| `plugin-catalog/jev.yaml` | An explicit Jev decision sidekick: "advisory judgments, **no automatic tool gating**". |
| `plugin-catalog/jira-browser.yaml` | Jira workspace linking tickets to Hermes projects, worktrees and conversations; agent tools are read-only but "return Jira text (untrusted) to the model". |
| `plugin-catalog/job-search.yaml` | A local-first job-search assistant that judges postings against your prose preferences (**no scores**) and writes digests on a schedule you control. |
| `plugin-catalog/jot.yaml` | Notes, checklists and documents beside Hermes with **revision checks and undo for AI edits**. |
| `plugin-catalog/jp-address.yaml` | Splits a Japanese address into prefecture/city/town. "An address it cannot place for certain comes back as **ambiguous or at the municipality instead of a guess**." |
| `plugin-catalog/jp-charts.yaml` | Bar/line/stacked charts as phone-sized PNGs with a **required unit and source line** — and the strongest verification idea in the shard: "**Every bar, point, label and tick is read back from the finished figure and compared with the parsed data before the image is returned.**" |
| `plugin-catalog/jp-chatwork.yaml` | Chatwork room integration that polls instead of using a webhook, "**never answers a message twice across restarts**", and restricts commands and approval answers to the token's own account when no allow-list is set. |
| `plugin-catalog/jp-corporate.yaml` | Japanese corporate lookup on METI gBizINFO: search/verify a company and read its subsidies, government contracts, awards, certifications, financials and patents. |
| `plugin-catalog/jp-edinet.yaml` | EDINET filings API v2 (search, financials, save document). "**`found: false` only means the figure is missing from the consolidated current-year rows the plugin reads, not that the document has no number.**" "A past day's filing list can change." |
| `plugin-catalog/jp-egov-law.yaml` | e-Gov Law API: find a law, read one article **as in force today or on a given date**, check amendment history. "**Silence is not 'no amendment'.**" Registers a weekly-amendments blueprint but creates no cron job. |
| `plugin-catalog/jp-estat.yaml` | e-Stat government statistics: search tables, fetch population / household / wage / price figures. |
| `plugin-catalog/jp-kokkai.yaml` | Diet meeting search and short speech excerpts (≤10 excerpts, ≤240 chars each). "Adding or removing a watch asks for Hermes approval every time and is **refused under cron, yolo, approvals off, unattended sessions, and `plugins.isolation: host`**." |
| `plugin-catalog/jp-reinfolib.yaml` | Quarterly MLIT land-price data for one city. Honest: "**HTTP 404 means no data for that request, not zero rows and not unchanged prices**"; "A no-data week may be `[SILENT]` and not arrive." |
| `plugin-catalog/jp-subsidies.yaml` | Subsidy search plus a weekly watch. "Each call waits at most 60 seconds and retries at most twice, and **a result is a search match, not proof that every subsidy came back**." Honest failure mode: "**If delivery fails after the script runs, those subsidies are already marked seen** and the text stays under `cron/output/`." |
| `plugin-catalog/junie-acp.yaml` | JetBrains Junie as a model provider over ACP. |
| `plugin-catalog/kanban-gantt.yaml` | Gantt timeline over the kanban boards. On a cross-board move, "**the copy is verified there before the source rows and their links are deleted**". Live updates over an authenticated websocket, off with `KANBAN_GANTT_WS=0` (then it polls every 60 s and shows a Refresh button). |
| `plugin-catalog/kanban-graph.yaml` | Live read-only dependency graph; clicking a task lights up its whole lineage with runs, last failure and the worker's latest tool calls. |
| `plugin-catalog/kanban-live-gantt.yaml` | A now-centred Gantt with a persisted 72 h window, hour-tick zoom, a now line, and "**lifecycle rendering (dashed waiting vs solid run spans at real durations)**". |
| `plugin-catalog/kanban-stream.yaml` | Live-streams worker activity to a Telegram ops channel: one edit-in-place message per task, rolling tool-call history, elapsed timer, tokens/sec, thinking indicator, pinned final state; mid-task steering via task comments. Ships disabled; needs a dedicated ops bot. |
| `plugin-catalog/kanban-task-threads.yaml` | Every kanban task gets a Discord forum thread with a rewritten status card and an **append-only event log**. "The absolute workspace path is **off by default and requires explicit opt-in**." |
| `plugin-catalog/kfchow-llm-value-router.yaml` | Per-turn cost-tier routing: routine turns are **downgraded to the provider's free rung**, strategic turns escalated to a premium rung "after a **2-token billed credit probe** (Nous only, fail-closed)". Weak: the decision JSONL "**is never rotated**". |
| `plugin-catalog/kimchi-acp-provider.yaml` | The Kimchi coding harness as a provider over ACP; "its permission prompts stay on, and Hermes cancels them, so gated tools don't run, unless you opt in with `--yolo` … (not for shared gateway or cron use)". |
| `plugin-catalog/kimchi-provider.yaml` | Kimchi models via the OpenAI-compatible API; gateway unknown-model 400s classified as `model_not_found`; an identifying User-Agent on every request. |
| `plugin-catalog/kimi-code-delegate.yaml` | Delegate-only, **fail-closed** Kimi Code ACP integration (one tool). |
| `plugin-catalog/kiro-acp.yaml` | Kiro CLI (AWS) as a provider over ACP stdio. |
| `plugin-catalog/kiro-provider.yaml` | Native Kiro provider with AWS Builder ID / IAM Identity Center device login; OAuth grants stored in Hermes's profile-scoped credential pool. |
| `plugin-catalog/kiwi.yaml` | A2A commerce runtime: source suppliers and negotiate purchases; "Kiwi never handles payments". |
| `plugin-catalog/klipper-print-watch.yaml` | 3D-printer monitor on the Moonraker HTTP API: cron reports shutdown, complete, error, paused-after-printing, cancelled, stalled. "Pause, resume and cancel ask for Hermes approval every time and are **refused under cron, yolo, approvals off and unattended sessions**." |
| `plugin-catalog/kokoro-tts.yaml` | Local Kokoro-82M TTS on Apple Silicon with sentence-by-sentence PCM streaming and a per-sentence language switch; the local server "refuses other addresses, runs offline, and **does not log the text**". |
| `plugin-catalog/kuma.yaml` | Uptime-Kuma monitoring: workflow skills for incident review, status digests and **confirmation-gated maintenance**. Honest: the MCP server exposes 31 read/WRITE tools "including **permanent delete tools the bundled skills never call**". |
| `plugin-catalog/kumiho-memory.yaml` | Hosted memory for decisions, preferences and facts; the server is `trust: untrusted`, "so Hermes asks before every tool not annotated read-only". |
| `plugin-catalog/lancedb-suite.yaml` | Local-first vector memory with a **strict write contract, calibrated abstention, typed relations, conflict tracking and a retrieval-quality gate**. |
| `plugin-catalog/lancedb.yaml` | LanceDB hybrid memory: embedded vector + FTS recall, workspace facts, transparent forget. |
| `plugin-catalog/langfuse.yaml` | `official`: **one trace per turn, one generation per LLM call** (usage and cost from Hermes's own pricing, cache and reasoning tokens included), one observation per tool call and subagent. "Content capture is **sanitized by default** (metadata-only and full are opt-in)." |
| `plugin-catalog/laso-finance.yaml` | Money-moving plugin (cards, payouts, transfers) with 19 approval-gated tools. Honest: "**`approvals.mode off` / yolo, or `approvals.cron_mode`/`unattended_mode` approve, let them run without a prompt**". Also per-agent **spend limits** and agent API keys. |
| `plugin-catalog/letsfg.yaml` | Flight and hotel booking over a hosted MCP. "Per LetsFG, a booking … starts only when the user presses Approve in an e-mail from LetsFG, **never from the conversation**." |
| `plugin-catalog/lib-docs.yaml` | Look up current library docs from public npm and PyPI (no keys), with a Desktop pane. |
| `plugin-catalog/lightningai-rate-limit.yaml` | Per-process throttle keeping LLM requests inside a ~15 req/min limit with an in-memory token bucket. "Gates only calls whose provider or base_url points at Lightning AI; **no-op otherwise**." |
| `plugin-catalog/lightningai.yaml` | Lightning AI as a model provider; models fetched live from `/models`. |
| `plugin-catalog/limbic.yaml` | **Self-organising memory with a deterministic lifecycle**: adaptive trust scoring, activation maturation, **interference-based forgetting**, NLI-based correction detection and synaptic atrophy — "No LLM cost — all lifecycle mechanisms are deterministic." "**Recall is confidence-gated: when nothing clears the calibration floor, recall abstains (`no_confident_match`) instead of surfacing near-misses.**" Stores record the embedder that produced their vectors and report `stale_embedder=true` after an embedder change until reindexed. |
| `plugin-catalog/linkup.yaml` | Linkup cited search (fast/standard/deep), JS-rendering fetch, async deep research, and a backend for the built-in `web_search`/`web_extract`; fetched pages cached 24 h. |
| `plugin-catalog/liquid-inference-provider.yaml` | An **auction exchange for LLM inference**: each request goes to the eligible offer with the lowest estimated charge, and each request carries a **charge cap (1 USD by default)**. |
| `plugin-catalog/little-canary.yaml` | Screens user turns and blocks downstream tools on a BLOCK verdict; "the original prompt still reaches the model". |
| `plugin-catalog/live-time.yaml` | Injects the live current time into every LLM call via `pre_llm_call` — "fixes stale session-start timestamps in long/cross-day conversations". |
| `plugin-catalog/llm-antidote.yaml` | **Runtime guardrails + signed fleet admission**: a *versioned capability policy* that blocks or requires approval for model tool calls, paired synthetic behavioural evaluation **with no real side effects**, and a signed local promotion gate that "**refuses a model whose evidence does not satisfy signed fleet policy**". Balanced mode sends MCP/connector/plugin tools, memory and skill writes, out-of-tree file reads and network-capable commands to the approval prompt; **strict mode blocks them instead**. |
| `plugin-catalog/llmslim.yaml` | Context engine that compresses older tool output and turns **locally, with no LLM call and deterministic output**, and "**the start of the prompt is sent unchanged, so prompt caching keeps working**". |
| `plugin-catalog/local-system-one-hermes.yaml` | A control plane for **reversible OFF/Shadow/Canary routing decisions** with explicit Canary acknowledgement and fail-open behaviour. "Its only request mutations, in acknowledged Canary mode on the **first provider call of a turn**, are removing `web_search`/`web_extract` tools for audited deterministic no-Web rules and (off by default) lowering `reasoning_effort` on audited hard-fast rules." |
| `plugin-catalog/local_knowledge.yaml` | A configurable local capability index: search / get / neighbours plus **local usage feedback and reporting**. |
| `plugin-catalog/long-conversations.yaml` | Persistence across session boundaries via **structured handoff briefs** (topic, work in progress, decisions, open questions, next step) injected into the first turn of the next session for the same chat or user. |
| `plugin-catalog/looot.yaml` | One sign-in and one prepaid balance for 2,500+ data endpoints. "Hermes asks before each paid call and **refuses them in unattended runs**." |
| `plugin-catalog/loreconvo.yaml` | Cross-surface persistent session memory: stores end-of-session transcripts (truncated, including tool output) and memory writes in a store shared across all profiles. |
| `plugin-catalog/lowrouter.yaml` | Model provider whose picker shows the 180 tool-capable `auto/` models "**instead of all 719 IDs from `/v1/models`**", and takes context windows from the provider's catalog "instead of Hermes' 256K fallback". "LowRouter bills in EUR, so the plugin reports no USD cost and **Hermes shows it as unknown**." |
| `plugin-catalog/lumberroom.yaml` | One durable memory store shared across agents; setup "switches off Hermes' built-in MEMORY.md/USER.md store" so there is one source. |
| `plugin-catalog/machine-library.yaml` | Research search backend for `web_search`/`web_extract` — papers, books, patents, standards, Wikipedia — with citable source links. |
| `plugin-catalog/machine-spirit.yaml` | A Warhammer 40k shrine pane that animates while Hermes works. "Just for fun." |
| `plugin-catalog/made-shelf.yaml` | Cross-session shelf of every path the agent wrote or patched. |
| `plugin-catalog/magi.yaml` | **Review pending memory writes** and inspect / add / edit / delete / AI-compact stored memory from the Desktop. |
| `plugin-catalog/make-parts-now.yaml` | Quote custom parts from CAD files; "Nothing is charged in chat: checkout links open Stripe Checkout … where the user pays." |
| `plugin-catalog/maqami-travel.yaml` | Hotel/flight search and real booking changes over a hosted MCP; "the skill tells the agent to show the details and **get a clear yes before each prebook, amend or cancel**". |
| `plugin-catalog/markdown-new.yaml` | Search, read-as-Markdown, crawl and convert via the public markdown.new service. |
| `plugin-catalog/markifact.yaml` | 50+ ad/analytics platforms through a hosted MCP. Honest: "every write is a separate approval-gated operation and the skills instruct confirm-before-spend, but **that is enforced by the skills and the server's approval flag, not by Hermes**." |
| `plugin-catalog/max-platform.yaml` | MAX messenger gateway. Honest: "Inbound attachments are downloaded **only for allowlisted senders**, with SSRF protection"; "**The MAX allowlist does not honour Hermes pairing approvals.**" |
| `plugin-catalog/mcp-plugin-creator.yaml` | Turns any MCP server into a portable Agent Plugin **built from evidence** — the server's self-description, your past sessions with it, its docs and a **read-only probe** — then "checks a built plugin for **server drift** and new errors in use". |
| `plugin-catalog/mcp-serve.yaml` | `official`: run Hermes as an MCP server. "`--tools` (off by default) also exposes web, browser, vision, image generation, skills and TTS tools; **terminal, file and kanban tools are never exposed**." |
| `plugin-catalog/meeting-overlay.yaml` | Live meeting transcript pane plus a launchd recording agent. |
| `plugin-catalog/mem-os.yaml` | Local-first persistent memory in a local SQLite; a skill covering **when to store and when to recall**. |
| `plugin-catalog/mem0.yaml` | Mem0 provider with server-side LLM fact extraction, semantic search, automatic dedup and opt-in reranking. Honest: "the mem0ai library's anonymous PostHog usage telemetry **stays on unless `MEM0_TELEMETRY=false`**". |
| `plugin-catalog/memanto.yaml` | Typed long-term memory (remember/recall/answer) with auto-recall and turn capture. |
| `plugin-catalog/memex8.yaml` | Self-hosted vector memory with **decision/evaluation memory-type promotion (slower decay for load-bearing turns)**, **prompt-injection sanitization on read**, per-session injection dedup with a char-budget gate, and a "slumber" consolidation pipeline. |
| `plugin-catalog/memlock.yaml` | **Reasserts pinned standing instructions after context compaction** — the answer to "the rules I set must survive the summary". |
| `plugin-catalog/memobase.yaml` | Self-hosted user-profile + event-timeline recall with hybrid BM25/vector/entity retrieval and automatic per-turn prefetch. |
| `plugin-catalog/memoria.yaml` | Cloud memory with scoped recall, explicit tools and opt-in background capture over a local SQLite outbox. Honest: "**Ambiguous write outcomes are not automatically retried; this plugin does not provide exactly-once capture**", and "auto capture can retain paraphrases, recalled facts from later turns … global semantic deduplication is not guaranteed". |
| `plugin-catalog/memory-review.yaml` | **Checkbox staged memory writes** and approve or reject the selection from a dialog. |
| `plugin-catalog/memory-rewind.yaml` | Git-backed version history for MEMORY.md / USER.md / SOUL.md / skills: browse, diff, restore. "Runs the local git binary (**isolated from the user's git config, hooks and signing**)" and "reads only the tracked files (never `.env`, `auth.json`, databases or `skills/.hub/`)". |
| `plugin-catalog/memory-shield.yaml` | **The memory write-policy plugin.** By default the agent may add facts to the owner profile anywhere it may write, may correct one only when the owner asks in a direct/CLI/trusted chat, and **nobody may delete one**; the agent's own notes cannot be deleted; group chats are read-only; **Hermes' unattended background review may not touch the owner profile**. Three modes — block, ask through the approval gate, or just log — plus **snapshots taken right before an allowed edit** (20 per file) and undo. Audit JSONL keeps the last 500 refused or flagged writes. Honest limits: "**Without `trusted_users` every direct chat counts as the owner**", and spotting edits made through terminal/execute_code is "best effort". |
| `plugin-catalog/memory-zvec.yaml` | In-process HNSW + RocksDB FTS store with native hybrid retrieval and session-safe lock governance. |
| `plugin-catalog/memtomem.yaml` | Markdown-first memory shared across coding agents, over a local MCP server. Honest: "At startup the server also reads the nearest `.env` found upward from its installed location … **outside Hermes's MCP environment filtering**." |
| `plugin-catalog/mermail.yaml` | Privacy-first agent inboxes over a hosted MCP. Honest: "the skills allow the agent to **move funds without a same-turn confirmation** when your message already states exact terms, so spending controls live on your Mermail account, not in Hermes." |
| `plugin-catalog/meshy.yaml` | `official`: Meshy's own MCP for 3D generation. "Every credit-spending call goes through Hermes's approval prompt with its estimated cost, and a **200-credit limit per chat makes it ask again**." |
| `plugin-catalog/metamask-wallet.yaml` | MetaMask Agent Wallet: chat-only setup, approval-gated transfers/swaps/signatures, a **gated Guard Mode policy editor**, and a background 2FA watcher. "Keys stay in MetaMask." |
| `plugin-catalog/metronix.yaml` | Memory provider with prefetch recall and built-in memory write-through. |
| `plugin-catalog/microsoft365.yaml` | Pre-release M365 Graph tools for Outlook, SharePoint, OneDrive, Calendar, Teams, To Do, Planner, with a preflight tool. |
| `plugin-catalog/mindgraph.yaml` | Semantic graph memory with hybrid retrieval, goal/decision tracking and cross-document synthesis. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/minecraft-platform.yaml` | A Mineflayer bot that joins a server and relays chat to the agent. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/minimax-image.yaml` | MiniMax Image-01 text-to-image and image-to-image with subject reference. |
| `plugin-catalog/minimax-search.yaml` | MiniMax web search via the Token Plan API. |
| `plugin-catalog/minimax-video.yaml` | Hailuo text-to-video, image-to-video and subject-reference-to-video over the async task API. |
| `plugin-catalog/mistral-vibe.yaml` | Mistral Vibe subscription access via browser PKCE login and a dedicated credential pool. Honest: "Logout clears the local pool but **does not revoke the key remotely**", and "Vibe subscription coverage of API use is not guaranteed and may bill as pay-as-you-go". |
| `plugin-catalog/mnemostack.yaml` | Hybrid recall (vector + lexical + graph) with **verbatim capture with self-echo suppression** and soft retraction; multi-tenant when pointed at a shared service. |
| `plugin-catalog/mnemosyne-dashboard.yaml` | Local-only dashboard for browsing memories, triples, stats and consolidation history. |
| `plugin-catalog/mnemosyne.yaml` | Local-first memory (SQLite, vector + FTS5 hybrid recall, episodic consolidation, temporal knowledge graph) with 41 tools, including **persona promote/demote/reinforce**, a `sleep` consolidation, and `recall_diagnostics`. |
| `plugin-catalog/mnemoverse.yaml` | Hosted memory shared across tools: "rating a recalled memory as helpful or misleading **re-ranks what comes back next**". |
| `plugin-catalog/model-drift-watch.yaml` | **Scheduled check that the model has not quietly got worse**: 34 fixed, exactly graded questions run through cron, each compared against the same model's own baseline with "an **exact per-question test and a same-day confirmation run**", and a message only for a **confirmed drop**, a changed served model, or a failed measurement. Each check is capped (default 120k tokens / $0.50). |
| `plugin-catalog/model-picker.yaml` | Per-turn cost classifier across three tiers, "**biased to keep the previous tier unless the turn changes shape**", with `escalate_model` for tool failures that "replaces the next request's context with a **model-written handoff summary plus the recent tail**". |
| `plugin-catalog/model-router.yaml` | Profile model settings, opt-in Heavy/Light routing, fallback controls and runtime limits. Its stated delegation rule is quotable: "Small bounded changes stay with Main. Ordinary implementation delegation requires **two substantive independent workstreams with net parallel benefit** … This is guidance, not an API two-job minimum." |
| `plugin-catalog/model-usage-status.yaml` | Provider-native Claude and Codex remaining-allowance windows in the status bar. |
| `plugin-catalog/monid.yaml` | One integration for many paid third-party tools. Honest: "The 'confirm the price first' step is **an instruction to the model in the bundled skill, not a Hermes approval prompt**, unless you add `trust: untrusted`". |
| `plugin-catalog/morning-briefing.yaml` | A personal daily newspaper rendered as one newsprint page and printed each morning by a cron job. |
| `plugin-catalog/mrscraper.yaml` | Paid web search, rendered extraction, crawling and scraper-authoring tools. |
| `plugin-catalog/ms-decision-provider.yaml` | **Typed decision tools that preserve full probability distributions** (`decision_noul`, `decision_choice`, `decision_score`, `decide`), plus an opt-in `pre_tool_call` gate that "requests human approval for known-risk calls **without sending their arguments to Azure**"; `MS_DECISION_GATE_MODE=block` hard-denies. The repo ships a **labelled eval corpus containing literal destructive commands as should-refuse examples**. |
| `plugin-catalog/my-github.yaml` | Status-bar chip + dashboard tab listing your repos (public and private) via the `gh` CLI. |
| `plugin-catalog/mybot-farm.yaml` | Search and plant community Hermes profiles. Honest: "plants third-party Hermes profiles (config, SOUL, skills, memories) from mybot.farm sellers **with no hash pinning**". |
| `plugin-catalog/myswarm.yaml` | Community `agents.md` swarm configs: visualize, sanitize, export, import/revert. "Every import/revert asks for approval." Honest: "The import security check is a **best-effort regex + model warning, not a security boundary**". |
| `plugin-catalog/nachos.yaml` | Durable memory **and** context compression in local SQLite or flat files; the provider injects a system-prompt block and disables built-in memory so there is one source. |
| `plugin-catalog/needs-you.yaml` | "Hermes is waiting" — a full Desktop page for pending approvals: queue, chip, OS notification, **redacted previews only**. |
| `plugin-catalog/nerve.yaml` | A supervisory nervous system: evidence-backed kanban supervision, context governance, **token-budget trajectory control**, durable SSH workers, and a `pre_verify` hook. "The operator-only `nerve setup` CLI … **the model cannot trigger this**." |
| `plugin-catalog/netmind-provider.yaml` | NetMind OpenAI-compatible provider with a bundled model catalog. |
| `plugin-catalog/next-prompt.yaml` | Suggests the next message after each turn as a pill under the composer — the likely answer when the agent asks, or the natural next step. |
| `plugin-catalog/next-steps.yaml` | Next-step suggestions computed **locally with Ollama**; clicking one submits it to the current session, a new session, another profile, or a kanban card. |
| `plugin-catalog/nextcloud-talk.yaml` | HMAC-verified Nextcloud Talk bot webhooks. Honest: "Dedupe is in-memory and **does not survive restart**; uncertain sends are not automatically retried." |
| `plugin-catalog/nextdns.yaml` | Read-only DNS query logs, blocked queries with the matching blocklist, and aggregate analytics. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/nexus.yaml` | Self-hosted Qdrant memory with **guardrail rules** (`nexus_guardrail_check` / `nexus_guardrail_override`), a knowledge graph, and cost-routing stats. "**Access levels fail closed: a memory, a protection rule or a graph label without a known level counts as the most restrictive.**" The local service's routes "demand a per-installation key … and reject non-loopback Host/Origin, while the open `/healthz` answers liveness only". |
| `plugin-catalog/ngrok-ai-gateway.yaml` | One key for many providers with failover. "Gateway errors (unrouted model, access-policy and upstream-key failures, out of credit) **map onto Hermes' fallback instead of a generic error**." |
| `plugin-catalog/nine-balance-widget.yaml` | Nine provider balances in one widget, with off-peak price windows and drop alerts. Honest: keys are "stored in **plaintext in Desktop plugin storage (not Hermes' secret store)**". |
| `plugin-catalog/node-search.yaml` | Bounded Markdown metadata+graph prefilter over configured local roots. |
| `plugin-catalog/nowstamp.yaml` | "Give the agent a clock": appends the current date and time, plus **the real gap since the previous message**, to every user turn, with spaced-out timestamps on tool results for long runs. |
| `plugin-catalog/ntfy-approval.yaml` | Answer approval prompts from a phone: Approve once / Approve for session / Deny. "**No answer still means deny**" and "**any failure or timeout is a deny**". Honest: "anyone who can read the ntfy topic can approve dangerous commands". |
| `plugin-catalog/nvidia-app.yaml` | `verified`: NVIDIA App control over its local MCP; "the install is **refused when the app is absent**", and the endpoint and token are re-read on every connection so a changed port needs no reconfiguration. |
| `plugin-catalog/nvidia-broadcast.yaml` | `verified`: NVIDIA Broadcast camera/mic/speaker effects over its local MCP gateway. |
| `plugin-catalog/obsidian-memory.yaml` | Browse, search and edit Obsidian vault notes from the dashboard; force-directed graph, multi-vault, wikilinks. |
| `plugin-catalog/oc-free-provider.yaml` | Discovers live zero-cost tool-capable models by intersecting two catalogues, persists only the last successful intersection for restart fallback, and **translates tool schemas bidirectionally while Hermes executes tools locally**. |
| `plugin-catalog/office-desk.yaml` | Guarded Word/PowerPoint/Excel editing with tracked changes, redlines, recalc and diffs. "**Every write gets a backup and a revertible receipt**, and you review it all on a Desk page." |
| `plugin-catalog/offpeak-bekci.yaml` | Off-peak window made actionable: a countdown chip, a one-shot notice 30 minutes before the window, and "**approval is taken only from the user** … **nothing is installed without a hash-bound approval typed by the user**, and **the plugin never writes the cron store**". Measure-only by default: the middleware "records what it would delay and **never delays**". It cites the admission rules inside the entry: "the private `gateway.session_context` module (**rule 9 → not used**)". |
| `plugin-catalog/omh.yaml` | A large bridge plugin: routing hints, per-task delegation routing, plan todos, evidence probes that "**keep prepared work apart from observed results**", a source-trust tool and a decision gate. Honest hole: `omh_gather_evidence` "runs allowlisted checks … via subprocess on the host, **outside any sandboxed terminal backend and without Hermes' terminal approval**". |
| `plugin-catalog/omnivoice.yaml` | OmniVoice TTS provider. |
| `plugin-catalog/opaque-composer.yaml` | Keeps the desktop composer opaque while scrolling so the text stays readable. |
| `plugin-catalog/openai-compatible.yaml` | GPT Image through any OpenAI Images-compatible gateway, with "gateway-aware errors and **requested-vs-returned size reporting**". |
| `plugin-catalog/openalex.yaml` | Scholarly search, citation traversal, grouped counts and fulltext through OpenAlex, with **session spending limits**. |
| `plugin-catalog/opencode-shepherd.yaml` | Watches opencode sessions: alerts for stopped turns, questions and permissions, plus a dependency-free CLI to reply. |
| `plugin-catalog/openinvest.yaml` | **A self-hosted AI investment committee**: portfolio review, a **decision ledger**, and a **4-role LLM committee (macro / quant / risk / CIO) that debates a symbol**. "Buy/sell/deposit/withdraw only edit the local ledger — **it never connects to a broker or places orders**." The MCP snippet runs with `trust: untrusted` so Hermes asks before ledger writes. Honest: "news ingestion can trigger extra committee runs (LLM spend)". |
| `plugin-catalog/openltm.yaml` | Local SQLite memory with FTS5 + optional vector recall, **importance-weighted decay**, a queryable memory graph, and a **declarative rule engine that classifies corrections, constraints, preferences, decisions and agent-discovered facts** into distilled self-contained facts. "**Runtime notifications and read-only tool requests are excluded by named guards so ops noise never becomes memory.**" |
| `plugin-catalog/openmail.yaml` | Gives the agent its own email address: inbound mail wakes the agent over a websocket, replies go out in-thread. |
| `plugin-catalog/openrouter-picker.yaml` | The Desktop model picker + a composer provider: "**Checking a model here is what the composer lists**" — one list, one truth. |
| `plugin-catalog/openrouter-spend.yaml` | Key spend and recorded chat costs in USD/INR; middleware on every LLM request records ids, model, token counts and reported cost (no prompt or reply text). |
| `plugin-catalog/openrouter-voice.yaml` | OpenRouter STT and TTS providers. |
| `plugin-catalog/openspec.yaml` | Spec-driven development: change/spec/task lifecycle, diffs, promotion, archiving and validation (22 tools). |
| `plugin-catalog/openviking.yaml` | Long-term memory in Quick Local / managed cloud / own server. Honest: "its localhost server **keeps running after Hermes exits and after plugin removal**", and Quick Local setup installs "the newest 0.4.x server release from PyPI at setup time (checked against PyPI's hash, **not the version reviewed here**)". |
| `plugin-catalog/operations.yaml` | A fleet operations page: topology, model traffic, handoffs, traces, merge requests and **conformance checks**. "With `drift_action: automatic` it files and starts a fix card for drift … **with a verified report (at most daily)**", and "'Propose a rule' pushes a branch and opens a merge request on the standard's GitLab project." |
| `plugin-catalog/optchat.yaml` | Endless memory: an **append-only verbatim log** plus a binary summary tree; prefetch returns a **fixed-budget view** of the whole history, and `optchat_zoom`/`optchat_date` open any line down to the verbatim message. Weak: everything is "appended permanently to unencrypted owner-only files … **with no deletion or retention limit**". |
| `plugin-catalog/optmem-hermes.yaml` | Local append-only memory with regex/BM25 recall and a bounded wake digest; **verified migration and rollback**; compaction is manual unless `auto_nap` is on. Honest: "**Summaries are lossy, raw records remain recoverable, and conflicts are not resolved automatically.**" |
| `plugin-catalog/orbit-desktop.yaml` | A bundled browser desktop the agent can reshape: versioned sandboxed web apps, scoped control, previews and checkpoints; a reviewed app catalogue with immutable source pins; "installed UI runs in a sandboxed iframe and **never executes backend code**". |
| `plugin-catalog/orcaslicer.yaml` | Prepare, slice, preflight and export 3D prints; explicit printer upload/control, camera snapshots and monitoring. Honest: "**agent-supplied confirmation is not independent human authentication**." |
| `plugin-catalog/orquehelx.yaml` | **Per-call delegation across your own subscriptions**: each route pins a provider and a model. "**A child counts as out of quota only on an unambiguous provider error or a measured window at 100%, and the route never switches on its own: a policy decides whether the parent asks you, picks another route, or waits.**" A `pre_tool_call` hook *blocks* `delegate_task` spawns while routes are configured. |
| `plugin-catalog/osv-ref.yaml` | `@cve:` / `@ghsa:` / `@osv:` context references: attach a vulnerability record (summary, aliases, severity, affected ranges and fixed versions), merged across up to four alias records. |
| `plugin-catalog/parallel-search.yaml` | Free web search and page fetch through Parallel's hosted MCP. |
| `plugin-catalog/parcel-deliveries.yaml` | Parcel tracking with "a built-in guard for Parcel's strict rate limits"; the model may add deliveries to the account, **add-only, capped at 20/day**. |
| `plugin-catalog/parlor.yaml` | Rooms where agents of any vendor talk over plain HTTP — a room is a URL, no accounts, no sign-in. |
| `plugin-catalog/parrotnotes.yaml` | Meeting notes, transcripts and insights through a hosted MCP. |
| `plugin-catalog/pass-secrets.yaml` | `pass` (GPG-encrypted, git-tracked password store) as a first-class secret source beside Bitwarden and 1Password. "Stdlib-only … **no network — ever**." It also adds "a ~900-char system-prompt note about secret resolution". |
| `plugin-catalog/pastdotdev.yaml` | Source-traced recall from past conversations; sessions are sent to past.dev when they end, with "common secret shapes redacted". "Off by default on messaging-gateway sessions." |
| `plugin-catalog/pay-cli.yaml` | Pay per request in stablecoins through the local Pay CLI. "**Each payment is confirmed by the user through MCP elicitation (declined when nobody can answer)** and the server is marked untrusted." |
| `plugin-catalog/pay.yaml` | The hosted Pay MCP. "Hosted Pay enforces the account's spending limits (**none move until the user sets them**)"; honest: the documented OAuth setup "replaces that [untrusted] entry with a native one that runs at `trust: full` unless the user sets `mcp_servers.pay.trust: untrusted`". |
| `plugin-catalog/pcs-security-tls-posture.yaml` | Read-only audit of local TLS posture: certificate validity, key strength, deprecated protocols, weak cipher suites. No network, no subprocesses. |
| `plugin-catalog/pdf-surgeon.yaml` | **The shard's best verification design.** Rewrites PDF text in place, keeping the typesetting, and then *verifies*: the edited line must read exactly as the original with the phrase swapped and nothing else, every other line unchanged, block count / baseline / font / size / spacing held, the old phrase's occurrence count down by exactly one, and the page's font-size-colour set unchanged — "**a pixel-diff band is reported for information and does not decide the outcome**". "A fuzzy match is **refused** rather than allowed to edit text the caller never named." "Until an edit is accepted the output is written under a temporary name … and **moved into place only after verification passes, so a failed check leaves nothing behind**." |
| `plugin-catalog/pending-queue-monitor.yaml` | Read-only monitor for pending memory and skill write approvals. "It returns only counts, age buckets, oldest age, and per-item profile/subsystem/id/action/origin/created_at/age_seconds. **It never returns or displays summaries, payloads, or record content; it exposes no approve, reject, or delete actions.**" |
| `plugin-catalog/penny.yaml` | Hosted private notes. "Works **only in local CLI/TUI conversations (cron, subagents and gateways are refused)**"; tokens "are not removed on uninstall". |
| `plugin-catalog/pep-ref.yaml` | `@pep:<number>` context references with section addressing and local autocomplete. |
| `plugin-catalog/personae.yaml` | A messenger-style roster of profiles with live sessions and status lights; "Apropos starts a new session with a **hidden pointer message** naming the sessions you picked". |
| `plugin-catalog/phone-harness.yaml` | Drive a real phone with one tool. Honest: "every `phone_exec` call goes to Hermes's approval prompt unless you opt in to **classifier auto-run, a heuristic, bypassable check** that decides which scripts ask first". |
| `plugin-catalog/photofresco.yaml` | Edits images in a PhotoFresco window the user approves. Honest: "with the Send/Spend permissions granted in the PhotoFresco window, AI ops spend PhotoFresco credits … and **Hermes does not prompt before those calls**". |
| `plugin-catalog/pinned-folders.yaml` | A Pinned tab that files pinned chats into nested folders, with unread/working badges and clipboard layout export/import. |
| `plugin-catalog/pixel-worlds.yaml` | Pixel-art realms the agents inhabit in the Desktop. |
| `plugin-catalog/plan-mode.yaml` | **Plan mode, and the shard's clearest human-approval design.** `/plan` **blocks mutating tools** through `pre_tool_call` while the agent explores and writes a plan. One approval card offers: approve and auto-accept edits, approve and review each file edit, or keep planning. "**The text you were shown is saved as an approved snapshot, so later edits to the file do not change the approval.**" "**When yolo or `approvals.mode: off` would auto-approve, it asks through clarify instead, so a person still decides.**" The lean profile "asks **at most three** targeted questions"; the agent does not commit unless asked; each allow-list entry is "**keyed to one plan revision, so it cannot approve another plan**"; the revised plan says what changed since the last revision; and on the classic CLI the printed plan is not retyped (`write_once`). |
| `plugin-catalog/pocket-watch.yaml` | **A read-oriented window onto the scheduler**: cron jobs by schedule, a health view of run outcomes and **consecutive failures**, a timeline, and maintenance actions. "Rather than another agent-facing toolset." |
| `plugin-catalog/post-cortex.yaml` | Typed records (**decisions, fixed problems, code changes**) in an entity graph with local semantic search; mirrors built-in memory writes; "**cron and subagent runs never write automatically**"; the daemon redacts credentials, e-mails, phone numbers and public IPv4 addresses on write. |
| `plugin-catalog/pricewin.yaml` | Live hotel/flight prices across four sites over a hosted MCP, with inline cards in the transcript. |
| `plugin-catalog/print-job-watch.yaml` | A cron watch on one OctoPrint printer with a **precise state machine**: "reports printer_disconnected (**not a pause**); error; complete after Printing, Printing from SD, Pausing, Paused, Resuming, or Finishing; paused after Printing…; cancelled; and stalled". Pause/resume/cancel "ask for Hermes approval every time and are **refused under cron, yolo, approvals off, single-query, unattended sessions**". Honest: at the default 5-minute cadence "it is **288 runs a day with no daily cap**". |
| `plugin-catalog/prism.yaml` | Prism OpenAI-compatible inference with long-context DeepSeek models. |
| `plugin-catalog/privacy-gateway.yaml` | Local Presidio PII pseudonymization for model requests **and tool results**, with an **encrypted profile-scoped alias vault**. "**Requests are blocked when the engine cannot load**" (fail-closed, unlike `hermes-pii`); tools outside `rehydrate_tool_allowlist` receive alias tokens, not plaintext. |
| `plugin-catalog/profile-models.yaml` | A read-only Desktop map of the main, auxiliary, sub-agent and MoA model routes. |
| `plugin-catalog/profile-pane.yaml` | Cross-profile config pane: copy `.env` values between profiles, rewrite other profiles' SOUL, memory and config. |
| `plugin-catalog/profile-picker.yaml` | Pick the profile for a new chat in the composer, and see which profile a running chat belongs to. |
| `plugin-catalog/progress-squash.yaml` | **Collapses carriage-return progress bars so the model reads one line instead of every redraw** — "a 300-step tqdm loop goes from 17,396 characters to about 120". One `transform_terminal_output` hook, no tools. |
| `plugin-catalog/promoat.yaml` | AI clone videos with your own face and voice; 23 tools including clone/delete of account assets. |
| `plugin-catalog/prompt-enhance.yaml` | Rewrites a composer draft outside the chat and puts the finished prompt back in the field; a prompt library; "a one-call model pick **does not change the session**". |
| `plugin-catalog/prompt-enhancer.yaml` | A composer button that rewrites a rough draft into a structured prompt (task / scope / constraints / output shape) and restores the original on a second click; "**one stateless gateway call, preserves `@file` and `/command` chips**". |
| `plugin-catalog/prompt-optimizer.yaml` | Model-aware prompt rewriting with quality scoring and analytics. Honest: "the default auto mode **rewrites every user message of 5+ words through your configured model (one extra LLM call per turn)** before the agent sees it". |
| `plugin-catalog/prompt-pocket.yaml` | A local prompt library with validated JSON import/export and IndexedDB storage. "Does not read or modify composer drafts, send messages, or make network requests." |
| `plugin-catalog/prompt-queue.yaml` | A kanban-style prompt queue: Play drains cards one at a time into per-card targets (new session, existing session, project, a profile''s Bot Chat), "**gated on the global model slot, background-review completion, and context compaction**". A trust-aware `::enqueue` directive is ask-first by default. |
| `plugin-catalog/prompt-snippets.yaml` | A snippet library rendered as an official Popover; draft writes go through the host composer draft API. "Inserts into the focused session, not the active one." |
| `plugin-catalog/prompt-studio.yaml` | A step-by-step prompt builder (option cards per step with AI suggestions), each AI call on its own auxiliary task. Honest: on opening in an existing chat it reads the last 8 turns plus any compaction summary from `state.db`, redacts secrets, and sends up to 8k chars to the auxiliary model. |
| `plugin-catalog/prompt-tray.yaml` | Saved prompts inserted into the composer. |
| `plugin-catalog/proofable-mcp.yaml` | Hosted agent identity, scoped access, wallet-signed proofs and a secret vault over a hosted MCP. |
| `plugin-catalog/protean-model-sync.yaml` | Fleet-wide provider and model presets, written into the config of the profiles you select (backup first). |
| `plugin-catalog/protean-ordaprompt.yaml` | A comparative classifier that "compares **all** topic labels and session choices in one batch, including new-topic, ambiguous, and new-session options", using "**calibrated score and margin gates**, weighs continuity against context cost and contamination, and **abstains when uncertain**". |
| `plugin-catalog/protean-subagent-viewer.yaml` | A read-only pane for live and past delegated subagent workers. |
| `plugin-catalog/protonpass.yaml` | Proton Pass as a secret source beside Bitwarden and 1Password: `pass://vault/item/field` references or a whole vault; a 0700 session dir and a 0600 value cache. |
| `plugin-catalog/provenance-gate.yaml` | **Grounds a written decision in the trader''s own words.** Flags memory and `skill_manage` writes that state a user decision ("the user decided …", "用户决定 …") **without the user's own words**: the sentence needs a **quote that appears verbatim in text the user typed in this session**, shares key words with the decision and **does not drop a negation**. "A patch is checked by **the text it produces**." Observe mode records; block mode refuses and tells the model how to fix it. "**Measured on an independent blind set of 133 lines: precision 1.000, recall 0.694.**" Evidence log kept 30 days by default. |
| `plugin-catalog/provider-copy.yaml` | Copy provider API keys from one profile onto others: a one-time explicit copy, fill-missing by default with an explicit overwrite opt-in, and "**OAuth sign-ins and messaging bot tokens never travel**". |
| `plugin-catalog/provider-status.yaml` | Status-bar quota tracking for 17 providers, with peak/off-peak gauges and countdowns for DeepSeek and GLM. "This edition does not rotate Hermes environment keys on exhaust." |
| `plugin-catalog/provider-usage.yaml` | Per-provider quota and balance chips with "**burn-rate projections (ETA to reset or depletion)**", a notification per threshold crossing, and a near-limit amber tint. |
| `plugin-catalog/pstack.yaml` | An engineering-rigor stack: 7 playbooks (new-feature, bugfix, refactor, testing, one-shot, migrate, explore) plus how / architect / interrogate / swarm / unslop skills. |
| `plugin-catalog/public-holidays.yaml` | Public holidays for 200+ countries plus workday checks, workday counts and **deadline math (N working days after a date), computed in code instead of by the model**. |
| `plugin-catalog/pushary.yaml` | Phone notifications, questions and approvals as a native approval transport, with per-tool gates that **fail closed**; queued messages are "injected into the next turn as operator instructions". |
| `plugin-catalog/pushover-hermes-plugin.yaml` | Outbound-only Pushover platform plus opt-in lifecycle notifications (finished, questions, errors, approvals, kanban blockers). "Outbound-only, **no inbound or approval path**". |
| `plugin-catalog/qdrant-memory.yaml` | Native memory with LLM fact extraction into Qdrant, plus a **SQLite WAL admission ledger that makes every write idempotent and replayable across restarts with fail-closed recovery**. Honest: "**single-writer design**: a local ownership lock excludes a second writer", and "deletion removes records and fences pending operations, but is **not a forensic secure erase** (SQLite WAL pages and backups may retain content)". |
| `plugin-catalog/qdrant.yaml` | Dense semantic memory where "each turn becomes one point — **user and assistant text verbatim, no LLM summarization step** … so a result **quotes what was actually said**". "A **circuit breaker (5 consecutive I/O failures, 120 s cooldown) degrades to no new memories instead of crashing**, and `is_available()`/`check_backend()`/`unavailable_reason()` **distinguish a misconfiguration from a dead server**." `qdrant_forget` is "**dry-run by default, no delete-all**". Measured: "+0.024 recall@10 on the LongMemEval 1,000-example benchmark". |
| `plugin-catalog/quota.yaml` | Per-provider quota/rate-limit status via `/quota` and a widget that "reads **precomputed** `quota_cache.json` so the widget never does network I/O". |
| `plugin-catalog/quote-ask.yaml` | Select any text in a conversation → a pill offering "Quote & ask"; the selection lands in the composer as a Markdown quote, cut at 4000 characters. |
| `plugin-catalog/quotum.yaml` | A seat's Venice key as a provider, with the seat's daily cap, spend and a 20:00 UTC bell in `/usage`. |
| `plugin-catalog/radio-dm-gateway.yaml` | Answers an allowlisted radio DM. Honest: "**A channel packet or a direct message without `pkiEncrypted` is never answered**, because a channel key can forge a sender"; and "An approval question is sent only when its line shows exactly the command `/approve` will run. A line that still goes out after that send was declined **does not let `/approve` run it, and the next approval is declined once**." |
| `plugin-catalog/rea-captcha.yaml` | Inspects captured CAPTCHA evidence locally when a task is interrupted by one. |
| `plugin-catalog/rea.yaml` | `official`: reverse-engineering over REA's MCP (binaries, .NET, Electron, Android, firmware). Honest: "a few REA tools run a command under a PTY, launch or drive an application, change a connected Android device or overwrite a chosen file, and **Hermes does not prompt before them**; the bundled skill tells the agent to ask first and to skip them in unattended runs." |
| `plugin-catalog/reaction-feedback.yaml` | "Lets the agent see the emoji reactions you leave on its messages: react 👍 or 👎 to a reply and the agent's next turn in that private chat **starts with a short note naming the reaction and the message it followed**." In-memory only, nothing on disk. |
| `plugin-catalog/reaction-ledger.yaml` | JSONL ledger of emoji reactions: counts per emoji, per chat, per day. Stores "12-digit hashes of the chat and message ids (**never a user id, user name or message text**)". |
| `plugin-catalog/reading-buddy.yaml` | Local-first WeRead companion: syncs bookshelf, stats and notes, then private reading cards and weekly/monthly reviews — "**cards and reviews are local files saved only after user confirmation**". |
| `plugin-catalog/reasoning-switch.yaml` | Rotate the focused session's reasoning effort from the status bar, with per-level prompt limits and "**auto-demotes the level after the configured number of prompts**". |
| `plugin-catalog/recency-anchor.yaml` | **"Your system prompt is message zero and the user's question is message N. On models that weight recency hard, that is not a fair fight, and the instruction you care about most quietly loses to whatever was just asked. This plugin restates it at the end of every user turn instead."** |
| `plugin-catalog/redaction-pack.yaml` | Teaches the built-in secret redactor 71 more vendor credential formats through `register_redaction_patterns`, "so those tokens are masked in logs, tool output and model-bound text like the built-in ones". "The patterns can **only add masks**". |
| `plugin-catalog/redline.yaml` | Guided Markdown and source review: annotate passages or line-numbered code in a docked pane and send comment/question/change-request batches back; a `transform_llm_output` hook appends a `::redline` directive to qualifying replies. |
| `plugin-catalog/remarkable.yaml` | reMarkable cloud transfers, library management, backups, typed text and bounded native notebook rendering. |
| `plugin-catalog/reme.yaml` | File-native long-term memory with HTTP and embedded backends. Honest: "a non-loopback `http://` endpoint receives them in plaintext". |
| `plugin-catalog/removed.yaml` | **The blocklist itself.** "The installer refuses to install anything whose name or repo URL matches an entry here (unless the caller explicitly bypasses the check). Each entry: {name, repo, reason, date}. Removals land via reviewed PRs, same as additions." One live entry — `or-picker`, "Folded into openrouter-picker. Installing the provider alone left the picker broken." — with the sharpest comment in the file: "**Name only. Do not set `repo:`: the replacement entry is the same repository, and a repo match would refuse that install too.**" |
| `plugin-catalog/render-platform.yaml` | Render hosting over its hosted MCP, with 20 unchanged upstream skills. Honest: "`render-docker` is excluded because its upstream Dockerfile cleanup example triggers a **critical scanner rule**", and "unattended calls are denied" for tools lacking a read-only annotation. |
| `plugin-catalog/replaid.yaml` | Replaid social inbox over OAuth. |
| `plugin-catalog/requesty.yaml` | Requesty gateway provider; the picker lists **managed routing policies** (curated routes with failover) rather than raw model ids; "the Hermes **session id is sent as `requesty.trace_id`**", and context windows and estimated cost come from the vendor catalogue. |
| `plugin-catalog/rfc-ref.yaml` | `@rfc:<number>` context references: attach an IETF RFC record (status, date, authors, abstract, what it obsoletes/updates, errata). |
| `plugin-catalog/rocketchat-platform.yaml` | Rocket.Chat gateway: REST out, DDP WebSocket in, 10 tools. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/rply-platform.yaml` | rply inbox gateway: tappable clarify questions and command approvals, cron delivery, a pinned table of scheduled jobs, a dashboard with run/pause/resume, and a secret tool that saves API keys "without the value passing through the chat". "The secret tool **waits up to 15 minutes for the human and refuses under cron**." |
| `plugin-catalog/rss-reader.yaml` | Desktop RSS reader with reader-mode capture, mute rules, saved searches and AI summaries. |
| `plugin-catalog/rtk-rewrite-docker.yaml` | Rewrites terminal commands through RTK so the model sees compact output, with a backend gate so a Docker/remote backend never receives an rtk command. "The plugin **does not validate the rewrite, fails open on timeout or error**." |
| `plugin-catalog/rtk-rewrite.yaml` | The same rewrite, unconditionally: "**cutting tokens on common dev commands**"; fail-open `pre_tool_call` with a 2 s timeout. |
| `plugin-catalog/runbox.yaml` | Per-chat offline Python container with results as a plain file:line issue list. "Export **reads each existing target through `read_file` before replacing it**, and **reports host files changed since the sync as conflicts**." Honest: "the work container has no network … and runs commands **without Hermes' dangerous-command approval** like Hermes' Docker backend"; "adds a short per-turn note (**about 80 tokens**)". |
| `plugin-catalog/s3.yaml` | Generic S3-compatible backup and restore. |
| `plugin-catalog/sabi-metadata.yaml` | **Fail-closed attribution middleware** for a local adaptive routing lane: opaque session/turn headers on loopback only, ignoring all other models. |
| `plugin-catalog/safeailabs-provider.yaml` | Safe AI Labs as a model provider, one endpoint per region. |
| `plugin-catalog/salesforce-chatter.yaml` | Chatter gateway. Honest: "`dry_run` **defaults to true** (no Salesforce writes, no outbound image fetch)" and "with `SF_CHATTER_ALLOWED_USERS` unset **nobody is answered**". |
| `plugin-catalog/scalekit.yaml` | 500+ connectors and 20,000+ tools through one environment URL; provider tokens stay in Scalekit. |
| `plugin-catalog/scamgate.yaml` | Offline scam gate: "**blocks agent tool calls that would edit Hermes config/profiles/plugins/hooks or turn approvals off**, and with approvals off **turns its 'ask' into a block** (setting `when_approvals_off: allow` restores asks)". |
| `plugin-catalog/search1api.yaml` | Live web search, news, Ask, crawl, sitemap and trending. |
| `plugin-catalog/secret-drop.yaml` | "Store a secret on the gateway host **without showing it to the model**" — keeps it out of chat and prompt context and redacts credential-shaped output. Honest: "**it is not a boundary against a model that deliberately reads it**." |
| `plugin-catalog/secret-handoff.yaml` | Ephemeral credential paste: `request_secret` asks through **clarify** and injects the reply over CDP, "**never storing it** … the value is never written to disk, the tool result, or the session transcript**". |
| `plugin-catalog/secure-env-ingress.yaml` | One-use HTTPS forms for missing secrets, a native encrypted Browser Vault (logins, TOTP setup keys, payment cards) and protected hosted payment-field filling, with "approved secret operations **outside chat and LLM input**". Honest: "consumers are trusted, not sandboxed"; "**Links are bearer authorization, not submitter identity**; cancellation cannot stop an already-running consumer"; "Site input callbacks, especially 3-D Secure, may authorize or auto-submit an operation. **Unknown outcomes require external verification before retry.**" |
| `plugin-catalog/sem-weave.yaml` | CLI-backed skills for local code discovery and entity-diff review; "**does not apply edits or merges, install binaries, or change Git configuration**". |
| `plugin-catalog/sendblue.yaml` | Sendblue iMessage/SMS with typing indicators and async daemon routing. |
| `plugin-catalog/senler-io-user.yaml` | Senler account + Relay automation. Honest: "the platform is `trusted_inbound`, so these events **bypass Hermes allowlists and pairing**, and customer text reaches the model as untrusted data"; "Relay credentials, instructions, event payloads and reports are stored **unencrypted**". |
| `plugin-catalog/serpapi.yaml` | SerpApi web/maps/news/shopping/hotels/flights/travel tools. |
| `plugin-catalog/session-dashboard.yaml` | Per-session analytics: token/cache/cost aggregates, tool-call breakdown, file changes, **failure groups**, and an "Ask AI" that copies a ready-to-run analysis prompt into a fresh draft chat. Read-only over `state.db`. |
| `plugin-catalog/session-flow.yaml` | Firefox-style session groups with project grouping, list/grid views and Ctrl+Scroll session cycling. "**All timers are ctx-owned intervals disposed on unload**." |
| `plugin-catalog/session-lens.yaml` | Read-only observability: "what each session cost and why, its full trace, **recurring tool failures**, every profile at a glance, provider quotas and service balances, **model comparison with cheaper-route evidence**, and **instruction-rule grading**". "Writes no Hermes state itself and sends no session content anywhere." |
| `plugin-catalog/session-mirror.yaml` | Mirrors conversations into Discord, one public thread per session and one post per turn. "Posting runs on a background thread and **never delays or breaks a turn**"; the redaction is "**fail-closed: nothing is sent if the redactor is unavailable**". |
| `plugin-catalog/session-ref.yaml` | `@session:"<title>"` references in the composer: "**nothing is injected into context**, the agent resolves it with its own session-search". |
| `plugin-catalog/session-token-counter.yaml` | Accumulated token totals and context-window occupancy for the focused session. |
| `plugin-catalog/shodan.yaml` | Shodan host/search/DNS/CVE/trends tools with complete capability declarations. |
| `plugin-catalog/showly.yaml` | Preview, publish and manage sites on Showly; the bundled skill makes it "the default for any deploy, preview or share request that names no provider", and "new links **default to public** (anyone with the link)". |
| `plugin-catalog/sidebar-cycle.yaml` | Step through sidebar sessions in on-screen order, wrapping at both ends. |
| `plugin-catalog/sidebar-manager.yaml` | Hide and reorder core sidebar rows. |
| `plugin-catalog/sigrex.yaml` | **Trading automation** (code and AI strategies, bots, webhooks and signals across crypto exchanges, DEXs and prediction markets) over the Sigrex MCP. Honest: "the connection has **full account access, including actions that can place live trades**", and the tool set "is served by the remote MCP server at runtime and is **not covered by the pinned sha**"; the skill "instructs the agent to confirm before any action that moves money or changes data". |
| `plugin-catalog/singularity.yaml` | `official`: Singularity/Apptainer terminal backend (`--containall --no-home`, CPU/memory limits, optional per-session overlay). "Your skills and registered credential files are bind-mounted **read-only** into the container, and because the container is a disposable sandbox **Hermes skips its dangerous-command prompts** there." |
| `plugin-catalog/sketch-pad.yaml` | Draw a shape and attach the PNG to the next message. |
| `plugin-catalog/skill-integrity.yaml` | **Rug-pull detection for installed skills.** Fingerprints every file in every skill directory (SHA-256), keeps a profile-local snapshot, and reports exactly which files changed, appeared or vanished: "a skill that **mutates after install without the user touching it** is the rug-pull signal". "A skill directory made unreadable is **reported as a finding, never treated as clean**", and "blind spots (oversize files, symlinks, permission-denied) are **counted and printed, never silent**". An hourly hook injects the names of changed skills into the agent's context. Read-only, stdlib-only, zero network. |
| `plugin-catalog/skill-retrieval.yaml` | **BM25 skill retrieval for large libraries.** "An `llm_request` middleware rewrites the outgoing request''s `<available_skills>` block to **names only (the same bytes every turn, so prompt caching is unaffected)**, and a `pre_llm_call` hook appends the **top-K matching skill descriptions** to the current user message." Optional Jev rerank is off by default and keeps the BM25 order on error. |
| `plugin-catalog/skill-router.yaml` | Evidence-based, session-safe skill routing with auditable decisions and opt-in learning. |
| `plugin-catalog/snag-shelf.yaml` | "Everything that snagged" — a cross-session shelf of failed tool calls with "truncated args with **key-name redaction**", an error snippet, and a one-click **fix-prompt insert**. |
| `plugin-catalog/snyk.yaml` | `official`: Snyk SAST/dependency/image/IaC/SBOM scanning over its first-party MCP. |
| `plugin-catalog/source-tray.yaml` | Session tray of the URLs the agent opened via search, extract or navigate. |
| `plugin-catalog/specstream.yaml` | Compiles a plain-words request into a finished list from the live web, "**priced per match with a maximum you approve before anything runs**"; the server is untrusted so Hermes asks before every non-read-only call and refuses them in unattended runs. |
| `plugin-catalog/spectator.yaml` | Live session sharing with masked transcripts for invite-token guests; host-approved guest suggestions are injected via `ctx.inject_message`. |
| `plugin-catalog/speechify.yaml` | Official Speechify TTS provider with low-latency streaming in voice mode. |
| `plugin-catalog/spotify-desktop.yaml` | Status-bar mini player reusing the Hermes Spotify login. |
| `plugin-catalog/spotify.yaml` | `official`: seven Spotify tools over the Web API with loopback PKCE login. |
| `plugin-catalog/stack.yaml` | Git-backed Markdown memory with a background curation agent and model-based recall. Honest: the curation agent "**commits and pushes the memory store to whatever git remotes you configure**". |
| `plugin-catalog/stalkchain.yaml` | Crypto research over the StalkChain Data MCP: check a coin before buying, vet a trader, see smart-money flows, review a wallet, set price alerts. "**Read-only: never trades, moves funds or signs anything**; the only write is the user's own price alerts, after they confirm." |
| `plugin-catalog/sticky-notes.yaml` | In-window sticky notes for the Desktop. |
| `plugin-catalog/stop-ledger.yaml` | JSONL ledger of the turns the human **stopped** while Hermes was still working (`/stop`, `/new`, `/reset` during a running turn) — counts per platform and per day, with a 12-digit hash of the session key and no chat content. |
| `plugin-catalog/storm-fusion-research.yaml` | "Human-gated perspective-panel research. **One question, several seats, one judge, one human.**" Solo, native subagent panel, or per-seat MoA/Fusion fanout. Honest: "**The human gates are skill instructions to the agent, not enforced by the tool.**" |
| `plugin-catalog/stream-speed.yaml` | JSONL ledger of stream timings: "**median and p90 time to first text** and the **median characters per second** per model, provider or day". |
| `plugin-catalog/stt-vocab.yaml` | Puts names the STT model mis-hears into the transcription prompt, drawn from a term list **and from the profile''s USER.md / MEMORY.md**, "most important last, within the 896 characters Hermes keeps for Whisper-family backends". Memory-derived names go only to local backends unless `allow_remote` is set. |
| `plugin-catalog/sugar.yaml` | Local-first memory in SQLite: decisions, preferences, **error patterns** and guidelines with project and global scopes, plus guideline-aware search. |
| `plugin-catalog/sunshine-moonlight.yaml` | Game-streaming setup and diagnosis. Honest: "`install` runs `sudo` … **without a Hermes approval prompt**". |
| `plugin-catalog/superlocalmemory.yaml` | Local-first memory with recall before each turn, tool-outcome logging and opt-in turn capture, plus four `slm_agent_*` tools for a child agent. |
| `plugin-catalog/supermemory.yaml` | Supermemory semantic memory provider with profile recall and per-turn capture. |
| `plugin-catalog/switchbot-control.yaml` | SwitchBot device control. Honest: "**Locks off unless enabled** … Lock and door devices stay refused unless you turn on `safety_devices`"; every command asks for approval and "is refused under cron, yolo, approvals off and unattended sessions". |
| `plugin-catalog/t3-code-theme.yaml` | An unofficial T3 Code dark theme, "scoped to its own theme; other themes are untouched". |
| `plugin-catalog/tabella.yaml` | A document lifecycle (create/convert/read/edit .docx/.xlsx/.pptx/.pdf/ODF) with a local-only HTTP lane that "binds to 127.0.0.1 only and requires Bearer auth" and rejects requests with an `Origin` header. Hardening worth copying: "**model-supplied HTML cannot fetch network or local-file resources (data: URIs only)**", pandoc args are allowlisted and the format names are validated against a grammar, "**closing pandoc''s `*.lua` reader/writer code-exec path**", and the Python deps are "pinned to exact versions with sha256 hashes … installed with `--require-hashes`". |
| `plugin-catalog/tailgate.yaml` | Per-job progress updates in chat for jobs Hermes hands off to other machines, with per-job mute/follow and **no model calls**. |
| `plugin-catalog/talaria-webui.yaml` | A richer chat interface over the Hermes API: cross-session history search, rewind/branch/compress of API sessions, and runs with the profile''s instructions. |
| `plugin-catalog/task-clock.yaml` | A live cron-running-job tracker with an accurate countdown, delay warnings and per-job outputs. |
| `plugin-catalog/task-deps.yaml` | Writes a project''s dependency graph to a file for the agent to read; "reads package.json, lockfiles, pyproject.toml, requirements.txt, go.mod and Cargo.toml"; **a missing file is skipped, not an error**. |
| `plugin-catalog/task-orchestrator.yaml` | Five plan modes with a status lane and an evidence-ledger contract. Honest: "**no automatic continuation** … when a worker returns no final answer, the turn ends with a final summary; the orchestrator does not silently retry". |
| `plugin-catalog/task-store.yaml` | A lightweight task store over SQLite with auto-compaction, three export formats, and a **dedicated `deliver` skill**. |
| `plugin-catalog/telegram-bridge.yaml` | Ties a Telegram topic to a Hermes chat; **a new topic starts with a first pinned message linking it to the chat**. |
| `plugin-catalog/telegram_allow_from.yaml` | **Restricts who may command the agent over Telegram** by id or username, and a per-chat switch for the **voice-transcription bridge**; a direct message is refused by default until an allow-list is set. "The list is **not** sent to Telegram." |
| `plugin-catalog/telegram_dashboard_probe.yaml` | A read-only status/health dashboard for the Telegram gateway: per-profile health, connection, last activity and **outbound queue depth**. |
| `plugin-catalog/telegram_health.yaml` | "A second, deliberately independent check: it opens its **own** Telegram Bot API connection with a **separate token** … and compares what each side can see — the **bot''s own view of the pending update queue** versus what Hermes already dispatched." |
| `plugin-catalog/telnyx-provider.yaml` | Vendor-maintained Telnyx inference provider with an authenticated live model catalog and catalog-derived pricing. |
| `plugin-catalog/thomas.yaml` | Fine-tunes a small calibrated encoder classifier and **rates it with gonogo**. "Every GPU launch goes through the human approval gate with the **exact config shown**; data checks and evaluation run locally for free." |
| `plugin-catalog/tidal.yaml` | TIDAL playback through local mpv over an unofficial API. Honest: "stores your TIDAL access and refresh token **in plaintext** (owner-only, 0600)". |
| `plugin-catalog/time-gap.yaml` | "Inject an implicit time-gap sense **only when a gap or a date rollover crosses**" — one line, only when it matters. |
| `plugin-catalog/tinyfish.yaml` | `verified`: Free Search and Fetch power Hermes's own `web_search`/`web_extract`; a remote browser and web agent handle sites needing clicks, forms or a login. "Under the default `request` policy each one goes through Hermes's approval prompt first … **cron and unattended runs are denied** unless you allow them." |
| `plugin-catalog/titanos-mcp.yaml` | A marketplace/Ads/listing plugin whose tools "read and **WRITE live marketplace/Ads accounts**". |
| `plugin-catalog/token-cost-meter.yaml` | Live token usage, model-aware USD cost and prompt-cache savings, with a per-day ledger that survives restarts. Honest: "costs are **list-price estimates, not billing data**". |
| `plugin-catalog/tokenwatch.yaml` | Monitors token usage, notifies at thresholds, and **freezes tool/gateway activity at configured limits**. |
| `plugin-catalog/tokstat.yaml` | Event-driven live token stats: cumulative total, this-turn counter, last-turn delta, context occupancy, cache hit rate. |
| `plugin-catalog/tool-slimmer.yaml` | "Reduce Hermes tool-schema overhead and show **selector savings** in the dashboard." |
| `plugin-catalog/toolaria.yaml` | "**Rescues oversized MCP and web tool results before they flood context.**" |
| `plugin-catalog/touchdesigner.yaml` | `official`: drive a live TouchDesigner session through the twozero MCP server. |
| `plugin-catalog/tsubasa.yaml` | Tsubasa OpenAI-compatible provider. Honest: "**tool calling not supported yet**"; the API "serves Canada only and answers HTTP 451 to requests from elsewhere". |
| `plugin-catalog/ttsbuddy.yaml` | Native TTS Buddy speech provider with offline voice selection and **exact-job recovery** (`ttsbuddy_recover` downloads an existing job, never overwrites). Account deletion is terminal-only and needs a fresh email code at a hidden prompt. |
| `plugin-catalog/turn-bell.yaml` | A bell that pings the ntfy topic when a turn finishes, with off / current-turn / all-turns modes. |
| `plugin-catalog/turn-usage.yaml` | A usage and cost footer on every reply: tokens, cache hit rate, cost, context occupancy, and a **per-tool time breakdown showing which tool actually consumed the wall clock**. "**Waiting time (a blocking user prompt) is reported separately and excluded from the active-time denominator.**" Honest cost: the footer is appended to the **stored** reply, "so it is replayed to the model on later turns and adds tokens to every turn". |
| `plugin-catalog/twenty-crm.yaml` | Twenty CRM with managed self-hosting, REST/GraphQL and live schema introspection. |
| `plugin-catalog/typesafe-skill-router.yaml` | "The request is routed before the model call and the one skill from the live roster that fits it is named in a **single `<skill_relevance>` line** on the user message — **nothing is injected when nothing fits**." |
| `plugin-catalog/umt.yaml` | 28 MCP servers, three of them zero-config and pinned to exact npm versions. |
| `plugin-catalog/unbrowse.yaml` | "Websites as APIs": read a page as markdown, run tasks through learned first-party APIs, fall back to a cloud browser with saved logins. "Once `UNBROWSE_API_KEY` is set the plugin **blocks the built-in `browser_*` tools** and `web_extract` on public URLs by default." |
| `plugin-catalog/unicode-ref.yaml` | `@unicode:` references that spell text out character by character for the model: invisible characters and their positions, text-direction controls, non-ordinary spaces, decoded Unicode tag characters, and "**words that mix Latin letters with lookalike Cyrillic, Greek or fullwidth ones**". |
| `plugin-catalog/unitares.yaml` | One identity per session and one check-in per completed turn, so the agent's working record carries across sessions. Fail-open. "**After 3 consecutive failures the plugin stops reporting for that session only**, until the session is finalized or reset." |
| `plugin-catalog/unraid.yaml` | Read-only Unraid monitoring: server metadata, array capacity, containers, VMs and grouped alerts, through fixed GraphQL queries and a VIEWER key. |
| `plugin-catalog/usage-flame.yaml` | A live quota chip with remaining %, reset countdown, **burn-rate pace and a run-out forecast with sparkline history** for every provider. |
| `plugin-catalog/usage-guard.yaml` | **Refuses a provider dispatch once a subscription window is exhausted.** By default it also refuses "when usage data is **missing, stale, unreadable, or the guard''s own config is malformed**" (`fail_open: false`); usage is read through Hermes''s own account-usage fetcher, at most one read per source every 180 s; a `pre_llm_call` hook adds a usage note at 80% and 90% used; an opt-in middleware "**lowers an existing output-token budget near the usage limit**". "**Auxiliary calls (compression, vision, titles, MoA advisors) are not gated.**" Its `known_issues` records a real unit bug: "Hermes''s Anthropic fetcher scales any utilization <= 1 by 100, so a window at 0-1% can read as 100% and the guard will refuse." |
| `plugin-catalog/usage-ledger.yaml` | A local-only content-free usage tally and native status line. |
| `plugin-catalog/usage-stats.yaml` | Multi-provider usage/balance for the status bar. |
| `plugin-catalog/vault-view.yaml` | A local Markdown vault workspace: visual editing, progressive reading, tag search, links, backlinks and a graph, compatible with Obsidian vaults. "Remote images and agent guidance are independent opt-ins and disabled by default; **automatic note-content sharing is disabled**." |
| `plugin-catalog/vaultknox.yaml` | Secret-leak protection: a 28-pattern detector registry redacts keys, tokens and passwords **before they reach session storage or the user**, and injects safe secret-handling rules so the agent never asks for a secret in chat. "Findings are logged as detector name plus SHA-256 fingerprint and **never the raw value**." |
| `plugin-catalog/vaultwarden.yaml` | Vaultwarden / Bitwarden CLI as a secret source. |
| `plugin-catalog/vector-platform.yaml` | A Nostr-based Vector bot with its own identity, relayed through a local Rust sidecar. The prebuilt bridge binary is "sha256 checked against that release''s SHA256SUMS" and can be built from source instead. |
| `plugin-catalog/vet402.yaml` | "Look a paid x402 or MPP URL up in vet402''s public record of real purchases **before the agent pays it**. **BLOCK stops the tool call**, and a WARN backed by evidence against the seller asks for approval." |
| `plugin-catalog/vidiq.yaml` | Skills only for vidIQ; the user adds the hosted MCP server themselves. |
| `plugin-catalog/vk-platform.yaml` | VK Messenger gateway with community Long Poll, media attachments, allowlists and project-lane routing. |
| `plugin-catalog/voice-ledger.yaml` | Another JSONL observer ledger: how many recordings, how much audio in total and typically, and how long since the last one, per STT provider/model/source/language/day. "**No audio, file path, prompt or transcript**" — and "observer only, **always returns None so the transcription request is unchanged**". |
| `plugin-catalog/voicestudio.yaml` | A client for the local VoiceStudio TTS app. |
| `plugin-catalog/vornik-companion.yaml` | A **hardened broker**: Hermes holds no credentials; privileged work runs in operator-approved workflows on your own daemon, "writes are approved by a person in Vornik". Memory removal asks the daemon to "**stop recalling (not delete)** a mirrored entry". Hermes's own dangerous-command prompts (the **redacted command text**) are answered on a paired phone, and "**any failure or a Vornik outage denying the command**" unless a builtin fallback is set — "**the plugin never decides itself**". |
| `plugin-catalog/wait-ledger.yaml` | Another observer ledger, and the one to copy: "how many waits there were, how many were answered or left unanswered, and **how long Hermes stood still in total, typically and at most**, per kind of prompt, per platform or per day". Records "no prompt text, answer or session key". |
| `plugin-catalog/wallaby-provider.yaml` | Wallaby Token curated open-weight inference (Kimi K3) as a model provider. |
| `plugin-catalog/wallpaper-theme.yaml` | A theme that follows your wallpaper palette, "derives a palette with **checked contrast floors**". The backend route "reads only JSON files inside the user''s home directory … under 256 KiB and returns **colour fields only, never raw file text**". |
| `plugin-catalog/watchline.yaml` | Polls a pull channel and forwards matched events into the gateway as inbound messages. |
| `plugin-catalog/waypoint.yaml` | A per-session status bar with **four states — Working (remembers your next step), Waiting on someone (who/what plus a follow-up reminder), Done (outcome plus a fresh-start handoff) and untracked** — plus a Status Board with follow-ups due and stale sessions, and three next-step suggestions per session. AI suggestions are **off by default**; "Power up" runs only when pressed, and its call log records model, effort, response time, tokens, finish reason and status "**never prompt, message or reply text**". |
| `plugin-catalog/weather.yaml` | Weather, radar/model imagery and verified meteorological calculations. |
| `plugin-catalog/web-deepseek.yaml` | Routes `web_search`/`web_extract` through DeepSeek's in-house AI search engine. Honest: "**only HTTP 200 responses that produce a result are billable**"; "extract returns Markdown only (no HTML variant, so `web_extract(format="html")` gets Markdown)"; "anti-bot or JS-rendered sites fail … while static pages work". |
| `plugin-catalog/web-defuddle.yaml` | Local, free, keyless article markdown via the defuddle CLI. |
| `plugin-catalog/web-local.yaml` | Keyless local extraction with httpx + trafilatura. |
| `plugin-catalog/web-meta-ai.yaml` | Search-only backend over Meta's Responses API web_search. |
| `plugin-catalog/web-octen.yaml` | Octen web search with query-focused highlights and page extraction. |
| `plugin-catalog/web-ollama-cloud.yaml` | Ollama Cloud web search + content extraction over its native REST API. |
| `plugin-catalog/web-oxylabs.yaml` | Oxylabs AI Studio search and extraction. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/web-search-plus.yaml` | Multi-provider search, extraction, quality reports and opt-in research mode; reads its own settings block from `config.yaml` read-only and may spawn an operator-configured local CLI "argv, no shell". |
| `plugin-catalog/web-serply.yaml` | Serply SERP API provider. |
| `plugin-catalog/web-toon.yaml` | Paid extraction over TOON. Honest: "spends about $0.001 … **with no per-call confirmation**; the sidecar's daily cap and origin allowlist are the only spending controls". |
| `plugin-catalog/web-venice.yaml` | Venice AI search + extract, privacy-first. (Malformed `requires_env: - name` — see §5.) |
| `plugin-catalog/wechat-social-assistant.yaml` | Local-first WeChat relationship memory via system OCR/Accessibility, 0600/0700 SQLite, 32 MCP tools, "**never sends messages** — outreach is drafts for human review only". |
| `plugin-catalog/whatsapp-agent-platform.yaml` | WhatsApp Agent Platform gateway, long-poll inbound, creator-only by default. Honest: "agent chats are **not end-to-end encrypted**"; received files "may reach the configured model, vision or speech-to-text provider". |
| `plugin-catalog/wicked-memory.yaml` | Wallet-scoped hosted memory with versioned update, history and "**approved hard delete**" — "every `wicked_memory_forget` asks for human approval". |
| `plugin-catalog/wiki-ref.yaml` | `@wiki:<title>` context references: attach a Wikipedia lead section, or one section with `@wiki:<title>#<section>`. |
| `plugin-catalog/wireguard.yaml` | Read-only WireGuard status and peer list. "It **never changes the tunnel and never reads the tunnel configuration file or any private key material**" — but "tool results put peer public keys, allowed IPs and peer endpoint IP addresses into the conversation sent to your model provider". |
| `plugin-catalog/wolfmarkdown.yaml` | Create, clean and **verify** standalone Markdown with deterministic artifact checks. |
| `plugin-catalog/woof.yaml` | Plan, launch, watch and compare weather simulations on your own GPU: size runs with the planner, launch locally or over SSH, **compare physics or resolution**, run multi-arm research campaigns and **score runs against radar and surface observations**. |
| `plugin-catalog/workflow-record.yaml` | "hermes record: demonstrate a browser workflow once … and its bundled skill lets `/learn` turn the recording into a skill that replays it." "Password, one-time-code and card fields are **masked inside the page as `{SECRET:name}` and never written**." |
| `plugin-catalog/world-clock.yaml` | One time zone in the status bar, the rest a click away. |
| `plugin-catalog/wyoming-voice-bridge.yaml` | Wyoming STT/TTS against a server you run. Honest: "Audio and text to speak go to the `WYOMING_*` host:port you set over **cleartext, unauthenticated TCP (public addresses accepted)**", and "Once selected, the providers send speech in every session, **including cron and webhooks**". |
| `plugin-catalog/xchat.yaml` | `official`: X's end-to-end encrypted DMs — "Messages are decrypted and encrypted locally with X's official Chat XDK, so **X only routes ciphertext**". |
| `plugin-catalog/xmemo.yaml` | Identity-aware cross-session memory with a local cache and an **unsent-write queue**. Declared deviation: "if none is set, falls back to the xmemo login token in `~/.config/xmemo/credentials.json` (**a catalog rule 11 deviation** kept for existing users)". |
| `plugin-catalog/yandex.yaml` | Yandex Search API backend for `web_search` plus a grounded generative search with cited sources. "**Installing does not switch web_search over**" — the user runs `hermes config set web.search_backend yandex`. |
| `plugin-catalog/yandex_calendar.yaml` | List/create/update/RSVP/move/delete CalDAV events. Honest: "**Every tool is offered by default, `yandex_calendar_delete_event` included**" — set `YANDEX_CALENDAR_ACTIONS` to register fewer. Also: "**Read-only calendars … accept a new event without storing it, and `yandex_calendar_create_event` still reports success**". |
| `plugin-catalog/yantrikdb-hermes-dashboard.yaml` | A local-only YantrikDB dashboard for memory operations. |
| `plugin-catalog/yantrikdb.yaml` | Persistent memory that "**canonicalizes duplicate memories, surfaces contradictions between structured or recognized single-valued claims for review**, and returns a `why_retrieved` reason list with every recall". Embedded by default: no server, no token, no GPU. |
| `plugin-catalog/yolo-auto.yaml` | Flat-rate OpenAI-compatible API with plan-filtered live model discovery. |
| `plugin-catalog/you.yaml` | You.com skills: live web search, extraction, cited research, **finance research**, and integration discovery over the You.com MCP servers. |
| `plugin-catalog/zalo-platform.yaml` | Zalo Bot Platform gateway, long-polling by default, opt-in webhook mode with a loopback listener that checks the secret header. |
| `plugin-catalog/zerosignal.yaml` | Private pay-per-request inference through a local proxy where "**your wallet is the credential**" — with the honest comment that `ZEROSIGNAL_API_KEY` is a placeholder Hermes requires but the proxy ignores. |

### 1.3 The files that deserve more than a line

**`plugin-catalog/README.md`** — the single most valuable document in the shard,
because it is a *supply-chain threat model written as a contribution guide*.
Section 1.1 above summarises it; three details deserve their own emphasis:

- **Rule 6 (declared capabilities must match reality) is a security property,
  not a doc rule.** "Validation fails the entry otherwise — undeclared capability
  creep is treated as a security issue." A plugin that registers a tool it did
  not declare, or declares a hook it does not register, is not a documentation
  bug; it is the plugin lying about its blast radius.
- **Rule 11 (one credential route) exists to stop cross-profile bleed.** Under
  Hermes's multi-profile multiplexing, a plugin that reads `~/.claude` or a
  vendor CLI's token file can hand one profile's credential to another. The rule
  says credentials come through `agent.secret_scope.get_secret(NAME)`,
  `credentialed_provider_request` with `requires_auth`, or an OAuth block signed
  in via `hermes auth add` — and never from a file. `plugin-catalog/xmemo.yaml`
  is the one entry in this shard that openly declares a deviation from it
  ("a catalog rule 11 deviation kept for existing users"), which is what an
  honest deviation looks like.
- **Rule 12 makes unattended runs a first-class citizen.** "Anything that waits
  for a person (a prompt, an OAuth browser flow) fails cleanly or times out
  under cron, the messaging gateway and other unattended runs instead of hanging
  the agent." That single sentence is the whole design brief for a scheduled
  trading job.

**`plugin-catalog/removed.yaml`** — the blocklist, and the reason the catalog
can distinguish two kinds of "no". The file is four lines of comment and one
entry, and the comment is the design:

> Blocklist for plugins pulled from the catalog for security or policy
> reasons. The installer refuses to install anything whose name or repo URL
> matches an entry here (unless the caller explicitly bypasses the check).
> Each entry: {name, repo, reason, date}. Removals land via reviewed PRs,
> same as additions.
>
> Name only. Do not set repo: the replacement entry is the same repository,
> and a repo match would refuse that install too.

The live entry is `or-picker` — "Folded into openrouter-picker. Installing the
provider alone left the picker broken." That is a *policy* removal with a
*reason* and a *date*, distinct from a stale entry, which is simply deleted.
The `README.md:214-229` text states the distinction precisely: a removed entry
stops updating, cannot be enabled and is refused at load time; a delisted entry
"is just a deleted file — users who already installed it are unaffected, and it
is welcome back once the problem is fixed."

The sharpest line is the comment warning not to set `repo:` — because a
name-and-repo blocklist would refuse the *replacement* plugin, which lives in
the same repository. That is a whole class of bug (a denylist that denials the
fix) designed out in three words of YAML.

**`plugin-catalog/alans-way.yaml`** — 30 KB, the longest entry, and the best
written. It is a proactivity, approval-binding and audit-log design in one
manifest, and it states its own boundaries precisely: "sent means scheduled, not
delivered or completed; there is no receipt/result store or replay"; "The
instruction not to save other bots' excerpts is model policy, not enforced
deletion"; "An approved commit is never replayed after a lost connection or host
change"; "Prices, availability and policies must come from a page read this
turn or be labeled unconfirmed." The last of those is a **voice rule**, and it
is the one August Trading's answer prose most needs.

---

## 2. Ideas worth stealing (ranked)

1. **A capability manifest the runtime enforces, not a comment.** Rule 6 makes
   `capabilities:` a contract: tools, hooks, middleware and env vars are
   declared, and validation *fails* the entry if reality disagrees. August
   Trading's desk tools are named in a UI catalogue and a vocabulary file
   (`utils/toolKinds.ts`); the same discipline could be a machine-checked
   registry that the provider refuses to start against if a tool's declared
   capabilities and its actual registration diverge.
2. **The "no-op governor" for scheduled work.** `heartbeat2.yaml`: a wake that
   produces nothing makes the agent slower, then pauses pointless wakes and
   **asks once**. `jev-cron-gate.yaml` achieves the same without a model call
   (a deterministic pre-check that prints `{"wakeAgent": false}`), and
   `hermes-cron.yaml` lists four ways to avoid a needless LLM run (`no_agent`,
   `wakeAgent` pre-check, `monitor`, `[SILENT]`). August Trading's automations
   already have a three-run breaker; the missing half is a *pre-check* that
   never spends a turn in the first place, and a **fail-open with a forced wake
   after N consecutive skips** so the check itself cannot silence a live signal.
3. **Operator-only escalation, model-only de-escalation.** Over and over the
   catalog draws the same line: the agent "can only make check-ins quieter";
   "the model may disable it, the operator enables it"; "Every guardrail is a
   user setting … that the agent works inside and **can never widen**";
   `hermes-verifier.yaml` ships "disabled and off by default";
   `hermes-gemini-live.yaml` makes "**only the user's press approve it, never
   the voice model**". This is the cleanest rule in the shard: *the model may
   narrow a permission, never widen one.*
4. **A decision that abstains instead of guessing.** `gonogo.yaml` returns
   Wilson-interval confidence, **routes uncertain cases to a human**, and has an
   explicit **INSUFFICIENT EVIDENCE** verdict when the sample cannot support
   the claim. `limbic.yaml` refuses to recall anything under a calibration
   floor ("abstains … instead of surfacing near-misses").
   `protean-ordaprompt.yaml` "abstains when uncertain".
   `yantrikdb.yaml` surfaces contradictions "for review" rather than resolving
   them. A trading app that says "I don't know" is a different product from one
   that always has a number.
5. **Verify the artifact, not the intent.** `pdf-surgeon.yaml` checks that the
   edited line reads exactly as the original with the phrase swapped and
   nothing else, that every other line is unchanged, that the old phrase's
   occurrence count dropped by exactly one — and writes to a temp name, moving
   it into place **only after verification passes**. `jp-charts.yaml` does the
   same for charts: "**Every bar, point, label and tick is read back from the
   finished figure and compared with the parsed data before the image is
   returned.**" `provenance-gate.yaml` checks "the text it produces". This is
   the pattern for August Trading's chart drawings, trade-plan cards and
   rendered verdicts.
6. **Ground a written conclusion in the human's own words.** `provenance-gate.yaml`
   requires that a memory or skill write asserting "the user decided …" contain
   a **quote that appears verbatim in text the user typed in this session**,
   sharing key words with the decision and **not dropping a negation** — and it
   publishes its own blind-set numbers ("precision 1.000, recall 0.694"). A
   learned trading rule should carry the trader's own sentence, not the
   model's paraphrase of it.
7. **One credential route, and the refusal to have two.** Rule 11 +
   `hermes-tenuo.yaml`'s **signed, expiring permission slip (a "warrant")**
   checked *before* the handler runs and *down to the arguments* — file paths,
   search queries, **spending limits** — with every decision in a local audit
   log, and cron jobs, subagents and gateway users each getting their own
   policy. Combined with `hermes-dpapi-secrets.yaml`'s precision ("a bar for
   backups, cloud sync and dotfiles, **not a boundary against code already
   running as the same user**"), this is a complete, honest answer to "where do
   the keys live and what actually stops a leak".
8. **A gate that survives the global auto-approve switch.** `plan-mode.yaml`:
   "When yolo or `approvals.mode: off` would auto-approve, it asks through
   clarify instead, **so a person still decides**." `scamgate.yaml` does the
   mirror image: with approvals off it "**turns its 'ask' into a block**".
   A trading app's plan-validation gate should be able to say which of the two
   it is.
9. **Structured logs that are queryable, bounded, and content-free.** The
   `olric3015` family (`approval-ledger`, `aux-ledger`, `command-ledger`,
   `edit-ledger`, `error-ledger`, `interim-ledger`, `reaction-ledger`,
   `stop-ledger`, `voice-ledger`, `wait-ledger`) is one design applied ten
   times: a JSONL file under `plugin-data/`, **metadata only** (no prompt
   text, no answers, no user ids; a 12-digit hash of the session key), trimmed
   to 5,000 rows past 2 MB, **observer only** — it can never answer, delay or
   change anything. `/wait-ledger` answers "how long Hermes stood still in
   total, typically and at most, per kind of prompt, per platform or per day".
   That is the trade-log equivalent: a structured, queryable, cheap-to-keep
   record of what the system did, with the human's own wait time measured.
10. **Rule drift detection as a first-class check.** `skill-integrity.yaml`
    fingerprints every file in every skill directory and reports exactly which
    files changed, appeared or vanished — "a skill that **mutates after install
    without the user touching it** is the rug-pull signal" — with blind spots
    "**counted and printed, never silent**" and an unreadable directory
    "**reported as a finding, never treated as clean**". August Trading's
    learning rules, skills and prompt registry are the same kind of asset.

---

## 3. Findings relevant to trading

- **A decision ledger that a model cannot edit.** `openinvest.yaml` is the only
  entry in the shard built for markets: a **4-role LLM committee (macro /
  quant / risk / CIO) that debates a symbol**, with a **decision ledger** — and
  "buy/sell/deposit/withdraw only edit the local ledger; **it never connects to
  a broker or places orders**". The separation of *advise* from *act* is
  exactly August Trading's proposal-parse → validate → log pipeline, and the
  role split (macro / quant / risk / CIO) maps onto a real committee.
- **A pre-trade gate that returns a verdict and names its basis.**
  `greyridge-token-safety.yaml` returns **SAFE / CAUTION / AVOID** from
  checkable facts (honeypot/sellability, transfer tax, owner/mint/pause flags,
  liquidity) and states "its verdict is a heuristic, not financial advice".
  August Trading's `services/validation/` gate scores a plan; it could also
  *say which numbers produced the score*, the way `biomimetic-brain.yaml`'s
  refusals "name the numbers behind them".
- **Market data with a provenance and a timestamp discipline.**
  `fxmacrodata.yaml` ships `known_at_time_task` (what was knowable *then*),
  `release_risk_score_task`, `macro_regime_classifier_task`,
  `fx_trade_setup_task`, `fx_backtest_task` and `event_impact_replay_task` —
  and every answer carries **source citations**. `colorado-traffic.yaml`
  separates "incidents happening now" from "scheduled work" and "unverified
  reports" rather than returning one flat feed. `public-holidays.yaml` computes
  "**deadline math (N working days after a date), computed in code instead of
  by the model**" — a market calendar must never be improvised.
- **Cost and quota as first-class runtime facts.** `usage-guard.yaml` refuses a
  provider dispatch once a subscription window is exhausted and — by default —
  also refuses when the usage data is "missing, stale, unreadable, or the
  guard's own config is malformed". `provider-usage.yaml` and `usage-flame.yaml`
  add **burn-rate pace and a run-out forecast**. `hermes-call-ledger.yaml`
  pairs every model call with "the charge the billing provider actually took",
  falling back to Hermes's own price-book estimate. For a trading app, the
  analogue is a hard **daily-loss budget and per-turn cost ceiling** that
  pauses the automations rather than merely reporting the number.
- **The trader's own wait time is a measurable quantity.** `wait-ledger.yaml`
  counts the times the system "stopped to wait for you" — how many, how many
  went unanswered, "how long Hermes stood still in total, typically and at
  most, per kind of prompt, per platform or per day" — and `turn-usage.yaml`
  reports waiting time **separately from active time**, excluded from the
  active-time denominator. In a trading app, "how long was the trader left
  staring at a pending approval" is a first-order metric.
- **Rogue-crypto and prediction-market access, read-only.** `stalkchain.yaml`
  ("check a coin before buying, vet a trader, see smart-money flows, review a
  wallet, set price alerts") and `hermes-gensyn-delphi.yaml` ("**No funds move
  and nothing is signed or sent**"), plus `vet402.yaml`, which looks a payment
  URL up in a public record of real purchases and **BLOCKS** the tool call on a
  bad record. The "read the chain, never act on the chain" split is the right
  default for an analysis app.
- **A model that has quietly got worse.** `model-drift-watch.yaml` runs 34
  fixed, exactly graded questions on a schedule, compares each against the same
  model's own baseline with "an **exact per-question test and a same-day
  confirmation run**", and reports only a **confirmed drop**, a changed served
  model, or a failed measurement — with a hard token/$ cap per check. A trading
  app whose provider silently swaps models would degrade its edge invisibly;
  this is the cheapest possible detector for that.

---

## 4. Weak spots in the reference material

1. **The policy is strong; the shipped entries are not all schema-valid.**
   Eleven of the 762 manifests carry a malformed `requires_env` — a YAML list
   containing the literal string `name` instead of the required
   `{name: …}` mapping: `brave-search.yaml`, `carbonvoice-platform.yaml`,
   `chatto-platform.yaml`, `fluxer-platform.yaml`, `fmsg-platform.yaml`,
   `mindgraph.yaml`, `minecraft-platform.yaml`, `nextdns.yaml`,
   `rocketchat-platform.yaml`, `web-oxylabs.yaml`, `web-venice.yaml`. Four of
   those same files also have a **description truncated mid-word** in the repo
   — `carbonvoice-platform.yaml` ends "…Replies via POST /v3/messages/start, so
   the Her", `chatto-platform.yaml` ends "…for inbound eve",
   `fluxer-platform.yaml` ends "…Component button", `fmsg-platform.yaml` ends
   "…Only http". The `README.md` admission rules are enforced by a *reviewer*,
   not by a *validator*, and the mirror test (`tests/website/
   test_catalog_rules_mirror.py`) checks that the rules text matches the
   website, not that every entry matches the rules. The lesson for August
   Trading: a policy in prose is only as good as the parse of the artefacts it
   governs.
2. **The rule set has real holes, and the entries prove it.** Rule 3 forbids
   self-updating code and rule 17 forbids unscannable binaries, yet
   `aphrodite.yaml` openly runs "**prebuilt native binaries** (`libaphrodite_hermes`
   + aphrodite proxy, v1.6.6) … fetched by an explicit `download.sh` step
   checked against in-tree SHA-256 sums" — a hash pin is not a build
   attestation, so this is rule 17's exception clause by another name. Rule 9
   forbids core overrides, yet `boardstate.yaml` reads a core private
   attribute (`web_server._SESSION_TOKEN`), and `hermes-jailbreak-kernel.yaml`
   is a plugin whose entire purpose is to **replace the system prompt** and
   strip other plugins' sections — the opposite of rule 9's spirit, and
   therefore almost certainly a rule-9 violation sitting in the catalog.
3. **The disclosure prose is excellent and the enforcement is often a skill
   instruction.** Across the shard the same sentence appears in many guises:
   "confirm-before-spend is enforced by skill instructions, **not by Hermes**"
   (`adspirer`), "the tool does not enforce approvals" (`hermes-seo`), "**The
   human gates are skill instructions to the agent, not enforced by the tool**"
   (`storm-fusion-research`), "the model can choose costly options" with "no
   Hermes approval prompt" (`acedatacloud-media`, `agentwalletapi`,
   `web-toon`). The catalog is honest about this — which is a virtue — but it
   means the *rules* are only as strong as the model that follows them, and
   several entries say so in the same breath as claiming a guard.

---

## 5. Method and coverage

- Every one of the 763 files in `hermes-plugin-catalog.files.txt` was read in
  full as text (the 762 YAML manifests and the catalog `README.md`). No file
  was skipped, and no file was summarised from its name.
- `plugin-catalog/alans-way.yaml` (30,449 bytes) was read in two halves
  (head 0–15,000 and tail 14,500–end) so that no line was lost to output
  truncation; every other file was read in one `Get-Content -Raw` pass.
- Nothing in the reference repository was executed, installed, built or tested;
  no network call was made; no file in the reference repo was modified.
- Cross-checks run against the checkout after the read: 762 YAML files,
  1,068,715 bytes total; tier distribution **community 740 / official 16 /
  verified 4**; a grep for the malformed `requires_env` shape returned the
  eleven files listed in §4.1; and the truncated descriptions were confirmed
  by printing the `description:` block of each of the eleven.
- **Not read:** the reference repo's code outside `plugin-catalog/` (the
  loader, the validator, the scanner and the website mirror the README refers
  to) is outside this shard's file list. Where this report describes the
  loader's behaviour (rule 2's SHA rejection, rule 7's scanner, rule 14's
  SemVer floor) it is reporting **the README's claim**, not a verified
  implementation.
