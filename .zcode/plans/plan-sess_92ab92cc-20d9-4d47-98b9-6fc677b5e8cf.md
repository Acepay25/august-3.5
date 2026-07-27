# Improve Auto-Update: Silent Install + Visible Full-Screen Overlay

## Problem 1 — Fix the NSIS "uninstall + wizard popup" issue
**Root cause:** `package.json` `build.nsis.oneClick: false` + `allowToChangeInstallationDirectory: true` generates an **assisted installer** (the wizard). When `autoUpdater.quitAndInstall()` runs, the wizard UI appears instead of a silent in-place upgrade.

### Change — `package.json` (build.nsis block, lines 88-95)
Switch to one-click silent mode and add best-practice settings:
```json
"nsis": {
  "oneClick": true,
  "perMachine": false,
  "deleteAppDataOnUninstall": false,
  "runAfterFinish": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "August 3.5"
}
```
- `oneClick: true` → uses `oneClick.nsh` (silent in-place update, no wizard, no directory prompt)
- Remove `allowToChangeInstallationDirectory` (incompatible with one-click, ignored anyway)
- Add `deleteAppDataOnUninstall: false` (preserve user data)
- Add `runAfterFinish: true` (explicit — relaunch after install)

## Problem 2 — Make the updating/installing animation visible
**Root cause:** `UpdateButton.tsx` is a tiny inline widget (80×6px progress bar) on the near-identical-colored `.glass` header (#27272a track on #18181b header). No overlay, no "installing" state, `animate-pulse` fades the button to 0.5 opacity.

### Decision (per user): Full-screen overlay + auto-install after download

### Change A — New component `components/shared/UpdateOverlay.tsx`
A full-screen overlay (rendered at app root, not in the header) that is **solid** (not transparent) and shows prominent, visible UI for each non-idle state:

- **Backdrop**: `fixed inset-0 z-[200]` (above everything, header is z-20), **solid** `bg-zinc-950` (no alpha — fixes transparency), `animate-fade-in`.
- **Centered card**: `bg-zinc-900` panel, `border border-zinc-800`, `rounded-2xl`, `shadow-2xl`, `p-8`, `max-w-md`, centered with `flex items-center justify-center`.
- **States** (all clearly visible):
  - `checking` → large spinner (`w-8 h-8 animate-spin text-cyan-400`) + "Checking for updates…"
  - `available` → Download icon + "v{version} is ready" + a large emerald "Download & Update" button (`bg-emerald-600 hover:bg-emerald-500`, no pulse). Clicking it calls `downloadUpdate()`.
  - `downloading` → large spinner + "Updating to v{version}" + **big progress bar** (`w-72 h-2 bg-zinc-800 rounded-full`, fill `bg-gradient-to-r from-cyan-500 to-blue-500` with `transition-all duration-300`, width = `${progress}%`) + "{progress}%" label + "Don't close the app" subtext.
  - `downloaded` → brief "Update ready — restarting…" + CheckCircle icon, then auto-install kicks in.
- Sizes scaled up vs. current: spinner 14px → 32px, progress bar 80×6 → 288×8, text 12px → 14-16px.
- No `animate-pulse` anywhere (removes the opacity-fading).
- The header's `UpdateButton` will still render in `idle`/`error` states (for the "Check for Updates" entry point and version display), but `checking`/`available`/`downloading`/`downloaded` states move to the overlay.

### Change B — `hooks/useAutoUpdate.ts`
- Add an `installing` status value to the union: `'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'`.
- Add an `installTimer` ref + a `beginAutoInstall()` helper that fires `installUpdate()` after a short delay (e.g. 800ms) once `downloaded` is received, and sets local `updateStatus.status = 'installing'` so the overlay shows "Restarting…" before the main process quits.
- Export `installUpdate` (already present) — overlay calls it directly via the existing `installUpdate` callback (no signature change needed).

### Change C — `electron/main.cjs` (update:install handler, lines 126-130)
Push an `installing` status to the renderer *before* quitting so the overlay can show "Restarting…":
```js
ipcMain.handle('update:install', () => {
    updateInfo = { ...updateInfo, status: 'installing' };
    sendUpdateStatus();
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
});
```
Also extend the `updateInfo.status` union comment (line 39) to include `'installing'`.

### Change D — Mount the overlay in `App.tsx` (near line 1556, next to `UpdateNotification`)
Add a lazy-loaded `<UpdateOverlay />` inside the existing `<React.Suspense>` boundary:
```tsx
{isElectron && <UpdateOverlay />}
```
Import alongside `UpdateNotification` (line 50). The overlay internally uses `useAutoUpdate()` and renders `null` when `status === 'idle'` or `!isElectron`, so it's a safe no-op in the browser.

### Change E — `components/shared/UpdateButton.tsx` (lines 49-99)
Trim it to handle only `idle` and `error` states (the entry points). Remove the `checking`/`available`/`downloading`/`downloaded` branches since those now render in the overlay (avoids duplicate/conflicting UI). The header keeps the "Check for Updates" button + version label + error/retry UI.

## Files touched
1. `package.json` — NSIS config (oneClick: true, drop allowToChangeInstallationDirectory, add explicit fields)
2. `electron/main.cjs` — `update:install` pushes `installing` status; status union comment
3. `hooks/useAutoUpdate.ts` — add `installing` to status union
4. `components/shared/UpdateOverlay.tsx` — **new** full-screen overlay component
5. `components/shared/UpdateButton.tsx` — trim to idle/error states only
6. `App.tsx` — lazy-import + mount `<UpdateOverlay />`

## Verification
- `npm run typecheck` (tsc --noEmit) to confirm the status-union changes type-check across main.cjs (n/a — .cjs, no TS) / useAutoUpdate.ts / UpdateOverlay / UpdateButton.
- Manual: rebuild with `npm run electron:build`, bump version, publish `electron:release`, run an older build, confirm: (1) update installs silently (no wizard), (2) full-screen overlay shows solid backdrop + visible progress.

## Notes / trade-offs
- `oneClick: true` removes the directory-choice page for *first-time* installs too (standard for auto-updating Electron apps). User data is preserved (`deleteAppDataOnUninstall: false`).
- Auto-install after download means the user can't postpone a restart once they start the download. The overlay will make this very clear ("Don't close the app" + auto-restart message). If they want to defer, they simply don't click "Download & Update".
- The overlay is `z-[200]`, above the header (`z-20`) and the existing `UpdateNotification` banner (`z-[100]`), so it can't be visually crowded out.
