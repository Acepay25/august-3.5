# Step B — gap audit (read-only), 2026-10-05

Scope: everything this branch added (A1, A2 slices 1-5, step 9 + follow-ups 1-4).
Question asked of each: **can a person reach it from the app, and does the thing it
claims to do actually happen?** No files were changed while producing this.

## Reachable and proven

| capability | mount | proof |
|---|---|---|
| rescope apply (human) | `App.tsx:2388` lazy `CoachThreadPanel`; `LearnView.tsx:26` `LearningQueuePanel` | **app-proven**: probe case 5 pressed `coach-proposal-apply-<id>` and the notebook bytes moved (1023→1063) |
| named refusal in both panels | same two mounts | probe case 5b saw "below the bar" rendered and the row kept — Coach side only |
| supervisor applies stored clauses | `LearnView.tsx:25` `SupervisorStream` (+ `SupervisorPanel.tsx:11` dock) | unit (`skillSupervisor.test.ts`), against real `initMemoryFiles` storage |
| override reports the named refusal | same | unit (`supervisorOverrideFeedback.test.tsx`) |
| ten trading stores registered RAW | Settings → Data / backup path | unit, **byte-equality round trip** with `skippedKeys`/`failedKeys` empty — which also proves the RESTORE half, since an un-listed key would have been skipped |
| image-stripped chat export, cap, notice | `BackupManager` in `ActionsTab.tsx:33` | unit at both ends (`exportLearningStores`, `backupNoticeVisible`, `backupService`) |
| restore keeps on-device images | same | unit (`46d375a`), red first |
| pointer-missing fallback | dock chat | unit (`7ea41e8`), red first |

## Gaps found

1. **A rescope row with no clauses now shows an Apply button that cannot apply.**
   `maybeQueueRescopeProposal` (`SkillMemoryService.ts:1622-1627`) queues regime/
   recurrence re-scopes with **no `payload`** — only `revise_skill` stores clauses.
   Since slice 1/2 put `rescope` in `APPLYABLE_PROPOSAL_KINDS` for the whole kind,
   those rows offer Apply, press it, and get `no-clauses` ("only the supervisor model
   can rewrite it"). Before A2 they offered nothing. Both statements are true, but the
   button invites a press that is guaranteed to fail. **Decision owed**: hide Apply per
   row when `payload` carries no clauses (recommended — the panel already knows), or
   make the regime pass write a suggested clause pair so it is genuinely applyable.
   Not done in this run because it is a feature-shape call.

2. **The queue strip's refusal line is unverified in the app.** `LearningQueuePanel`
   renders `proposalApplyFailureMessage` (`errorId` replaced with `failure`) and no
   probe presses Apply there — probe coverage is the Coach thread only. Its data-testid
   is `proposal-apply-error`. Cheap to add to `render-probe`, which already sweeps the
   Learn surface.

3. **Nothing exercises the real Settings → Data restore of a chat backup.** The image
   strip, the cap notice and the live-image reconciliation are unit-level; no probe
   does export → clear → import against the packaged panel. `render-probe` does cover
   back up / export / import generally (AGENTS.md), but not with an image-bearing
   session. Highest-value remaining app-verification item.

4. **`harness_settings_v1` is backed up but its restore target is ambiguous.** It is
   now RAW (correct: the owner is `harnessSettings.ts:79`, localStorage only) and it is
   also on `RESTORABLE_PREFERENCE_KEY_PREFIXES`, so a restore writes BOTH a Preferences
   copy and the mirrored localStorage copy. That is the documented mirror behaviour for
   raw owners and the round trip confirms the owner reads back the right bytes — but it
   leaves a Preferences row nothing reads, which is the one thing AGENTS.md warns spends
   shared-quota bytes. Worth a look when the settings store is next touched, not now.

5. **`trade_chat_active_v1` is still unbacked, on purpose.** The fallback that makes
   that safe is now tested (`chatActivePointerFallback.test.ts`): no pointer → newest
   session by `updatedAt`. Recorded so nobody "fixes" it by adding the prefix.

6. **Two byte-cap risks were measured and left open, not solved.**
   `trade_session_drawings_v1_<user>_<sessionId>` bounds drawings per coin but keeps
   every coin (`chartDrawings.ts:179`), and `desk_tools_forged_v1` / `trading_checklist_v1`
   have no count cap at all. All three are now exported; none is cap-guarded (the cap is
   scoped to chat sessions only, deliberately — see `CAPPED_EXPORT_PREFIXES`).
   Backlog: bound them at write time, same entry as `trimForStorage`.

## Backlog this run created (not started)

- bound `trade_chat_sessions_v1` bytes at write time (decision 1's explicit exclusion)
- bound session-drawing / forged-tool / checklist stores at write time (gap 6)
- raw-string envelope in the backup format, if plain-pointer keys are ever wanted
- a shadow-promotion end-to-end test that settles a real window and asserts the
  promoted prose line (`skillRefinement.test.ts` only pins serialization)
- probe coverage for gap 2 and gap 3
