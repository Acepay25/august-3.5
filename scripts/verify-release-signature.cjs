#!/usr/bin/env node
/**
 * Fail-closed release gate: the shipped installer must carry a valid
 * Authenticode signature.
 *
 * WHY THIS EXISTS. electron-updater's `NsisUpdater.verifySignature` asks
 * electron-builder's `app-update.yml` for a `publisherName` and compares it to
 * the downloaded installer's signer. This project configures no `publisherName`
 * (see `build.publish` in package.json), so the check has nothing to compare
 * against and returns null — which electron-updater treats as PASS. The
 * auto-updater therefore accepted ANY installer named like ours: the update
 * channel had no publisher identity in it at all. A valid signature closes that
 * (electron-builder writes `publisherName` from the signing cert), and a
 * signature check in the release workflow stops an unsigned artifact from being
 * published in the first place.
 *
 * Verified on this repo's own output before the gate existed: the built
 * `August Trading Setup *.exe` reports `Status: NotSigned`, and its
 * `app-update.yml` carries only owner/repo/provider/releaseType/updaterCacheDirName.
 *
 * THE OVERRIDE. Setting `ALLOW_UNSIGNED_RELEASE=true` skips the failure and
 * prints exactly what is being given up. It exists because a code-signing
 * certificate is a purchase, and until there is one this repo cannot ship
 * signed — but the choice to ship unsigned must be made deliberately at each
 * release, never inherited by accident.
 *
 * Usage: node scripts/verify-release-signature.cjs [path/to/installer.exe]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** The one built NSIS installer, or null when the directory has none. */
function findInstaller(dir) {
    if (!fs.existsSync(dir)) return null;
    const exes = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.exe'))
        // electron-builder writes the unpacked app beside the installer; only a
        // Setup binary is the artifact users download.
        .filter(f => /setup/i.test(f));
    if (exes.length === 0) return null;
    // Newest wins: a rebuild in the same dist_electron leaves the old one too.
    return exes
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0].f;
}

/** Strip the byte-level noise PowerShell can emit into a redirected pipe: a
 *  UTF-8 BOM, NUL bytes (it writes UTF-16LE under some host configurations),
 *  and CR. Compared by CODE POINT rather than written as escape sequences, so
 *  the source carries no invisible characters to be mangled in transit.
 *
 *  The 1.0.31 release reported "of unknown signature status" for an installer
 *  that is plainly NotSigned: the same command parsed locally and did not on
 *  the GitHub windows runner. The security behaviour stayed correct (an
 *  unreadable status counts as unsigned, so the gate fails closed), but a
 *  gate that cannot report what it read cannot be trusted to explain the next
 *  failure.
 */
function normalizeOutput(raw) {
    const kept = [];
    for (const ch of raw) {
        const code = ch.codePointAt(0);
        if (code === 0x00 || code === 0xFEFF || code === 0x0D) continue;
        kept.push(ch);
    }
    return kept.join('');
}

/**
 * PowerShell's verdict as `{ status, signer }`, or null if it cannot be read.
 *
 * The output is normalized before parsing because the same command produced
 * readable `STATUS=` lines locally and something the regex could not match on
 * the GitHub windows runner — where the release reported "of unknown
 * signature status" for an installer that is plainly NotSigned. The security
 * behaviour was right either way (an unreadable status is treated as unsigned,
 * so the gate fails closed), but a gate that cannot report what it actually
 * read is a gate nobody can trust, and the next real failure would be
 * indistinguishable from this parsing quirk.
 *
 * Three things are normalized: a UTF-8 BOM, NUL bytes (PowerShell writes
 * UTF-16LE when stdout is redirected under some host configurations), and
 * CRLF. `-EncodedCommand` is avoided on purpose — a base64 payload is opaque
 * to the next person debugging a release.
 */
function readSignature(exePath) {
    const ps = `$ErrorActionPreference='Stop';`
        + `$s = Get-AuthenticodeSignature -LiteralPath '${exePath.replace(/'/g, "''")}';`
        + ` [Console]::Out.WriteLine("STATUS=" + [string]$s.Status);`
        + ` [Console]::Out.WriteLine("SIGNER=" + $(if ($s.SignerCertificate) { [string]$s.SignerCertificate.Subject } else { '' }))`;
    let raw;
    try {
        // Read as latin1 so the bytes survive whatever PowerShell chose, then
        // strip the encoding artifacts below rather than guessing a codepage.
        raw = execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', ps],
            { encoding: 'latin1', windowsHide: true },
        );
    } catch {
        return null;
    }
    const out = normalizeOutput(raw);
    const status = (out.match(/^STATUS=(.*)$/m) || [])[1]?.trim() ?? '';
    const signer = (out.match(/^SIGNER=(.*)$/m) || [])[1]?.trim() ?? '';
    return { status, signer };
}

/**
 * The decision, kept pure so it can be tested without a Windows host.
 * @returns {{ ok: boolean, reason: string }}
 */
function decide({ status, signer }, { allowUnsigned, exeName }) {
    if (status === 'Valid' && signer) {
        return { ok: true, reason: `signed by ${signer}` };
    }
    if (allowUnsigned) {
        return {
            ok: true,
            reason: `ALLOW_UNSIGNED_RELEASE=true — ${exeName} is ${
                status || 'of unknown signature status'}${signer ? '' : ' with no signer certificate'}. `
                + 'The updater still checks the sha512 published in latest.yml, so download integrity is '
                + 'covered: a corrupted or truncated file is caught. What is MISSING is authenticity — with '
                + 'no publisherName there is no publisher identity in the update channel at all, so nothing '
                + 'binds the installer to us, and anyone able to publish to this repo can ship an update '
                + 'the app will install.',
        };
    }
    const detail = status === 'NotSigned'
        ? `${exeName} carries no Authenticode signature.`
        : `Signature status is "${status || 'unreadable'}"${signer ? ` (signer ${signer})` : ''}.`;
    return {
        ok: false,
        reason: `${detail} Refusing to publish an unsigned installer.\n`
            + '  Why: this release configures no build.publish.publisherName, so electron-updater cannot '
            + 'check WHO published a downloaded update — verifySignature returns null and treats that as a '
            + 'pass. The sha512 in latest.yml still catches a corrupted download, but integrity is not '
            + 'authenticity: nothing binds the installer to this project, so anyone who can publish a '
            + 'release here can ship an update the app will install with full privileges.\n'
            + '  Fix: add a code-signing certificate, then set win.certificateFile (or CSC_LINK) in the '
            + 'build config. electron-builder signs the artifact and writes publisherName from the cert.\n'
            + '  Shipping unsigned on purpose? Re-run with ALLOW_UNSIGNED_RELEASE=true, which accepts the '
            + 'gap explicitly rather than by omission.',
    };
}

function main() {
    const override = String(process.argv[2] || '').trim();
    const outDir = path.join(__dirname, '..', 'dist_electron');
    const exeName = findInstaller(outDir);
    if (!exeName) {
        console.error(`[signature-gate] no installer (*Setup*.exe) in ${outDir}. `
            + 'Build one first — this gate refuses to pass on a directory with nothing in it.');
        process.exit(1);
    }
    const exePath = path.join(outDir, exeName);
    const sig = readSignature(exePath);
    if (!sig) {
        console.error(`[signature-gate] could not read the signature of ${exeName}. `
            + 'Treating that as unsigned rather than passing it silently.');
    }
    const verdict = decide(sig ?? { status: '', signer: '' }, {
        allowUnsigned: String(process.env.ALLOW_UNSIGNED_RELEASE).toLowerCase() === 'true',
        exeName,
    });
    if (override && !process.env.ALLOW_UNSIGNED_RELEASE) {
        console.warn(`[signature-gate] ignoring the argument "${override}" — the override is the `
            + 'ALLOW_UNSIGNED_RELEASE=true environment variable, so a passing flag can never be the '
            + 'thing that quietly let an unsigned build through.');
    }
    console.log(`[signature-gate] ${exeName}: ${verdict.reason}`);
    process.exit(verdict.ok ? 0 : 1);
}

module.exports = { decide, findInstaller, readSignature, normalizeOutput };

if (require.main === module) main();
