/**
 * E-51 Phase 1 — `ModelMenu` as a panel, with nothing wired to it.
 *
 * The point of the phase is that the panel can be pinned BEFORE any surface
 * changes, so every assertion here is about the control the composer is about
 * to gain: one place that names the provider, lists only that provider's
 * models, and sets the thinking tier that decides whether the provider returns
 * real reasoning at all.
 *
 * Mounting only. Nothing in `components/` or `App.tsx` imports this component
 * yet (Phase 2 does that), so a regression here cannot reach the trader — and a
 * defect found here is cheaper than one found in a composer.
 *
 * Rows are addressed by `data-testid="model-row-<providerId>::<modelId>"` rather than by
 * their visible text on purpose: `formatModelDisplayName` pretty-prints the
 * slug ("deepseek-chat" → "Deepseek Chat"), and a test that hardcodes the
 * pretty form breaks when the pretty-printer is corrected.
 */
import React, { useEffect, useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import ModelMenu, { type ModelMenuAnchor } from '../components/shared/ModelMenu';
import type { EffortChoice } from '../components/shared/effortScale';
import type { ProviderConfig } from '../types/provider';
import { FREE_ONLY_STORAGE_KEY, STARRED_MODELS_KEY } from '../utils/providerUtils';

const anchor: ModelMenuAnchor = { top: 600, bottom: 632, left: 40, right: 200 };

const mkProvider = (over: Partial<ProviderConfig> & { id: string }): ProviderConfig => ({
    name: over.id,
    apiKey: 'sk-test',
    baseUrl: 'https://x.test/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: [],
    selectedModel: '',
    ...over,
} as ProviderConfig);

const PROVIDERS: ProviderConfig[] = [
    mkProvider({ id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] }),
    mkProvider({ id: 'openrouter', name: 'OpenRouter', models: ['xiaomi/mimo-v2-flash:vision', 'tencent/hy3:free'] }),
    mkProvider({ id: 'keyless', name: 'Keyless One', apiKey: '', isEnabled: false, models: ['ghost-model'] }),
];

/** Rows are keyed by the pair, because a model id on its own is not unique
 *  across providers — the same slug on two providers is two choices. */
const rowOf = (providerId: string, modelId: string): HTMLElement =>
    screen.getByTestId(`model-row-${providerId}::${modelId}`);
const pickButton = (providerId: string, modelId: string): HTMLElement =>
    within(rowOf(providerId, modelId)).getByRole('menuitemradio');

interface HarnessProps {
    effort?: EffortChoice;
    showEffort?: boolean;
    onEffort?: (id: EffortChoice) => void;
    onPick?: (v: string) => void;
    appShortcut?: (e: Event) => void;
}

/** A trigger that opens and closes the panel, so focus return is a real unmount
 *  rather than a prop flip. */
const Harness: React.FC<HarnessProps> = ({ effort = 'auto', showEffort = true, onEffort, onPick, appShortcut }) => {
    const [open, setOpen] = useState(true);
    const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (!appShortcut) return;
        // The app-level handler the plan is afraid of: a bare Escape that
        // CANCELS A RUNNING ANALYSIS while the trader only closed a menu.
        document.addEventListener('keydown', appShortcut);
        return () => document.removeEventListener('keydown', appShortcut);
    }, [appShortcut]);
    return (
        <div>
            <button ref={setTrigger} type="button" onClick={() => setOpen(true)}>trigger</button>
            {open && (
                <ModelMenu
                    providers={PROVIDERS}
                    value="deepseek::deepseek-chat"
                    onChange={(v) => { onPick?.(v); setOpen(false); }}
                    effort={effort}
                    onEffortChange={onEffort}
                    showEffort={showEffort}
                    onRefreshModels={() => {}}
                    onManageProviders={() => {}}
                    anchor={anchor}
                    onClose={() => setOpen(false)}
                    returnFocusTo={trigger}
                />
            )}
        </div>
    );
};

beforeEach(() => {
    localStorage.removeItem(STARRED_MODELS_KEY);
    localStorage.removeItem(FREE_ONLY_STORAGE_KEY);
});

describe('ModelMenu — the models section', () => {
    it('names the active provider on the header row and says API', () => {
        render(<Harness />);
        const row = screen.getByTestId('model-menu-provider-row');
        expect(row.textContent).toContain('DeepSeek');
        expect(row.textContent).toContain('API');
        expect(row.getAttribute('aria-haspopup')).toBe('menu');
        expect(row.getAttribute('aria-expanded')).toBe('false');
    });

    it('lists the active provider\'s models ONLY, and a provider with no key is not offered', () => {
        render(<Harness />);
        expect(rowOf('deepseek', 'deepseek-chat')).toBeTruthy();
        expect(rowOf('deepseek', 'deepseek-reasoner')).toBeTruthy();
        expect(screen.queryByTestId('model-row-openrouter::tencent/hy3:free')).toBeNull();
        expect(screen.queryByTestId('model-row-keyless::ghost-model')).toBeNull();
    });

    it('badges the vision model and the free model, and checks the selected row', () => {
        render(<Harness />);
        expect(pickButton('deepseek', 'deepseek-chat').getAttribute('aria-checked')).toBe('true');
        expect(pickButton('deepseek', 'deepseek-reasoner').getAttribute('aria-checked')).toBe('false');
        expect(within(rowOf('deepseek', 'deepseek-chat')).queryByText('Vision')).toBeNull();
        fireEvent.click(screen.getByTestId('model-menu-provider-row'));
        fireEvent.click(within(screen.getByTestId('model-menu-providers'))
            .getByRole('menuitemradio', { name: /OpenRouter/ }));
        expect(within(rowOf('openrouter', 'xiaomi/mimo-v2-flash:vision')).getByText('Vision')).toBeTruthy();
        expect(within(rowOf('openrouter', 'tencent/hy3:free')).getByText('free')).toBeTruthy();
        // Nothing from the old provider is left in the list.
        expect(screen.queryByTestId('model-row-deepseek::deepseek-chat')).toBeNull();
    });

    it('stars a model, persists the pair id, and sorts it to the top', async () => {
        render(<Harness />);
        fireEvent.click(within(rowOf('deepseek', 'deepseek-reasoner')).getByRole('button', { name: /^Star / }));
        expect(JSON.parse(localStorage.getItem(STARRED_MODELS_KEY) ?? '[]')).toContain('deepseek::deepseek-reasoner');
        await waitFor(() => expect(screen.getByTestId('model-menu-rows').children[0])
            .toHaveAttribute('data-testid', 'model-row-deepseek::deepseek-reasoner'));
        // And it unstars to the stored list again.
        fireEvent.click(within(rowOf('deepseek', 'deepseek-reasoner')).getByRole('button', { name: /^Unstar / }));
        await waitFor(() => expect(JSON.parse(localStorage.getItem(STARRED_MODELS_KEY) ?? '[]')).toEqual([]));
    });

    it('the free-only toggle writes the SHARED pref every model menu reads', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('model-menu-free-only'));
        expect(localStorage.getItem(FREE_ONLY_STORAGE_KEY)).toBe('1');
        expect(screen.getByTestId('model-menu-free-only').getAttribute('aria-pressed')).toBe('true');
        // Neither DeepSeek model is free, so the list is now empty of them.
        expect(screen.queryByTestId('model-row-deepseek::deepseek-chat')).toBeNull();
    });
});

describe('ModelMenu — the provider panel', () => {
    it('opens on the row click, lists ready providers, and switches the list', () => {
        render(<Harness />);
        expect(screen.queryByTestId('model-menu-providers')).toBeNull();
        fireEvent.click(screen.getByTestId('model-menu-provider-row'));
        const panel = screen.getByTestId('model-menu-providers');
        expect(within(panel).getByRole('menuitemradio', { name: /DeepSeek/ })).toBeTruthy();
        expect(within(panel).getByRole('menuitemradio', { name: /OpenRouter/ })).toBeTruthy();
        expect(within(panel).queryByRole('menuitemradio', { name: /Keyless/ })).toBeNull();
        expect(screen.getByTestId('model-menu-provider-row').getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(within(panel).getByRole('menuitemradio', { name: /OpenRouter/ }));
        expect(screen.queryByTestId('model-menu-providers')).toBeNull();
        expect(rowOf('openrouter', 'tencent/hy3:free')).toBeTruthy();
    });

    it('offers ONE destination for provider config, not two', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('model-menu-provider-row'));
        const items = within(screen.getByTestId('model-menu-providers')).getAllByRole('menuitem');
        expect(items.map(el => el.textContent?.trim())).toEqual(['Manage providers']);
    });
});

describe('ModelMenu — the effort section', () => {
    it('is a six-stop slider that exposes the LABEL, not the index', () => {
        const onEffort = vi.fn();
        render(<Harness effort="high" onEffort={onEffort} />);
        const slider = screen.getByTestId('effort-slider');
        expect(slider.getAttribute('role')).toBe('slider');
        expect(slider.getAttribute('aria-valuemin')).toBe('0');
        expect(slider.getAttribute('aria-valuemax')).toBe('5');
        expect(slider.getAttribute('aria-valuenow')).toBe('4');
        expect(slider.getAttribute('aria-valuetext')).toBe('High');
        // The hint rides the accessible name, per docs/ui-doctrine.md: a key
        // shown only in a <kbd> is invisible to the reader this control is for.
        expect(slider.getAttribute('aria-label')).toMatch(/^Thinking effort \(/);
        expect(screen.getByTestId('model-menu-effort').textContent).toMatch(/Effort/);
        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(onEffort).toHaveBeenLastCalledWith('max');
        fireEvent.keyDown(slider, { key: 'ArrowLeft' });
        expect(onEffort).toHaveBeenLastCalledWith('medium');
        fireEvent.keyDown(slider, { key: 'Home' });
        expect(onEffort).toHaveBeenLastCalledWith('off');
        fireEvent.keyDown(slider, { key: 'End' });
        expect(onEffort).toHaveBeenLastCalledWith('max');
    });

    it('is absent for a bot turn, which answers on its own config', () => {
        render(<Harness showEffort={false} />);
        expect(screen.queryByTestId('model-menu-effort')).toBeNull();
        expect(screen.queryByTestId('effort-slider')).toBeNull();
        // The models section is untouched by the rule.
        expect(rowOf('deepseek', 'deepseek-chat')).toBeTruthy();
    });
});

describe('ModelMenu — the keyboard', () => {
    it('arrow keys move the active row, Home and End jump', () => {
        render(<Harness />);
        const menu = screen.getByTestId('model-menu');
        // Focus entered the panel on the SELECTED row.
        expect(document.activeElement).toBe(pickButton('deepseek', 'deepseek-chat'));
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(pickButton('deepseek', 'deepseek-reasoner'));
        fireEvent.keyDown(menu, { key: 'End' });
        expect(document.activeElement).toBe(pickButton('deepseek', 'deepseek-reasoner'));
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(pickButton('deepseek', 'deepseek-chat'));
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(pickButton('deepseek', 'deepseek-chat'));
    });

    it('Right opens the provider panel and Left closes it', () => {
        render(<Harness />);
        const menu = screen.getByTestId('model-menu');
        fireEvent.keyDown(menu, { key: 'ArrowRight' });
        expect(screen.getByTestId('model-menu-providers')).toBeTruthy();
        fireEvent.keyDown(menu, { key: 'ArrowLeft' });
        expect(screen.queryByTestId('model-menu-providers')).toBeNull();
        // The outer list is still there — Left closed the inner panel, not the menu.
        expect(menu).toBeTruthy();
    });

    it('Escape is contained: closing a menu must not cancel a running analysis', () => {
        const appShortcut = vi.fn();
        render(<Harness appShortcut={appShortcut} />);
        fireEvent.keyDown(screen.getByTestId('model-menu'), { key: 'Escape' });
        expect(appShortcut).not.toHaveBeenCalled();
    });

    it('Escape closes the INNER panel first', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('model-menu-provider-row'));
        fireEvent.keyDown(screen.getByTestId('model-menu'), { key: 'Escape' });
        expect(screen.queryByTestId('model-menu-providers')).toBeNull();
        expect(screen.getByTestId('model-menu')).toBeTruthy();
    });

    it('focus returns to the trigger when the panel closes', () => {
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'trigger' });
        expect(document.activeElement).not.toBe(trigger);
        fireEvent.keyDown(screen.getByTestId('model-menu'), { key: 'Escape' });
        expect(trigger).toHaveFocus();
    });

    it('picking a model writes the pair and closes', () => {
        const onPick = vi.fn();
        render(<Harness onPick={onPick} />);
        fireEvent.click(pickButton('deepseek', 'deepseek-reasoner'));
        expect(onPick).toHaveBeenCalledWith('deepseek::deepseek-reasoner');
        expect(screen.queryByTestId('model-menu')).toBeNull();
    });
});
