/**
 * The ONE path rule for the repo bridge (Electron main + contracts).
 *
 * The model may read and edit August's own source in DEV ONLY, and only
 * inside the checkout named by AUGUSTTRADING_REPO. This module answers one
 * question — may this relative path be touched? — so the main process never
 * hand-rolls a containment check that a `..` or a drive letter slips past.
 *
 * Denied on purpose: dependency and build trees (writing them is not editing
 * the app), the git database, checkpoint storage, environment files and
 * binary assets (the bridge carries UTF-8 text, so a "successful" write to a
 * PNG would corrupt it).
 */
const path = require('path');

const DENY_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'dist_electron', '.august-checkpoints']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|pdf|zip|gz|exe|dll|node|wasm|mp4|mov|mp3|wav)$/i;

const normalizeRel = (rel) => String(rel == null ? '' : rel).replace(/\\/g, '/');

/**
 * @returns {{ok:true, abs:string, rel:string} | {ok:false, error:string}}
 */
const resolveRepoPath = (root, rel) => {
    if (!root) return { ok: false, error: 'no repo is configured' };
    const cleaned = normalizeRel(rel);
    if (!cleaned) return { ok: false, error: 'path is required' };
    if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
        return { ok: false, error: 'path must be relative to the repo' };
    }
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, cleaned);
    const relBack = path.relative(rootAbs, abs);
    if (!relBack || relBack.startsWith('..') || path.isAbsolute(relBack)) {
        return { ok: false, error: 'path must stay inside the repo' };
    }
    const parts = relBack.split(path.sep);
    const denied = parts.find(p => DENY_SEGMENTS.has(p));
    if (denied) return { ok: false, error: `"${denied}" is not editable` };
    const base = parts[parts.length - 1];
    if (/^\.env/i.test(base)) return { ok: false, error: 'environment files are not editable' };
    if (BINARY_EXT.test(base)) return { ok: false, error: 'binary files are not editable' };
    return { ok: true, abs, rel: parts.join('/') };
};

module.exports = { resolveRepoPath, DENY_SEGMENTS };
