// Preload script for Electron — bridges renderer and main process securely.
// With contextIsolation: true, the renderer cannot access Node.js directly.
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a safe, minimal API to the renderer for auto-update control.
 * The renderer calls these via window.electronAPI.*
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    isElectron: true,
    platform: process.platform,

    // Auto-update
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    downloadUpdate: () => ipcRenderer.invoke('update:download'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),

    // Secret encryption (OS keychain via safeStorage) — used by
    // ProviderConfigService to encrypt API keys at rest on desktop.
    encryptSecret: (plaintext) => ipcRenderer.invoke('crypto:encrypt', plaintext),
    decryptSecret: (payload) => ipcRenderer.invoke('crypto:decrypt', payload),

    // Listen for real-time status updates pushed from main process
    onUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on('update-status', handler);
        // Return an unsubscribe function
        return () => ipcRenderer.removeListener('update-status', handler);
    },
});
