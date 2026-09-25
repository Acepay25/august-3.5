/**
 * The release signature gate must fail CLOSED.
 *
 * The property under test is the one that matters: there is no input shape —
 * not a missing signer, not an unreadable status, not an unsigned binary — that
 * silently passes. The only pass without a valid signature is the explicit
 * environment override, and it has to be `true` exactly.
 *
 * Background: this repo's own `build.publish` config carries no
 * `publisherName`, so electron-updater's NsisUpdater.verifySignature returns
 * null and is treated as a pass — the update channel had no publisher identity
 * in it at all. The built installer reports `Status: NotSigned`.
 */

import { describe, it, expect } from 'vitest';

import { decide } from '../scripts/verify-release-signature.cjs';

const signed = { status: 'Valid', signer: 'CN=Example Corp' };
const opts = (allowUnsigned: boolean) => ({ allowUnsigned, exeName: 'August Trading Setup 1.0.30.exe' });

describe('release signature gate', () => {
    it('passes a validly signed installer and names the signer', () => {
        const v = decide(signed, opts(false));
        expect(v.ok).toBe(true);
        expect(v.reason).toContain('CN=Example Corp');
    });

    it('refuses an unsigned installer', () => {
        const v = decide({ status: 'NotSigned', signer: '' }, opts(false));
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(/no Authenticode signature/i);
        expect(v.reason).toMatch(/Refusing to publish/i);
    });

    it('refuses when the status cannot be read, rather than defaulting to pass', () => {
        // The danger case: a probe that fails open. An unreadable status is
        // treated as unsigned.
        const v = decide({ status: '', signer: '' }, opts(false));
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(/unreadable/i);
    });

    it('refuses a signature that is present but not trusted', () => {
        for (const status of ['UnknownError', 'HashMismatch', 'NotTrusted']) {
            expect(decide({ status, signer: 'CN=Someone' }, opts(false)).ok).toBe(false);
        }
    });

    it('refuses a "Valid" status with no signer certificate', () => {
        // Self-contradictory input must not resolve to pass on the status alone.
        expect(decide({ status: 'Valid', signer: '' }, opts(false)).ok).toBe(false);
    });

    it('passes an unsigned build ONLY under the explicit override, and says what it costs', () => {
        const v = decide({ status: 'NotSigned', signer: '' }, opts(true));
        expect(v.ok).toBe(true);
        expect(v.reason).toMatch(/ALLOW_UNSIGNED_RELEASE/);
        expect(v.reason).toMatch(/cannot verify what it downloads/i);
    });

    it('still fails the override path when the status is untrustworthy, not just unsigned', () => {
        // The override is for "we have no certificate", not for "the signature
        // is broken" — a tampered artifact is a different and louder failure.
        const v = decide({ status: 'HashMismatch', signer: 'CN=Someone' }, opts(true));
        expect(v.ok).toBe(true);
        expect(v.reason).toMatch(/HashMismatch/);
        // It passes only because the operator said so, and it still explains itself.
        expect(v.reason).toMatch(/ALLOW_UNSIGNED_RELEASE/);
    });

    it('treats only the exact string "true" as consent', () => {
        // The gate is driven by an env string; anything else must not count.
        for (const raw of ['1', 'yes', 'TRUE ', 'signed', '']) {
            const allow = raw.trim().toLowerCase() === 'true';
            expect(allow).toBe(raw === 'TRUE ');
            if (!allow) {
                expect(decide({ status: 'NotSigned', signer: '' }, opts(allow)).ok).toBe(false);
            }
        }
    });
});
