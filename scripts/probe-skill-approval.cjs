/**
 * probe-skill-approval — drives the REAL app through the four skill-draft
 * approval outcomes and asserts the notebook bytes after each click.
 *
 * Why this exists: `approveSkillDraft`, the read-back guard and the honest
 * toasts were unit-green while nothing had ever pressed "Save as skill" in a
 * browser. The mock provider emits no tool calls, so `propose_skill` itself
 * cannot be reached from a model turn yet (that is the next pass); a draft is
 * therefore seeded with the exact bytes `utils/skillDrafts.ts` writes, which
 * exercises everything DOWNSTREAM of the inbox — the part that was broken:
 *   coachAllowDraft → approveSkillDraft → notebook write → skillApprovalToast
 *
 * Cases, in order, one browser session, fresh storage each:
 *   1 happy      → a skill file appears, the draft is consumed, "Skill saved"
 *   2 collision  → same NAME, different IF clause → a SECOND file `-2.md`
 *                  (this threw an unhandled rejection before the fix)
 *   3 duplicate  → an already-live trigger → NO new file, "Already learned",
 *                  and specifically not "Skill saved"
 *   4 no folder  → skills folder deleted from the notebook → "Not saved" AND
 *                  the draft still in the inbox (it must not be destroyed)
 *
 * Usage: node scripts/probe-skill-approval.cjs [--headed]
 * Screenshots + a JSON transcript land in .probe-artifacts/skill-approval/.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PROBE_PORT || 4189);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, '.probe-artifacts', 'skill-approval');
const USER = 'Probe User';
const DRAFTS_KEY = `skill_drafts_v1:${USER}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let failed = 0;
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  [${JSON.stringify(detail)}]` : ''}`);
}

async function waitForServer(url, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 404) return true;
        } catch { /* not up yet */ }
        await sleep(400);
    }
    return false;
}

/** A crafted skill shaped exactly like `CraftedSkill`, clauses over the bar. */
const craft = (over = {}) => ({
    name: 'Funding exhaustion long',
    kind: 'repeat',
    when: 'funding runs positive for many sessions while price stalls at swept lows',
    steps: ['Confirm the funding streak', 'Wait for a 1h close back above the swept low', 'Enter with stop under the wick'],
    inputs: [],
    validate: 'Confirm the sweep on the live chart before acting',
    output: 'A long entry with a stop under the liquidity low',
    approval: 'A human approves this draft before it is ever applied',
    ifCondition: 'funding positive 8 sessions and the daily low was swept',
    thenAction: 'go long only after a 1h close back above the swept level',
    ...over,
});

const draftRow = (id, crafted, tradeId) => ({
    id, tradeId: tradeId || `chat:${crafted.kind}|${crafted.ifCondition}`,
    coin: 'BTC', crafted, createdAt: new Date().toISOString(),
});

async function freshSession(page) {
    await page.goto(`${BASE}/favicon.ico`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.evaluate((user) => {
        sessionStorage.setItem('activeUsername', user);
        localStorage.setItem('august_surface_v1', 'learn');
    }, USER);
    // The workspace modal is what CREATES the profile, and the profile is what
    // creates the notebook. render-probe documents this verbatim: skipping it
    // "makes the probe fail for the wrong reason" — the app just sits on the
    // onboarding modal and no `memory_files_v1_*` key is ever written.
    await page.evaluate(async (user) => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('FuturesAI-DB', 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('userProfiles')) {
                    request.result.createObjectStore('userProfiles', { keyPath: 'username' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('userProfiles', 'readwrite');
        tx.objectStore('userProfiles').put({
            username: user,
            conversations: [], tradeLog: [], savedAnalyses: [], tradeSummaries: [],
            finalTradeSummary: null,
            settings: { activeFrameworks: [] },
        });
        await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
        db.close();
        // Never used for a model call here (the mock provider emits no tool
        // calls), but the app treats "no ready provider" as incomplete setup.
        localStorage.setItem('provider_configs_v1', JSON.stringify([{
            id: 'mock', name: 'Mock', apiKey: 'mock-key',
            baseUrl: 'http://127.0.0.1:8787/v1',
            apiFormat: 'chat_completions',
            isEnabled: true, isBuiltIn: false,
            models: ['mock-mini'], selectedModel: 'mock-mini',
        }]));
    }, USER);
    await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
    await sleep(3000);
    // Let the app create its own profile + notebook, then read the key format
    // back off the live page. Guessing `memory_files_v1_<user>` is exactly the
    // kind of assumption that makes a probe pass for the wrong reason.
    const notebookKey = await page.evaluate(() =>
        Object.keys(localStorage).find(k => k.startsWith('memory_files_v1')) || null);
    if (!notebookKey) {
        // Worth keeping permanently: when this probe reports "no notebook", the
        // useful question is what the app DID store and what it drew — the
        // profile may never have been created, or the notebook may live in
        // IndexedDB on web rather than localStorage.
        const diag = await page.evaluate(() => ({
            lsKeys: Object.keys(localStorage),
            iddbs: (window.indexedDB && indexedDB.databases) ? indexedDB.databases().then(d => d.map(x => x.name)) : 'n/a',
            body: document.body.innerText.slice(0, 400),
        }));
        console.log('DIAG no-notebook:', JSON.stringify({ ...diag, iddbs: await diag.iddbs }));
        await page.screenshot({ path: path.join(OUT, 'diag-no-notebook.png'), fullPage: true }).catch(() => {});
    }
    return notebookKey;
}

async function seedDrafts(page, key, drafts) {
    await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [DRAFTS_KEY, drafts]);
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await sleep(2000);
    if (key) {
        await page.evaluate(([nk]) => {
            const raw = localStorage.getItem(nk);
            window.__notebookBefore = raw;
        }, [key]);
    }
}

const readDrafts = (page) => page.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
}, DRAFTS_KEY);

/** Skill file names currently in the notebook, from the live page. */
const readSkillFiles = (page, key) => page.evaluate(([nk]) => {
    try {
        const store = JSON.parse(localStorage.getItem(nk) || 'null');
        if (!store) return { folders: [], files: [] };
        const skills = (store.folders || []).find(f => f.name === 'skills');
        return {
            folders: (store.folders || []).map(f => f.name),
            files: skills ? (store.files || []).filter(f => f.folderId === skills.id).map(f => f.name) : [],
        };
    } catch { return { folders: [], files: [], error: 'unparseable' }; }
}, key);

async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

/** Click the Coach tab, then the card's approve control. */
async function openCoachAndAllow(page, draftId) {
    const tabClicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
            .find(b => (b.textContent || '').trim() === 'Coach');
        if (btn) { btn.click(); return true; }
        return false;
    });
    await sleep(1200);
    const testId = `coach-draft-allow-${draftId}`;
    let clicked = false;
    try {
        await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 8000 });
        await page.click(`[data-testid="${testId}"]`);
        clicked = true;
    } catch { /* fall through to the text locator */ }
    if (!clicked) {
        const el = page.locator('button:has-text("Save as skill")');
        if (await el.count() > 0) { await el.first().click(); clicked = true; }
    }
    return { tabClicked, clicked };
}

async function readToast(page) {
    try {
        const el = await page.waitForSelector('[data-child="toast-wrapper"], .Toastify, [role="status"], [aria-live="polite"]', { timeout: 5000 });
        return (await el.textContent()) || '';
    } catch { /* react-hot-toast renders a plain div; fall back to the body */ }
    const body = await page.evaluate(() => {
        const known = ['Skill saved', 'Already learned', 'Not saved'];
        const hit = known.find(t => document.body.innerText.includes(t));
        return hit || '';
    });
    return body;
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let serverLog = '';
    server.stdout.on('data', d => { serverLog += d.toString(); });
    server.stderr.on('data', d => { serverLog += d.toString(); });

    const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

    try {
        if (!await waitForServer(BASE)) {
            check('dev server started', false, serverLog.slice(0, 400));
            throw new Error('server did not come up');
        }
        const notebookKey = await freshSession(page);
        check('notebook key discovered on the live page', !!notebookKey, notebookKey);
        if (!notebookKey) throw new Error('no notebook to assert against');

        const cases = [
            { label: '1-happy', id: 'sk-probe-1', crafted: craft() },
            { label: '2-collision', id: 'sk-probe-2', crafted: craft({ ifCondition: 'a completely different trigger clause entirely' }) },
            { label: '3-duplicate', id: 'sk-probe-3', crafted: craft({ name: 'Renamed duplicate trigger' }) },
            { label: '4-no-folder', id: 'sk-probe-4', crafted: craft({ ifCondition: 'fourth case trigger that cannot be written' }) },
        ];

        for (const c of cases) {
            await freshSession(page);
            if (c.label === '4-no-folder') {
                // Delete the skills FOLDER from the notebook the app just made.
                await page.evaluate(([nk]) => {
                    const store = JSON.parse(localStorage.getItem(nk));
                    const skills = store.folders.find(f => f.name === 'skills');
                    store.folders = store.folders.filter(f => f.name !== 'skills');
                    store.files = store.files.filter(f => f.folderId !== (skills && skills.id));
                    localStorage.setItem(nk, JSON.stringify(store));
                }, notebookKey);
            }
            const before = await readSkillFiles(page, notebookKey);
            await seedDrafts(page, notebookKey, [draftRow(c.id, c.crafted)]);
            const seeded = await readDrafts(page);
            check(`${c.label}: draft is in the inbox before the click`, seeded.length === 1, seeded.map(d => d.id));

            const nav = await openCoachAndAllow(page, c.id);
            check(`${c.label}: Coach tab and approve control were reachable`, nav.tabClicked && nav.clicked, nav);
            await shot(page, `${c.label}-after-click`);

            const toast = await readToast(page);
            const after = await readSkillFiles(page, notebookKey);
            const draftsAfter = await readDrafts(page);
            console.log(`       ${c.label} toast="${toast.slice(0, 60)}" files=${JSON.stringify(after.files)} drafts=${draftsAfter.length}`);

            if (c.label === '1-happy') {
                check('1-happy: "Skill saved" shown', /Skill saved/.test(toast), toast.slice(0, 80));
                check('1-happy: a skill file was written', after.files.includes('funding-exhaustion-long.md'), after.files);
                check('1-happy: draft consumed', draftsAfter.length === 0, draftsAfter.map(d => d.id));
            }
            if (c.label === '2-collision') {
                check('2-collision: second file written as -2.md (no throw)', after.files.includes('funding-exhaustion-long-2.md'), after.files);
                check('2-collision: no unhandled pageerror', pageErrors.filter(e => /already exists/.test(e)).length === 0,
                    pageErrors.filter(e => /already exists/.test(e)));
            }
            if (c.label === '3-duplicate') {
                check('3-duplicate: says Already learned', /Already learned/.test(toast), toast.slice(0, 80));
                check('3-duplicate: does NOT claim Skill saved', !/Skill saved/.test(toast), toast.slice(0, 80));
                check('3-duplicate: wrote no new file', after.files.length === before.files.length, { before: before.files, after: after.files });
            }
            if (c.label === '4-no-folder') {
                check('4-no-folder: says Not saved', /Not saved/.test(toast), toast.slice(0, 80));
                check('4-no-folder: the draft SURVIVES the failed write', draftsAfter.length === 1, draftsAfter.map(d => d.id));
            }
        }
        await shot(page, 'final');
    } catch (e) {
        check('probe completed without throwing', false, String(e && e.message || e));
        await shot(page, 'aborted');
    } finally {
        fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify({ results, failed, pageErrors }, null, 2));
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        console.log(`\n${results.length - failed}/${results.length} checks passed; pageErrors=${pageErrors.length}`);
        if (pageErrors.length) console.log(pageErrors.slice(0, 5).join('\n'));
        process.exit(failed === 0 ? 0 : 1);
    }
})();
