// Preload script for Electron — bridges renderer and main process securely.
// With contextIsolation: true, the renderer cannot access Node.js directly.
// Expose only what the app needs via contextBridge if IPC becomes necessary.
const { contextBridge } = require('electron');

// Example: expose a safe API to the renderer if needed later
// contextBridge.exposeInMainWorld('electronAPI', {
//   platform: process.platform,
//   version: process.versions.electron,
// });
