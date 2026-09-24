/**
 * The desktop streaming bridge handed the provider's RAW (snake_case) usage
 * to a renderer whose only guard is falsiness, and substituted `{}` when a
 * provider reported none. Both are wrong for mergeTokenUsage, where
 * `number + undefined` is NaN.
 *
 * Executed against the real bridge before the fix: after one streamed call
 * the ledger was {promptTokens: NaN, completionTokens: NaN, totalTokens: NaN};
 * verdictFinalizer's `sum || undefined` then reported undefined tokens, and
 * `estimateCostUsd(NaN) ?? 0` made shouldSkipRemaining() always false — so the
 * per-debate `debateCostCapUsd` money guard NEVER FIRED on desktop. A spend
 * limit the user had set was silently inert, and Session Usage rendered "—".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { mergeTokenUsage } from '../utils/tokenUsage';

const mainSource = readFileSync(resolve(__dirname, '../electron/main.cjs'), 'utf8');

describe('desktop usage bridge', () => {
    it('normalizes streamed usage instead of forwarding it raw', () => {
        // The bridge must run the shared normalizer — the same one the
        // buffered path already used — rather than pass sseParser's raw
        // snake_case payload through.
        expect(mainSource).toMatch(/extractTokenUsageJs\(\{\s*usage:\s*streamOut\.usage\s*\}\)/);
    });

    it('never substitutes an empty object for absent usage', () => {
        // `usage: streamOut.usage || {}` is what let an object with no numeric
        // fields through the renderer's falsiness guard. The normalizer returns
        // undefined, which is the value that guard is written for.
        expect(mainSource).not.toMatch(/usage:\s*streamOut\.usage\s*\|\|\s*\{\}/);
    });

    it('a snake_case payload cannot poison the ledger', () => {
        // What the renderer used to receive, and what mergeTokenUsage did
        // with it: 0 + undefined === NaN, which then made every downstream
        // consumer report "no cost" and disabled the spend cap.
        const raw = { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 };
        const poisoned = mergeTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }, raw as never);
        expect(Number.isNaN(poisoned.promptTokens)).toBe(true);
        // …and what it does once normalized, which is the contract main.cjs
        // now guarantees at the bridge.
        const safe = mergeTokenUsage(
            { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            { promptTokens: 1200, completionTokens: 340, totalTokens: 1540 },
        );
        expect(safe).toEqual({ promptTokens: 1200, completionTokens: 340, totalTokens: 1540 });
        expect(Number.isFinite(safe.promptTokens)).toBe(true);
    });
});
