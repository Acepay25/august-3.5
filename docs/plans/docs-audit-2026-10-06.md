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
