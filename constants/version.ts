// App version — Vite injects the real package.json version at build time
// (see `define` in vite.config.ts); the literal is the dev/test fallback and
// kept synced with package.json so non-Vite importers never show a stale one.
// In Electron, the runtime version is also available via window.electronAPI.getVersion().
export const APP_VERSION: string =
    (import.meta as { env?: { PACKAGE_VERSION?: string } }).env?.PACKAGE_VERSION || '1.0.21';
export const APP_NAME = 'August Trading';
