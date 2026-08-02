const { app, BrowserWindow, ipcMain, dialog, protocol, net, safeStorage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

// =============================================================================
// CUSTOM PROTOCOL (app://) — must be registered before app.ready
// =============================================================================
// Using a custom protocol instead of file:// gives the renderer a proper origin,
// which fixes CORS failures on <script type="module" crossorigin> tags that Vite
// emits in the production build. On file:// the origin is opaque ("null") and
// module script fetches fail silently, causing a white screen.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        icon: path.join(__dirname, '../public/favicon.ico')
    });

    // Remove menu bar for cleaner look
    mainWindow.setMenuBarVisibility(false);

    if (isDev) {
        const port = process.env.PORT || 3000;
        mainWindow.loadURL(`http://localhost:${port}`);
        mainWindow.webContents.openDevTools();
    } else {
        // Serve the built dist/ folder via the custom app:// protocol
        const distPath = path.join(__dirname, '../dist');

        protocol.handle('app', (request) => {
            // app://./index.html -> dist/index.html
            // app://./assets/foo.js -> dist/assets/foo.js
            const url = new URL(request.url);
            let filePath = decodeURIComponent(url.pathname);

            // Default to index.html for root or SPA routes
            if (filePath === '/' || filePath === '') {
                filePath = '/index.html';
            }

            const fullPath = path.join(distPath, filePath);
            return net.fetch(pathToFileURL(fullPath).toString());
        });

        mainWindow.loadURL('app://./index.html');
    }
}

// =============================================================================
// AUTO-UPDATE LOGIC
// =============================================================================

let updateInfo = {
    status: 'idle',           // idle | checking | available | downloading | downloaded | installing | error
    progress: 0,
    version: null,
    error: null,
};

function sendUpdateStatus() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', updateInfo);
    }
}

function setupAutoUpdater() {
    // Disable auto-download — we let the user decide via the Update button
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        updateInfo = { ...updateInfo, status: 'checking', error: null };
        sendUpdateStatus();
    });

    autoUpdater.on('update-available', (info) => {
        updateInfo = {
            ...updateInfo,
            status: 'available',
            version: info.version,
            error: null,
        };
        sendUpdateStatus();
    });

    autoUpdater.on('update-not-available', () => {
        updateInfo = { ...updateInfo, status: 'idle', version: null };
        sendUpdateStatus();
    });

    autoUpdater.on('download-progress', (progressObj) => {
        updateInfo = {
            ...updateInfo,
            status: 'downloading',
            progress: Math.round(progressObj.percent),
        };
        sendUpdateStatus();
    });

    autoUpdater.on('update-downloaded', () => {
        updateInfo = {
            ...updateInfo,
            status: 'downloaded',
            progress: 100,
        };
        sendUpdateStatus();
    });

    autoUpdater.on('error', (err) => {
        updateInfo = {
            ...updateInfo,
            status: 'error',
            error: err ? err.message : 'Unknown update error',
        };
        sendUpdateStatus();
    });

    // IPC handlers — called from the renderer via the preload bridge
    ipcMain.handle('update:check', async () => {
        try {
            await autoUpdater.checkForUpdates();
            return updateInfo;
        } catch (err) {
            updateInfo = { ...updateInfo, status: 'error', error: err.message };
            sendUpdateStatus();
            return updateInfo;
        }
    });

    ipcMain.handle('update:download', async () => {
        try {
            await autoUpdater.downloadUpdate();
            return updateInfo;
        } catch (err) {
            updateInfo = { ...updateInfo, status: 'error', error: err.message };
            sendUpdateStatus();
            return updateInfo;
        }
    });

    ipcMain.handle('update:install', () => {
        // Push an 'installing' status so the renderer overlay can show a
        // "Restarting…" message before the app quits.
        updateInfo = { ...updateInfo, status: 'installing' };
        sendUpdateStatus();
        // quitAndInstall runs after the renderer acknowledges
        setImmediate(() => autoUpdater.quitAndInstall());
        return true;
    });

    ipcMain.handle('update:get-status', () => updateInfo);

    ipcMain.handle('app:get-version', () => app.getVersion());

    // =========================================================================
    // SECRET ENCRYPTION — API keys at rest
    // =========================================================================
    // The renderer stores provider API keys; on desktop we encrypt them with
    // the OS keychain (DPAPI on Windows, Keychain on macOS) via safeStorage.
    // Payloads are prefixed "enc:v1:" so the renderer can tell encrypted
    // values from legacy plaintext and fall back gracefully when unavailable.
    ipcMain.handle('crypto:encrypt', (_event, plaintext) => {
        try {
            if (typeof plaintext !== 'string' || !plaintext || !safeStorage.isEncryptionAvailable()) return null;
            return 'enc:v1:' + safeStorage.encryptString(plaintext).toString('base64');
        } catch (err) {
            console.warn('[main] crypto:encrypt failed:', err);
            return null;
        }
    });

    ipcMain.handle('crypto:decrypt', (_event, payload) => {
        try {
            if (typeof payload !== 'string' || !payload.startsWith('enc:v1:')) return null;
            return safeStorage.decryptString(Buffer.from(payload.slice(7), 'base64'));
        } catch (err) {
            console.warn('[main] crypto:decrypt failed:', err);
            return null;
        }
    });
}

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();

    // Check for updates on startup (production only, non-blocking)
    if (!isDev) {
        // Delay the check so the app loads first
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(() => {
                // Silently fail on startup — user can manually check
            });
        }, 3000);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
