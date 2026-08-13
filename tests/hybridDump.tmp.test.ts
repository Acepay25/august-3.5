/**
 * TEMPORARY dump script — fetches the real hybrid intelligence packet for
 * BTCUSDT and writes the COMPLETE payload (raw JSON + full prompt injection)
 * to hybrid-payload-dump.md. Not a test; deleted after the dump.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchHybridData, generateHybridPromptInjection } from '../services/analysis/HybridIntelligenceService';

describe('hybrid dump', () => {
    it('writes the full payload', async () => {
        const data = await fetchHybridData('BTCUSDT');
        const injection = generateHybridPromptInjection(data);
        const json = JSON.stringify(data, null, 2);
        const out = [
            '========================================================================',
            ' HYBRID INTELLIGENCE — FULL PAYLOAD DUMP (BTCUSDT, live fetch)',
            '========================================================================',
            '',
            `RAW JSON PACKET SIZE: ${(json.length / 1024).toFixed(1)} KB`,
            `PROMPT INJECTION SIZE: ${(injection.length / 1024).toFixed(1)} KB`,
            '',
            '═══════════════════════════════════════════════════════════════',
            ' PART 1 — RAW JSON PACKET (HybridDataPacket)',
            '═══════════════════════════════════════════════════════════════',
            json,
            '',
            '═══════════════════════════════════════════════════════════════',
            ' PART 2 — PROMPT INJECTION (exactly what the model receives)',
            '═══════════════════════════════════════════════════════════════',
            injection,
            '',
        ].join('\n');
        const target = path.resolve(__dirname, '..', 'hybrid-payload-dump.md');
        fs.writeFileSync(target, out, 'utf8');
        console.log(`DUMP WRITTEN: ${target} (${(out.length / 1024).toFixed(1)} KB)`);
        expect(data.symbol).toBe('BTCUSDT');
    }, 60000);
});
