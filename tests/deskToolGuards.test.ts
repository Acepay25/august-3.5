import { describe, it, expect } from 'vitest';
import { detectStalledLoop, looksTruncatedToolCall } from '../services/analysis/DeskToolsService';

const OPEN = '<' + 'tool_call name="scan_setups">';
const CLOSE = '</' + 'tool_call>';

/**
 * Two guards added to the desk-tool loop, both invisible to a round cap.
 */

describe('detectStalledLoop', () => {
    it('says nothing about a seat making progress', () => {
        expect(detectStalledLoop(['a:1', 'b:2', 'c:3'])).toBe(0);
        // A,B,A is a legitimate second look at a frame, not yet a loop.
        expect(detectStalledLoop(['a:1', 'b:2', 'a:1'])).toBe(0);
        expect(detectStalledLoop([])).toBe(0);
    });

    it('catches the same call three times over', () => {
        expect(detectStalledLoop(['a:1', 'a:1', 'a:1'])).toBeGreaterThan(0);
    });

    it('catches the alternation a repeat counter alone never sees', () => {
        // A,B,A,B never repeats one signature three times — this is the shape
        // that spends every remaining round while each result is cached.
        expect(detectStalledLoop(['a:1', 'b:2', 'a:1', 'b:2'])).toBeGreaterThan(0);
    });

    it('separates calls by arguments, not just by tool', () => {
        expect(detectStalledLoop([
            'get:{"symbol":"BTCUSDT"}', 'get:{"symbol":"ETHUSDT"}',
            'get:{"symbol":"SOLUSDT"}', 'get:{"symbol":"ADAUSDT"}',
        ])).toBe(0);
    });
});

describe('looksTruncatedToolCall', () => {
    it('reads a whole argument object with a missing close as a syntax slip', () => {
        // Re-emitting works here, so the bounce must say "fix the format".
        expect(looksTruncatedToolCall(`${OPEN}{"symbol":"ETHUSDT"}`)).toBe(false);
    });

    it('reads a cut argument object as truncation', () => {
        // Asking for an exact re-emission here reproduces the same cut.
        expect(looksTruncatedToolCall(`${OPEN}{"symbol":"ETHUS`)).toBe(true);
        expect(looksTruncatedToolCall(`${OPEN}`)).toBe(true);
    });

    it('is not interested in a well-formed call', () => {
        expect(looksTruncatedToolCall(`${OPEN}{"symbol":"ETHUSDT"}${CLOSE}`)).toBe(false);
        expect(looksTruncatedToolCall('All timeframes look ranging.')).toBe(false);
        expect(looksTruncatedToolCall('')).toBe(false);
    });
});
