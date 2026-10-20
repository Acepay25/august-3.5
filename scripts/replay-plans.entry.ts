/// <reference types="node" />
/**
 * replay-plans — the read-only drift harness (E-20).
 *
 * Usage:
 *   node scripts/replay-plans.cjs --input <journal-or-backup.json> [--out <path>] [--fail-on-drift]
 *
 * Accepts a backup JSON (`{ profile: { tradeLog } }`, `{ tradeLog }`,
 * `{ profileJson: "<json>" }`) or a bare array of LoggedTrade rows. It uses
 * the app's real plan builder, so its verdict is what the current code would
 * say — not what a second copy of the arithmetic would say.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { LoggedTrade } from '../types';
import { replayTrades, replaySummaryLine } from '../utils/planReplay';

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
};
const input = valueOf('--input');
if (!input) {
    console.error('replay-plans: --input <journal-or-backup.json> is required');
    process.exit(2);
}

const extractTrades = (raw: unknown): LoggedTrade[] => {
    if (Array.isArray(raw)) return raw as LoggedTrade[];
    const root = raw as Record<string, unknown>;
    const direct = root.tradeLog;
    if (Array.isArray(direct)) return direct as LoggedTrade[];
    const profile = root.profile as Record<string, unknown> | undefined;
    if (profile && Array.isArray(profile.tradeLog)) return profile.tradeLog as LoggedTrade[];
    const profileJson = root.profileJson;
    if (typeof profileJson === 'string') {
        try { return extractTrades(JSON.parse(profileJson)); } catch { /* invalid nested JSON */ }
    }
    return [];
};

let raw: unknown;
try {
    raw = JSON.parse(readFileSync(input, 'utf8'));
} catch (e) {
    console.error(`replay-plans: cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
}
const trades = extractTrades(raw);
if (trades.length === 0) {
    console.error('replay-plans: no tradeLog rows found in the input — refusing to report a vacuous zero');
    process.exit(2);
}

const report = replayTrades(trades);
console.log(replaySummaryLine(report));
for (const row of report.drift.slice(0, 40)) {
    console.log(`  ${row.tradeId} ${row.symbol} [${row.fields.join(',')}] ${row.detail}`);
}
if (report.drift.length > 40) console.log(`  …and ${report.drift.length - 40} more drifted rows`);

const out = resolve(valueOf('--out') ?? '.probe-artifacts/replay-report.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: resolve(input),
    ...report,
    // The deterministic baseline over declined candidates waits on the
    // candidate log, which is staged behind the shadow month (D-24). The
    // harness reports what it can measure today rather than inventing it.
    baseline: 'requires the candidate log (D-24, gated on the shadow month)',
}, null, 2));
console.log(`replay-plans: report written to ${out}`);
if (args.includes('--fail-on-drift') && report.drift.length > 0) process.exit(1);
