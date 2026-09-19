/**
 * WS-2.3 — "the model approves; the user can still delete" is only true if the
 * hard move is reachable where the skill is actually read, and the reason the
 * supervisor gave survives the session. Both were missing: the detail pane
 * offered a retire toggle and nothing else, and whyAccepted was persisted but
 * rendered by no component at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import SkillDetail, { deleteSkillFile, type SkillCardData } from '../components/skills/SkillDetail';
import type { SkillMeta } from '../services/learning/SkillMemoryService';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';

const USER = 'skill-detail-user';

const card = (over: Partial<SkillCardData> = {}): SkillCardData => ({
    fileId: 'f1',
    name: 'Avoid BTC short after a reclaimed sweep',
    meta: {
        status: 'candidate',
        kind: 'avoid',
        wins: 0,
        losses: 0,
        whyAccepted: 'Five closed trades share the shape and nothing contradicts it.',
    } as SkillMeta,
    body: '# Avoid BTC short\n\n**When:** sweep reclaimed\n**What I do:** skip.',
    ...over,
});

beforeEach(async () => {
    store = {};
    localStorage.clear();
    await initMemoryFiles(USER);
});

afterEach(cleanup);

describe('SkillDetail — the human keeps the hard move', () => {
    it('asks twice before deleting, and only calls back on the second press', () => {
        const onDelete = vi.fn();
        render(<SkillDetail skill={card()} onBack={() => {}} onToggleRetire={() => {}} onDelete={onDelete} />);
        const btn = screen.getByTestId('skill-delete');
        fireEvent.click(btn);
        expect(onDelete).not.toHaveBeenCalled();
        expect(btn.textContent).toBe('Confirm delete');
        fireEvent.click(btn);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('shows no delete affordance when the caller cannot delete', () => {
        render(<SkillDetail skill={card()} onBack={() => {}} onToggleRetire={() => {}} />);
        expect(screen.queryByTestId('skill-delete')).toBeNull();
    });

    it('renders the supervisor reason that was persisted on the file', () => {
        render(<SkillDetail skill={card()} onBack={() => {}} onToggleRetire={() => {}} onDelete={() => {}} />);
        expect(screen.getByText('Why it was accepted')).toBeTruthy();
        expect(screen.getByText('Five closed trades share the shape and nothing contradicts it.')).toBeTruthy();
    });

    it('says so when no reason was recorded, rather than showing an empty slot', () => {
        render(<SkillDetail skill={card({ meta: { status: 'candidate', kind: 'avoid', wins: 0, losses: 0 } as SkillMeta })}
            onBack={() => {}} onToggleRetire={() => {}} onDelete={() => {}} />);
        expect(screen.queryByText('Why it was accepted')).toBeNull();
    });
});

describe('deleteSkillFile', () => {
    it('removes the skill from the notebook for good', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const file = await createMemoryFile(skills.id, 'btc-sweep-skip.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 2
losses: 0
ifCondition: BTC short into a reclaimed sweep
thenAction: skip the short
tradeIds: a,b,c
---

# Avoid BTC short

**When:** BTC short into a reclaimed sweep
**What I do:** skip.
`, USER, true);
        expect(getMemoryFiles().files.some(f => f.id === file.id)).toBe(true);

        await deleteSkillFile({ fileId: file.id, name: 'btc-sweep-skip', meta: null, body: file.content });

        expect(getMemoryFiles().files.some(f => f.id === file.id)).toBe(false);
    });
});
