import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService so notebook files live in an in-memory, per-key
// store (avoids touching localStorage / Capacitor Preferences in tests).
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  // The notebook init reads the RAW value so it can tell "no key" apart from
  // "unparseable blob" (getPreferenceObject erases that distinction). The mock
  // store holds parsed objects, so stringify on the way out — except a string
  // the test planted raw (the corrupt-blob cases), which passes through as-is.
  getPreference: vi.fn(async (key: string) => {
    const v = store[key];
    if (v === undefined || v === null) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }),
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
      const raw = store[key];
      if (!Array.isArray(raw)) return [];
      return guard ? raw.filter(guard) : raw;
  }),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import {
  initMemoryFiles,
  getMemoryFiles,
  getMemoryFilesStats,
  createMemoryFolder,
  renameMemoryFolder,
  moveMemoryFolder,
  deleteMemoryFolder,
  createMemoryFile,
  updateMemoryFile,
  deleteMemoryFile,
  appendDiaryEntry,
  syncProfileMemory,
  syncPatternMemory,
  toPatternMemoryMarkdown,
  syncRecurringMistakes,
  buildRecurringMistakesContent,
  extractLessonFromPostMortem,
  getMemoryFilesIndex,
  computeTopLessons,
  writeModelNote,
  SUGGESTIONS_FILE_NAME,
  withNotebookWriteLock,
  createMemoryFileUnlocked,
  getMemoryFilesOwner,
} from '../services/learning/MemoryFilesService';
import { getPreference } from '../services/infrastructure/PreferencesService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import { LoggedTrade, MemoryFile, TradeOutcome, UserProfile } from '../types';

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
  id: 'trade-1',
  analysis: { coinName: 'BTCUSDT', direction: 'Short' } as any,
  outcome: TradeOutcome.WIN,
  timestamp: '2026-08-09T12:00:00.000Z',
  pnlPercent: 3.2,
  postMortem: '## Final Report\n**Key Lesson:** Wait for the 15m reclaim before entering.\nThe entry was premature.',
  ...overrides,
});

const makeProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  username: 'rober',
  conversations: [],
  tradeLog: [makeTrade(), makeTrade({ id: 'trade-2', outcome: TradeOutcome.LOSS, pnlPercent: -2.1 })],
  savedAnalyses: [],
  tradeSummaries: [],
  finalTradeSummary: null,
  settings: { activeFrameworks: [], isAccuracyModeEnabled: true, isHybridIntelligenceEnabled: true },
  globalMemory: { totalTradesAnalyzed: 2, familyPerformance: {}, aiPatternMemory: [], userPreferences: { leverageDefault: 5, favoriteAssets: ['BTCUSDT'], preferredSetup: 'swing' }, globalCorrections: [], lastUpdated: '' },
  ...overrides,
});

const findFile = (name: string, folderName = ''): MemoryFile | undefined => {
  const { folders, files } = getMemoryFiles();
  return files.find(f => f.name === name && (!folderName || folders.find(x => x.id === f.folderId)?.name === folderName));
};

describe('MemoryFilesService', () => {
  beforeEach(async () => {
    store = {};
    // Reset the sync cache by (re)initializing against the empty store.
    await initMemoryFiles('test-user');
  });

  describe('initMemoryFiles (seeding)', () => {
    it('seeds the default folders (incl. distilled) on first boot', async () => {
      const { folders } = getMemoryFiles();
      expect(folders.map(f => f.name)).toEqual(['profile', 'trader-diary', 'market-conditions', 'rules', 'skills', 'bots', 'lens', 'settled-beliefs', 'distilled']);
    });

    it('seeds only the risk-rules starter — the unread market-conditions playbooks are gone', async () => {
      expect(findFile('risk-rules.md', 'rules')).toBeDefined();
      expect(findFile('ranging-day.md', 'market-conditions')).toBeUndefined();
      expect(findFile('after-liquidity-sweep.md', 'market-conditions')).toBeUndefined();
      // The folder itself stays — user notes there are still indexed.
      expect(getMemoryFiles().folders.some(f => f.name === 'market-conditions')).toBe(true);
    });

    it('persists the seed so a reload does not reseed', async () => {
      await initMemoryFiles('test-user'); // second init
      expect(getMemoryFiles().folders).toHaveLength(9);
      const stored = store['memory_files_v1_test-user'] as { folders: unknown[] };
      expect(stored.folders).toHaveLength(9);
    });

    it('loads a saved store for the active user', async () => {
      store['memory_files_v1_alice'] = {
        version: 1,
        folders: [{ id: 'f1', name: 'notes', order: 0 }],
        files: [{ id: 'x', folderId: 'f1', name: 'a.md', content: 'hello', enabled: true, createdAt: 1, updatedAt: 1 }],
      };
      await initMemoryFiles('alice');
      expect(getMemoryFiles().folders.map(f => f.name)).toEqual(['notes']);
      expect(findFile('a.md')?.content).toBe('hello');
    });

    it('a corrupt blob is NEVER overwritten by the seed — missing key is the only case allowed to write', async () => {
      // One torn byte in the stored notebook. Pre-fix, getPreferenceObject
      // returned null for this exactly as for a missing key, and the seed
      // branch ended in persist() — replacing the whole notebook with an
      // empty one at boot.
      store['memory_files_v1_carol'] = '{"version":1,"folders":[{"id":"f1","na';
      await initMemoryFiles('carol');
      // In-memory the app serves an empty seeded notebook so it keeps working…
      expect(getMemoryFiles().folders.map(f => f.name)).toContain('profile');
      // …but the bytes on disk are UNTOUCHED — the only copy of whatever the
      // user had survives for repair/restore.
      expect(store['memory_files_v1_carol']).toBe('{"version":1,"folders":[{"id":"f1","na');
      // And once the blob is repaired (e.g. restored from a backup), the next
      // boot loads it normally.
      store['memory_files_v1_carol'] = {
        version: 1,
        folders: [{ id: 'f1', name: 'notes', order: 0 }],
        files: [{ id: 'x', folderId: 'f1', name: 'recovered.md', content: 'back', enabled: true, createdAt: 1, updatedAt: 1 }],
      };
      await initMemoryFiles('carol');
      expect(findFile('recovered.md')?.content).toBe('back');
    });

    it('a parseable but non-notebook blob is also left untouched', async () => {
      store['memory_files_v1_dave'] = '"just a string"';
      await initMemoryFiles('dave');
      expect(store['memory_files_v1_dave']).toBe('"just a string"');
    });
  });

  describe('CRUD', () => {
    it('creates and persists a folder (slugified)', async () => {
      const folder = await createMemoryFolder('My Notes!', 'test-user');
      expect(folder.name).toBe('my-notes');
      await initMemoryFiles('test-user');
      expect(getMemoryFiles().folders.some(f => f.name === 'my-notes')).toBe(true);
    });

    it('returns the existing folder for duplicate names (idempotent)', async () => {
      const first = await createMemoryFolder('rules', 'test-user');
      const second = await createMemoryFolder('rules', 'test-user');
      expect(second.id).toBe(first.id);
      await initMemoryFiles('test-user');
      expect(getMemoryFiles().folders.filter(f => f.name === 'rules')).toHaveLength(1);
    });

    it('deletes a folder and all its files', async () => {
      const folder = await createMemoryFolder('temp', 'test-user');
      await createMemoryFile(folder.id, 'note.md', 'x', 'test-user');
      await deleteMemoryFolder(folder.id, 'test-user');
      const { folders, files } = getMemoryFiles();
      expect(folders.some(f => f.id === folder.id)).toBe(false);
      expect(files.some(f => f.folderId === folder.id)).toBe(false);
    });

    it('renames a folder (slugified) and persists', async () => {
      const folder = await createMemoryFolder('temp', 'test-user');
      const clean = await renameMemoryFolder(folder.id, 'My New Name!', 'test-user');
      expect(clean).toBe('my-new-name');
      await initMemoryFiles('test-user');
      expect(getMemoryFiles().folders.some(f => f.name === 'my-new-name')).toBe(true);
    });

    it('rejects renaming to an existing folder name', async () => {
      const folder = await createMemoryFolder('temp', 'test-user');
      await expect(renameMemoryFolder(folder.id, 'rules', 'test-user')).rejects.toThrow('already exists');
    });

    it('moves a folder and keeps order values sequential', async () => {
      const { folders } = getMemoryFiles(); // profile(0) trader-diary(1) market-conditions(2) rules(3)
      const rules = folders.find(f => f.name === 'rules')!;
      await moveMemoryFolder(rules.id, 1, 'test-user');
      const after = getMemoryFiles().folders;
      expect(after.map(f => f.name)).toEqual(['profile', 'rules', 'trader-diary', 'market-conditions', 'skills', 'bots', 'lens', 'settled-beliefs', 'distilled']);
      expect(after.map(f => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      // Persists across reload.
      await initMemoryFiles('test-user');
      expect(getMemoryFiles().folders.map(f => f.name)).toEqual(['profile', 'rules', 'trader-diary', 'market-conditions', 'skills', 'bots', 'lens', 'settled-beliefs', 'distilled']);
    });

    it('clamps out-of-range move targets', async () => {
      const { folders } = getMemoryFiles();
      await moveMemoryFolder(folders[0].id, 99, 'test-user');
      expect(getMemoryFiles().folders.map(f => f.name)).toEqual(['trader-diary', 'market-conditions', 'rules', 'skills', 'bots', 'lens', 'settled-beliefs', 'distilled', 'profile']);
    });

    it('creates files with a forced .md extension', async () => {
      const folder = getMemoryFiles().folders.find(f => f.name === 'rules')!;
      const file = await createMemoryFile(folder.id, 'my-note', 'content', 'test-user');
      expect(file.name).toBe('my-note.md');
    });

    it('rejects duplicate file names within a folder', async () => {
      const folder = getMemoryFiles().folders.find(f => f.name === 'rules')!;
      await createMemoryFile(folder.id, 'a.md', 'x', 'test-user');
      await expect(createMemoryFile(folder.id, 'a.md', 'y', 'test-user')).rejects.toThrow('already exists');
    });

    it('updates content and toggles enabled', async () => {
      const folder = getMemoryFiles().folders.find(f => f.name === 'rules')!;
      const file = await createMemoryFile(folder.id, 'a.md', 'x', 'test-user');
      await updateMemoryFile(file.id, { content: 'y', enabled: false }, 'test-user');
      const updated = findFile('a.md')!;
      expect(updated.content).toBe('y');
      expect(updated.enabled).toBe(false);
    });

    it('deletes a single file', async () => {
      const folder = getMemoryFiles().folders.find(f => f.name === 'rules')!;
      const file = await createMemoryFile(folder.id, 'a.md', 'x', 'test-user');
      await deleteMemoryFile(file.id, 'test-user');
      expect(findFile('a.md')).toBeUndefined();
    });
  });

  describe('getMemoryFilesContext (injection)', () => {
    it('returns empty when nothing is enabled', async () => {
      // Disable every seeded file.
      for (const f of getMemoryFiles().files) await updateMemoryFile(f.id, { enabled: false }, 'test-user');
      expect(getMemoryFilesContext()).toBe('');
      expect(getMemoryFilesStats()).toEqual({ enabledCount: 0, charCount: 0 });
    });

    it('injects the ranked slices: identity, risk-rules bullets (budget layout)', async () => {
      const ctx = getMemoryFilesContext();
      expect(ctx).toContain('[profile/memory.md]'.replace('profile/memory.md', 'rules/risk-rules.md'));
      // risk-rules injects its bullet lines, not the instructional preamble.
      expect(ctx).not.toContain('Personal Risk Rules');
      // Disabling the file removes its slice.
      const rules = findFile('risk-rules.md')!;
      await updateMemoryFile(rules.id, { enabled: false }, 'test-user');
      expect(getMemoryFilesContext()).not.toContain('[rules/risk-rules.md]');
      await updateMemoryFile(rules.id, { enabled: true }, 'test-user');
    });

    it('orders profile files first', async () => {
      await syncProfileMemory(makeProfile(), 'test-user');
      const ctx = getMemoryFilesContext();
      expect(ctx.indexOf('[profile/memory.md]')).toBeLessThan(ctx.indexOf('[rules/'));
    });

    it('never injects diary content — it is raw storage', async () => {
      await appendDiaryEntry(makeTrade(), 'test-user');
      const ctx = getMemoryFilesContext({ coin: 'BTCUSDT' });
      expect(ctx).not.toContain('WIN ✅');
      expect(ctx).not.toContain('Wait for the 15m reclaim before entering.');
      // The diary file still exists on disk for doctrine/skill gates.
      expect(findFile('BTCUSDT.md', 'trader-diary')).toBeTruthy();
    });

    it('does not dump the pattern-memory essay', async () => {
      await syncPatternMemory('Executive Summary\nHuge dump of all trades.\n', 'test-user');
      const ctx = getMemoryFilesContext();
      expect(ctx).not.toContain('[profile/pattern-memory.md]');
    });

    it('does not dump suggestions.md', async () => {
      const folder = getMemoryFiles().folders.find(f => f.name === 'profile')!;
      await createMemoryFile(folder.id, SUGGESTIONS_FILE_NAME, '# Suggestions\nMerge the two range files.', 'test-user', true);
      const ctx = getMemoryFilesContext();
      expect(ctx).not.toContain('[profile/suggestions.md]');
    });

    it('frames memory as own-knowledge with the recall pointer', () => {
      const ctx = getMemoryFilesContext();
      expect(ctx).toContain('MY MEMORY');
      expect(ctx).toContain('recall');
      expect(ctx).not.toMatch(/MUST cite|MUST reference/i);
    });

    it('cold-start context is empty, not a map dump (recall tool covers discovery)', () => {
      // No query → no matched skill/mistakes → only identity +
      // risk rules. A brand-new notebook with no profile yields ''.
      const ctx = getMemoryFilesContext();
      expect(ctx).not.toContain('NOTEBOOK MAP');
      expect(findFile('index.md', 'profile')?.content).toContain('NOTEBOOK MAP'); // map still maintained on disk
    });

    it('coin query pulls the ranked slices, never the diary (progressive disclosure via recall)', async () => {
      await appendDiaryEntry(makeTrade(), 'test-user');
      const ctx = getMemoryFilesContext({ coin: 'BTCUSDT' });
      expect(ctx).not.toContain('NOTEBOOK MAP');
      expect(ctx).not.toContain('trader-diary/');
    });
  });

  describe('appendDiaryEntry', () => {
    it('creates trader-diary/<coin>.md and appends the entry', async () => {
      await appendDiaryEntry(makeTrade(), 'test-user');
      const file = findFile('BTCUSDT.md', 'trader-diary')!;
      expect(file.autoManaged).toBe(true);
      expect(file.content).toContain('# BTCUSDT Trade Diary');
      expect(file.content).toContain('Aug 9 · BTCUSDT · Short · WIN ✅ (+3.2%)');
      expect(file.content).toContain('What I learned: Wait for the 15m reclaim before entering.');
      expect(file.content).toContain('id: trade-1');
    });

    it('does not duplicate a diary entry for the same trade id', async () => {
      await appendDiaryEntry(makeTrade(), 'test-user');
      await appendDiaryEntry(makeTrade(), 'test-user');
      const file = findFile('BTCUSDT.md', 'trader-diary')!;
      expect(file.content.split('id: trade-1').length - 1).toBe(1);
    });

    it('skips pending and entry-not-hit trades', async () => {
      await appendDiaryEntry(makeTrade({ outcome: TradeOutcome.PENDING }), 'test-user');
      await appendDiaryEntry(makeTrade({ outcome: TradeOutcome.ENTRY_NOT_HIT }), 'test-user');
      expect(findFile('BTCUSDT.md', 'trader-diary')).toBeUndefined();
    });

    it('appends to the existing file and trims to the newest 50 entries', async () => {
      for (let i = 0; i < 55; i++) {
        await appendDiaryEntry(makeTrade({ id: `t-${i}`, pnlPercent: i }), 'test-user');
      }
      const file = findFile('BTCUSDT.md', 'trader-diary')!;
      const entries = file.content.split('\n## ').slice(1);
      expect(entries).toHaveLength(50);
      expect(entries[entries.length - 1]).toContain('(+54%)');
    });

    it('falls back to a General diary when the coin name is missing', async () => {
      await appendDiaryEntry(makeTrade({ analysis: {} as any }), 'test-user');
      expect(findFile('General.md', 'trader-diary')).toBeDefined();
    });
  });

  describe('extractLessonFromPostMortem', () => {
    it('extracts a labeled lesson line', () => {
      expect(extractLessonFromPostMortem('**Key Lesson:** Wait for the 15m reclaim.\nThen more text.')).toBe('Wait for the 15m reclaim.');
    });
    it('returns empty for empty input', () => {
      expect(extractLessonFromPostMortem('')).toBe('');
    });
  });

  describe('syncProfileMemory', () => {
    it('writes profile/memory.md from the profile data', async () => {
      await syncProfileMemory(makeProfile(), 'test-user');
      const file = findFile('memory.md', 'profile')!;
      expect(file.autoManaged).toBe(true);
      expect(file.content).toContain('**Trader:** rober');
      expect(file.content).toContain('**Trades logged:** 2 (1 win / 1 loss');
      expect(file.content).toContain('**Win rate:** 50%');
      expect(file.content).toContain('**Favorite assets:** BTCUSDT (2)');
      expect(file.content).toContain('**Default leverage:** 5x');
    });

    it('regenerates on re-sync (no duplicate content)', async () => {
      await syncProfileMemory(makeProfile(), 'test-user');
      await syncProfileMemory(makeProfile(), 'test-user');
      const file = findFile('memory.md', 'profile')!;
      expect(file.content.match(/\*\*Trader:\*\*/g)).toHaveLength(1);
    });
  });

  describe('syncPatternMemory', () => {
    it('writes profile/pattern-memory.md as markdown', async () => {
      await syncPatternMemory('Executive Summary\nTrades look mixed.\n\nMissed Win Analysis\nNone.\n\nConclusion\nStay selective.', 'test-user');
      const file = findFile('pattern-memory.md', 'profile')!;
      expect(file.autoManaged).toBe(true);
      expect(file.content).toContain('# Pattern Memory');
      expect(file.content).toContain('## Executive Summary');
      expect(file.content).toContain('## Conclusion');
      expect(file.content).toContain('skills/');
      expect(file.content).not.toContain('## Missed Win Analysis');
    });

    it('includes closed-trade stats when a log is passed', async () => {
      await syncPatternMemory('Executive Summary\nOk.\n\nConclusion\nDone.', 'test-user', [
        makeTrade({ outcome: TradeOutcome.WIN }),
        makeTrade({ outcome: TradeOutcome.LOSS }),
      ]);
      const file = findFile('pattern-memory.md', 'profile')!;
      expect(file.content).toContain('**Closed trades:** 2 (1 win / 1 loss)');
      expect(file.content).toContain('**Win rate:** 50%');
    });

    it('writes a stub when the synthesis is empty', async () => {
      await syncPatternMemory(null, 'test-user');
      const file = findFile('pattern-memory.md', 'profile')!;
      expect(file.content).toContain('Log more trades');
    });
  });

  describe('toPatternMemoryMarkdown', () => {
    it('rebuilds chrome instead of leaving a titled document untouched', () => {
      const md = toPatternMemoryMarkdown('# Pattern Memory\n\nAlready a file.\n');
      expect(md).toContain('# Pattern Memory');
      expect(md).toContain('Already a file.');
      expect(md).toContain('See also:');
    });
  });

  describe('getMemoryFilesIndex', () => {
    it('lists every folder and file with name, size and excerpt', async () => {
      await syncProfileMemory(makeProfile(), 'test-user');
      await appendDiaryEntry(makeTrade(), 'test-user');
      const index = getMemoryFilesIndex();
      expect(index).toContain('📁 profile/');
      expect(index).toContain('memory.md');
      expect(index).toContain('📁 trader-diary/');
      expect(index).toContain('BTCUSDT.md');
      expect(index).toContain('📁 rules/');
      expect(index).toContain('risk-rules.md');
      expect(index).toContain('**Graph**');
    });

    it('reports an empty notebook', async () => {
      for (const f of getMemoryFiles().files) await deleteMemoryFile(f.id, 'test-user');
      expect(getMemoryFilesIndex()).toContain('empty notebook');
    });
  });

  describe('writeModelNote (AI writer)', () => {
    it('creates a new folder when the model picks a topic with no home', async () => {
      const file = await writeModelNote(
        { folder: 'session-timing', fileName: 'asia-session.md', content: '# Asia Session\nWhen I trade Asia…' },
        'test-user'
      );
      expect(file.autoManaged).toBe(true);
      const { folders, files } = getMemoryFiles();
      expect(folders.some(f => f.name === 'session-timing')).toBe(true);
      expect(files.some(f => f.id === file.id && f.name === 'asia-session.md')).toBe(true);
    });

    it('reuses an existing folder when the name matches', async () => {
      await writeModelNote({ folder: 'rules', fileName: 'never-avg-down.md', content: '# Rule\nNever average down.' }, 'test-user');
      const folders = getMemoryFiles().folders;
      expect(folders.filter(f => f.name === 'rules')).toHaveLength(1);
      expect(findFile('never-avg-down.md', 'rules')).toBeDefined();
    });

    it('never overwrites an existing file — suffixes -2, -3…', async () => {
      const note = { folder: 'lessons', fileName: 'same-lesson.md', content: '# Lesson\nFirst.' };
      await writeModelNote(note, 'test-user');
      await writeModelNote({ ...note, content: '# Lesson\nSecond.' }, 'test-user');
      expect(findFile('same-lesson.md', 'lessons')?.content).toContain('First.');
      const second = findFile('same-lesson-2.md', 'lessons')!;
      expect(second.content).toContain('Second.');
      // The folder was auto-created too.
      expect(getMemoryFiles().folders.some(f => f.name === 'lessons')).toBe(true);
    });

    it('appends a new section to an existing file instead of duplicating it', async () => {
      // First write creates the file (create decision).
      await writeModelNote({ decision: 'create', folder: 'lessons', fileName: 'sweep-reclaim.md', content: '# Sweep Reclaim\nFirst version.' }, 'test-user');
      // Second write with the same topic appends to it (append decision).
      const file = await writeModelNote({ decision: 'append', folder: 'lessons', fileName: 'sweep-reclaim.md', content: '## Asia Session Variant\nSecond insight.' }, 'test-user');
      expect(file.name).toBe('sweep-reclaim.md');
      expect(file.content).toContain('# Sweep Reclaim\nFirst version.');
      expect(file.content).toContain('---');
      expect(file.content).toContain('## Asia Session Variant');
      // No duplicate file was created.
      expect(findFile('sweep-reclaim-2.md', 'lessons')).toBeUndefined();
    });

    it('append fuzzy-matches a similarly named file in the same folder', async () => {
      await writeModelNote({ decision: 'create', folder: 'market-conditions', fileName: 'range-day.md', content: '# Range Day\nOriginal.' }, 'test-user');
      // Model names it slightly differently ('range-days') — still appends to
      // the existing range-day.md (one name contains the other).
      const file = await writeModelNote({ decision: 'append', folder: 'market-conditions', fileName: 'range-days.md', content: '## Extra\nMore.' }, 'test-user');
      expect(file.name).toBe('range-day.md');
      expect(file.content).toContain('## Extra');
    });

    it('append REJECTS harness-regenerated files but allows model notes', async () => {
      // profile/memory.md is rewritten wholesale by syncProfileMemory — an
      // append would be silently clobbered, so the write must fail visibly.
      const profileFolder = getMemoryFiles().folders.find(f => f.name === 'profile')!;
      await createMemoryFile(profileFolder.id, 'memory.md', '# Profile\nseed', 'test-user', true);
      await expect(writeModelNote(
        { decision: 'append', folder: 'profile', fileName: 'memory', content: '## Rogue note' },
        'test-user',
      )).rejects.toThrow(/harness-managed/);
      // lens/macro.md — same story for the seat memory files.
      const lensFolder = getMemoryFiles().folders.find(f => f.name === 'lens')!;
      await createMemoryFile(lensFolder.id, 'macro.md', '# Macro lens\nseed', 'test-user', true);
      await expect(writeModelNote(
        { decision: 'append', folder: 'lens', fileName: 'macro.md', content: '## Rogue' },
        'test-user',
      )).rejects.toThrow(/harness-managed/);
      // trader-diary is the harness's own namespace — model notes are banned
      // at the folder level (a stem-miss would otherwise silently create one).
      await expect(writeModelNote(
        { decision: 'append', folder: 'trader-diary', fileName: 'BTC', content: '## Rogue' },
        'test-user',
      )).rejects.toThrow(/harness-owned/);
      // A model note (lessons/, autoManaged but NOT regenerated) still appends.
      await writeModelNote({ decision: 'create', folder: 'lessons', fileName: 'keep-appendable.md', content: '# First' }, 'test-user');
      const ok = await writeModelNote({ decision: 'append', folder: 'lessons', fileName: 'keep-appendable.md', content: '## Second' }, 'test-user');
      expect(ok.content).toContain('## Second');
    });

    it('append falls back to creating the file when the target does not exist', async () => {
      const file = await writeModelNote({ decision: 'append', folder: 'rules', fileName: 'new-rule.md', content: '# New Rule\nBody.' }, 'test-user');
      expect(file.name).toBe('new-rule.md');
      expect(file.content).toContain('# New Rule');
    });

    it('sanitizes names and rejects empty content', async () => {
      const file = await writeModelNote(
        { folder: 'My Topic!', fileName: 'Range Day', content: 'Some note.' },
        'test-user'
      );
      expect(file.name).toBe('range-day.md');
      expect(getMemoryFiles().folders.some(f => f.name === 'my-topic')).toBe(true);
      await expect(writeModelNote({ folder: 'x', fileName: 'y', content: '   ' }, 'test-user')).rejects.toThrow('content is empty');
    });

    it('falls back to lessons/note.md for garbage names', async () => {
      const file = await writeModelNote({ folder: '!!!', fileName: '???', content: 'Note.' }, 'test-user');
      expect(getMemoryFiles().folders.some(f => f.name === 'lessons')).toBe(true);
      expect(file.name).toBe('note.md');
    });
  });

  describe('computeTopLessons', () => {
    it('clusters 2+ trades per coin+direction, losses first, then wins by count', () => {
      const lessons = computeTopLessons([
        makeTrade({ id: 'w1', outcome: TradeOutcome.WIN, pnlPercent: 2.0 }),
        makeTrade({ id: 'w2', outcome: TradeOutcome.WIN, pnlPercent: 4.0 }),
        makeTrade({ id: 'l1', outcome: TradeOutcome.LOSS, pnlPercent: -2.4 }),
        makeTrade({ id: 'l2', outcome: TradeOutcome.LOSS, pnlPercent: -1.6 }),
        makeTrade({ id: 'solo', outcome: TradeOutcome.WIN, pnlPercent: 1.0, analysis: { coinName: 'ETHUSDT', direction: 'Long' } as any }),
      ]);
      expect(lessons).toHaveLength(2);
      expect(lessons[0].kind).toBe('loss');
      expect(lessons[0].label).toBe('BTCUSDT Short');
      expect(lessons[0].count).toBe(2);
      expect(lessons[0].avgPnl).toBeCloseTo(-2.0);
      expect(lessons[1].kind).toBe('win');
      expect(lessons[1].count).toBe(2);
      // Single-trade clusters are ignored.
      expect(lessons.some(l => l.label.includes('ETHUSDT'))).toBe(false);
    });

    it('excludes pending and entry-not-hit trades', () => {
      const lessons = computeTopLessons([
        makeTrade({ id: 'p', outcome: TradeOutcome.PENDING }),
        makeTrade({ id: 'e', outcome: TradeOutcome.ENTRY_NOT_HIT }),
        makeTrade({ id: 'w1', outcome: TradeOutcome.WIN }),
        makeTrade({ id: 'w2', outcome: TradeOutcome.WIN }),
      ]);
      expect(lessons).toHaveLength(1);
      expect(lessons[0].kind).toBe('win');
    });
  });

  describe('syncRecurringMistakes', () => {
    it('detects loss clusters of 2+ on the same coin + direction', async () => {
      await syncRecurringMistakes([
        makeTrade({ id: 'l1', outcome: TradeOutcome.LOSS, pnlPercent: -1.8 }),
        makeTrade({ id: 'l2', outcome: TradeOutcome.LOSS, pnlPercent: -2.4 }),
        makeTrade({ id: 'w1', outcome: TradeOutcome.WIN, pnlPercent: 2.0 }),
      ], 'test-user');
      const file = findFile('recurring-mistakes.md', 'rules')!;
      expect(file.content).toContain('**2× BTCUSDT Short**');
      expect(file.content).toContain('avg -2.1%');
    });

    it('writes a placeholder when no clusters exist yet', () => {
      const content = buildRecurringMistakesContent([makeTrade({ outcome: TradeOutcome.LOSS, pnlPercent: -1 })]);
      expect(content).toContain('No recurring loss clusters yet');
    });
  });

  // Profile-switch race (deep-dive 2026-09-15 item 1): one module-global
  // cache must always persist to the key that OWNS the cached bytes — never
  // to the username a writer captured before the switch.
  describe('cache-owner persistence (profile switch mid-write)', () => {
    it('a stale writer for user A lands the data in the cache owner\'s (B) key, never A key', async () => {
      await initMemoryFiles('alice');
      await initMemoryFiles('bob'); // cache now holds BOB's notebook

      // A writer that captured the OLD username mutates the shared cache.
      await createMemoryFolder('post-switch', 'alice');

      const bobBlob = store['memory_files_v1_bob'] as { folders: { name: string }[] };
      const aliceBlob = store['memory_files_v1_alice'] as { folders: { name: string }[] };
      expect(bobBlob.folders.map(f => f.name)).toContain('post-switch');
      expect(aliceBlob.folders.map(f => f.name)).not.toContain('post-switch');
    });

    it('empty-store clearing targets the cache owner key, not the caller username', async () => {
      await initMemoryFiles('carol');
      await initMemoryFiles('dave');
      for (const f of [...getMemoryFiles().folders]) await deleteMemoryFolder(f.id, 'carol');
      // The writers captured 'carol' but the cache is owned by dave → dave's
      // key is the one emptied; carol's seed stays intact.
      expect(store['memory_files_v1_dave']).toBeUndefined();
      expect(store['memory_files_v1_carol']).toBeDefined();
    });

    it('initMemoryFiles is serialized behind an in-flight writer', async () => {
      await initMemoryFiles('erin');
      let release: () => void = () => undefined;
      const gate = new Promise<void>(res => { release = res; });
      // Hold the write lock with a running mutation…
      const writer = withNotebookWriteLock(async () => {
        await gate;
        const rules = getMemoryFiles().folders.find(f => f.name === 'rules')!;
        await createMemoryFileUnlocked(rules.id, 'during-switch.md', 'x', 'erin');
      });
      await Promise.resolve(); // let the writer enter the lock
      // …then request the profile switch. It must QUEUE, not jump the cache swap.
      const switcher = initMemoryFiles('flora');
      release();
      await Promise.all([writer, switcher]);

      // Erin's write persisted to ERIN's key (the cache was still erin's while
      // the writer ran); Flora's seed landed in FLORA's key only. Before the
      // init lock, the swap could race the writer and land flora's notebook
      // under erin's key (or vice versa).
      const erinBlob = store['memory_files_v1_erin'] as { files: { name: string }[] };
      const floraBlob = store['memory_files_v1_flora'] as { files: { name: string }[] };
      expect(erinBlob.files.map(f => f.name)).toContain('during-switch.md');
      expect(floraBlob.files.map(f => f.name)).not.toContain('during-switch.md');
      expect(getMemoryFilesOwner()).toBe('flora');
    });

    it('an unlocked persist racing an in-flight init writes the OLD owner key, never the new one', async () => {
      // The memoryCacheOwner must be assigned ATOMICALLY with the cache
      // swap. Pre-fix, init stamped the new username as owner BEFORE the
      // storage read — while B's init was in flight the cache still held
      // A's bytes under B's ownership, so any unlocked concurrent persist
      // (the old ensureHarnessFoldersUnlocked-in-syncClosedTradeToNotebook
      // shape) flushed A's stale notebook into B's Preferences key.
      await initMemoryFiles('gina');
      const getMock = vi.mocked(getPreference);
      const originalImpl = getMock.getMockImplementation() as
          ((key: string) => Promise<string | null>) | undefined;
      let release: () => void = () => undefined;
      const loadGate = new Promise<void>(res => { release = res; });
      getMock.mockImplementation((async (key: string) => {
        if (key === 'memory_files_v1_hal') { await loadGate; return null; }
        return originalImpl ? originalImpl(key) : null;
      }) as never);
      try {
        const halInit = initMemoryFiles('hal');
        // Let init enter the gated getPreference await. The cache now
        // still holds GINA's bytes — and must still be owned by GINA.
        await new Promise(res => setTimeout(res, 0));
        expect(getMemoryFilesOwner()).toBe('gina');

        // Unlocked concurrent persist mid-init (simulates a caller that
        // mutated the shared cache without holding the notebook lock).
        const rules = getMemoryFiles().folders.find(f => f.name === 'rules')!;
        await createMemoryFileUnlocked(rules.id, 'racy.md', 'x', 'gina');
        const ginaBlob = store['memory_files_v1_gina'] as { files: { name: string }[] };
        expect(ginaBlob.files.map(f => f.name)).toContain('racy.md');

        release();
        await halInit;
        expect(getMemoryFilesOwner()).toBe('hal');
        const halBlob = store['memory_files_v1_hal'] as { files: { name: string }[] };
        // Hal's key only ever received HAL's own seed — never Gina's bytes.
        expect(halBlob.files.map(f => f.name)).not.toContain('racy.md');
        const racyGina = (store['memory_files_v1_gina'] as { files: { name: string }[] }).files;
        expect(racyGina.map(f => f.name)).toContain('racy.md');
      } finally {
        getMock.mockImplementation((originalImpl ?? (async () => null)) as never);
      }
    });
  });
});
