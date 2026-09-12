/**
 * profileMemory — the collaboration memory (this environment's MEMORY.md
 * analogue). The load-bearing guarantees: one fact per slug with UPSERT (an
 * update never creates a duplicate), the always-loaded index renders one line
 * per entry, and the desk tools round-trip (remember → read_memory sees it
 * immediately → forget removes it) WITHOUT the result cache freezing the read.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    rememberProfileMemory, listProfileMemories, getProfileMemory, forgetProfileMemory,
    buildProfileMemoryIndex, slugify, normalizeKind, __clearProfileMemoriesForTests,
} from '../services/learning/profileMemory';
import { executeDeskTool, clearDeskToolCache } from '../services/analysis/DeskToolsService';

beforeEach(() => {
    localStorage.clear();
    __clearProfileMemoriesForTests();
    clearDeskToolCache();
});

describe('profileMemory store', () => {
    it('creates a new entry and derives a kebab slug from the name', () => {
        const { entry, created } = rememberProfileMemory({
            name: 'User runs 15m scalps', kind: 'user',
            description: 'When sizing or suggesting timeframes.', body: 'The user day-trades 15m charts.',
        });
        expect(created).toBe(true);
        expect(entry.slug).toBe('user-runs-15m-scalps');
        expect(listProfileMemories().length).toBe(1);
    });

    it('upserts by slug — updating never leaves a duplicate behind', () => {
        rememberProfileMemory({ name: 'Risk cap', kind: 'feedback', description: 'd1', body: 'No leverage over 10x.' });
        const slug = listProfileMemories()[0].slug;
        const { created } = rememberProfileMemory({ slug, kind: 'feedback', description: 'd2', body: 'User corrected: max 5x.' });
        expect(created).toBe(false);
        expect(listProfileMemories().length).toBe(1);
        expect(getProfileMemory(slug)?.body).toContain('max 5x');
    });

    it('forget deletes; a wrong slug is a no-op', () => {
        rememberProfileMemory({ name: 'Temp', kind: 'project', description: 'd', body: 'b' });
        const slug = listProfileMemories()[0].slug;
        expect(forgetProfileMemory(slug)).toBe(true);
        expect(listProfileMemories().length).toBe(0);
        expect(forgetProfileMemory('nope')).toBe(false);
    });

    it('rejects an unknown kind via normalizeKind', () => {
        expect(normalizeKind('user')).toBe('user');
        expect(normalizeKind('vibes')).toBeNull();
    });

    it('caps the store and keeps the newest entries', () => {
        for (let i = 0; i < 45; i += 1) {
            rememberProfileMemory({ name: `fact-${i}`, kind: 'reference', description: `d${i}`, body: 'b' });
        }
        const all = listProfileMemories();
        expect(all.length).toBeLessThanOrEqual(40);
        expect(all[all.length - 1].slug).toContain('fact-44');
    });
});

describe('buildProfileMemoryIndex', () => {
    it('renders one line per entry with kind + slug + description', () => {
        rememberProfileMemory({ name: 'Risk cap', kind: 'feedback', description: 'When sizing any trade.', body: 'b' });
        const block = buildProfileMemoryIndex();
        expect(block).toContain('[feedback]');
        expect(block).toContain('risk-cap');
        expect(block).toContain('When sizing any trade.');
        expect(block).toContain('read_memory');
    });

    it('empty store → empty string (composes cleanly into the prompt)', () => {
        expect(buildProfileMemoryIndex()).toBe('');
    });
});

describe('memory desk tools (executeDeskTool)', () => {
    it('remember → read_memory sees it immediately (cache bypass) → forget removes it', async () => {
        const saved = await executeDeskTool({
            id: 'c1', name: 'remember',
            arguments: { name: 'Prefers BTC only', kind: 'user', description: 'When picking symbols.', body: 'User trades BTCUSDT exclusively.' },
        });
        expect(saved.ok).toBe(true);
        expect(saved.content).toContain('"saved":true');

        const read = await executeDeskTool({ id: 'c2', name: 'read_memory', arguments: { slugs: ['all'] } });
        expect(read.content).toContain('prefers-btc-only');
        expect(read.content).toContain('User trades BTCUSDT exclusively.');

        const gone = await executeDeskTool({ id: 'c3', name: 'forget', arguments: { slug: 'prefers-btc-only' } });
        expect(gone.content).toContain('"removed":true');
        const after = await executeDeskTool({ id: 'c4', name: 'read_memory', arguments: { slugs: ['all'] } });
        expect(after.content).toContain('No matching memories');
    });

    it('remember rejects a bad kind without touching the store', async () => {
        const r = await executeDeskTool({ id: 'c1', name: 'remember', arguments: { kind: 'vibes', description: 'd', body: 'b' } });
        expect(r.content).toMatch(/remember rejected/);
        expect(listProfileMemories().length).toBe(0);
    });

    it('toolActionFromResult surfaces remember/forget as side-effect rows', async () => {
        const { toolActionFromResult } = await import('../services/analysis/DeskToolsService');
        const remember = await executeDeskTool({ id: 'c1', name: 'remember', arguments: { name: 'X', kind: 'project', description: 'd', body: 'b' } });
        const row = toolActionFromResult('remember', true, remember.content, 'm');
        expect(row).not.toBeNull();
        expect(row?.verb).toBe('saved');
        expect(row?.label).toContain('project/');
    });
});

describe('slugify', () => {
    it('normalizes arbitrary names to kebab slugs', () => {
        expect(slugify('  User Runs 15m Scalps!! ')).toBe('user-runs-15m-scalps');
    });
});
