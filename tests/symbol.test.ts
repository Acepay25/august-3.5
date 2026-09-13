/**
 * utils/symbol — the single canonical symbol reader. The regression this
 * guards: un-anchored `replace(/USDT|USD|PERP/gi,'')` stripped "USD" ANYWHERE,
 * so "USDC" → "C" and "USDCUSDT" → "CUSDT", mis-joining coin/skill/trade
 * memory onto the wrong asset. baseOf/stripQuoteSuffix are anchored.
 */

import { describe, it, expect } from 'vitest';
import { baseOf, quoteOf, display, stripQuoteSuffix, parseSymbol } from '../utils/symbol';

describe('baseOf — anchored base extraction (never mangles a stablecoin)', () => {
    it('strips a trailing quote', () => {
        expect(baseOf('BTCUSDT')).toBe('BTC');
        expect(baseOf('ETHUSDC')).toBe('ETH');
        expect(baseOf('BTCUSD')).toBe('BTC');
        expect(baseOf('1000PEPEUSDT')).toBe('1000PEPE');
        expect(baseOf('BTCPERP')).toBe('BTC');
        // Exactly one trailing token is removed (a USDT-margined PERP keeps its
        // USDT — callers pass one quote form at a time).
        expect(baseOf('BTCUSDTPERP')).toBe('BTCUSDT');
    });
    it('does NOT reproduce the USDC → "C" bug', () => {
        // The old `/USDT|USD|PERP/gi` produced these wrong values:
        expect(baseOf('USDC')).toBe('USDC');        // was "C"
        expect(baseOf('USDCUSDT')).toBe('USDC');     // was "C"
        expect(baseOf('SOLUSDC')).toBe('SOL');
    });
    it('is case- and separator-insensitive', () => {
        expect(baseOf('btcusdt')).toBe('BTC');
        expect(baseOf('BTC-USDT')).toBe('BTC');
        expect(baseOf('  ethusd  ')).toBe('ETH');
    });
});

describe('stripQuoteSuffix — may empty (bare quote is "not a base")', () => {
    it('empties a bare quote token (detection sites rely on this)', () => {
        expect(stripQuoteSuffix('USD')).toBe('');
        expect(stripQuoteSuffix('USDT')).toBe('');
    });
    it('fixes the USDC pair detection bug', () => {
        expect(stripQuoteSuffix('USDCUSDT')).toBe('USDC');   // old global strip → "C"
    });
});

describe('quoteOf / display / parseSymbol', () => {
    it('resolves the trailing quote, defaulting bare bases to USDT', () => {
        expect(quoteOf('BTCUSDT')).toBe('USDT');
        expect(quoteOf('ETHUSDC')).toBe('USDC');
        expect(quoteOf('BTC')).toBe('USDT');
    });
    it('renders a slash pair, leaves a bare base alone', () => {
        expect(display('BTCUSDT')).toBe('BTC/USDT');
        expect(display('USDCUSDT')).toBe('USDC/USDT');
        expect(display('BTC')).toBe('BTC');
    });
    it('parses base + quote + full together', () => {
        expect(parseSymbol('btcusdt')).toEqual({ full: 'BTCUSDT', base: 'BTC', quote: 'USDT' });
    });
});
