import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterBotNoteByQuery, botMemoryFolderName } from '../services/bots/BotMemoryService';
import { clipNote, findClipIn } from '../utils/harnessMarks';

/**
 * The three defects in the bot-note reader, all found by reading
 * hermes-agent's profile layer against our own:
 *
 *   1. "another coin's lesson" was decided by a HARDCODED list of nine majors,
 *      so on any other symbol the filter matched nothing and every line passed
 *      as a general lesson — the feature was a no-op for most of the roster;
 *   2. the byte budget was derived from `memoryScope`, which gave an ISOLATED
 *      bot a LARGER allowance than a global one — backwards from why the field
 *      exists (scope is about sharing, and is enforced elsewhere);
 *   3. both files were head-`slice`d with no marker, so a 4kB notebook read to
 *      the model as the whole of it.
 */

const NOTE = [
    '- BTC: fade the retest after a sweep, size small.',
    '- ARB: the London-open push always gets sold.',
    '- Always demand a third touch before calling a line valid.',
].join('\n');

describe('the "another coin" filter', () => {
    it('drops a line naming another coin the trader journals for', () => {
        const kept = filterBotNoteByQuery(NOTE, { coin: 'BTCUSDT', knownCoins: ['ARBUSDT'] }) ?? '';
        expect(kept).toContain('BTC');
        expect(kept).not.toContain('ARB');
        // A coin-specific lesson on a coin nobody asked about is dead weight;
        // the general line survives.
        expect(kept).toContain('third touch');
    });

    it('no longer no-ops just because a symbol is outside the nine majors', () => {
        // The old list had no OP/ARB/PEPE entry, so asking about OPUSDT kept
        // an ARB-specific rule as if it were general advice.
        const withoutUniverse = filterBotNoteByQuery(NOTE, { coin: 'OPUSDT' }) ?? '';
        const withUniverse = filterBotNoteByQuery(NOTE, { coin: 'OPUSDT', knownCoins: ['ARBUSDT'] }) ?? '';
        expect(withoutUniverse).toContain('ARB');
        expect(withUniverse).not.toContain('ARB');
    });

    it('matches a symbol as a word, not as a substring', () => {
        // `includes()` read 'OP' inside "LondOPen", so with OP on the chart a
        // BTC-specific lesson was claimed as being about OP and kept.
        const note = '- BTC: fade the retest near the London open.\n- Another line.\n- And one more.';
        const kept = filterBotNoteByQuery(note, { coin: 'OPUSDT' }) ?? '';
        expect(kept).not.toContain('BTC');
    });

    it('treats a symbol as data, not as pattern source', () => {
        // A stray '(' in a ticker must not compile into a broken character class.
        expect(() => filterBotNoteByQuery(NOTE, { coin: 'BTC', knownCoins: ['(x+'] })).not.toThrow();
    });
});

describe('the byte budget', () => {
    // Each case re-seeds the notebook, so the module graph has to be dropped
    // between them — otherwise the first `doMock` stays cached and every case
    // silently reads the same content.
    beforeEach(() => { vi.resetModules(); });

    /** getBotMemoryContext reads through MemoryFilesService, so the notebook
     *  is the only thing faked — the budget arithmetic stays real. */
    const seed = (content: string) => {
        vi.doMock('../services/learning/MemoryFilesService', async (importOriginal) => ({
            ...(await importOriginal<typeof import('../services/learning/MemoryFilesService')>()),
            getMemoryFiles: () => ({
                // Named through the SAME helper the reader uses — a folder the
                // test invented would read as "this bot has no notes".
                folders: [{ id: 'f1', name: botMemoryFolderName('bot-1') }],
                files: [{ id: 'x1', folderId: 'f1', name: 'memory.md', content }],
            }),
        }));
    };

    it('names how much was withheld instead of cutting silently', async () => {
        seed('note line one\n'.repeat(400));
        const { getBotMemoryContext: read } = await import('../services/bots/BotMemoryService');
        const ctx = read('bot-1', undefined, 300);
        const seen = findClipIn(ctx);
        expect(seen).not.toBeNull();
        expect(seen!.total).toBeGreaterThan(seen!.kept);
        expect(ctx.length).toBeLessThan(420);
    });

    it('gives the whole file when it fits, and adds no marker', async () => {
        seed('a short note');
        const { getBotMemoryContext: read } = await import('../services/bots/BotMemoryService');
        const ctx = read('bot-1', undefined, 600);
        expect(ctx).toContain('a short note');
        expect(findClipIn(ctx)).toBeNull();
    });

    it('never lets the clip note itself break the promised budget', async () => {
        // A cap smaller than one marker must still report the gap rather than
        // emit a bare ellipsis or a zero-length lie.
        seed('x'.repeat(500));
        const { getBotMemoryContext: read } = await import('../services/bots/BotMemoryService');
        const ctx = read('bot-1', undefined, 60);
        expect(findClipIn(ctx)).not.toBeNull();
        expect(clipNote({ source: 'memory.md', kept: 0, total: 500 }).length).toBeLessThan(200);
    });
});
