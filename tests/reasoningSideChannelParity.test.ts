/**
 * The reasoning-side-channel ask, on every transport.
 *
 * This used to be a private function in the renderer only. The PACKAGED APP
 * builds its provider request in electron/main.cjs, so the flag was never sent
 * from the desktop: the same seat returned its thinking on the web and not in
 * the packaged app, with the Thinking row silently empty and no error to
 * explain it. The predicate now lives in shared/providerRequestPolicy.cjs —
 * the one module the renderer, the vite proxy and main.cjs all import — and
 * this test holds all three to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as policy from '../shared/providerRequestPolicy.cjs';

const mainSrc = readFileSync(resolve(__dirname, '../electron/main.cjs'), 'utf8');
const providerSrc = readFileSync(resolve(__dirname, '../services/providers/GenericProviderService.ts'), 'utf8');

describe('reasoning side channel', () => {
    it('asks hosts that can return a separate reasoning channel', () => {
        const params: Record<string, unknown> = {};
        policy.requestReasoningSideChannel(
            { baseUrl: 'https://openrouter.ai/api/v1', selectedModel: 'x' } as never,
            params,
        );
        expect(params.include_reasoning).toBe(true);
    });

    it('stays silent for hosts that have no such field', () => {
        const params: Record<string, unknown> = {};
        policy.requestReasoningSideChannel(
            { baseUrl: 'https://api.anthropic.com', selectedModel: 'claude-opus-4' } as never,
            params,
        );
        expect(params.include_reasoning).toBeUndefined();
    });

    it('is one implementation, not a copy per transport', () => {
        // A second definition would drift silently — that is exactly how the
        // desktop ended up different from the web.
        const defs = (mainSrc + providerSrc).match(/function requestReasoningSideChannel/g) ?? [];
        expect(defs).toHaveLength(0);
    });

    it('is sent by the renderer', () => {
        expect(providerSrc).toMatch(/requestReasoningSideChannel\(config, params\)/);
    });

    it('is sent by the packaged app', () => {
        // The gap this test exists for: main.cjs builds the provider body, so
        // without this line the desktop silently omits the flag.
        expect(mainSrc).toMatch(/policy\.requestReasoningSideChannel\(config, body\)/);
    });
});
