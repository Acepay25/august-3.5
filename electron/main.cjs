const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

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
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// =============================================================================
// AUTO-UPDATE LOGIC
// =============================================================================

let updateInfo = {
    status: 'idle',           // idle | checking | available | downloading | downloaded | error
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
        // quitAndInstall runs after the renderer acknowledges
        setImmediate(() => autoUpdater.quitAndInstall());
        return true;
    });

    ipcMain.handle('update:get-status', () => updateInfo);

    ipcMain.handle('app:get-version', () => app.getVersion());
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
