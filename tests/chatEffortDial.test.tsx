/**
 * The thinking-effort dial, shared by both chat homes.
 *
 * The Chart AI dock has had this chip for a long time; the Chat surface did not,
 * and the tier the dock showed was honoured by the dock's own transport while
 * the Chat surface's casual request hardcoded the task default. Two consequences,
 * both fixed here and both pinned below: a surface with no dial cannot ask for
 * reasoning it will later be shown as a text scratchpad, and a dial whose value
 * lives in one component's `useState` is a label that drifts the moment the other
 * home is opened (the dock unmounts on a surface switch).
 *
 * The chip's own behavior is rendered; the wiring between the two homes is a
 * source contract, because mounting the dock means standing up its whole
 * orchestrator to observe one field read.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import fs from 'node:fs';
import EffortChip, { EFFORT_CHOICES, effortChoiceOf } from '../components/shared/EffortChip';

const tiers = EFFORT_CHOICES.map(c => c.id);

describe('EffortChip', () => {
    it('names the current tier in the trigger, in words', () => {
        render(<EffortChip value="high" onChange={() => {}} />);
        expect(screen.getByLabelText('Thinking effort: High')).toBeInTheDocument();
        // A tier is not a number of bars and never a raw id on screen.
        expect(screen.getByTestId('composer-effort-chip').textContent).not.toMatch(/high/);
    });

    it('reads an unset tier as Auto, which is what the wire has always sent', () => {
        render(<EffortChip value="auto" onChange={() => {}} />);
        expect(screen.getByLabelText('Thinking effort: Auto')).toBeInTheDocument();
        expect(effortChoiceOf('nonsense' as never).id).toBe('auto');
    });

    it('opens a radio menu with exactly the current tier checked', () => {
        render(<EffortChip value="medium" onChange={() => {}} />);
        expect(screen.queryByTestId('effort-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('composer-effort-chip'));
        const menu = screen.getByTestId('effort-menu');
        expect(menu).toHaveAttribute('role', 'menu');
        const items = within(menu).getAllByRole('menuitemradio');
        expect(items.map(el => el.textContent?.trim())).toEqual(EFFORT_CHOICES.map(c => c.label));
        expect(items.filter(el => el.getAttribute('aria-checked') === 'true')).toHaveLength(1);
        expect(within(menu).getByRole('menuitemradio', { name: 'Medium' }))
            .toHaveAttribute('aria-checked', 'true');
    });

    it('reports the tier the trader picked and closes', () => {
        const onChange = vi.fn();
        render(<EffortChip value="auto" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('composer-effort-chip'));
        fireEvent.click(within(screen.getByTestId('effort-menu')).getByRole('menuitemradio', { name: 'Max' }));
        expect(onChange).toHaveBeenCalledWith('max');
        expect(screen.queryByTestId('effort-menu')).toBeNull();
    });

    it('closes on Escape without picking, and the key does not escape to the app', () => {
        const onChange = vi.fn();
        render(
            <div onKeyDown={() => onChange('REACHED-THE-APP')}>
                <EffortChip value="low" onChange={onChange} />
            </div>,
        );
        fireEvent.click(screen.getByTestId('composer-effort-chip'));
        // Unhandled, Escape bubbles to the app-level shortcut that CANCELS a
        // running analysis while the trader merely closed a menu.
        fireEvent.keyDown(screen.getByTestId('effort-menu'), { key: 'Escape' });
        expect(screen.queryByTestId('effort-menu')).toBeNull();
        expect(onChange).not.toHaveBeenCalledWith('REACHED-THE-APP');
    });

    it('closes when the rest of the screen is clicked', () => {
        render(<EffortChip value="low" onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('composer-effort-chip'));
        const backdrop = document.querySelector('.fixed.inset-0');
        expect(backdrop, 'a menu you can only leave by picking an item is a trap').not.toBeNull();
        fireEvent.click(backdrop as Element);
        expect(screen.queryByTestId('effort-menu')).toBeNull();
    });

    it('offers every tier the transport can route', () => {
        expect(tiers).toEqual(['off', 'auto', 'low', 'medium', 'high', 'max']);
    });
});

describe('both chat homes drive the one stored tier', () => {
    const composerSrc = fs.readFileSync('components/trade/panels/ChatComposer.tsx', 'utf8');
    const panelSrc = fs.readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
    const agentsSrc = fs.readFileSync('components/agents/AgentsView.tsx', 'utf8');
    const appSrc = fs.readFileSync('App.tsx', 'utf8');
    const runnerSrc = fs.readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
    const casualSrc = fs.readFileSync('services/providers/GenericAnalysisService.ts', 'utf8');

    it('the dock mounts the shared chip instead of a private copy of the menu', () => {
        expect(composerSrc).toMatch(/import EffortChip from '..\/..\/shared\/EffortChip';/);
        expect(composerSrc).toMatch(/<EffortChip value=\{effort\} onChange=\{changeEffort\} \/>/);
        // The menu used to be shell state; one owner of `open` means the two
        // chips cannot disagree about which popover is showing.
        expect(composerSrc).not.toMatch(/showEffortMenu/);
        expect(panelSrc).not.toMatch(/showEffortMenu/);
    });

    it('the dock reads the tier off the session row, not out of useState', () => {
        expect(panelSrc).toMatch(/const effort: ReasoningEffort = activeSession\.effort \?\? 'auto';/);
        expect(panelSrc).not.toMatch(/useState<ReasoningEffort/);
        expect(panelSrc).toMatch(/chatStore\.mutate\(activeId, sess => \(\{ \.\.\.sess, effort: next \}\)\)/);
    });

    it('the Chat surface mounts the same chip, and hides it for a bot turn', () => {
        expect(agentsSrc).toMatch(/effortPicker\?: React\.ReactNode;/);
        expect(agentsSrc).toMatch(/\{!activeBot && effortPicker\}/);
        // A bot answers through the mailbox transport, which never reads this
        // dial; showing the chip there would advertise a gesture that is not
        // wired.
        expect(agentsSrc).toMatch(/\{modelPicker\}/);
    });

    it('App mounts the chip on the session value and sends that same value', () => {
        expect(appSrc).toMatch(/effortPicker=\{[\s\S]{0,700}<SessionEffortChip \/>/);
        // ONE analysis entry for both homes, so exactly one place reads the
        // stored tier at send time. Two wrappers was the old shape, and they
        // drifted (one ran into a private message list).
        expect(appSrc.match(/reasoningEffort: chatStore\.getActiveEffort\(\)/g)).toHaveLength(1);
    });

    it('nobody subscribes App itself to the session store', () => {
        // chatStore latches the username it loaded for on its FIRST touch and
        // rehashes onto the real one at the first write. App renders before a
        // profile is chosen, so an App-body subscription initialized the store
        // against the empty username — then the session id the dock was writing
        // into stopped existing and sends appended nothing. Measured on position,
        // not on a comment: the subscription must live in a module-scope
        // component, which by construction can only run inside a surface.
        const subscribe = appSrc.indexOf('useSyncExternalStore(chatStore.subscribe');
        expect(subscribe).toBeGreaterThan(-1);
        const appBody = appSrc.indexOf('const App: React.FC');
        expect(appBody).toBeGreaterThan(-1);
        expect(subscribe).toBeLessThan(appBody);
    });

    it('both chat transports map the tier through one shared rule', () => {
        expect(runnerSrc).toMatch(/reasoningEffort: resolveComposerEffort\(effort\)/);
        expect(casualSrc).toMatch(/reasoningEffort: resolveComposerEffort\(effort\)/);
        // No transport may keep its own copy of the chat default.
        expect(runnerSrc).not.toMatch(/effortForTask\('chat'\)/);
        expect(casualSrc).toMatch(/effortForTask\('chat'\)/); // getQuickResponse is not a composer
    });
});
