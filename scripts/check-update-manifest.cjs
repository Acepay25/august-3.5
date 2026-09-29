/**
 * Does the updater manifest name a file that actually exists?
 *
 * `electron-updater` never guesses a filename. It reads `latest.yml` from the
 * newest GitHub release, takes `path`/`url` verbatim, and requests
 * `https://github.com/<owner>/<repo>/releases/download/<tag>/<that name>`. If
 * the name in the manifest and the name the packager emitted disagree, every
 * auto-update 404s with a bare `Cannot download "<url>"` that names the URL
 * but not the cause.
 *
 * That is not hypothetical. v1.1.0 shipped a manifest reading
 * `August-Trading-Setup-1.1.0.exe` beside an artifact named
 * `August.Trading.Setup.1.1.0.exe`. Nothing else in the release gate noticed:
 * the publish step asserts exactly one `Setup *.exe` exists, and a dot-named
 * file satisfies that just as well as a hyphen-named one. Only the updater
 * could tell, and only on a user's machine.
 *
 * The cause was `artifactName` being unset, so both names were decided
 * independently by electron-builder internals. `package.json` now pins it.
 * This check exists so that if the two ever diverge again, the build fails
 * HERE — before anything is uploaded — instead of at every user's desk.
 *
 * Runs over the build output directory, which is the same directory the
 * release workflow then publishes from. Reading `latest.yml` and the `.exe`
 * from one place is the point: checking them apart is how this got shipped.
 */

const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join(__dirname, '..', 'dist_electron');
const manifestPath = path.join(outDir, 'latest.yml');

/** `latest.yml` is a flat YAML doc; we only need the one scalar it exists for. */
const readManifestNames = (text) => {
    const names = new Set();
    // A quoted or bare scalar on a `path:` / `url:` line.
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(?:path|url):\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
        if (m && m[1]) names.add(m[1]);
    }
    return [...names];
};

const fail = (msg) => {
    console.error(`[update-manifest] ${msg}`);
    process.exit(1);
};

if (!fs.existsSync(manifestPath)) {
    fail(`no latest.yml in ${outDir} — the updater would find no manifest at all.`);
}

const wanted = readManifestNames(fs.readFileSync(manifestPath, 'utf8'));
if (wanted.length === 0) {
    fail(`latest.yml in ${outDir} names no file — it is malformed.`);
}

const problems = [];
for (const name of wanted) {
    if (!fs.existsSync(path.join(outDir, name))) {
        problems.push(name);
    }
}

if (problems.length > 0) {
    const present = fs
        .readdirSync(outDir)
        .filter((f) => /\.exe$/i.test(f))
        .map((f) => `    ${f}`);
    fail(
        `latest.yml names ${problems.length} file(s) that are not in ${outDir}:\n` +
            problems.map((n) => `    ${n}`).join('\n') +
            (present.length
                ? `\n  the packager actually produced:\n${present.join('\n')}\n` +
                  `\n  The updater will request the name in latest.yml and get a 404.\n` +
                  `  If the names differ, set build.artifactName explicitly so the\n` +
                  `  manifest and the artifact are decided in the same place.`
                : '\n  (and no .exe at all)')
    );
}

console.log(
    `[update-manifest] OK — latest.yml names ${wanted.length} file(s), all present: ${wanted.join(', ')}`
);
