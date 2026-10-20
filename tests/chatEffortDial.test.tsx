/**
 * The thinking tier on the composer's model control, shared by both chat homes.
 *
 * The Chart AI dock had an effort dial for a long time; the Chat surface did not,
 * and the tier the dock showed was honoured by the dock's own transport while
 * the Chat surface's casual request hardcoded the task default. Two consequences,
 * both pinned below: a surface with no dial cannot ask for reasoning it will
 * later be shown as a text scratchpad, and a dial whose value lives in one
 * component's `useState` is a label that drifts the moment the other home is
 * opened (the dock unmounts on a surface switch).
 *
 * E-51 Phase 2 merged the dial INTO the model control: the tier rides the
 * trigger's label (ruling D-D) and is edited on the slider in the same panel
 * that picks the model, because `low` switches thinking off on the GLM and
 * DeepSeek routes — a tier read apart from the model it changes is a tier the
 * trader cannot reason about. The panel's own behaviour (six stops,
 * `aria-valuetext`, Escape containment, the bot-turn rule) is pinned in
 * `tests/modelMenu.test.tsx`; what lives here is the label and the WIRING,
 * because mounting the dock means standing up its whole orchestrator to observe
 * one field read.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import ModelChip from '../components/shared/ModelChip';
import { EFFORT_CHOICES, effortChoiceOf, effortShortcutHint, nextEffortTier } from '../components/shared/effortScale';
import { effortDialUp, resetEffortDial } from '../components/shared/effortDial';
import type { ProviderConfig } from '../types/provider';

// The dial registry is module state, so a mounted chip in one test would keep
// the chord "legal" for the next file.
beforeEach(resetEffortDial);
afterEach(cleanup);

const tiers = EFFORT_CHOICES.map(c => c.id);

const PROVIDERS: ProviderConfig[] = [{
    id: 'deepseek', name: 'DeepSeek', apiKey: 'sk-test', baseUrl: 'https://x.test/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['deepseek-reasoner'], selectedModel: 'deepseek-reasoner',
} as ProviderConfig];

/** jsdom lays nothing out, and the panel positions off the trigger's rect. */
const stubRect = (): void => {
    HTMLElement.prototype.getBoundingClientRect = () => ({
        top: 600, bottom: 632, left: 40, right: 200, width: 160, height: 32, x: 40, y: 600, toJSON: () => ({}),
    }) as DOMRect;
};

describe('the tier on the merged model control', () => {
    it('names provider, model and tier on the trigger, in words', () => {        stubRect();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="high" onEffortChange={() => {}} />);
        const trigger = screen.getByTestId('composer-model-chip');
        // The pretty-printed model name is asserted through the label's SHAPE,
        // not by hardcoding `formatModelDisplayName`'s output — that function is
        // a table of known tokens and changes on purpose.
        expect(trigger).toHaveAccessibleName(/^Model DeepSeek · .+ · High$/);
        // A tier is never a raw id on screen, and the id is not the label either.
        expect(trigger.textContent).not.toMatch(/deepseek-reasoner/);
    });

    it('reads an unset tier as Auto, which is what the wire has always sent', () => {
        stubRect();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="auto" onEffortChange={() => {}} />);
        expect(screen.getByTestId('composer-model-chip').textContent).toContain('Auto');
        expect(effortChoiceOf('nonsense' as never).id).toBe('auto');
    });

    it('drops the tier from the label when the host has no dial to show', () => {
        stubRect();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="high" onEffortChange={() => {}} showEffort={false} />);
        const trigger = screen.getByTestId('composer-model-chip');
        expect(trigger.textContent).not.toMatch(/High/);
        fireEvent.click(trigger);
        expect(screen.queryByTestId('model-menu-effort')).toBeNull();
    });

    it('the slider in the same panel writes the tier the trigger prints', () => {
        stubRect();
        const onEffort = vi.fn();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="medium" onEffortChange={onEffort} />);
        fireEvent.click(screen.getByTestId('composer-model-chip'));
        fireEvent.keyDown(screen.getByTestId('effort-slider'), { key: 'ArrowRight' });
        expect(onEffort).toHaveBeenCalledWith('high');
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

    it('the dock mounts the tier INTO the model control, and has no separate dial', () => {
        expect(composerSrc).toMatch(/import ModelChip from '..\/..\/shared\/ModelChip';/);
        expect(composerSrc).toMatch(/effort=\{effort\} onEffortChange=\{changeEffort\} compact/);
        // The standalone chip is deleted, not left mounted somewhere else.
        expect(composerSrc).not.toMatch(/EffortChip/);
        expect(fs.existsSync('components/shared/EffortChip.tsx')).toBe(false);
        // The menu used to be shell state; one owner of `open` means the two
        // controls cannot disagree about which popover is showing.
        expect(composerSrc).not.toMatch(/showEffortMenu/);
        expect(panelSrc).not.toMatch(/showEffortMenu/);
    });

    it('the control sits in the card, immediately left of send (ruling D-A)', () => {
        // Not a footer row under it: the pair is what right-aligns, and the send
        // keeps the composer's bottom-right corner. render-probe measures the
        // same claim in pixels, because no source regex can.
        expect(composerSrc).toMatch(/data-testid="composer-model-and-send"/);
        expect(agentsSrc).toMatch(/data-testid="composer-model-and-send"/);
        expect(composerSrc).not.toMatch(/The reference footer, harness-style/);
    });

    it('the dock reads the tier off the session row, not out of useState', () => {
        expect(panelSrc).toMatch(/const effort: ReasoningEffort = activeSession\.effort \?\? 'auto';/);
        expect(panelSrc).not.toMatch(/useState<ReasoningEffort/);
        expect(panelSrc).toMatch(/chatStore\.mutate\(activeId, sess => \(\{ \.\.\.sess, effort: next \}\)\)/);
    });

    it('the Chat surface gets the same control, and the bot rule travels with it', () => {
        expect(agentsSrc).toMatch(/modelPicker\?: \(opts: \{ showEffort: boolean \}\) => React\.ReactNode;/);
        expect(agentsSrc).toMatch(/\{modelPicker\?\.\(\{ showEffort: !activeBot \}\)\}/);
        // A bot answers through the mailbox transport, which never reads this
        // dial; offering to edit it there would advertise a gesture that is
        // not wired. The rule is now a section that is absent, not a chip that
        // is hidden — the control owns it either way.
        expect(agentsSrc).not.toMatch(/effortPicker/);
    });

    it('App mounts the control on the session value and sends that same value', () => {
        expect(appSrc).toMatch(/modelPicker=\{\(\{ showEffort \}\) => \(/);
        expect(appSrc).toMatch(/<SessionModelChip[\s\S]*?showEffort=\{showEffort\} \/>/);
        // ONE analysis entry for both homes, so exactly one place reads the
        // stored tier at send time. Two wrappers was the old shape, and they
        // drifted (one ran into a private message list).
        expect(appSrc.match(/reasoningEffort: chatStore\.getActiveEffort\(\)/g)).toHaveLength(1);
        // And one writer for the model pair, used by the Chat surface's chip
        // instead of re-spelling the two statements inline (G-4).
        expect(appSrc).toMatch(/const changeChatSoloModel = useCallback\(\(value: string\): void => \{/);
        expect(appSrc).not.toMatch(/setSelectedChatModel\(v\); chatStore\.setActiveSoloModel\(v\);/);
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
        // The dock and the Chat surface can both present a plan, so their
        // "auto" resolves through tradingDecision — not the casual chat tier
        // (E-39). A trader's explicit pick still passes through untouched.
        expect(runnerSrc).toMatch(/reasoningEffort: resolveComposerEffort\(effort, 'tradingDecision'\)/);
        expect(casualSrc).toMatch(/reasoningEffort: resolveComposerEffort\(effort\)/);
        // 20b added a THIRD casual transport — the Chat surface's desk turn.
        // One dial, three wires: a transport that skipped the shared rule would
        // show a tier on the chip and send another on the wire.
        const surfaceSrc = fs.readFileSync('services/trade/chatSurfaceTurn.ts', 'utf8');
        expect(surfaceSrc).toMatch(/reasoningEffort: resolveComposerEffort\(req\.effort, 'tradingDecision'\)/);
        // A scheduled run that can present gets the schedule's top tier.
        const automationSrc = fs.readFileSync('services/trade/automationTurn.ts', 'utf8');
        expect(automationSrc).toMatch(/resolveComposerEffort\(undefined, 'automatedTradingDecision'\)/);
        // No transport may keep its own copy of the chat default.
        expect(runnerSrc).not.toMatch(/effortForTask\('chat'\)/);
        expect(surfaceSrc).not.toMatch(/effortForTask\('chat'\)/);
        expect(casualSrc).toMatch(/effortForTask\('chat'\)/); // getQuickResponse is not a composer
    });
});

/**
 * E-51 ruling D-B — the `Ctrl/Cmd+Shift+E` chord, bound in the same commit as
 * the hint that advertises it.
 *
 * The reference client's shortcut is a GLOBAL thinking toggle. Here it is legal
 * only while a composer actually shows the tier: a panel session has no dial
 * (its seats pick their own models) and a bot turn has none either (a bot
 * answers on its own config through a transport that never reads the field), so
 * a chord that wrote a tier in those states would change something nothing
 * reads back. That is the same class of lie as a key hint for an unbound key,
 * which is why the hint and the binding ship together and why the binding asks
 * `effortDial.ts` before it acts.
 */
describe('the Ctrl/Cmd+Shift+E chord', () => {
    const appSrc = fs.readFileSync('App.tsx', 'utf8');

    it('walks the ladder in order and wraps at the top', () => {
        expect(nextEffortTier('off')).toBe('auto');
        expect(nextEffortTier('auto')).toBe('low');
        expect(nextEffortTier('medium')).toBe('high');
        expect(nextEffortTier('high')).toBe('max');
        // Wrapping is what makes the chord repeatable instead of a one-way ramp
        // that strands the dial at `max` with no way back except the panel.
        expect(nextEffortTier('max')).toBe('off');
    });

    it('names the keycap the machine actually has', () => {
        expect(effortShortcutHint('MacIntel')).toBe('⌘⇧E');
        expect(effortShortcutHint('Win32')).toBe('Ctrl+Shift+E');
        expect(effortShortcutHint('Linux x86_64')).toBe('Ctrl+Shift+E');
    });

    it('prints the hint beside the EFFORT label and in the slider’s accessible name', () => {
        stubRect();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="high" onEffortChange={() => {}} />);
        fireEvent.click(screen.getByTestId('composer-model-chip'));
        const hint = effortShortcutHint(`${navigator.userAgent} ${navigator.platform ?? ''}`);
        const section = screen.getByTestId('model-menu-effort');
        expect(section.textContent).toContain(hint);
        expect(screen.getByRole('slider').getAttribute('aria-label')).toContain(hint);
    });

    it('is legal only while a composer shows the dial, and stops when it unmounts', async () => {
        expect(effortDialUp()).toBe(false);
        stubRect();
        const view = render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="high" onEffortChange={() => {}} />);
        // The panel is not open: the chip still shows the tier on its trigger,
        // and that is what the chord edits, so the key is live already.
        await waitFor(() => expect(effortDialUp()).toBe(true));
        view.unmount();
        expect(effortDialUp()).toBe(false);
    });

    it('a bot turn, which answers on its own config, never raises it', async () => {
        stubRect();
        render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="high" onEffortChange={() => {}} showEffort={false} />);
        await Promise.resolve();
        expect(effortDialUp()).toBe(false);
    });

    it('App binds it, guarded by that flag, writing the one stored row', () => {
        // The guard and the binding are ONE condition: a chord bound but not
        // guarded would fire on a bot turn, and a guarded chord never bound is
        // the dead hint this repo keeps catching.
        expect(appSrc).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.shiftKey && !e\.altKey && effortDialUp\(\) && e\.key\.toLowerCase\(\) === 'e'/);
        expect(appSrc).toMatch(/chatStore\.setActiveEffort\(nextEffortTier\(chatStore\.getActiveEffort\(\)\)\)/);
        expect(appSrc).toMatch(/import \{ effortDialUp \} from '\.\/components\/shared\/effortDial'/);
    });

    it('the double-release guard keeps the count sane', async () => {
        stubRect();
        const view = render(<ModelChip providers={PROVIDERS} value="deepseek::deepseek-reasoner"
            onChange={() => {}} effort="low" onEffortChange={() => {}} />);
        await waitFor(() => expect(effortDialUp()).toBe(true));
        view.unmount();
        view.unmount();
        expect(effortDialUp()).toBe(false);
    });
});
