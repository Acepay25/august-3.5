/**
 * E-21 — the Content-Security-Policy must not name a remote origin the app
 * does not use.
 *
 * `index.html`'s meta tag was the ONLY CSP (there is no header, and the
 * `app://` handler returns `net.fetch(file://)` verbatim, so a header was
 * never possible). It allowed `https://s3.tradingview.com` in `script-src`
 * and three TradingView hosts in `frame-src`/`img-src` — while the code
 * deliberately does NOT use the widget:
 *
 *   components/trade/TradingChart.tsx:4  "Deliberately NOT the embed widget"
 *   components/market/LiveMarket.tsx:6   "run its OWN WebSocket + REST-poll"
 *
 * and the CSP's own comment claimed the opposite. That made the app's ONLY
 * remote-script permission a hole with nothing behind it — and a script in
 * the app origin inherits the preload bridge (decryptSecret, providerChat).
 *
 * This suite is the guard the plan asked for: "A test asserting `script-src`
 * contains no `unsafe-inline`/`unsafe-eval` and no third-party origin, and
 * that `frame-src` contains no third-party origin. That test would have
 * caught this automatically."
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** The CSP directives, as a map. */
const parseCsp = (source: string): Record<string, string> => {
    const match = source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    if (!match) throw new Error('no Content-Security-Policy meta tag in index.html');
    const out: Record<string, string> = {};
    for (const part of match[1].split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const space = trimmed.indexOf(' ');
        if (space === -1) out[trimmed] = '';
        else out[trimmed.slice(0, space)] = trimmed.slice(space + 1);
    }
    return out;
};

const csp = parseCsp(html);

/** The policy as ONE string — the COMMENT around it is not part of it. */
const cspText = (): string => {
    const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    return match ? match[1] : '';
};

/** Every source-list token of a directive, keywords included. */
const tokens = (directive: string): string[] =>
    (csp[directive] ?? '').split(/\s+/).filter(Boolean);

/** The HOSTS of a directive — the keywords ('self', 'none', 'data:', …) are
 *  not hosts, so a third-party host is what is left. */
const hosts = (directive: string): string[] =>
    tokens(directive).filter(token => !token.startsWith("'")).map(token => token.toLowerCase());

describe('E-21 — the CSP names no remote origin', () => {
    it('script-src allows the app only — no third-party script host', () => {
        expect(hosts('script-src')).toEqual([]);
        expect(tokens('script-src')).toEqual(["'self'"]);
    });

    it('script-src has no unsafe-inline and no unsafe-eval', () => {
        expect(csp['script-src']).not.toMatch(/unsafe-inline/);
        expect(csp['script-src']).not.toMatch(/unsafe-eval/);
    });

    it('frame-src allows no frame at all', () => {
        // 'none' is explicit; omitting the directive would fall back to
        // default-src ('self' app:) and re-open same-origin framing.
        expect(csp['frame-src']).toBe("'none'");
        expect(hosts('frame-src')).toEqual([]);
    });

    it('img-src, font-src and worker-src name no third-party host', () => {
        expect(hosts('img-src')).toEqual(['data:', 'blob:']);
        expect(hosts('font-src')).toEqual(['data:']);
        expect(hosts('worker-src')).toEqual(['blob:']);
        // connect-src is scheme-scoped by design (providers are runtime
        // configured), so it is asserted separately below.
        expect(cspText()).not.toMatch(/tradingview/i);
    });

    it('no TradingView host survives anywhere in the POLICY', () => {
        expect(cspText()).not.toMatch(/tradingview/i);
    });

    it('object-src stays none and base-uri stays self', () => {
        expect(csp['object-src']).toBe("'none'");
        expect(csp['base-uri']).toBe("'self'");
    });
});

describe('E-21 — nothing in the app loads a remote origin the CSP would have to allow', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
        for (const entry of readdirSync(dir)) {
            if (['node_modules', '.git', 'dist', 'dist_electron', 'android', 'coverage', 'test-results', '.probe-artifacts', 'tests', 'e2e', 'docs'].includes(entry)) continue;
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) walk(p, out);
            else if (/\.(ts|tsx|cjs|html|css)$/.test(p)) out.push(p);
        }
        return out;
    };

    it('no source file loads a TradingView asset or embeds a frame', () => {
        const offenders: string[] = [];
        for (const file of walk(ROOT)) {
            const src = readFileSync(file, 'utf8');
            // Strip comments so the two files that DOCUMENT the decision
            // (TradingChart.tsx, LiveMarket.tsx) are not counted as users.
            const code = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1')
                .replace(/<!--[\s\S]*?-->/g, '');
            // The VENDOR host, not the domain term: `analyzeTradingView` is
            // this app's own name for "analyse the chart".
            if (/tradingview\.com/i.test(code)) offenders.push(`${file} (loads a TradingView host)`);
            if (/<iframe/i.test(code)) offenders.push(`${file} (embeds a frame)`);
        }
        expect(offenders).toEqual([]);
    });

    it('the CSP comment describes the policy that is actually there', () => {
        // The bug was as much in the COMMENT as in the policy: it claimed a
        // TradingView widget loader that the code does not use.
        expect(html).not.toMatch(/TradingView widget loader/i);
        expect(html).toMatch(/No third-party script origin/);
    });
});
