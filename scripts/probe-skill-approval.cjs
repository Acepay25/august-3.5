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

/** Skill file names currently in the notebook, from the live page.
 *  Resolves the key INSIDE the page every call: the app recreates the notebook
 *  asynchronously after a storage clear, so a key captured once at startup can
 *  be stale (that null-deref is what killed case 4 last pass). */
const readSkillFiles = (page) => page.evaluate(() => {
    const nk = Object.keys(localStorage).find(k => k.startsWith('memory_files_v1'));
    if (!nk) return { key: null, folders: [], files: [], error: 'no-notebook-key' };
    const raw = localStorage.getItem(nk);
    if (!raw) return { key: nk, folders: [], files: [], error: 'not-persisted-yet' };
    try {
        const store = JSON.parse(raw);
        const skills = (store.folders || []).find(f => f.name === 'skills');
        return {
            key: nk,
            folders: (store.folders || []).map(f => f.name),
            files: skills ? (store.files || []).filter(f => f.folderId === skills.id).map(f => f.name) : [],
        };
    } catch (e) { return { key: nk, folders: [], files: [], error: String(e) }; }
});

/** Drop the skills folder from the live notebook. Returns false if there was
 *  nothing to drop, so the case cannot pass vacuously on a missing folder. */
const deleteSkillsFolder = (page) => page.evaluate(() => {
    const nk = Object.keys(localStorage).find(k => k.startsWith('memory_files_v1'));
    if (!nk) return false;
    try {
        const store = JSON.parse(localStorage.getItem(nk) || 'null');
        if (!store || !Array.isArray(store.folders)) return false;
        const skills = store.folders.find(f => f.name === 'skills');
        if (!skills) return false;
        store.folders = store.folders.filter(f => f.name !== 'skills');
        store.files = (store.files || []).filter(f => f.folderId !== skills.id);
        localStorage.setItem(nk, JSON.stringify(store));
        return true;
    } catch { return false; }
});

async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

/** Click a visible control by the first word of its text, across whatever
 *  element the design system actually used (button, role=tab, anchor, div).
 *  Restricting to <button> is what made this report "not reachable" twice. */
const clickByText = (page, word) => page.evaluate((w) => {
    const sel = 'button, [role="tab"], [role="button"], a, [data-testid]';
    const cands = [...document.querySelectorAll(sel)]
        .map(el => ({ el, text: (el.textContent || '').trim() }))
        .filter(c => new RegExp('^' + w + '(\\s|$)').test(c.text))
        // The innermost match wins: a whole panel can start with the same word.
        .sort((a, b) => a.text.length - b.text.length);
    if (!cands.length) return { ok: false, seen: [] };
    cands[0].el.click();
    return { ok: true, used: cands[0].text.slice(0, 30), options: cands.length };
}, word);

/** Click the Coach tab, then the card's approve control. */
async function openCoachAndAllow(page, draftId) {
    // The rail owns the surface; the tab strip only exists once Learn mounts.
    const learn = await clickByText(page, 'Learn');
    await sleep(1200);
    // The tab strip renders the badge as a sibling span, so textContent is
    // "Coach1" with NO space — a text match on /^Coach(\s|$)/ never hit. The
    // tab has a stable testid; use it, and keep the text click as a fallback.
    let tab = { ok: false, used: null };
    try {
        await page.waitForSelector('[data-testid="learn-tab-coach"]', { timeout: 6000 });
        await page.click('[data-testid="learn-tab-coach"]');
        tab = { ok: true, used: 'learn-tab-coach' };
    } catch { tab = await clickByText(page, 'Coach'); }
    await sleep(1500);
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
    if (!(tab.ok && clicked)) {
        // Dump what IS on screen rather than guessing a fourth time.
        const dump = await page.evaluate(() => ({
            buttons: [...document.querySelectorAll('button,[role="tab"],a')].map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 45),
            testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 45),
        }));
        console.log('DIAG learn=' + JSON.stringify(learn) + ' coach=' + JSON.stringify(tab));
        console.log('DIAG buttons=' + JSON.stringify(dump.buttons));
        console.log('DIAG testids=' + JSON.stringify(dump.testids));
        await page.screenshot({ path: path.join(OUT, 'diag-before-click.png'), fullPage: true }).catch(() => {});
    }
    return { learn, tabClicked: tab.ok, clicked };
}

/** Poll the rendered text for one of the known toast strings.
 *  The previous version waited on `[role="status"]`/`[aria-live]` and returned
 *  that element's textContent — which matched an EMPTY live region and reported
 *  "" even though the toast had fired. Reading the page text for the strings we
 *  actually assert on cannot produce that false negative. */
const TOAST_STRINGS = ['Skill saved', 'Already learned', 'Not saved'];
async function readToast(page) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const hit = await page.evaluate((known) => {
            const text = document.body.innerText || '';
            return known.find(t => text.includes(t)) || '';
        }, TOAST_STRINGS);
        if (hit) return hit;
        await sleep(200);
    }
    return '';
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    // The seeded provider config points at 127.0.0.1:8787 (same contract as
    // render-probe.cjs:460). Without it every case logged ~25 failed-resource
    // errors that were the probe's own fiction, not the app's behaviour.
    const mock = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-provider.cjs'), '8787'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let serverLog = '';
    server.stdout.on('data', d => { serverLog += d.toString(); });
    server.stderr.on('data', d => { serverLog += d.toString(); });

    const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Only an UNCAUGHT exception is treated as a failure. Failed image/fetch
    // loads are reported but must not fail the run, or the probe would be
    // asserting on network reachability rather than on the approval flow.
    const pageErrors = [];
    const resourceErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        (/failed to load resource|net::|ERR_|502|503/i.test(m.text()) ? resourceErrors : pageErrors).push(m.text());
    });
    page.on('requestfailed', r => resourceErrors.push(`${r.url()} ${r.failure() && r.failure().errorText}`));

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
            let folderRemoved = true;
            if (c.label === '4-no-folder') {
                folderRemoved = await deleteSkillsFolder(page);
                await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
                await sleep(2000);
            }
            check(`${c.label}: the skills folder really was removed first`, folderRemoved);
            const before = await readSkillFiles(page);
            await seedDrafts(page, notebookKey, [draftRow(c.id, c.crafted)]);
            const seeded = await readDrafts(page);
            check(`${c.label}: draft is in the inbox before the click`, seeded.length === 1, seeded.map(d => d.id));

            const nav = await openCoachAndAllow(page, c.id);
            check(`${c.label}: Coach tab and approve control were reachable`, nav.tabClicked && nav.clicked, nav);
            // Screenshot AFTER reading the toast, so the image is evidence of
            // the claim rather than a frame captured before it rendered.
            const toast = await readToast(page);
            await shot(page, `${c.label}-after-click`);
            const after = await readSkillFiles(page);
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
        check('no uncaught page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 3));
        console.log(`(resource-load noise ignored: ${resourceErrors.length})`);
        fs.writeFileSync(path.join(OUT, 'transcript.json'),
            JSON.stringify({ results, failed, pageErrors, resourceErrors: resourceErrors.slice(0, 20) }, null, 2));
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        mock.kill('SIGTERM');
        console.log(`\n${results.length - failed}/${results.length} checks passed; pageErrors=${pageErrors.length}`);
        if (pageErrors.length) console.log(pageErrors.slice(0, 5).join('\n'));
        process.exit(failed === 0 ? 0 : 1);
    }
})();
