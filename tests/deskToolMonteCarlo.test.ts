import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESK_TOOL_DEFINITIONS, DESK_TOOLS_PROMPT, executeDeskTool, toolLabel } from '../services/analysis/DeskToolsService';
import type { DeskToolResult } from '../services/analysis/DeskToolsService';

const call = (args: Record<string, unknown> = {}): Promise<DeskToolResult> => executeDeskTool(
    { id: 'mc-1', name: 'run_monte_carlo', arguments: {
        direction: 'long', entry: 100, stop_loss: 95, take_profits: [110],
        num_simulations: 100, max_steps: 10, ...args,
    } },
    { defaultSymbol: 'BTCUSDT', chartInterval: '15m' },
);

beforeEach(() => vi.stubGlobal('Worker', undefined));
afterEach(() => vi.unstubAllGlobals());

describe('run_monte_carlo desk tool', () => {
    it('publishes the required schema, prompt instructions and readable label', () => {
        const tool = DESK_TOOL_DEFINITIONS.find(t => t.function.name === 'run_monte_carlo');
        expect(tool?.function.parameters.required).toEqual(['direction', 'entry', 'stop_loss', 'take_profits']);
        expect(DESK_TOOLS_PROMPT).toContain('run_monte_carlo');
        expect(toolLabel('run_monte_carlo')).toBe('monte carlo');
    });

    it('executes the real simulation and reports only the supplied target', async () => {
        const result = await call();
        expect(result).toMatchObject({ ok: true, name: 'run_monte_carlo', toolCallId: 'mc-1', symbol: 'BTCUSDT' });
        expect(result.content).toContain('100 simulated paths on 15m');
        expect(result.content).toContain('BTCUSDT Long entry 100');
        expect(result.content).toContain('TP2 0.0 · TP3 0.0');
        expect(result.content).toContain('5th–95th percentile trade PnL');
        expect(result.content).toContain('NOT a forecast');
        expect(result.content).not.toMatch(/NaN|Infinity|truncated/);
        expect(result.content.length).toBeLessThan(2400);
        expect((await call()).content).toBe(result.content);
    });

    it('accepts numeric strings and sorts short targets nearest first', async () => {
        const result = await call({ direction: 'sell', entry: '100', stop_loss: '105', take_profits: ['80', '90'], symbol: 'ETHUSDT' });
        expect(result.ok).toBe(true);
        expect(result.symbol).toBe('ETHUSDT');
        expect(result.content).toContain('Short entry 100 · SL 105 · TPs 90 / 80');
    });

    it.each([
        { direction: undefined }, { direction: 'neutral' }, { entry: true }, { entry: 0 },
        { entry: Infinity }, { stop_loss: 101 }, { take_profits: [] },
        { take_profits: [110, 90] }, { take_profits: [NaN] },
        { take_profits: [101, 102, 103, 104] }, { atr: -1 }, { atr: null },
        { num_simulations: Infinity }, { max_steps: 'bad' },
        { account_balance: 1000, position_size: Infinity, leverage: 2 },
        { account_balance: 1000, position_size: 2000, leverage: 2 },
    ])('rejects invalid inputs %j', async (args) => {
        const result = await call(args);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('run_monte_carlo rejected:');
    });

    it('reports timeouts honestly for distant levels and low volatility', async () => {
        const result = await call({ stop_loss: 1, take_profits: [1000], atr: 0.001, max_steps: 1, num_simulations: 1 });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('100 simulated paths');
        expect(result.content).toContain('timeout 100.0');
        expect(result.content).toContain('EV +0.00%');
    });

    it('includes account risk only for a complete valid account input', async () => {
        const complete = await call({ account_balance: 10000, position_size: 100, leverage: 2 });
        expect(complete.ok).toBe(true);
        expect(complete.content).toContain('Account risk over 100 fixed-fractional trades');
        expect(complete.content).not.toMatch(/NaN|Infinity|truncated/);
        const partial = await call({ account_balance: 10000 });
        expect(partial.ok).toBe(true);
        expect(partial.content).toContain('Ruin risk skipped');
    });

    it('enforces the caller tool allowlist', async () => {
        const result = await executeDeskTool({ id: 'denied', name: 'run_monte_carlo', arguments: {} }, { allowedTools: ['recall'] });
        expect(result.ok).toBe(false);
    });
});
