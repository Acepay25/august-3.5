import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('scripts/installer-smoke.cjs');
const source = readFileSync(scriptPath, 'utf8');

interface ProbeHelpers {
    sanitizeEnv: (env: Record<string, string>) => Record<string, string>;
    parseTimeout: (value: string, fallback: number) => number;
    resolveExePath: () => string;
}

function loadHelpers(env: Record<string, string> = {}): ProbeHelpers {
    return vm.runInNewContext(
        source.slice(0, source.lastIndexOf('main().catch(')) + '\n({ sanitizeEnv, parseTimeout, resolveExePath });',
        {
            require: createRequire(scriptPath),
            __dirname: path.dirname(scriptPath),
            process: { env, platform: process.platform },
            console,
        },
    ) as ProbeHelpers;
}

describe('packaged smoke helpers', () => {
    it('removes credentials, proxies and execution overrides from the child environment', () => {
        const { sanitizeEnv } = loadHelpers();
        expect(sanitizeEnv({
            PATH: 'tools', HOME: 'scratch', OPENAI_API_KEY: 'secret', GH_TOKEN: 'secret',
            HTTPS_PROXY: 'proxy', NODE_OPTIONS: '--require injected', ELECTRON_RUN_AS_NODE: '1',
        })).toEqual({
            PATH: 'tools', HOME: 'scratch', AUGUST_SMOKE_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        });
    });

    it('uses finite positive timeout values only', () => {
        const { parseTimeout } = loadHelpers();
        for (const invalid of ['', '0', '-1', 'Infinity', 'invalid']) {
            expect(parseTimeout(invalid, 120000)).toBe(120000);
        }
        expect(parseTimeout('250.9', 120000)).toBe(250);
    });

    it('resolves an explicit executable independently of default build output', () => {
        expect(loadHelpers({ INSTALLER_SMOKE_EXECUTABLE: process.execPath }).resolveExePath()).toBe(process.execPath);
        expect(loadHelpers({ AUGUST_SMOKE_APP: process.execPath }).resolveExePath()).toBe(process.execPath);
    });

    it('fails instead of silently ignoring a missing explicit executable', () => {
        expect(() => loadHelpers({ INSTALLER_SMOKE_EXECUTABLE: 'missing-smoke-test.exe' }).resolveExePath()).toThrow('override does not exist');
    });

    it('retains resource and main-process failure gates in the launcher', () => {
        expect(source).toContain("page.on('requestfailed'");
        expect(source).toContain("page.on('response'");
        expect(source).toContain('if (appResourceFailures.length > 0)');
        expect(source).toContain('if (mainConsoleErrors.length > 0)');
        expect(source).toContain('if (appExited || appProcess.exitCode !== null');
    });
});
