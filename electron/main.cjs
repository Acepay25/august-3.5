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
const activeProviderRequests = new Map();

// =============================================================================
// PROVIDER TRANSPORT — main-process requests avoid renderer CORS restrictions
// =============================================================================

const LOCAL_PROVIDER_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function normalizeProviderUrl(url) {
    const parsed = new URL(String(url || '').trim());
    const isLocal = LOCAL_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase());
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
        throw new Error('Provider URLs must use HTTPS. HTTP is allowed only for localhost.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('Provider URLs cannot include credentials, query parameters, or fragments.');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    for (const suffix of ['/chat/completions', '/messages', '/responses']) {
        if (parsed.pathname.endsWith(suffix)) {
            parsed.pathname = parsed.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
            break;
        }
    }
    return parsed.toString().replace(/\/$/, '');
}

function providerRequestDetails(request) {
    const config = request?.config || {};
    const format = config.apiFormat;
    const baseUrl = normalizeProviderUrl(config.baseUrl);
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const model = String(config.selectedModel || '').trim();
    if (!model) throw new Error('Choose a model before sending a provider request.');

    const headers = { 'Content-Type': 'application/json' };
    const apiKey = String(config.apiKey || '').trim();
    let url;
    let body;

    if (format === 'chat_completions') {
        url = `${baseUrl}/chat/completions`;
        if (apiKey && apiKey !== 'not-needed') headers.Authorization = `Bearer ${apiKey}`;
        body = {
            model,
            messages,
            max_tokens: request.maxTokens ?? 4096,
            temperature: request.temperature ?? 0.7,
        };
        if (request.jsonMode) body.response_format = { type: 'json_object' };
    } else if (format === 'messages') {
        url = `${baseUrl}/messages`;
        if (apiKey) headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
        const system = messages.find(message => message?.role === 'system');
        body = {
            model,
            max_tokens: request.maxTokens ?? 4096,
            messages: messages.filter(message => message?.role !== 'system'),
        };
        if (system) body.system = typeof system.content === 'string' ? system.content : '';
        if (request.temperature !== undefined) body.temperature = request.temperature;
    } else if (format === 'responses') {
        url = `${baseUrl}/responses`;
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        body = {
            model,
            input: messages,
            max_output_tokens: request.maxTokens ?? 4096,
            temperature: request.temperature ?? 0.7,
        };
    } else {
        throw new Error('Unknown provider API format.');
    }

    return { url, headers, body };
}

async function sendProviderRequest(request) {
    const { url, headers, body } = providerRequestDetails(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    if (request.requestId) activeProviderRequests.set(request.requestId, controller);
    let response;
    try {
        response = await net.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
        if (request.requestId) activeProviderRequests.delete(request.requestId);
    }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* handled by fallback below */ }

    if (!response.ok) {
        const error = new Error(response.status === 401
            ? 'Invalid API key. Check your provider settings.'
            : response.status === 403
                ? 'Access denied. Check your provider permissions or credits.'
                : response.status === 429
                    ? 'Rate limit reached. Please wait and try again.'
                    : response.status >= 500
                        ? 'Provider server error. Try again later.'
                        : `Provider request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }

    let text = '';
    let reasoning = '';
    if (request.config.apiFormat === 'messages') {
        text = Array.isArray(data.content)
            ? data.content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
            : data.text || '';
    } else if (request.config.apiFormat === 'responses') {
        if (data.output_text) text = data.output_text;
        if (!text && Array.isArray(data.output)) {
            text = data.output.flatMap(item => item?.content || [])
                .filter(block => block?.type === 'output_text').map(block => block.text).join('\n');
        }
    } else {
        text = data.choices?.[0]?.message?.content || '';
        reasoning = data.choices?.[0]?.message?.reasoning_content || data.choices?.[0]?.message?.reasoning || '';
    }
    return { text: text || (raw && typeof data === 'object' ? JSON.stringify(data) : raw), reasoning };
}

async function createWindow() {
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
        // Chromium can retain localhost responses between Electron launches,
        // even when the renderer performs a hard refresh. Disable that cache
        // for the development window and force the first navigation to use
        // the current Vite output.
        const devSession = mainWindow.webContents.session;
        await devSession.clearCache();
        devSession.webRequest.onHeadersReceived(
            { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'] },
            (details, callback) => {
                const responseHeaders = { ...details.responseHeaders };
                for (const key of Object.keys(responseHeaders)) {
                    if (key.toLowerCase() === 'cache-control') delete responseHeaders[key];
                }
                responseHeaders['Cache-Control'] = ['no-store, no-cache, must-revalidate, max-age=0'];
                callback({ responseHeaders });
            }
        );
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) {
            require('electron').shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const allowed = isDev ? url.startsWith('http://localhost:') : url.startsWith('app://');
        if (!allowed) event.preventDefault();
    });

    if (isDev) {
        const port = process.env.PORT || 3000;
        await mainWindow.loadURL(`http://localhost:${port}`);
        mainWindow.webContents.openDevTools();
    } else {
        // Serve the built dist/ folder via the custom app:// protocol
        const distPath = path.resolve(__dirname, '../dist');

        protocol.handle('app', (request) => {
            const url = new URL(request.url);
            if (url.protocol !== 'app:' || url.hostname !== '.') {
                return new Response('Not found', { status: 404 });
            }

            let filePath;
            try {
                filePath = decodeURIComponent(url.pathname);
            } catch {
                return new Response('Bad request', { status: 400 });
            }

            if (filePath === '/' || filePath === '') {
                filePath = '/index.html';
            }

            const fullPath = path.resolve(distPath, `.${filePath}`);
            const relativePath = path.relative(distPath, fullPath);
            if (
                relativePath === '..' ||
                relativePath.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relativePath)
            ) {
                return new Response('Forbidden', { status: 403 });
            }

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

    ipcMain.handle('provider:chat', async (_event, request) => {
        try {
            return { ok: true, ...(await sendProviderRequest(request)) };
        } catch (error) {
            console.error('[main] provider request failed:', {
                provider: request?.config?.name || 'Provider',
                format: request?.config?.apiFormat,
                message: error instanceof Error ? error.message : String(error),
                code: error?.code,
                status: error?.status,
            });
            return {
                ok: false,
                status: typeof error?.status === 'number' ? error.status : undefined,
                code: typeof error?.code === 'string' ? error.code : undefined,
                message: error instanceof Error ? error.message : 'Provider request failed.',
            };
        }
    });

    ipcMain.handle('provider:cancel', (_event, requestId) => {
        if (typeof requestId !== 'string') return false;
        const controller = activeProviderRequests.get(requestId);
        if (!controller) return false;
        controller.abort();
        activeProviderRequests.delete(requestId);
        return true;
    });

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
