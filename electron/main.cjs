const { app, BrowserWindow } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        icon: path.join(__dirname, '../public/favicon.ico') // Attempt to load icon
    });

    // Remove menu bar for cleaner look
    win.setMenuBarVisibility(false);

    if (isDev) {
        // Determine the URL from environment or default to Vite's 5173
        const port = process.env.PORT || 3000;
        win.loadURL(`http://localhost:${port}`);
        win.webContents.openDevTools();
    } else {
        // In production, load the index.html from the dist folder
        // 'win-unpacked' or 'setup.exe' structure usually places resources inside resources/app.asar or similar
        // but electron-builder usually sets root to the app folder.
        // We navigate up from 'electron' folder to 'dist'
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();

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
