# hermes-agent :: hermes-scripts-ci

**Files in shard:** 412 (read: 358, skipped with reason: 54)

**What this shard covers:** the hermes-agent repository's entire
build/release/continuity layer: the 80 GitHub Actions files (composite actions
+ 55 workflows), the `docker/` container build and entrypoint scripts (21), the
`nix/` packaging module tree (25), the `pm/` package-manager — Hermes' locked
artifact installer (58) — and 229 files under `scripts/` (CI gate scripts, the
code-health ratchet, bundle/release orchestration, Termux/Android packaging, the
Windows desktop-update hand-off, and the WhatsApp bridge). It contains **no
agent loop, no tool definitions, no model-routing code and no trading logic** —
it is the harness's *engineering* substrate. The transferable ideas are
therefore about release safety, evidence gates, reproducibility, and the
discipline of "a passive rule cannot enforce a policy".

**Coverage note (honest ledger).** The `.github/`, `docker/` and `nix/` trees
were read in full except five large files, which were read head+tail
(`.github/workflows/desktop-bundled-release.yml`, `nix/checks.nix`,
`nix/moduleCommon.nix`, `nix/nixosModules.nix`,
`scripts/check-windows-footguns.py`). Under `pm/`, 21 modules were read in full
and 31 were catalogued structurally (module header + top-level symbol
inventory). Under `scripts/`, every file was opened and catalogued
structurally — the brief's tier-2 allowance ("you still open every file, but a
one-line entry per file is enough"). The 54 `skipped` rows in the status TSV
say exactly which files fell into which of those buckets. Every file in the
shard appears below exactly once.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### Group: `docker/` — the container runtime and its supervision tree (21 files)

- **Purpose.** The Hermes container image's *runtime contract*: how a
  long-lived, multi-profile, unprivileged agent process is started, supervised,
  re-homed and repaired after a crash or a bad `docker exec`.
- **Key abstractions.** `docker/entrypoint-dispatch.sh` (PID-1 vs wrapped-runtime
  dispatch), `docker/main-wrapper.sh` (CMD routing + privilege drop),
  `docker/hermes-exec-shim.sh` (the `docker exec` privilege-drop shim),
  `docker/stage2-hook.sh` (the cont-init bootstrap), the `docker/s6-rc.d/*`
  service tree, and the two `docker/cont-init.d/*` scripts.
- **Data flow.** PID 1 → `/init` (s6-overlay) → `main-wrapper.sh` → the user's
  CMD, all as the unprivileged `hermes` user (UID 10000). `/etc/cont-init.d/`
  runs `01-hermes-setup` (the stage2 hook: UID/GID remap, volume chown, config
  seeding, `API_SERVER_KEY` generation, dependency refresh) then
  `02-reconcile-profiles` (recreate the per-profile s6 slots and auto-start only
  those whose last recorded state was `running`).
- **Non-obvious design decisions.**
  - The install tree `/opt/hermes` is **root-owned and non-writable on
    purpose**: "prevents an agent session from self-modifying the installed
    source, venv, TUI bundle, or node_modules and bricking the gateway"
    (`docker/stage2-hook.sh`). Mutable state lives only under `$HERMES_HOME`.
  - `docker exec <c> hermes login` used to write a root-owned `auth.json` and
    break the gateway for *every* subsequent message, while `docker exec … chat
    -q ping` still worked — so `docker/hermes-exec-shim.sh` drops to `hermes`
    before exec'ing the real binary, and fails **loud** (exit 126) when
    `s6-setuidgid` is missing rather than silently running as root.
  - `--user <uid>` is **rejected with actionable guidance** (use
    `HERMES_UID`/`HERMES_GID` or `PUID`/`PGID` instead) because the bootstrap
    needs root. The same guard is duplicated in `main-wrapper.sh` so the user
    sees it at the surface they actually typed.
  - Chown is **targeted**, never `chown -R $HERMES_HOME`: the volume may be a
    host bind mount with unrelated files (`docker/stage2-hook.sh`, issue
    #19788). An explicit allowlist of top-level state files replaces a blanket
    `find -user root` sweep.
  - Every chown refuses to traverse a **symlinked path** (`refuse_symlinked_path`),
    which is also why the old `logs/gateways` recursive chown was removed
    (symlink TOCTOU, CWE-59/367).
  - `API_SERVER_KEY` is generated only when absent, and the operator's
    container-provided key **wins** — because `.env` is loaded with
    `override=True`, a generated key would silently shadow it and 401 every
    client. A stale empty `API_SERVER_KEY=` line is deleted so it cannot
    clobber the operator key.
  - `HERMES_DASHBOARD_INSECURE` no longer disables the auth gate; it is
    accepted, ignored, and warned about — the gate had been the entry point
    for an MCP-config persistence campaign.
  - The dashboard's s6 slot is declared *always* but exits 0 and its `finish`
    script exits **125** (s6's "permanent failure, do not restart"), so
    `s6-svstat` truthfully reports the slot as down instead of a restart loop.
- **Edge cases & failure handling.** Rootless Podman (chown fails → warn and
  continue); a read-only volume (key generation degrades to a warning, and the
  cron-fire path is explicitly named as unavailable rather than silently
  lost); a stale `auth.json` with a terminal `invalid_grant` (re-seeded only
  when the on-disk entry is provably terminal *or* the orchestrator seed is
  newer); the Docker socket group (`--group-add` alone is wiped by
  `initgroups()` at the `s6-setuidgid` drop, so an `/etc/group` entry is
  created at boot); the Fly Machines API socket (group-write access for
  scale-to-zero, scoped and explained).
- **Surprising.** `docker/entrypoint.sh` is a **deprecated shim** that runs the
  bootstrap but deliberately does **not** exec the CMD; `docker/s6-rc.d/dashboard/type`
  is the literal string `longrun`; `docker/s6-rc.d/main-hermes/run` is a
  deliberate no-op (`sleep infinity`) that exists only so the s6 `user` bundle
  is valid. `docker/sandbox-desktop.Dockerfile` builds the *terminal-backend
  sandbox* (no Hermes code) and pins `agent-browser` with `--ignore-scripts` so
  the first `browser_navigate` in a fresh sandbox never waits on an npm fetch.

#### Group: `nix/` — the declarative packaging tree (25 files)

- **Purpose.** Build Hermes as a reproducible Nix derivation, and expose it as
  a NixOS module, a Home Manager module, and a dev shell.
- **Key abstractions.** `nix/lib.nix` (the shared npm/workspace helpers and
  the *source filters*), `nix/python.nix` (the uv2nix virtual env),
  `nix/pythonLock.nix` (the **only** place that picks the interpreter),
  `nix/hermes-agent.nix` (the package), `nix/moduleCommon.nix` (the option set
  and renderers shared by both modules), `nix/nixosModules.nix` and
  `nix/homeManagerModules.nix` (the two module surfaces), `nix/checks.nix` (21
  build-time checks), `nix/pm-packages.nix` (the `pm/lock.json` → derivation
  translation).
- **Data flow.** `pm/lock.json` is the single pin table; Nix reads it as *pure
  data* (`builtins.fromJSON`) and knows no versions, URLs or hashes of its
  own. `pythonLock.nix` derives the Python family from that lock and selects
  `pkgs.python3NN` — and **throws** rather than falling back to a default
  interpreter. `lib.nix` derives the npm workspace topology from the root
  `package.json` `workspaces` field, so adding a workspace needs no edit
  anywhere else.
- **Non-obvious design decisions.**
  - **Source filters** keep rebuild scopes apart: a `.tsx` change must not
    rebuild the Python venv, a `.py` change must not rebuild the TUI/Web/
    Desktop. The exclusion lists are *derived* (JS workspace dirs come from
    `package.json`), not hand-maintained.
  - `nix/overlays.nix` exposes `pkgs.hermes-agent` as a **pure alias** of the
    flake's own package, so `pkgs.hermes-agent`, `nix build .#default` and the
    module's default are the *same* locked derivation.
  - The desktop wrapper's `HERMES_DESKTOP_HERMES` points at the *fully built*
    agent package: "No re-implementation of the agent resolution in this
    wrapper."
  - Secrets in a desktop launcher go into `extraRun` (`--run`, read at start
    time), never `extraEnv` (`--set`, which writes into the world-readable Nix
    store).
  - `setup.py` is permitted to build a wheel/sdist only from the sealed
    derivation, enforced by a **derivation** environment variable
    (`HERMES_NIX_BUILD=1`), not a devShell one — "so `nix develop -c uv build`
    must remain blocked."
  - The Home Manager module splits `programs.hermes-agent` (the CLI and the
    desktop app) from `services.hermes-agent` (the daemon), because Home
    Manager separates an installation from a daemon. A removed option
    (`installPackage`) is kept as `mkOption` + an **assertion** with the exact
    replacement text, "because a quiet removal gives them a machine with no
    `hermes` and no message."
  - `nix/checks.nix` evaluates the modules *for real* through
    `lib.evalModules` / `homeManagerConfiguration`, "Each of these faults then
    stops the check, and not the rebuild of a user."
- **Edge cases & failure handling.** aarch64-darwin has no `onnxruntime`
  wheels → nixpkgs-prebuilt overrides for numpy/pyarrow/av/etc.; legacy
  alibabacloud sdists declare no build backend → explicit `setuptools`;
  `python-olm` needs CFFI; `misaki` is a git source with no recorded backend
  → `hatchling`; `node-pty` is always compiled from source against
  `electron.headers` (no network, no stale hash); a `config.yaml` merge is
  **idempotent** and deep-merges (Nix keys win, user keys preserved) — proven
  by seven named scenarios A–G in `checks.nix`.
- **Surprising.** `nix/tests/agent-references.py` checks the **shipped**
  package, not a reconstruction of the recipe: it launches the real wrapper
  with a `sitecustomize.py` probe and asserts the environment the *actual*
  wrapper hands to Python ("No parsing makeWrapper's shell text").
  `nix/tests/desktop-backend.py` plants a *competing* legacy install and
  asserts the packaged desktop still selects its pinned backend.

#### Group: `pm/` — the locked package manager (58 files, tier 1 + tier 2)

- **Purpose.** One dependency authority for every tool Hermes ships: pinned
  binaries, the Python venv, node_modules, plugin dependencies.
- **Key abstractions.** `pm/__init__.py` (the lazy PEP-562 facade),
  `pm/lock.py` (`Lockfile` = the pins, `Facts` = the installed state),
  `pm/package.py` (what a package *is*: `Package`, `BinaryPackage`,
  `DebPackage`, `StatePackage`, `Runner`), `pm/store.py` (the machine-wide
  byte store), `pm/install.py` (`ensure()`: make the installed state match the
  lockfile), `pm/registry.py` (the package registry), `pm/packages.py` (the
  concrete definitions: uv, python, node, npm, git, gh, ffmpeg, ripgrep,
  chromium, llama.cpp ×5, whispercpp, cua-driver, agent-browser, bws,
  iron-proxy, termux-docker), `pm/environment.py` (the private Python engine),
  `pm/environments.py` (the generation layout), `pm/runtime.py` (PM's own
  runtime, independent of the application graph), `pm/receipt.py` (the
  machine-readable operation receipt), `pm/plugin_eviction.py`, `pm/workspace.py`.
- **Data flow.** `pm/lock.json` (machine-written pins: version + per-target
  `{url, sha256}`) → `pm/downloader.py` (resumable, hash-verified,
  multi-connection) → `pm/store.py` (extracted, verified tree) →
  `pm/lock.py::Facts` (what is actually on this machine: entry, version, env,
  stamp, target, artifact shas, tree digest) → `pm/install.py::ensure()` →
  a composed environment (`Runner.env`) or a venv generation. A **generation**
  is published atomically; the running process may only *adopt* it if nothing
  it already imported would change underneath it (`pm/environments_adopt.py`).
- **Non-obvious design decisions.**
  - The lockfile carries the **resolved URL beside the hash**: "the lockfile is
    the complete machine interface (nix reads it as pure data), and the python
    url templates are consulted only at `pm lock --bump` time."
  - The **identity** of an installed tool is `(target, tuple(artifact sha256s))`,
    not the version: "a same-version re-pin, a different target, or a fact
    written before identity existed all count as NOT installed and force a
    reinstall."
  - `pm/lock.py` publishes rows under a file lock with a **conflict check**
    (`StaleLockRow`): "a concurrent editor changed a row that this writer plans
    to publish."
  - `pm/filesystem.py` is **stdlib-only** and import-light by design — the
    boot-time dependency selection imports it before any dependency exists.
  - `pm/progress.py` has one output policy for long child processes: verbose in
    CI (the only record of a remote failure), one rewritten status line on a
    terminal, start+finish off it — and "a failure always prints the captured
    tail, so containment never hides an error."
  - `pm/index_config.py` strips ambient `UV_*` so a caller's settings cannot
    steer which project/interpreter/cache an operation uses, but forwards
    **index and transport** knobs, and bridges pip's `index-url` to uv.
  - `pm/install_states.py` reclaims per-checkout dependency state whose
    checkout is gone — but only when the checkout is *provably* deleted
    ("under the data root that owns `installs/` … or directly in a
    `.worktrees/` dir that still exists") and the state is unheld.
  - `pm/extras.py` maps each extra to the **import that proves it** (an
    "anchor"), so availability is one `find_spec` with no package-manager
    machinery on the hot path; a platform-gated extra whose gate excludes the
    machine reads as unavailable *by design*.
  - `pm/receipt.py` writes every pm venv sync with the **same schema** the
    updater's receipts use, into the same directory, with a `kind` field — so
    one reader serves every surface and "a failed venv rebuild is as reportable
    as a failed update."
- **Edge cases & failure handling.** A corrupt `facts.json` is *evidence, not
  garbage* — it is copied to `.corrupt` before being reset. `pm/network.py`
  distinguishes a CDN firewall block (`cf-mitigated` / `x-vercel-mitigated`)
  from a real server error and says "Your install is fine; retry from another
  network". `pm/plugin_eviction.py` disables a plugin that no longer fits the
  new core **in every home that enables it**, with the reason reaching the
  operator and the receipt, so an update is never blocked by a plugin nobody
  is there to re-choose. `pm/uv_cache_prune.py` prunes **exact-to-lock** and
  "fails open for unknown layouts, never for identifiable stale pins."
- **Surprising.** `pm/environment.py` recognises the "index did not report
  upload times" and "failed to bytecode-compile" failure modes separately —
  a *failed inventory must not become an empty feature list*
  (`pm/features.py::FeatureProbeError`). `pm/environments_adopt.py` refuses to
  hot-swap a generation when a module already loaded from it changed version,
  and says so: "restart Hermes to activate it (dependency generation X was
  published after this process loaded Y)".

### Tier 2 — bulk: a compact table, one row per file

#### Group A — `.github/` templates, composite actions, and workflows (80 files)

| File | What it is / what it pins |
| --- | --- |
| `.github/CODEOWNERS` | The approval boundary. Every path that decides what CI executes, what runs at pip-install, what pins a third-party repo, and what a user pipes into a shell is owned by `hermes-agent-core`. It explicitly *replaces* a label-based gate. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Bug form: requires reproduction steps, expected vs actual, an **Affected Component** dropdown, OS + Python + Hermes version, and a `hermes debug share` debug report. |
| `.github/ISSUE_TEMPLATE/config.yml` | Blank issues enabled; security vulnerabilities routed to a private advisory, not a public issue. |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Feature form that asks "**Is this a new skill?** Most capabilities should be skills, not tools" and pushes niche integrations to the Skills Hub. |
| `.github/ISSUE_TEMPLATE/setup_help.yml` | Setup-help form: install method, exact commands run, full error output, "what I've already tried". |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR form: change type, a **"How to Test"** section, a checklist requiring `pytest tests/ -q` **and** `python scripts/check`, and a separate new-skill section. |
| `.github/actionlint.yaml` | Declares the org's self-hosted runner labels so `actionlint` does not drown real findings in "unknown runner label" noise. |
| `.github/actions/check-clean-worktree/action.yml` | A **master-switch** gate that fails a job that left tracked changes or untracked files in the checkout. Callers never pass `mode`; any unknown mode fails closed. |
| `.github/actions/desktop-build-cache/action.yml` | Two-phase (restore → prepare → save) dependency cache transport. "cache-hit: transport result only; **never permission to skip preparation**." |
| `.github/actions/detect-changes/action.yml` | Classifies a PR's changed files into CI lanes. **Fails open** when the diff cannot be computed; retries the compare API so a rate-limit blip does not silently fail open. |
| `.github/actions/e2e-screen-record/action.yml` | One screen-recording mechanism for every install-e2e runner. A missing `ffmpeg` is a **hard error** — "a graceful skip makes the missing tool invisible." |
| `.github/actions/get-app-token/action.yml` | Mints a 1-hour GitHub App installation token (5,000 req/hr vs 1,000); falls back to `GITHUB_TOKEN`. |
| `.github/actions/nix-setup/action.yml` | Installs Nix + Cachix (push is `continue-on-error`, read-only by default). |
| `.github/actions/plugin-validate/action.yml` | Builds an **isolated** Hermes checkout at a requested ref plus an isolated validator runtime, then runs `plugins validate` against a third-party plugin. |
| `.github/actions/retry/action.yml` | Retries a flaky command; the command travels through `env`, never interpolated into the script body. Captures stdout as a step output via a heredoc delimiter. |
| `.github/actions/setup-pm/README.md` | The locked-toolchain contract: PM downloads **exact** native artifacts from `pm/lock.json`, never a version range. Why a tool-only job must not auto-save the uv cache; why the prune is lock-exact. |
| `.github/actions/setup-pm/action.yml` | The core provisioning action. Cache keys hash `pm/**` + the action + `setup_toolchain.py` (not just the lock); `pm/__pycache__` is excluded (it embeds the checkout mtime). PRs restore but never save. |
| `.github/actions/setup-pm/prune/action.yml` | A nested action whose only reason to exist is that composite actions cannot declare a post step. |
| `.github/actions/setup-pm/prune/index.mjs` | Runs PM's `--exact-lock` cache prune: keeps every wheel `uv.lock` resolves and drops superseded pins. |
| `.github/actions/setup-windows-build-deps/action.yml` | Caches ARM64 OpenSSL dev files only, then calls the shared PowerShell installer. |
| `.github/blob-size-allowlist.txt` | Exact-path exemptions from the 500 KiB blob-size gate. "Admit a path only when the file must ship at its size **and** legitimately changes." |
| `.github/dependabot.yml` | Dependabot scoped to **github-actions only**; pip/npm are pinned exactly and moved deliberately, not on a schedule. |
| `.github/scripts/run-workspace-checks.mjs` | "The unit of work is a CHECK, and not a workspace." Buffers each unit's output so interleaved stdout cannot garble a failure, and **refuses to report green having run nothing**. Uses `process.exitCode` so the failing check's output is not dropped. |
| `.github/workflows/archive-inputs.yml` | Archives every pinned HTTP input to R2 when `pm/lock.json` changes. Unprovisioned R2 = a `::notice::`, not a red main. |
| `.github/workflows/blob-size-check.yml` | Rejects new/modified binaries over 500 KiB. Runs unconditionally: "a docs-only or asset-only PR … is exactly the kind of PR that commits a screenshot." |
| `.github/workflows/bootstrap-installer-build.yml` | Hand-dispatched signed Tauri bootstrap builds. No caches of any kind. Mints an Azure federated token on a 4-minute refresh loop. |
| `.github/workflows/bootstrap-installer.yml` | Pins the `install.sh` **protocol**: `protocol_version == 1` and the exact stage list. The stage manifest is checked *piped*, exactly as `curl \| bash` runs it. |
| `.github/workflows/canary-release.yml` | Daily canary; the source identity is `v<stable>+canary.<timestamp>`, which compares equal to stable, and only the protected R2 canary head moves subscribers. |
| `.github/workflows/case-collision-check.yml` | Rejects two tracked paths differing only by case. Runs unconditionally, not behind a language lane. |
| `.github/workflows/catalog-tests.yml` | A catalog-only PR runs the *discovered* set of catalog tests. "A new catalog test joins the lane by existing." |
| `.github/workflows/ci-review-comment.yml` | Live-updating PR review comment on `in_progress` (not `requested`). Always checks out the **default branch**, never the PR head — which is what makes a write token safe. Names the watched run `CI_RUN_ID`, not `GITHUB_RUN_ID`. |
| `.github/workflows/ci.yaml` | The orchestrator: one `detect` job, lane-gated `workflow_call` sub-workflows, one aggregate gate whose **check name carries a version** so a PR whose last CI predates a new required job cannot merge on a stale green. Release runs force every lane and treat a *skipped required* lane as a failure. |
| `.github/workflows/contributor-check.yml` | Every new contributor email must map to a file under `contributors/emails/` or the frozen legacy map; unmapped emails fail with the exact fix commands. |
| `.github/workflows/deploy-site.yml` | Docs deploy. Reuses the latest healthy skills index instead of re-crawling; validates the index (≥1500 skills) *before* publishing. Keeps a 14-day rolling pool of hashed assets and union-merges it (`cp --update=none`). |
| `.github/workflows/desktop-bundle-smoke.yml` | Re-smokes an **already built** artifact with the test scripts of any pushed ref, with no rebuild. Re-verifies size + sha256 against the receipt before installing. |
| `.github/workflows/desktop-bundled-release.yml` | (2,503 lines; head + tail read.) Tag admission → per-OS builder jobs → stage files + receipts to R2 → gated publish jobs write the updater feeds. "The publish jobs write the feeds ONCE after their whole build matrix is green, so a failed leg can never publish a partial channel." `stable-store` commits the Store submission *held* so certification runs before the gate. |
| `.github/workflows/docker-lint.yml` | hadolint on both Dockerfiles + shellcheck over `docker/`, pinned to `--severity=error`. |
| `.github/workflows/docker.yml` | Two images per arch. The release path is **build-and-test-then-publish-the-same-bytes**: the publish phase downloads, verifies the hash, re-checks the image identity and pushes **without rebuilding**. Main pushes tag `:main` only; `:latest` is moved by the ordered publication controller. A strict phase gate fails when a phase's required job was skipped. |
| `.github/workflows/docs-search-monitor.yml` | Live probe of the deployed docs search every 6 hours, "because search broke in production twice in one month with every build green." One retry after 90 s; only the retry writes annotations. |
| `.github/workflows/docs-site-checks.yml` | Regenerates skill docs and **diffs them against the committed copies** — GitHub renders the committed copies. |
| `.github/workflows/e2e-desktop-core.yml` | The deterministic core Desktop suite. Retries: 0, one worker, every wait event-driven; held to 10/10 consecutive green runs before being wired in. |
| `.github/workflows/e2e-desktop-update.yml` | The Desktop install/update journey. Open bugs are **message-gated** (`gates.ts`), never statically xfailed. |
| `.github/workflows/e2e-desktop.yml` | The legacy visual Playwright lane: baselines on main, comparison on PRs, a review-status JSON and a markdown visual-diff table. |
| `.github/workflows/history-check.yml` | Rejects a PR with no common ancestor with main; the comment records the real incident (a parent-less root commit collapsed `git blame` for ~1500 files). |
| `.github/workflows/icons-freshness-check.yml` | Regenerates every icon and fails on **any byte difference** from the committed copies, plus untracked files. |
| `.github/workflows/infographic-check.yml` | Rejects committed PR-infographic images, matching on the **image** not a directory name. "A passive ignore rule cannot enforce a policy. This check can." |
| `.github/workflows/install-e2e-macos-run.yml` | Three macOS arms: the shared script driver, the published `Hermes-Setup.dmg` driven by Playwright, and the signed-bundle arm. Unsupported pairs **natively skip** (grey check, no runner). |
| `.github/workflows/install-e2e-red.yml` | Keeps exactly **one** issue labelled `install-e2e-red` in step with the scheduled matrix; a red run rewrites the open one's body in place, grouped by failure class. |
| `.github/workflows/install-e2e-run.yml` | The reusable single-leg runner. "No sandbox: the driver points every git process at a local bare clone and isolates HOME … the bare runner — which is disposable, and therefore IS the sandbox." |
| `.github/workflows/install-e2e-windows-run.yml` | The Windows leg: the website `Hermes-Setup.exe` clicked by AutoHotkey, `irm \| iex install.ps1`, `hermes update`, and the app's own Update button under Playwright. The driver drops `HERMES_RUNTIME_DIR`/`HERMES_PYTHON` on entry so the product sees one shared tools store. |
| `.github/workflows/install-e2e.yml` | "Can a user on a released version get to this commit?" Tags are picked at runtime (newest, oldest, a spread) — "a hardcoded list would stop covering the newest release the day after it ships." The source gate treats a skipped leg as a failure except for *declared* capability skips; an empty matrix also fails. |
| `.github/workflows/js-autofix.yml` | Two-job security split: an **unprivileged** job runs `eslint --fix` and uploads a patch; a **privileged** job never runs npm, never installs anything, and only applies the artifact. The patch is rejected if it touches anything outside JS/TS/JSON. |
| `.github/workflows/js-tests.yml` | One 32-core job replaces a 14-leg matrix ("it paid about 371 s of repeated setup to do it"). Caches the **installed** `node_modules` tree keyed on the lockfile, with no restore-keys — "a partial hit leaves a stale tree." |
| `.github/workflows/label-rerun.yml` | The `run-e2e` label reruns CI/Docker/Nix, refusing to rerun a run for a **superseded head**. |
| `.github/workflows/lazy-deps-guard.yml` | Rejects any tracked production import of the `tools.lazy_deps` stub. Fails on inventory errors, so it "can never pass by scanning nothing." |
| `.github/workflows/lint.yml` | Three things: an **advisory** ruff+ty diff vs the base (written to `$RUNNER_TEMP`, because the clean-worktree gate would fail), a **blocking** `ruff check .`, and the **code-health ratchet**. Plus the Windows-footgun, `/tmp`-literal, `config.yaml`-writer, unmarked-OS-fake, `AGENTS.md` size and profile-scope checks. The advisory diffs are time-boxed so they cannot eat the blocking job's budget. |
| `.github/workflows/live-providers.yml` | Secret-gated **live** canaries against real provider APIs on a release tag. Runs bare `pytest`, *not* the canonical runner, because `env -i` would strip the credentials. A per-case token/dollar guard keeps a full run under $0.50. |
| `.github/workflows/lockfile-diff.yml` | Advisory **semantic** diff of `package-lock.json` — parses the `packages` map at the merge base and at HEAD and set-diffs `{path: version}`. "Never blocking; this is review signal, not enforcement." |
| `.github/workflows/nix.yml` | `nix flake check` (21 checks). Owns its own triggers because "a reusable-workflow call holds the caller run in progress for the full build, and GitHub refuses `gh run rerun` on a run that is still in progress." The store cache is saved from main only, GC'd to 5G, and purged by prefix. |
| `.github/workflows/osv-scanner.yml` | Weekly OSV scan of five explicit lockfiles, `fail-on-vuln: false`. "The findings are the repo-wide baseline of pinned-dep CVEs … and belong in the Security tab, not in each PR's review comment." |
| `.github/workflows/plugin-catalog-ci.yml` | The third-party plugin admission gate: data-only PRs; `repo` an https URL; `sha` exactly 40 hex and a **commit object**; `subdir` relative with no `.`/`..`; the resolved path *and every symlink* must stay inside the pinned clone; an unscannable-payload gate unless the binary carries a build-provenance attestation at the pinned digest; and a self-updater gate (fetching GitHub **and** writing plugin files). |
| `.github/workflows/pm-bundle.yml` | Stages the self-contained agent payload per target and smoke-tests the **relocated** payload with the network disabled (`unshare --net` on Linux). |
| `.github/workflows/profile-artifact-check.yml` | Rejects profile archives in the checkout — the enforcement boundary that still catches `git add -f`. |
| `.github/workflows/prompt-surface-diff.yml` | Diffs the **committed prompt-surface snapshot** (system prompt + `tools[]` per surface) and reports per-surface token deltas. Never blocking; the staleness test is the gate. |
| `.github/workflows/remote-backends.yml` | Runs the SSH and Docker terminal backends against a **real** sshd container and the real Docker daemon, with `--fail-on-skip` — "here that would be a green lane over zero coverage." |
| `.github/workflows/rust-tests.yml` | `cargo test --lib` for the Tauri bootstrap installer — a crate the classifier treated as `frontend`, so it had never compiled in CI. |
| `.github/workflows/sandbox-image.yml` | The terminal-backend sandbox image (no Hermes code, so it does not track main). Publishes per-arch by digest and stitches the manifest list registry-side, with retries. |
| `.github/workflows/skills-index-freshness.yml` | A watchdog every 4 hours: the live index must be <26 h old and above per-source floors. A second job checks the catalog's CORS from a browser's point of view — "`curl -L` never checks CORS, so the watchdog stays green while Desktop is blocked." |
| `.github/workflows/skills-index.yml` | Twice-daily multi-source catalog crawl with a 120-minute timeout (15 min was cancelled every run and left the index frozen). Mints a **second** App token before the stars probe because the walk outlives the first token's TTL. |
| `.github/workflows/stable-release-publication.yml` | The reconcile pass after a failed Stable Release: reconciles stable drafts and protected heads, promotes ordered aliases, commits the Store draft. |
| `.github/workflows/stable-release.yml` | The release orchestrator. An `admit` job resolves a claim tag to an immutable commit and emits a **lane table** (`lanes` = one flag per lane, `jobs` = one run flag per lane-controlled job) that every downstream `if` reads. `ci.yaml` is deliberately excluded from `secrets: inherit` because it runs PR-controlled code. |
| `.github/workflows/supply-chain-audit.yml` | A deliberately **narrow** scanner: base64-decode + exec/eval on one line, and a subprocess whose command is encoded. "Low-signal heuristics … were intentionally removed — they fired on nearly every PR and trained reviewers to ignore the scanner." Also blocks PyPI deps without an upper bound. |
| `.github/workflows/termux-verify.yml` | Termux packaging contracts on Linux, prebuilt TUI checks, and a **bionic runtime verification** in a real ARM64 container with `--network none`. A release candidate still fails loudly on missing R2. |
| `.github/workflows/tests-os.yml` | Runs the OS-marked tests on their own host. Each lane **fails when it selects zero tests** — "a renamed marker or bad selector can never report a green job that ran nothing." A backstop asserts no leftover `python.exe`/`hermes.exe`. |
| `.github/workflows/tests.yml` | The Linux suite: two 32-core slices, per-file subprocess isolation, a per-file duration cache (only green first-attempt durations are written, "so a hang on main cannot ratchet its own bound upward"), and a WAL-capable SQLite assertion. E2E uses `HERMES_TEST_FILE_RETRIES: 0` — "a rare corruption that passes on retry is still a corruption." |
| `.github/workflows/uv-lockfile-check.yml` | Verifies `uv.lock` is in sync and **distinguishes a registry outage from a real desync** by grepping the log for network-error signatures; the two get different messages. |
| `.github/workflows/windows-bundle-sdk.yml` | The only lane that runs the real Windows SDK downloader (the vitest halves skip every `runIf(win32)` leg on Linux). |
| `.github/workflows/windows-desktop-attach-e2e.yml` | Desktop attaching to a running local gateway on a real Windows host, on the dev tree **and** on the electron-builder `--dir` build of the same commit. |
| `.github/workflows/windows-install-update-e2e.yml` | The real `install.ps1` → `hermes update` journey on a fresh fake profile. A manifest file proves the crash cells actually ran ("so a lost marker or opt-in would run zero crash cells green"). |
| `.github/workflows/windows-venv-e2e.yml` | On-demand only: live venv-holder E2E against the real Windows process table. Deliberately not wired to PR/main. |

#### Group B — `pm/` — the locked package manager (58 files)

| File | What it is / what it pins |
| --- | --- |
| `pm/AGENTS.md` | The dependency-pinning policy: `>=floor,<next_major` on PyPI, 40-char SHAs for git, SHA + `# vN` for actions, `==exact` for CI-only requirements. "A bare `>=X.Y.Z` is rejected by CI and reviewers." Also the release-age rule (`exclude-newer = "3 days"`) and its one exemption class (CA trust stores). |
| `pm/__init__.py` | The lazy PEP-562 facade: `pm.ensure`, `pm.sync_venv`, `pm.build_environment` … resolved on attribute access so `pm.environments` runs at process boot without dragging in the downloader. |
| `pm/_marker_eval.py` | Evaluates one PEP 508 marker inside PM's runtime and prints "1"/"0" — for callers whose interpreter has no `packaging`. |
| `pm/_uv.py` | Resolves the pinned uv and Python without host discovery or recursive worker dispatch. A read-only probe never installs. |
| `pm/_venv_entry.py` | Runs code inside a venv on *another* interpreter (stdlib only) — for sealed payloads whose venv redirectors must not run. |
| `pm/artifact-mirror.json` | The public content-addressed mirror layout: `origin` + `prefix`. |
| `pm/artifact_mirror.py` | Builds mirror URLs from a pin's sha256 and bridges an npm registry URL onto the mirror. |
| `pm/build_env.py` | The CLI for building/inspecting explicit Python environments: `--check-lock`, `--exact-lock`, `--prune-cache`, `--export-requirements`, `--manager-runtime`, `--record-selection`. `--exact-lock` replaces `--ci/--prune-cache` because "downloaded wheels the lock keeps must survive." |
| `pm/build_operations.py` | Build/CI operations with caller-owned inputs, independent of live selection: `check_project_lock`, `export_requirements`, `build_requirements_environment`, `prepare_tools`, `verified_tools`, `stage_tools`, `prune_cache`. |
| `pm/cli.py` | The `hermes pm` CLI: `lock / install / repair / env / doctor / gc / bundle / status / update`. |
| `pm/client.py` | Synchronous PM mutations **in an isolated interpreter, never the app's imports** — every mutation is a JSON-line request to the PM worker. |
| `pm/defaults.py` | The optional default packages and the user's per-install opt-outs, recorded in `declined-packages.json`. A damaged record raises rather than silently re-adding a package the user refused. |
| `pm/download_state.py` | Cross-process ownership of resumable partials (a lock inode must outlive its release) and the 6-hour GC grace window. |
| `pm/downloader.py` | Resumable, hash-verified, multi-connection downloads. Partial state is keyed by `sha256(url)` so two callers share one partial; a `Release` wait handles an upstream artifact published late. |
| `pm/environment.py` | PM's private Python engine: tool routing, isolation, command execution, `classify_uv_failure`, `PythonEnvironment` (create/lock/sync/export/install_wheelhouse/prune/check). |
| `pm/environments.py` | The generation layout: where a project's venv generations live, which one is selected, the interpreter inside any venv. Stdlib + `hermes_constants` only. |
| `pm/environments_adopt.py` | Adopts a newly selected generation inside a running process **only** when nothing already imported would change underneath it; otherwise it returns the restart reason. |
| `pm/extras.py` | Extra → anchor-import table; platform gates from `[tool.hermes.extras-platforms]`; `ensure_import` / `ensure_and_bind`; `legacy_selection` for the first-generation migration. |
| `pm/features.py` | The `enabled-features.json` file: the EXACT extras the install carries. With lazy installs off the list is FROZEN; with them on it is the baseline. A failed inventory raises `FeatureProbeError` rather than yielding an empty list. |
| `pm/filesystem.py` | Stdlib-only primitives: `long_root`/`native` (Windows MAX_PATH), `lock_fd`, `durable_write_bytes` (atomic + fsync), `retry_held` (rides out a transient Windows AV/indexer hold), `remove_tree` (clears a read-only attribute). |
| `pm/index_config.py` | Forwards the user's package-index/transport configuration into uv, strips the rest, and bridges pip's `index-url` to `UV_INDEX_URL`. |
| `pm/install.py` | `ensure()` — make the installed state match the lockfile and hand back the composed environment. Publishes a new generation atomically, restores the previous entry on failure, and supports `drift()`, `check()`, `activate()`. |
| `pm/install_states.py` | Reclaims per-checkout dependency state whose checkout is **provably** gone; skips anything a live process may hold (the install lock, a generation lease). |
| `pm/launch.py` | The CLI entry after the isolated interpreter is selected: installs platform trust *before* importing the import closure, then leases the current runtime. |
| `pm/libatomic.py` | Installs the host `libatomic` package that official Linux Node needs. Interactive `sudo` happens **before** PM takes its lock; inside the lock only `sudo -n` is allowed. |
| `pm/lock.json` | The pin table: 21 packages, each with a version and per-target `{url, sha256}` artifacts (a target may hold a list when a package is split across archives). |
| `pm/lock.py` | `Lockfile` (the pins, published with a conflict check) and `Facts` (the installed state: entry, version, env, stamp, target, artifact shas, tree digest). A corrupt facts file is preserved as `.corrupt`. |
| `pm/native_build.py` | Prepares the native compiler environment (MSVC, Clang, Rust, static OpenSSL) for Windows ARM64 sdist builds — "PM owns the sync, so PM prepares that environment." |
| `pm/network.py` | Bounded retries for idempotent network operations, with `Retry-After` support and a CDN-firewall explanation distinct from a server error. |
| `pm/operations.py` | The Python dependency operations the isolated engine executes: `build_environment`, `lock_project`, `stage_manager_runtime`, `ensure_environment`, `ensure_project_environment`, `ensure_python_tool`. Callers "describe a dependency graph and its lifetime, never a uv command." |
| `pm/package.py` | What a package **is**: `Package`, `BinaryPackage`, `DebPackage`, `StatePackage`, `Runner` (the composed environment), `compose_env`, `InstallError`. No versions, no hashes — those live in the lock. |
| `pm/packages.py` | The concrete package definitions: uv, python, node, npm, git, gh, ffmpeg, ripgrep, chromium, llama.cpp (cpu/cuda/vulkan/hip/metal), whispercpp, cua-driver, agent-browser, bws, iron-proxy, termux-docker, dmgbuild. |
| `pm/paths.py` | Where the store, lockfile, installed-state file and `install-stamp.json` live; the partials area is anchored to the **default** hermes root, never the (possibly read-only) store. |
| `pm/plugin_declarations.py` | Reads a plugin's build declaration (manifest version, `python_dependencies`) without importing CLI configuration or plugin code. |
| `pm/plugin_eviction.py` | Keeps an update alive when an enabled plugin no longer fits the new core: the plugin is disabled in every home that enables it, the reason reaches the operator and the receipt, and the update continues. |
| `pm/plugin_inputs.py` | The plugin-member input a sync or currency probe takes: `Members`, `Candidates`, `Selection`, `StagedUpdate`. Each request names exactly one source, so conflicting inputs cannot be expressed. |
| `pm/plugins_state.py` | Reads every profile's enabled plugins in config order for the shared union. Discovery never edits a profile's selection. |
| `pm/progress.py` | One output policy for long child processes: verbose in CI, one rewritten status line on a terminal, start+finish off it — and a failure always prints the captured tail. |
| `pm/publication.py` | Worker-local plugin selection and code publication. "Requests carry proposed data; discovery, snapshots and publication happen only while the install lock is held." |
| `pm/pyproject.toml` | PM's own runtime: `packaging`, `tomli-w`, `ruamel.yaml`, `truststore`. "Deliberately independent: repairing the app cannot require resolving it." |
| `pm/receipt.py` | The machine-readable receipt for every pm venv sync — same schema and directory as the updater's receipts, with a `kind` field. Rotated at 20 receipts. |
| `pm/recovery.py` | Restores dependency generations without importing the damaged environment; validates the startup imports; `refresh_dependencies` re-resolves after an image upgrade. |
| `pm/registry.py` | The package registry: `register`, `get_package`, `all_packages`, `package_definitions`, and `walk` (the dependency walk with cycle protection). |
| `pm/runtime.py` | PM's runtime, independent of the application graph. Only the bootstrap runs in the caller's interpreter; it never imports application dependencies. |
| `pm/runtime_stage.py` | One locked dependency builder for PM workers and packaged runtimes; "no project install, application extra, or application lock enters this graph." |
| `pm/security_packages.py` | Optional security executables (bws, iron-proxy). Acquisition and publication belong to PM. |
| `pm/shell.py` | `pm.shell()` — the one place Hermes resolves the shell it runs commands with (on Windows, the staged Git-for-Windows bash). |
| `pm/store.py` | The machine-wide byte store: download, verify, extract, publish atomically; target detection (glibc/musl/bionic); `tree_digest`. |
| `pm/termux_libs.py` | The Termux pool pin table. The pool deletes a package's previous archive when it rebuilds, so a pin "rots silently until a payload build downloads it" — `pm update --termux --check` reports retired rows. |
| `pm/termux_runtime_libs.json` | The pinned Termux runtime libraries (brotli, c-ares, fftw, …) with url + sha256 + version per library. |
| `pm/testenv.py` | The isolated environment a checkout's test suite runs under (the locked deps plus the `dev`/`test` groups). A side environment — "test-only dependencies must not enter PM facts or anything that ships." |
| `pm/update.py` | `hermes pm update`: resolve the latest versions per package (GitHub releases, npm dist-tags, the llama.cpp bucket, per-distro indexes) and re-pin the lockfile. |
| `pm/user_facing.py` | The terminal's PATH: the user's own tools first, Hermes's after. Hermes's own operations resolve pinned tools through PM, never through that PATH. |
| `pm/uv.lock` | PM's own `uv.lock` (generated; 3.3 KB). |
| `pm/uv_cache_prune.py` | Exact-to-lock pruning of a uv cache. "Unidentifiable buckets survive — pruning fails open for unknown layouts, never for identifiable stale pins." |
| `pm/worker.py` | One stdlib JSON-line PM request per isolated process, with a pause/control channel. |
| `pm/worker_operations.py` | Import-light routing and prerequisite policy for the private PM worker. |
| `pm/workspace.py` | Resolves core plus plugin requirements in a **writable build snapshot**. "Shipped source and locks are inputs, never mutation targets." Strips the release-age cutoff from every generated workspace. |

#### Group C — `scripts/` — the CI gates, builders and release machinery (229 files)

| File | What it is / what it pins |
| --- | --- |
| `scripts/_activation.py` | Activation guard: every script fails **immediately** with the exact activation command rather than later with a confusing `ModuleNotFoundError`. |
| `scripts/_activation.sh` | The sourced POSIX activation: `hermes_sync`, `hermes_bootstrap_python`, `hermes_compose_env`, `hermes_apply_env`, `hermes_activation_current`, `hermes_ensure_env`. |
| `scripts/aa_quality_sync.py` | Proposes catalog quality updates from Artificial Analysis. Authoring-time only: "The script proposes, the commit decides." |
| `scripts/add_contributor.py` | Writes one file per contributor email under `contributors/emails/` — file additions never merge-conflict, unlike the frozen legacy map. |
| `scripts/audit-old-updater-imports.py` | Answers "what can an OLD `hermes update` still import from a NEW tree?" — the update swaps the checkout under its own feet. |
| `scripts/audit_pr_attribution.py` | Mirrors the CI contributor gate locally so salvage branches never bounce off it. |
| `scripts/build-bundle.ps1` | Builds the desktop MSIX for the commit checked out here, on this machine (sideload or Store variant). |
| `scripts/build-bundle.sh` | The macOS/Linux counterpart (DMG, ZIP, AppImage), unsigned and not notarized. |
| `scripts/build/README.md` | How the shared product builders relate to npm, uv, PM and Nix. |
| `scripts/build/agent.py` | Assembles a runnable agent from prepared inputs, without downloads or live state. |
| `scripts/build/desktop.mjs` | The Electron renderer build: native-tree validation, bundling, stamps, typecheck. |
| `scripts/build/freshness.mjs` | Product receipts: source hash, output hash, stamp identity, "is the current build current?" — the build's own freshness contract. |
| `scripts/build/frontend-common.mjs` | Shared frontend helpers: workspace tool resolution, owned-output checks, `publishDirectory`, `withProduct`. |
| `scripts/build/icon_environment.py` | Prepares an interpreter that can run the icon generator without a Hermes install. |
| `scripts/build/inputs.py` | The `AgentInputs` dataclass — build-time paths, "not a second runtime configuration or dependency resolver." |
| `scripts/build/launcher_wrapper.py` | The bundled-payload CLI entry wrapper (the distlib launcher's zip overlay) with four `HERMES_*` placeholders. |
| `scripts/build/launchers.py` | Shared payload launcher rendering — all paths supplied by the assembler. |
| `scripts/build/mint_launchers.py` | Mints the win32 CLI launchers with distlib, using the payload's **own** store python as the minting interpreter. |
| `scripts/build/node-deps.mjs` | Prepares node dependencies: npm command resolution, a "completed install matches" receipt check, `npm ci` under a receipt-verified tree. |
| `scripts/build/python.mjs` | Runs build helpers with the prepared Python, "never an ambient uv environment." |
| `scripts/build/tui.mjs` | The self-contained TUI compiler. |
| `scripts/build/web.mjs` | The dashboard compiler, with a cgroup-aware thread and heap cap. |
| `scripts/build/windows-deps.ps1` | Build-only prerequisites (MSVC, SDK, Clang, Rust, static OpenSSL). |
| `scripts/build_model_catalog.py` | Builds the curated model catalog JSON the CLI fetches at runtime, so model lists can change without a release. |
| `scripts/build_skills_index.py` | Crawls every skill source into a static JSON index served by the docs site, so `hermes skills search/install` does not hit the GitHub API. |
| `scripts/bundle-store-msixbundle.mjs` | Bundles x64 + arm64 Store packages into ONE universal `.msixbundle`. |
| `scripts/bundles/bytecode.py` | Bakes the payload's bytecode cache at staging time so a sealed payload does not pay a cold-compile stall on first launch. |
| `scripts/bundles/channel_artifacts.py` | One native manifest/feed writer for admitted previews and protected releases. |
| `scripts/bundles/desktop.py` | Builds a complete desktop bundle with the shared Python payload tools — "the one driver. Local and CI run the same command." |
| `scripts/bundles/desktop_inputs.py` | Build identity and process environment from an admitted preparation; validates the builder's identity against the request. |
| `scripts/bundles/desktop_prepare.py` | Complete desktop dependency preparation and its job-local consume contract (`BuildRequest`, `PreparedDesktop`). |
| `scripts/bundles/desktop_toolchain.py` | Child-scoped desktop build tools, independent of the invoking Hermes install. |
| `scripts/bundles/dmgbuild_diagnostics.py` | Runs the supplier's dmgbuild with failure-time, read-only handle diagnostics. |
| `scripts/bundles/native.py` | Native payload staging through PM's existing package authority, with an **arch guard**. |
| `scripts/bundles/native_build.py` | Prepares or consumes the standalone PM payload, without desktop products. |
| `scripts/bundles/native_prepared.py` | Job-local native preparation admission; "never a portable environment cache." Publishes a prepared bundle with an input digest. |
| `scripts/bundles/payload.py` | Distribution snapshots, PM facts and portable link sealing. |
| `scripts/bundles/release_artifacts.py` | Records, stages and promotes the exact native release artifacts; validates the Windows bundle and writes the App Installer feed. |
| `scripts/bundles/set_dmg_volume_icon.sh` | Replaces the volume icon of a finished DMG before signing. |
| `scripts/bundles/stage.py` | Selects complete frontend products and stages the runnable native agent. |
| `scripts/capture-cage-terminal.sh` | Captures a terminal screenshot inside `cage --`. |
| `scripts/check` | The local entry point for **every blocking CI check**, with the same pinned tools: the workflow guards, ruff and the code-health ratchet, plus the case-collision, lazy-deps, profile-archive and blob-size guards. Can install a pre-commit hook. |
| `scripts/check-case-collisions.py` | Blocking check for tracked files whose paths collide when case is ignored. |
| `scripts/check-windows-footguns.py` | The Windows footgun rule table (`open()` without `encoding=`, `os.fdopen`, `os.kill(pid, 0)`, `os.setsid`, shebang scripts, …) with an inline `# windows-footgun: ok` suppression and "false negatives are fine" guard hints. |
| `scripts/check_bash_shebangs.py` | Requires a PATH-resolved Bash in scripts — Nix and other non-FHS environments have no fixed `/bin/bash`. |
| `scripts/check_config_yaml_writers.py` | Fails when a `config.yaml` is written by anything but the comment-preserving writer (a PyYAML dump destroys every user comment — issue #92554). |
| `scripts/check_no_tmp_literals.py` | Fails on a literal `/tmp` in production code, skills, docs or prompts. `/tmp` is not portable: Termux has none, macOS aliases it to `/private/tmp`, Linux mounts it as a RAM tmpfs. A `no-tmp: ok — <why>` marker marks a deliberate line. |
| `scripts/check_profile_scope_patterns.py` | Advisory lint for profile-scope hazards on the lines a change adds — one process may serve many profiles, and `os.environ` holds only the launch profile's values. |
| `scripts/check_subprocess_stdin.py` | Fails when a subprocess call in TUI-context code inherits stdin (the gateway child speaks JSON-RPC on stdin; inheriting it causes an EOF exit). |
| `scripts/ci/archive_inputs.py` | Archives pinned binary inputs in R2 and seeds existing CI consumers. |
| `scripts/ci/assemble_review_comment.py` | The unified CI review comment: every job emits a `review_status` JSON array; the assembler dedups by source, orders by severity, and renders one comment. |
| `scripts/ci/catalog_test_files.py` | Prints the test files the `catalog` lane runs — discovery, so a new catalog test joins the lane without an edit. |
| `scripts/ci/check_agents_md_size.py` | Fails when a tracked `AGENTS.md` would be truncated when an agent loads it (a whole chain of them is one project-context block). |
| `scripts/ci/check_blob_size.py` | Fails when a change adds a large binary or a large new file — "every blob a merge adds stays in every clone forever." |
| `scripts/ci/check_catalog_cors.py` | Fetches the docs catalog the way Desktop does and fails when a browser would block it (CORS on every hop of the redirect chain). |
| `scripts/ci/check_docs_drift.py` | A docs drift ratchet: every `DEFAULT_CONFIG` key and every slash command must be documented, with a baseline file. |
| `scripts/ci/check_lazy_deps_imports.py` | Fails on any tracked production import of the `tools.lazy_deps` stub; fails on inventory errors. |
| `scripts/ci/check_os_marker_fakes.py` | Fails when a test fakes macOS without carrying `@pytest.mark.platforms("macos")` — a faked branch "never runs on macOS." |
| `scripts/ci/check_profile_archive_boundary.py` | The blocking, executable policy against profile export archives in the checkout or the build context. |
| `scripts/ci/check_public_surface.py` | Diffs the public surface (dropped public names, methods, test functions) against a base ref — after a refactor that dropped 1,703 names "reviewers found ~30 of the names by hand." |
| `scripts/ci/classify_changes.py` | Classifies a PR's changed files into CI work lanes. The formula behind the orchestrator's `if:` conditions. |
| `scripts/ci/desktop_build_cache.py` | Describes the desktop dependency snapshot with the runner's stdlib only. "Restored bytes are candidates: preparation must still admit them." |
| `scripts/ci/desktop_commands.py` | Exposes already-prepared tools to later CI audit/upload steps; never installs. |
| `scripts/ci/docs_drift_baseline.json` | The documented-gap baseline for the docs drift ratchet. |
| `scripts/ci/e2e_screenshot_status.py` | Selects the Desktop E2E visual evidence and builds the CI review status for it. |
| `scripts/ci/list_os_marked_tests.py` | Lists the test files that carry a `platforms()` gate for a given platform (the marked-OS lane's file list). |
| `scripts/ci/live_comment.py` | The live-updating PR review comment poller: polls job statuses through the API, upserts one comment, and fetches every `review-status-*` artifact. |
| `scripts/ci/lockfile_diff.py` | The semantic `package-lock.json` diff (parse the `packages` map, set-diff `{path: version}`). |
| `scripts/ci/profile_scope_patterns.json` | The validated profile-scope pattern set, with a class legend (C1 … ) and a selection rule: patterns hitting ≤50 sites are lint, more are review greps. |
| `scripts/ci/prompt_surface.py` | Renders the model-facing prompt surface (system prompt + `tools[]` per surface) **deterministically** and diffs the committed snapshot. |
| `scripts/ci/python_packages.py` | Prepares isolated CI tools, then exports their Python or runs it directly. |
| `scripts/ci/required_results.py` | The strict CI aggregate gate shared by `ci.yaml` and the stable orchestrator: a skipped required lane fails in release mode. |
| `scripts/ci/setup_toolchain.py` | The GitHub Actions file-command wrapper around the real, stdlib-only PM bootstrap (`prepare` / `install` / `dependencies` / `archive-inputs`). |
| `scripts/ci/start_test_sshd.sh` | Starts a throwaway sshd container with a per-run keypair for the real SSH backend tests. |
| `scripts/ci/test_sshd_container_setup.sh` | Runs *inside* that container: installs openssh-server, adds the `hermes` user that accepts only the test key, execs sshd. |
| `scripts/ci/timings_report.py` | Collects CI job/step timings from the API and generates an HTML diff report with a gantt chart and a per-step breakdown. |
| `scripts/code_health/__init__.py` | "Code-health ratchet: per-unit caps that only go down." |
| `scripts/code_health/__main__.py` | `python -m scripts.code_health` entry. |
| `scripts/code_health/cli.py` | The ratchet's CLI, including the **master switch** (blocking / advisory / off) read from `config.py`. |
| `scripts/code_health/compare.py` | The base-vs-head verdict: every unit has its own cap, and pattern rules compare *multisets of fingerprints* "so fixing one violation and adding another still fails." |
| `scripts/code_health/config.py` | Targets, file scope and the rule table — "the one place a rule's id, scope and fix text live." The `fix` text is what the agent reads when it trips the rule. |
| `scripts/code_health/gitio.py` | Git plumbing: changed files between two trees and their contents on either side, read through the same functions so both sides are measured identically. |
| `scripts/code_health/measure.py` | Measures a set of files in one tree (AST-based; comments, string statements, complexity attribution). |
| `scripts/code_health/model.py` | The shared data shapes: `Unit`, `Hit`, `FileMeasure`, `Finding`. |
| `scripts/code_health/py_ast.py` | Leaf AST helpers shared by the checkers (no imports from the engine, so no cycle). |
| `scripts/code_health/py_rules.py` | The Hermes-specific AST rules (`HX` ids): hard-coded home paths, new env vars, argv identity, unscoped secret fallbacks, and more. "Checkers favour precision: a rule that cries wolf gets an allow comment on every hit and stops meaning anything." |
| `scripts/code_health/py_rules_sleep.py` | HX013: a wall-clock sleep in a test. The one sleep that is not a race is a bounded poll, so the poll-shape analysis lives here too. |
| `scripts/code_health/py_structure.py` | Python structure: qualname, length, nesting, body hash, scope lookup. Cyclomatic complexity comes from ruff so the number matches `ruff check --select C901`. |
| `scripts/code_health/replay.py` | Replays the ratchet over recently merged PRs: "what would it have blocked?" |
| `scripts/code_health/report.py` | Allow comments (`# health: allow <RULE> -- <why>`) and the agent-facing report. |
| `scripts/code_health/ruff_runner.py` | Runs the **pinned** ruff and splits its output into per-function CC and pattern hits — "a different local ruff is never used silently." |
| `scripts/code_health/ts_measure.py` | TypeScript measurement: runs `ts_units.mjs` under node with the lockfile's typescript. |
| `scripts/code_health/ts_units.mjs` | TypeScript structure for the ratchet: per-function CC (classic McCabe), length, nesting. Parses only — no type check. |
| `scripts/contributor_audit.py` | Cross-references git authors, `Co-authored-by` trailers and salvaged PR descriptions to find contributors missing from the release notes. |
| `scripts/desktop-update.ps1` | A **compatibility forwarder** (16 lines): "do not add logic here." The hand-off moved to `scripts/desktop-update/windows.ps1`. |
| `scripts/desktop-update/marker-claim.ps1` | Claim / delegate / release / heartbeat of the update marker. Every function mutates the marker only inside one `Open-MarkerLock` hold and judges it inside that same hold. |
| `scripts/desktop-update/marker.ps1` | The update marker (contract C1 v2) for `windows.ps1`, in pure PowerShell + CIM "because the claim runs before the first Add-Type." |
| `scripts/desktop-update/marker.sh` | The POSIX marker, bash 3.2 compatible (no associative arrays, no `{fd}` redirections). |
| `scripts/desktop-update/posix.sh` | The repo-owned macOS/Linux Desktop update hand-off: wait for the Desktop to exit, run `hermes update`, tell the shim how it went, reopen the app. |
| `scripts/desktop-update/repro.sh` | Reproduces the desktop-update paths against a sandboxed `HERMES_HOME` — "nothing here touches your real ~/.hermes or checkout." |
| `scripts/desktop-update/runtime.ps1` | The launcher probe helper; every probe is bounded (60 s) so a hung launcher fails the probe instead of parking the hand-off forever. |
| `scripts/desktop-update/serve-ui.py` | The loopback shim server for the update progress page (a `file://` page cannot receive events from a detached process). |
| `scripts/desktop-update/swap-selftest.sh` | The `--self-test-swap-interrupt` self-test: uses the REAL `mac_swap` and `mac_bundle_recover`. |
| `scripts/desktop-update/ui.html` | The quiet shim page for the update hand-off (Windows + POSIX), served over loopback. |
| `scripts/desktop-update/update-job.ps1` | The Win32 job/process helper: `StartAssigned` creates the step **SUSPENDED** inside a private job so the marker can publish the delegate before the first instruction runs. |
| `scripts/desktop-update/update-panel.js` | A clone of `ui.html` for systems without chromium (driven by `osascript -l JavaScript`). |
| `scripts/desktop-update/windows.ps1` | The repo-owned Windows Desktop update hand-off — 1,820 lines. Exists because of the frozen-binary problem: the staged Tauri binary had no self-update path. |
| `scripts/dev-minimal-sandbox.sh` | A one-line entrypoint that sources `dev-sandbox.sh` to preserve a separate identity. |
| `scripts/dev-sandbox.sh` | Runs a Hermes instance in an isolated sandbox: separate `HERMES_HOME`, separate Electron userData, a distinct Desktop app name so it does not compete with the main instance's single-instance lock. |
| `scripts/discord-voice-doctor.py` | The Discord voice diagnostic: checks every dependency, config value and bot permission needed for voice mode, with masked values. |
| `scripts/docker_config_migrate.py` | Runs the Docker boot-time config migrations safely, with a backup/restore of the touched paths. |
| `scripts/docker_rebootstrap_nous_session.py` | Re-seeds a terminally-dead Nous bootstrap session at boot — only when the on-disk entry is provably terminal *or* the orchestrator seed is newer, so a healthy rotated token is never rolled back. |
| `scripts/dump_desktop_slash_registry.py` | Regenerates the desktop slash registry JSON from `COMMAND_REGISTRY`; the test fails until the committed copy is updated. |
| `scripts/e2e_shared_metrics_staging.py` | Live staging E2E for the shared-metrics exporter against the real ingest service, with a throwaway `HERMES_HOME`. |
| `scripts/gen-bootstrap-pins.py` | Generates the bootstrap pin fragments inside the installers — the installers fetch uv **before** any checkout exists, so they cannot read `pm/lock.json` at run time. |
| `scripts/gen_gateway_command_parity.py` | Regenerates the gateway-command-parity doc from the code: what each local client does with each shared command. |
| `scripts/gen_gateway_contracts.py` | Renders the `tui_gateway/contracts` into TypeScript and OpenRPC, with a deliberately small JSON-Schema-subset renderer (so the Python-only CI lane needs no Node). |
| `scripts/generate-icons.mjs` | The thin Node wrapper around the Python icon generator. |
| `scripts/generate_conformance_vectors.py` | Renders a shared corpus (markdown grid + scar tissue + adversarial agent output) through the **native** platform renderers and dumps input→output JSON vectors — "the native adapters as executable spec." |
| `scripts/generate_icons.py` | Generates every app icon from the source art + backgrounds, for all platforms and AppX scales. |
| `scripts/hermes-gateway` | A historical script entry; "service policy belongs to `hermes gateway`." |
| `scripts/install.cmd` | The CMD wrapper that launches the PowerShell installer. |
| `scripts/install.ps1` | The Windows bootstrap installer (1,672 lines): git checkout + venv + `hermes` on PATH, with a `-Manifest` / `-Stage` protocol. |
| `scripts/install.sh` | The POSIX bootstrap installer (1,300 lines): clone, acquire uv/Python, then hand the checkout to the same completion an update runs, "so a fresh install and a finished update land in one state." |
| `scripts/iso-certify.py` | The dashboard turn-isolation certify harness: percentiles over a real websocket turn, stall detection, and a scratch dashboard. |
| `scripts/keystroke_diagnostic.py` | Diagnoses how `prompt_toolkit` identifies keystrokes in the current terminal (especially on Windows). |
| `scripts/kill_modal.sh` | Kills all running Modal apps. |
| `scripts/launch_capture_probe.sh` | "Probe-the-probe" for the launch capture: control rows first (no opt-in env var → `subprocess.run` untouched), then treatment rows. |
| `scripts/lint_diff.py` | Diffs ruff + ty reports between two refs by a stable key (file, rule, line) into a Markdown summary. |
| `scripts/micro_compaction_report.py` | Summarizes micro-compaction telemetry from the content-free JSON lines the compressor emits. |
| `scripts/msix-shared.mjs` | Native MSIX identity/version derivation and the artifact content-type table; the App Installer XML and feed publication belong to `scripts.bundles.release_artifacts`. |
| `scripts/observability/gateway_health_export_probe.py` | Exercises the Gateway Health & Diagnostics export against a local OTLP capture collector. |
| `scripts/observability/otel_capture_collector.py` | A tiny local OTLP/HTTP capture collector (not a production collector): accepts traces/metrics/logs, records request metadata as JSONL, returns 200. |
| `scripts/probe_active_session_exclusivity.py` | Cross-process falsification of the per-session fence: two *separate* gateway processes writing to one conversation. |
| `scripts/profile-tui.py` | Drives the Hermes TUI under `HERMES_DEV_PERF` and summarizes the pipeline (percentiles over the log). |
| `scripts/release-content-types.json` | The extension → content-type table for release artifacts. |
| `scripts/release.py` | The release entrypoint: `release`, `publish`, `abandon`, canary, commit and channel operations; changelog and co-author parsing. |
| `scripts/render-builds-table.py` | Renders the release download tables into the published page and as standalone pages in the bucket. |
| `scripts/run-in-hermes-env` | Runs a command in the Hermes dev environment, whatever shell or cwd it was launched from. |
| `scripts/run_tests.sh` | The **canonical** test runner: the local run must match CI. Enforces credential hygiene (a scrubbed environment), a temp `HERMES_HOME`, `TZ`, and per-file isolation. |
| `scripts/run_tests_parallel.py` | The per-file parallel runner (1,664 lines) — the replacement for xdist plus a subprocess-isolation plugin: discovery, per-file timeouts scaled by the last healthy duration, retries, and a duration cache. |
| `scripts/sample_and_compress.py` | Samples and compresses HuggingFace trajectory datasets. |
| `scripts/sandbox/generate-e2e-matrix.mjs` | Expands the install/update **support matrix** into concrete E2E combinations; renders the plan as a human-readable chart. |
| `scripts/sandbox/pick-release-tags.sh` | Picks the release tags the install/update E2E should update FROM — at runtime, "rather than hardcoding keeps [the matrix] covering the newest release the day after it ships." |
| `scripts/scan_plugin_payloads.py` | Scans a pinned plugin tree for unscannable executable payloads (compiled binaries, committed bytecode, archives hiding either) — catalog rule 17. |
| `scripts/smoke-payload.sh` | Exercises the published launch contract after relocation. "Network isolation is the runner's responsibility … not a lazy-deps flag." |
| `scripts/smoke_nemo_relay_shared_metrics.py` | Runs a real Hermes CLI turn against a local fake provider and validates the Relay shared-metrics output, with canary strings for prompt, model, response, tool call, tool result and skills. |
| `scripts/stage-msixbundle.mjs` | Bundles x64 + arm64 MSIX packages and signs the envelope; every mode stops at the artifact. |
| `scripts/termux/assembly_permissions.sh` | Host-side ownership handoff for the disposable environment assembly mount. |
| `scripts/termux/build.py` | Builds the TUI and packages a prepared bionic payload as a Termux `.deb`. |
| `scripts/termux/build_builder_image.sh` | Builds + pushes the derived Termux builder image; the tag hashes the pinned base digest **and** the Dockerfile bytes. |
| `scripts/termux/build_config.sh` | The build constants (Android platform tag, Python ABI, toolchain pins) — "target facts, not release pins." |
| `scripts/termux/build_cpython.sh` | Stages the pinned bionic CPython into the payload (a thin wrapper over the shared `termux_pkg_build.sh`). |
| `scripts/termux/build_deb.sh` | Fat `.deb` assembly for the Termux bundle. "No opt-out flags: a skipped step is a different artifact." |
| `scripts/termux/build_environment.py` | Wires staged bionic inputs to PM without exposing its installer executable. |
| `scripts/termux/build_node.sh` | Stages the pinned bionic node into the payload. |
| `scripts/termux/build_uv.sh` | Stages the pinned bionic uv into the payload; "pm owns the pin, the download, the hardened extraction, and the file-evidence verify." |
| `scripts/termux/build_wheels.py` | Container-side wheelhouse build: build the android set from sdist against the container's bionic python, retag, and run the offline completeness + import gates. |
| `scripts/termux/check_apt.sh` | Verifies the signed APT repository with the same non-root APT used on a phone. |
| `scripts/termux/check_deb.sh` | Installs and tests the real package in a fresh, **offline** Termux rootfs. |
| `scripts/termux/deb_version.py` | Derives a Debian package version (or channel) from a release tag — a pure, unit-tested function. |
| `scripts/termux/launchers.py` | APT maintainer hooks; the agent entrypoints belong to `scripts.build.launchers`. |
| `scripts/termux/payload_facts.py` | Records bionic tools and assembles the prepared fixed-prefix agent. |
| `scripts/termux/python_linkage.py` | Links Python extensions explicitly for bionic's local symbol lookup. |
| `scripts/termux/retag_wheel.py` | The PEP 738 wheel retagger: rewrites a built wheel so it installs on Android/bionic, recomputing `RECORD` hashes. |
| `scripts/termux/stage_apt_repo.py` | Stages a static APT repository layout (`dists/` + `pool/`) from a pool of `.deb`s, with a signed `Release`/`InRelease`. |
| `scripts/termux/stage_runtime_libs.py` | Stages the Termux runtime libs into the sealed payload; "the device's termux tree may have NONE of the payload interpreters' runtime libs installed." |
| `scripts/termux/termux-builder.Dockerfile` | The derived build image: the digest-pinned `termux-docker` base with the wheelhouse toolchain pre-installed. |
| `scripts/termux/termux_build.sh` | The Android/Termux wheelhouse builder — the ONE entry point, with a host half (arch-free data work) and a container half. |
| `scripts/termux/termux_pkg_build.sh` | Stages the pinned bionic python/node `.deb`s into the payload via pm. |
| `scripts/termux/validate_installed.py` | Exercises a freshly installed Termux bundle with **networking disabled**. |
| `scripts/termux/wheelhouse_cache.py` | The wheelhouse manifest is the proof used to admit restored build output. |
| `scripts/tests/test-install-ps1-longpath.ps1` | Tests `install.ps1`'s 8.3 short-path normalization. |
| `scripts/tests/test-install-ps1-node-compatibility.ps1` | Verifies the pre-Python bootstrap handoff: PM owns Node provisioning, and the installer must not download it itself (every download shim throws). |
| `scripts/tests/test-install-ps1-store-guard.ps1` | Tests the `HermesHome`/`InstallDir` separation guard (#124526). |
| `scripts/tests/test-install-ps1-utf8.ps1` | Regression: uv's UTF-8 stdout must remain an executable path under PS 5.1 — with **native fixtures** that write raw bytes to a pipe, because a PowerShell function returning a .NET string would bypass the decoder. |
| `scripts/update-test/HANDOFF.md` | How to test the bundles branch against a normal hermes install (backup, clone, exercise). |
| `scripts/update-test/hermes-update-rehearsal.ps1` | The Windows rehearsal for an **existing** install: pre (backup + clone), post (apply the update), status. |
| `scripts/update-test/hermes-update-rehearsal.sh` | The POSIX rehearsal for an existing install. |
| `scripts/update-test/smoke-test.ps1` | Smoke test for the rehearsal: builds a synthetic install in a temp tree and drives pre/post/status for real. |
| `scripts/update-test/smoke-test.sh` | The POSIX smoke test for the rehearsal. |
| `scripts/validate_plugin_catalog.py` | The standalone structural validator for plugin-catalog entries: name regex, 40-hex sha, tiers, categories, platforms, capability keys, image hosts. |
| `scripts/verify-bootstrap-version-stamp.py` | Verifies the version stamp a bootstrap installer ships (`.hermes-bootstrap-complete`) against the installed repo's HEAD. |
| `scripts/whatsapp-bridge/allowlist.js` | WhatsApp identifier normalization, the allowed-user parser, and the inbound-group / inbound-user matchers. |
| `scripts/whatsapp-bridge/allowlist.test.mjs` | Unit tests for the allowlist expansion and matching. |
| `scripts/whatsapp-bridge/bridge.js` | The standalone WhatsApp bridge process (Baileys) — 1,179 lines; a gateway adapter, not agent logic. |
| `scripts/whatsapp-bridge/bridge.native.test.mjs` | Unit tests for the WhatsApp-native payload helpers; the test file avoids importing `bridge.js` because that file starts a server and a socket at module load — "Keep the helper module pure." |
| `scripts/whatsapp-bridge/bridge.reconnect.test.mjs` | Tests the reconnect scheduling and version-resolution guards, including the reconnect-wedge trap (`startSocket()` awaits network I/O before it …). |
| `scripts/whatsapp-bridge/bridge_helpers.js` | The pure helper module: MIME map, message-envelope unwrapping, context info, bounded message store, quoted-media cache, poll aggregation. |
| `scripts/whatsapp-bridge/bridge_helpers.timestamp.test.mjs` | Tests the bridge's log-line stamping (regression #97021: lifecycle logs must carry a local timestamp). |
| `scripts/whatsapp-bridge/outbound_ids.js` | A bounded FIFO set of outbound message IDs — used to tell "echo of our own `/send`" from "owner-typed message on the linked device." |
| `scripts/whatsapp-bridge/outbound_ids.test.mjs` | Unit tests for the outbound-ID tracker. |
| `scripts/whatsapp-bridge/owner_message_gate.js` | The pure classifier for the bot-mode dispatch loop: whether a `fromMe` message is forwarded as `fromOwner`. |
| `scripts/whatsapp-bridge/owner_message_gate.test.mjs` | Unit tests for the owner-message gate. |
| `scripts/whatsapp-bridge/package.json` | The bridge's own package manifest (Baileys, `qrcode`, …). |
| `scripts/whatsapp-bridge/package-lock.json` | The bridge's generated lockfile (2,229 lines). |
| `scripts/windows-build-deps.ps1` | Native build dependencies, separate from PM's application environment. |
| `scripts/windows_e2e_harness.ps1` | A local harness for `windows-e2e.ps1`'s non-GUI logic, runnable under Linux pwsh. |
| `scripts/write_install_stamp.py` | Generates the canonical `install-stamp.json` for every packager (Docker, Nix, desktop) — "no env vars, no separate [per-packager] format." |

### Tier 3 — skipped with a reason

- `.github/workflows/desktop-bundled-release.yml` — 134 KB / 2,503 lines: read the head 320 and tail 180 lines; the topology, feed layout, phase gates and the Store held/immediate rule were captured.
- `nix/checks.nix` — 80 KB / 1,467 lines: read the head 180 and tail 90; the check inventory and the seven config-merge scenarios (A–G, including idempotency) were captured.
- `nix/moduleCommon.nix` — 47 KB: read the head 150 and tail 60; the shared option/renderer/assertion surface was captured.
- `nix/nixosModules.nix` — 35 KB: read the head 120 and tail 60; the NixOS module surface and the container-mode entrypoint were captured.
- `scripts/check-windows-footguns.py` — 38 KB / 894 lines: read the head 200 and tail 80; the rule-table shape, the suppression marker and the guard hints were captured.
- `nix/node-gyp-11-4-0-package-lock.json` — a generated 185 KB lockfile: confirmed by name, size and a 25-line header peek showing the pinned node-gyp dependency set.
- `pm/uv.lock`, `scripts/whatsapp-bridge/package-lock.json` — generated lockfiles: confirmed by name, size and a header peek.
- `scripts/build/*` (15 files) and `scripts/build/README.md` — classified `generated-vendored` in the shard's file list; each was opened and its header + symbol inventory read, but not read line by line.
- 31 `pm/*.py` modules (`build_operations`, `cli`, `client`, `downloader`, `environment`, `environments`, `install`, `libatomic`, `native_build`, `operations`, `package`, `packages`, `plugin_declarations`, `plugin_eviction`, `plugin_inputs`, `plugins_state`, `progress`, `publication`, `receipt`, `recovery`, `registry`, `runtime`, `security_packages`, `shell`, `store`, `termux_libs`, `update`, `user_facing`, `worker`, `worker_operations`, `workspace`) — opened and catalogued via the module header + top-level symbol inventory, not read line by line; the table entries above are derived from that.
- The remaining `scripts/` files — opened and catalogued the same way (module header + top-level symbol inventory), which is the brief's tier-2 allowance ("you still open every file, but a one-line entry per file is enough").

---

## 2. Ideas worth stealing

1. **A passive rule cannot enforce a policy — an executable gate can.**
   *Where:* `.github/workflows/infographic-check.yml`, `.github/workflows/blob-size-check.yml`,
   `.github/workflows/case-collision-check.yml`, `.github/workflows/lazy-deps-guard.yml`,
   `scripts/ci/check_profile_archive_boundary.py`.
   *What:* each of these is a policy that was previously a `.gitignore` entry and
   leaked anyway (nine more PNGs landed *after* the ignore rule, and a
   differently-spelled directory sidestepped it).
   *Why it transfers:* August Trading's `docs/plan/open-items.md` is a list of
   things that must not drift. Any item whose enforcement is a convention, a
   comment, or a human review can be given the same shape: a small script that
   fails the build, plus a CODEOWNERS line. — **CONVERGENT** (the same
   "passive rule vs executable gate" argument appears in `pi`'s and
   `deepseek-harness`'s plan/ratchet work).

2. **Version the required-check name so a stale green cannot merge.**
   *Where:* `.github/workflows/ci.yaml` (the `all-checks-pass` job).
   *What:* "The check name carries a version. The ruleset requires a check
   NAME, and a green check run recorded on a PR head stays valid forever, so a
   PR whose last CI predates a new required job still merges on that old green
   (32 PRs merged without the code-health ratchet that way)."
   *Why it transfers:* August Trading's `docs/plan/` gate workflow has the same
   hole — adding a new gate to the plan does not invalidate the greens already
   on open PRs. Version the gate name and bump it in the same rollout. — **UNIQUE**
   (this exact mechanism appears nowhere else in the three repos).

3. **A zero-work lane must fail, not pass.**
   *Where:* `.github/workflows/tests-os.yml` (pytest exit 5 when the marker
   selects nothing), `.github/workflows/remote-backends.yml` (`--fail-on-skip`),
   `.github/scripts/run-workspace-checks.mjs` ("refusing to report green having
   run nothing"), `scripts/ci/check_lazy_deps_imports.py` ("it can never pass by
   scanning nothing").
   *What:* every lane proves it *ran* something.
   *Why it transfers:* August Trading's `npm run test`/`typecheck` gates have
   the same exposure — a marker or a glob that matches nothing is green.
   Cheap to add: assert a non-zero selection count per lane. — **CONVERGENT**.

4. **Distinguish "the infrastructure failed" from "your change is wrong", and
   say so in the message.**
   *Where:* `.github/workflows/uv-lockfile-check.yml` (greps the uv log for
   network-error signatures and emits a *different* `review_status` for a
   registry outage vs a stale lockfile).
   *What:* "Only the second is the contributor's to fix."
   *Why it transfers:* August Trading's CI failures currently collapse into one
   "red". A small taxonomy (infra / flaky / real) with a distinct message per
   class is a large contributor-experience win, and the same taxonomy can
   drive the live PR comment. — **CONVERGENT**.

5. **Ship the tested bytes; never rebuild at publish time.**
   *Where:* `.github/workflows/docker.yml` (the release `test` phase saves the
   tested image tar + sha256; the `publish` phase downloads, verifies the
   hash, re-checks the image identity and pushes without rebuilding), and
   `scripts/bundles/release_artifacts.py` + `scripts/releases/handoff.py`
   (receipts carry the exact artifact list, size and sha256).
   *What:* the artifact that is published is byte-identical to the one that was
   tested.
   *Why it transfers:* August Trading's Electron release gate currently
   asserts the *packaged* app's behaviour but the release path can rebuild.
   Adopting "test the bytes, publish the bytes" closes the gap. — **UNIQUE**
   in its strict form (the receipt + identity re-check at publish time).

6. **A per-unit ratchet whose caps only go down, with multiset comparison.**
   *Where:* `scripts/code_health/` (especially `compare.py`: "Pattern rules
   compare multisets of fingerprints, so fixing one violation and adding
   another still fails"), `scripts/check` (the local entry point for every
   blocking check).
   *What:* every function and file keeps its own cap; a PR cannot trade one
   violation for another.
   *Why it transfers:* August Trading has 5,143 test files and 514 suites —
   exactly the scale where a global lint threshold stops working. A per-file
   cap that only descends is the mechanism that keeps a codebase from
   re-growing. — **CONVERGENT**.

7. **Make the *shipped* artefact the thing under test, not a reconstruction
   of its build recipe.**
   *Where:* `nix/tests/agent-references.py` (launches the real wrapper with a
   `sitecustomize.py` probe and asserts the environment the actual wrapper
   hands to Python — "No parsing makeWrapper's shell text"), and
   `nix/tests/desktop-backend.py` (plants a *competing* legacy install and
   asserts the packaged app still picks its pinned backend).
   *What:* the test observes the product, not a model of it.
   *Why it transfers:* August Trading's `electron/main.cjs` and `preload.cjs`
   are outside `tsc`'s include globs — the existing `typecheck:electron` gate
   is a *syntax* check. A probe that launches the real main process and
   asserts the environment it hands to the renderer is the same idea. — **UNIQUE**.

8. **Rethink the "required check" as one aggregated gate, and make a skipped
   required lane a failure in release mode.**
   *Where:* `.github/workflows/ci.yaml` + `scripts/ci/required_results.py`
   (PR-only jobs and deferred jobs are excluded; in release mode a skipped
   required lane fails).
   *Why it transfers:* August Trading's CI/release gate currently relies on
   branch protection listing many checks; one aggregator with an explicit
   PR-only/deferred list is easier to reason about and easier to extend.
   — **CONVERGENT**.

9. **A watchdog that probes the *live* thing and opens one issue.**
   *Where:* `.github/workflows/skills-index-freshness.yml` (4-hourly probe of
   the deployed index, per-source floors, one issue, comments appended rather
   than re-opened) and `.github/workflows/docs-search-monitor.yml` (a live
   search probe because "search broke in production twice in one month with
   every build green").
   *Why it transfers:* August Trading's app is a local desktop/web app, but
   the *pattern* — a cheap scheduled probe of the deployed surface with a
   freshness floor and per-source floors — applies to a deployed docs site or
   a hosted API. The specific insight is the **floor per source**: a total
   count can be healthy while one source has collapsed. — **UNIQUE**.

10. **Prove the "no tool installed" path by running the product with the
    network disabled.**
    *Where:* `.github/workflows/pm-bundle.yml` (`unshare --net` smoke of the
    relocated payload), `scripts/termux/validate_installed.py` ("networking
    disabled"), `scripts/smoke-payload.sh` ("Network isolation is the runner's
    responsibility, not a lazy-deps flag").
    *Why it transfers:* August Trading's lazy-install paths and its
    "no API key" probes deserve the same treatment: a smoke that *cannot*
    reach the network is the only way to prove nothing silently fetched.
    — **CONVERGENT**.

11. **A machine-readable receipt for every operation, written into one
    directory with one schema, so one reader serves every surface.**
    *Where:* `pm/receipt.py` ("Every pm venv sync — startup, plugin install,
    update rebuild — writes a receipt with the SAME schema the updater's
    receipts use, into the same directory, with a `kind` field… One reader
    (`hermes pm status`, desktop IPC) serves every surface").
    *Why it transfers:* August Trading has an update log, a trade log and a
    render-probe artifact, each read by a different surface. One receipt
    schema with a `kind` discriminator would let a single "what happened
    last time" surface answer for all of them. — **CONVERGENT**.

12. **A prompt-surface snapshot with per-surface token deltas.**
    *Where:* `scripts/ci/prompt_surface.py` + `.github/workflows/prompt-surface-diff.yml`.
    *What:* renders the system prompt and the `tools[]` array through the
    **production** code for each surface (cli × 4 model families, cli in a code
    workspace, desktop, telegram, discord, cron), commits the snapshot, and
    diffs it per surface with token deltas and per-tool description/param
    changes.
    *Why it transfers:* August Trading's `constants/prompts/` and
    `constants/promptRegistry.ts` are exactly this surface, and the plan's
    "prompt size discipline" lens has no measurement today. This is a
    ready-made design for a **committed prompt snapshot with a staleness
    test**. — **UNIQUE** (and directly on the plan's "Prompt size and caching"
    lens).

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* The cron
  scheduler itself lives outside `scripts/`; what this shard shows is the
  **scheduled-work harness**: a schedule that failed silently for two months
  because the timeout was too small (`.github/workflows/skills-index.yml`: "15
  min cancelled every scheduled run … and left the live index frozen"), a
  watchdog that runs on a shorter interval than the job and checks a
  *freshness floor* (26 h) plus **per-source floors** rather than a total
  (`.github/workflows/skills-index-freshness.yml`), and a red-tracker that
  keeps **one** issue in step with the matrix — a red run rewrites the open
  issue's body grouped by failure class, a green run closes it
  (`.github/workflows/install-e2e-red.yml`). The transferable pattern for
  August Trading's own automations: *a scheduled job that nobody watches is a
  job that has already stopped working.*
- **Human-in-the-loop approval:** *mostly outside this shard*, but two
  mechanisms are here. (a) The **held-then-live** publication pattern
  (`scripts/releases/store.py`, `stable-store` in
  `desktop-bundled-release.yml`): the Store submission is committed **held**
  (`targetPublishMode: "Manual"`) so certification runs *before* the gate, and
  only the publication pass switches it to Immediate — so a failed publish
  leaves a held submission no customer sees, never a live build. (b) The
  **privileged/unprivileged split** (`.github/workflows/js-autofix.yml`): the
  unprivileged job may run repo code; the privileged job may only apply an
  artifact it receives. Both map onto August Trading's approvals inbox: a
  human approval is a *held state* that a later, separately-authorised step
  promotes — not a boolean.
- **Post-mortem / reflection loops:** *not in this shard* (the learning/skills
  engine is elsewhere). The adjacent mechanism here is the **replay**:
  `scripts/code_health/replay.py` re-runs the ratchet over every PR merged in
  a closed window and reports "what would it have blocked?" — a way to
  calibrate a new rule against history *before* turning it on. That is
  directly usable for August Trading's reflection rules: replay a proposed
  rule over the existing trade log and see how many past trades it would have
  flagged.
- **Multi-agent:** *not in this shard.* Nothing here debates or delegates; the
  shard is build infrastructure.
- **Structured logs the model can query:** partly here. The repo's own
  approach is **content-free JSONL telemetry** plus a rotation: `pm/receipt.py`
  writes machine-readable receipts to `<HERMES_HOME>/logs/update_receipts/`
  (rotated at 20), and `scripts/micro_compaction_report.py` reads
  "content-free JSON lines emitted by `_emit_micro_compaction_telemetry`" to
  report percentiles. The *pattern* worth stealing for August Trading's trade
  log is the receipt schema: one JSON document per operation, one directory, a
  `kind` discriminator, a fixed rotation, and every field machine-readable —
  so a summariser can read it without a database.
- **Staying simple as features accumulate:** this is the shard's strongest
  theme. (a) *Skills, not tools* — the feature-request template asks "**Is
  this a new skill?** Most capabilities should be skills, not tools."
  (b) *One authority per concern* — `pm/lock.json` is the only pin table and
  Nix reads it as pure data; `nix/pythonLock.nix` is the only place that picks
  an interpreter and it *throws* rather than defaulting.
  (c) *Deprecation with a message* — `docker/entrypoint.sh` and
  `scripts/desktop-update.ps1` are kept as one-line forwarders with a loud
  warning, and `homeManagerModules.nix` keeps a removed option as an
  assertion carrying the exact replacement text, "because a quiet removal gives
  them a machine with no `hermes` and no message."
  (d) *A narrow scanner beats a broad one* — the supply-chain scanner was
  deliberately narrowed to two critical patterns because "low-signal heuristics
  … fired on nearly every PR and trained reviewers to ignore the scanner."
  (e) *A slot that is honestly down* — the dashboard's s6 service is declared
  always but reports itself as permanently failed (exit 125) when disabled, so
  `s6-svstat` tells the truth instead of a restart loop.

---

## 4. Non-obvious decisions and gotchas

1. **`docker exec <c> hermes login` silently broke the gateway.** Root wrote a
   0600 `auth.json`; the unprivileged gateway then answered "not logged in" on
   *every* message, while `docker exec … chat -q ping` (also root) still
   worked. The symptom looks like a provider failure, not a permission one.
2. **A file on the checkout that a test wrote is a CI failure, not a
   nuisance.** `check-clean-worktree` is the last step of every job, with a
   single master switch; any unknown `mode` value fails closed.
3. **The `ci.yaml` aggregate gate's *name* is a versioned artifact.** A green
   check on a PR head stays valid forever, so adding a required job without
   bumping the name leaves older PRs able to merge on stale greens.
4. **A reusable-workflow call blocks `gh run rerun` on the caller.** One slow
   advisory job inside a `workflow_call` holds the parent run in progress for
   its full duration, and GitHub refuses to rerun an in-progress run. This is
   why `docker.yml`, `nix.yml` and the live-comment poller own their own
   triggers instead of being called from `ci.yaml`.
5. **`GITHUB_RUN_ID` cannot be overridden by an `env:` block** — the runner
   sets the `GITHUB_*` defaults itself. The live comment poller watches
   `CI_RUN_ID` for exactly this reason; naming it `GITHUB_RUN_ID` made the
   poller watch *itself* and wait out its whole timeout.
6. **A cache hit is not permission to skip preparation.** The desktop build
   cache action says it in its own output contract: "cache-hit: transport
   result only; never permission to skip preparation." Trusted workflow/token
   policy admits writers, not the key.
7. **`uv cache prune --ci` is the wrong prune.** It discards *downloaded*
   wheels the lock still needs, so the saved snapshot warms almost nothing.
   PM's `--exact-lock` prune keeps every wheel `uv.lock` resolves and drops
   only superseded pins.
8. **A tool's identity is its artifact hashes, not its version.** A
   same-version re-pin must force a reinstall; a fact written before identity
   existed is "not vouchable" and forces one.
9. **`facts.json` is evidence, not garbage.** A corrupt but non-empty state
   file is copied to `.corrupt` before it is reset — "the next `_write` would
   silently discard every installed-state record."
10. **The environment in the container is not the environment in the
    terminal.** PM puts its own pinned tools first for the process, and the
    *user's* tools first for terminal commands — "Hermes's own operations must
    not depend on this PATH."
11. **A "successful" run that changed nothing is a failure.** Icon
   freshness, the docs generator, the prompt-surface snapshot and the
   code-health ratchet all compare against a committed artefact and fail on a
   byte difference — including untracked files.
12. **Supply-chain scanning must stay narrow or it gets ignored.** The repo
   removed its low-signal heuristics explicitly and wrote the reason in the
   file so nobody re-adds them.
13. **A PR body is the archive; the binary never enters git.** The
    infographic check matches on the *image*, not a directory name, because
    keying on `infographic/` let `infograficos/` through.
14. **`AGENTS.md` is a budgeted artefact.** The whole chain of `AGENTS.md`
    files from the git root down is loaded as ONE project-context block and
    truncated at a fixed character cap; a CI check keeps every one under it.
15. **Docker's `/init` and the fallback path are different environments.**
    The non-PID-1 fallback skips `with-contenv`, so the env must be
    rehydrated explicitly — a real bug class, handled in `main-wrapper.sh`.

---

## 5. Weak spots

1. **The complexity budget of this shard is very high.** `desktop-bundled-release.yml`
   (2,503 lines), `windows.ps1` (1,820), `install.sh` (1,300),
   `install.ps1` (1,672), `run_tests_parallel.py` (1,664),
   `posix.sh` (1,329), `audit-old-updater-imports.py` (1,339) and
   `stable.py` (1,036) are all *shell/CI* programs carrying real policy. A
   reader — or an agent — cannot hold them in one context, and the repo
   compensates with increasingly baroque comment conventions rather than with
   smaller units.
2. **The `pm` package manager is a second dependency resolver living inside
   the application.** It has its own lockfile, its own store, its own facts
   file, its own generation model, its own worker, its own runtime and its own
   retry policy — all to install ~20 pinned tools that a `uv`/`npm` pair plus
   a lockfile could have covered. The payoff (reproducible, hash-verified,
   offline-capable installs) is real; the maintenance surface is not small.
3. **The release pipeline's policy is spread across many layers.** The same
   "what must be true before we publish" question is answered in
   `lanes.py`, `job_groups.py`, `required_results.py`, `stable.py`,
   `sequencer.py`, `channels.py` and the workflow YAML — with a lane table, a
   job-group table and a needs-JSON evaluator that all have to agree. A
   mistake in any one of them is a red or a green release.
4. **The container bootstrap is a 40 KB shell script** that performs UID
   remapping, group creation, 40+ chowns, key generation, env rewriting across
   every profile and a config migration. It is heavily commented (which is
   good) but it is a shell script doing what a Python module would do far
   more safely.
5. **Several gates are advisory and rely on a human reading a log.** The
   profile-scope lint, the public-surface diff, the prompt-surface diff and
   the lockfile diff all *report* rather than fail. That is a deliberate
   trade-off, but it means the drift they watch for is only caught if a
   reviewer scrolls the right log.
6. **Coverage asymmetry in this shard itself.** The bulk of `scripts/` is
   release and packaging machinery; the *product* logic (agent loop, tools,
   memory, skills) is essentially absent, so the shard's value is
   concentrated in engineering discipline rather than in agent design.
