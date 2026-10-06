# Docs audit — 2026-10-06 (post stage 3 merge)

Four parallel audits over every plan-shaped doc in the repo, run against HEAD
after stage 3 merged to `main` (`ed97537`). Verdicts marked **[V]** were
re-verified by the main agent in code; others are agent-reported with the
file:line they cited.

## Disposition

| Doc | Verdict | Why |
|---|---|---|
| `docs/plans/workstream1-stepB-evidence.md` | DELETE | 5 completion claims contradicted by HEAD |
| `final-sweep-report.md` | DELETE after rehoming its 2 live recommendations | `:159` claims a "restrained grid treatment" while `:134` admits `.bg-grid` may be unused (0 occurrences in `index.css`) **[V]**; 6 lines cite `ChatInput`/`MessageItem`/`ConversationHistory`/`ChatArea`, none of which exist in git **[V]**. Its release-security finding is CORRECT and still open — `:103` says the workflow "does not show immutable action pinning" and `:105` recommends pinning; do NOT record that as a false claim **[V]** |
| `plan.md` | DELETE after rehoming residue | 22/35 implemented; calls live `/index.css` a dead reference **[V]** |
| `performance-audit-report.md` | ARCHIVE | all fixes landed; G/J moot; "responseCache fine" was deleted in `b80c6fa` |
| `UI_UX_AUDIT_REPORT.md` | REHOME then delete | Section A premise two refactors dead, but ~12 live a11y gaps |
| `PLAN_LEARNING_LOOP_AND_UI.md` | ARCHIVE | implemented history; cap name + line counts wrong |
| `docs/plans/stage1-ui-ux-spec.md` | ARCHIVE | C1 (`fmtUsd`) and C9 claims false |
| `docs/plans/stage2-implementation-plan.md` | LIVE — Phase 3/4 owed | Phase 3 unbuilt **[V]**: no `TypingIndicator` anywhere |
| `docs/plans/workstream1-status.md` | LIVE — update | 2 switches have no UI; post-mortem still 5 writers |
| `docs/plans/workstream1-stepB-gap-audit.md` | ARCHIVE as issue source | 4 gaps open |
| `docs/learning-loop-map.md` | UPDATE | supervisor triage-only **[V]**; cadence 15 min `useLearningHeartbeat.ts:40` **[V]**; `NotebookSection.tsx` deleted **[V]** |
| `docs/ui-doctrine.md` | UPDATE | omits `dense`; Learn tab list predates System; scan scope claim |
| `docs/desk/README.md` | REWRITE or DELETE | 9/19 claims wrong; `pixelSize = 5` not 6 **[V]**; `PixelSeat.tsx:11` cites a `--avatar-px` that exists nowhere **[V]** |
| `docs/plans/chat-dock-reference.md` | UPDATE | 4 wrong; "conversations need a home" is what stage 3 A shipped |
| `README.md` | UPDATE | `:90,93` link docs deleted in `7bf9538` **[V]** |
| `PRIVACY.md` | UPDATE | "two places data leaves" is 4+: `web_search` → `DeskToolsService.ts:1539,1581` **[V]**, toolForge arbitrary https → `toolForge.ts:215` **[V]**, plus the JSONL export |
| `AGENTS.md` | OK on paths | every cited path resolves (4 grep hits were false positives) **[V]** |
| `stage3-arrangement.md` / `stage3-status.md` | CURRENT | F4b shipped `2c42cfe`, F4c dropped, G struck |

## Agent claim corrected
One audit declared `workstream1-status.md`'s "never pushed" premise stale because
the branch's tip is an ancestor of main. Wrong: `git ls-remote --heads origin`
shows **no** `workstream1-trade-review` ref **[V]**. The branch is still unpushed;
its *content* reached main by merge, which makes the concern moot, not false.

## Open work these audits surfaced
- **stage 2 Phase 3** (typing indicator + `aria-live`, run ladder, R:R on proposal
  and verdict cards) and **Phase 4** (installer state returns `null` at
  `UpdateButton.tsx:80`; no focus-restore anywhere; chart has no `role="img"`).
- **a11y**: untrapped `aria-modal` in `LiveStreamView.tsx:191`,
  `ScenarioSimulator.tsx:214`, `UserProfileManager.tsx:87`; Esc gate at
  `App.tsx:1351` omits `simulatorCandidate`/`showMismatchModal`; undo toast lacks
  `role="status"`; dead `copiedMessageId` (`useJournalUI.ts:21`);
  `isUserModalOpen` missing from `OVERLAY_KEYS`; dead contrast exemption at
  `index.css:1626-1631`.
- **workstream1**: queue-Apply has no probe coverage; `harness_settings_v1` still
  double-written (`ExportService.ts:375` + `:736`); write-time bounds still count
  items not bytes (`chatSessions.ts:199`, `toolForge.ts:50`, `checklist.ts`);
  no shadow-promotion e2e; the two supervisor switches have no UI.
- **security/release**: actions are still not SHA-pinned — `release.yml:28,77` plus
  `ci.yml:19,22,102,105,137` use mutable `@v5` tags **[V]**. This is `final-sweep-report.md`'s
  one still-valid recommendation; rehome it before deleting that doc.
- **residue from plan.md**: no logger (`MODERATOR_ERROR` live at
  `debateMarkers.ts:24`), no key pool, SQLCipher off (`SqliteService.ts:113`).

No deletions have been performed yet — nothing goes away before its actionable
residue has somewhere to live.

---

# ROI verdicts — four parallel reviews (same day)

Every item below was re-verified in code; **[V]** = checked by the main agent.

## Do now (all small, all reuse an existing module)
1. **Chat-session byte bound** [V] — `services/trade/chatSessions.ts:199` `trimForStorage`
   trims by ENTRY COUNT while one screenshot entry is capped at 1.2 MB, `saveSessions`
   swallows the quota error, and on web Preferences *is* localStorage: a few images can
   silently stop every other store from writing. The only genuine data-loss path found.
2. **Expose the two supervisor switches** [V] — read at `SkillMemoryService.ts:731,3379,3479`,
   no UI writer anywhere. Expose, do not delete: deleting removes the trader's only
   off-switch over a veto that can halt a verdict. Two rows in `HarnessControls`.
3. **`role="status"` on the room thinking line** [V] — `components/chat/GroupChatView.tsx:385`
   (NOT `components/agents/`). Do not build a `TypingIndicator`: `ReasoningRow.tsx:125-158`
   already says "Thought for 14s" and the desk already announces via `SpeechBubble.tsx:73`.
4. **R:R chip on `TradeProposalCard`** [V] — `computeRrRatio` + `fmtRiskReward` are canonical
   and tested, and it is the number gating "Log this trade". DROP the `VerdictCard` half:
   `AgentsView.tsx:347-349` already prints it, row-count gated at `render-probe.cjs:756`.
5. **Move `SettingsMenu` + `ConfirmDialog` onto `useFocusTrap`** [V] — both hand-roll cycling
   (`SettingsMenu.tsx:347-351`, `ConfirmDialog.tsx:134-136`) and neither restores to the
   invoker, while `useFocusTrap.ts:39` already saves it and 12 overlays use it. This deletes
   duplication rather than adding a feature.
6. **Composer focus ring** [V] — `ChatComposer.tsx:152` `focus:outline-none` and
   `index.css:1578-1583` strips the global one: the most-used field has no keyboard
   indicator. Fix must be `focus-visible:ring-*`; `themeContrast.test.ts:139-156` bans bare
   `focus:ring`.
7. **Two untrapped `aria-modal` dialogs + two Esc double-fires** [V] — `LiveStreamView.tsx:191`
   and `:178-182` (one Esc closes the panel AND cancels a running post-mortem);
   `ScenarioSimulator.tsx` (in `components/modals/`, not `analysis/`). Convert to
   `useEscapeClose`; do NOT grow `App.tsx:1351`.
8. **`Check for updates` needs a result** [V] — `ProfileTab.tsx:26-42` (code I shipped in
   Phase E): press, wait, and it silently returns to "Check for updates". Nothing gates it —
   `installer-smoke` disables the updater and render-probe sweeps only Settings -> Data.
9. **SHA-pin 5 workflow sites** [V] — `release.yml:28,77` + `ci.yml:19,22,102,105,137` use
   mutable `@v5` on the box that builds the signing input.
10. **Deletions, batched** [V] — `applyProposalRewrite` (`skillSupervisor.ts:372`) is unreferenced
    since `757f0da`, and `SkillMemoryService.ts:3074` still documents it as live; `copiedMessageId`,
    `selectedProbabilityMessageId`, `expandedPostMortemImages`; `closeAllOverlays`/`resetProgress`
    (zero callers) with their key lists; six empty icon spans; the `-`/`+` steppers get labels;
    undo toast gets `role="status"`; `index.css:1626-1631` guards `text-[9px]/[10px]`, which
    `typeRamp.test.ts:33` already bans.

## Decide, don't delete quietly
- **`useRightPanel.ts:126` computes `fullscreen | push` from viewport width; `TradeView.tsx:1056`
  hardcodes `presentation="push"`** [V]. The mobile fullscreen branch has never shipped. Wire it
  or remove the computation — either is honest, silently deleting it is not.

## Defer
Label unification across entry/SL/TP surfaces (cosmetic, no gate, no user problem); chart
`role="img"` (a static label goes stale against live data, and `KeyLevelsCard` + the overlay chip
already carry the content); Trade's mobile tablist arrow keys (do when that file is next touched);
the `usePostMortem` six-writer merge (L; it is step C's prerequisite, refactoring now is churn);
a real logger (740 `console.*` — the actual gap is that packaged Electron has no log sink, ~30
lines in `main.cjs`, not a rewrite); SQLite encryption (nothing to protect that `safeStorage`
doesn't already cover); the crosshair/watermark design pass.

## Drop
`harness_settings_v1` "double-write" is NOT a bug [V] — RAW at `ExportService.ts:375` makes the
owner's store the read source, RESTORABLE at `:736` lets it restore at all. `EXPORT_RAW_KEY_CAP_BYTES`
is already folded into `EXPORT_KEY_CAPS` (`:412`). Multi-key pool (quota convenience; register the
gateway twice). `aria-invalid` coverage (1 site vs 111 controls) and merging the two capture modals.
Installing renders `null` (documented at `UpdateButton.tsx:15-16`; `UpdateOverlay.tsx:217` owns it).
Per-model expansion standardisation, the clarification rung (already named with honest skip notes at
`utils/runContract.ts:31`), and the AdvancedAnalytics/Journal-aside migration (both gone in stage 3).

## Corrections to the audit above, and to what I told you
- The Esc-gate item is **mostly stale**: `useEscapeClose.ts:15-20` is capture-phase with
  `stopPropagation`, so `showMismatchModal` and the capture modals already shield the gate.
- "Add `isUserModalOpen` to `OVERLAY_KEYS`" answers a premise the code no longer has — that
  machinery has zero callers.
- `index.css:1626-1631` is a 44px **touch-target** exemption, not a contrast one.
- I reported "neither proposal card nor verdict card shows R:R". True of those two files, wrong as a
  summary: `AgentsView.tsx:347-349` already prints the chip in the conversation home.
- `final-sweep-report.md` RECOMMENDS action pinning (`:103,105`); it does not claim it exists.
