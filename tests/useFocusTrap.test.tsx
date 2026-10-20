/**
 * useFocusTrap — the audit-2026-09-15 keyboard-freeze fix:
 * an UNATTACHED trap used to preventDefault Tab document-wide (zero
 * focusables, container never rendered) — freezing the whole app's
 * keyboard while the modal was mounted. It must be inert instead.
 * Also covers DataCaptureModal (the offender: dialogRef returned but
 * never placed on the role=dialog div) actually wiring the trap.
 */

import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { openTags, REPO_ROOT } from './jsxScan';
import DataCaptureModal from '../components/modals/DataCaptureModal';
import { TradeOutcome } from '../types';

// jsdom has no layout: every element's offsetParent is null, which the
// trap's visible-only filter would read as "nothing is focusable".
// Emulate layout so the attached-trap behavior tests are meaningful.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement): HTMLElement | null {
            return this.parentElement ?? null;
        },
    });
});

const TrapProbe: React.FC<{ attach: boolean }> = ({ attach }) => {
    const ref = useFocusTrap<HTMLDivElement>(true);
    return (
        <div ref={attach ? ref : undefined}>
            <button type="button">first</button>
            <button type="button">second</button>
        </div>
    );
};

const pressTab = (shift = false): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev;
};

describe('useFocusTrap', () => {
    it('is INERT when the ref is never attached — Tab is not prevented document-wide', () => {
        render(<TrapProbe attach={false} />);
        const ev = pressTab();
        expect(ev.defaultPrevented).toBe(false);
    });

    it('attached: traps the keyboard — Tab on the last focusable wraps to the first', async () => {
        render(<TrapProbe attach />);
        const first = screen.getByText('first');
        const second = screen.getByText('second');
        // The trap autofocuses the first focusable once mounted.
        await waitFor(() => expect(document.activeElement).toBe(first));
        second.focus();
        const ev = pressTab();
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        // Shift+Tab on the first wraps back to the last.
        const ev2 = pressTab(true);
        expect(ev2.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
    });
});

describe('DataCaptureModal focus-trap wiring', () => {
    it('puts the focus-trap ref on the role=dialog container', () => {
        render(
            <DataCaptureModal
                message={{ analysis: { coinName: 'BTCUSDT' } } as never}
                outcome={TradeOutcome.WIN}
                onClose={() => {}}
                onAutoCapture={() => {}}
                onSkip={() => {}}
            />
        );
        const dialog = screen.getByRole('dialog');
        // tabIndex -1 marks the trap container (the hook focuses it when the
        // subtree has no tabbable elements); before the fix the ref was
        // never attached and Tab was frozen document-wide.
        expect(dialog.getAttribute('tabindex')).toBe('-1');
        expect(dialog.contains(screen.getByText('Auto-Capture & Log'))).toBe(true);
    });
});

/**
 * O-66 — the five blocking modals that rendered `role="dialog"` with no trap.
 * The assertion is the one that cannot pass by accident: the trap's own
 * mount effect moves focus to the first control INSIDE the dialog, so
 * "focus is inside the dialog" is proof the ref reached the container. The
 * historical failure this file already pins is exactly the inverse — a trap
 * allocated but never attached, which froze Tab document-wide.
 */
import AutomationEditorModal from '../components/automation/AutomationEditorModal';
import ThinkingModal from '../components/analysis/ThinkingModal';
import ImageViewerModal from '../components/modals/ImageViewerModal';
import NewBotDialog from '../components/chat/NewBotDialog';
import { NewGroupDialog } from '../components/chat/NewGroupDialog';
import type { ProviderConfig } from '../types/provider';

const provider = {
    id: 'p1', name: 'P1', apiKey: 'sk-test', baseUrl: 'https://x.test/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m1'], selectedModel: 'm1',
} as ProviderConfig;

const expectFocusInsideDialog = async (dialog: HTMLElement): Promise<void> => {
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(dialog.getAttribute('aria-modal')).toBe('true');
};

describe('the modals the audit named as untrapped (O-66)', () => {
    it('AutomationEditorModal — the 542-line CRUD modal', async () => {
        render(<AutomationEditorModal isVisible modelOptions={[{ id: 'm1', name: 'M1', providerId: 'p1' } as never]}
            providers={[provider]} onClose={() => {}} onSave={() => {}} />);
        await expectFocusInsideDialog(screen.getByRole('dialog'));
    });

    it('ThinkingModal — the chain-of-thought reader', async () => {
        render(<ThinkingModal isOpen onClose={() => {}} title="Thought" content="the model's reasoning" />);
        await expectFocusInsideDialog(screen.getByRole('dialog'));
    });

    it('ImageViewerModal — a full-screen viewer over black/95 chrome', async () => {
        render(<ImageViewerModal imageUrl="data:image/png;base64,AAAA" onClose={() => {}} />);
        await expectFocusInsideDialog(screen.getByRole('dialog'));
    });

    it('NewBotDialog — the trap holds the keyboard while the form is open', async () => {
        render(<NewBotDialog open onClose={() => {}} onCreate={() => {}} providers={[provider]} />);
        await expectFocusInsideDialog(screen.getByRole('dialog'));
    });

    it('NewGroupDialog — the member picker inside a blocking overlay', async () => {
        render(<NewGroupDialog open onClose={() => {}} onCreate={() => {}} bots={[]} />);
        await expectFocusInsideDialog(screen.getByRole('dialog'));
    });
});

/**
 * O-66 over the WHOLE population, not the five files the audit happened to
 * name. The property a keyboard user depends on is narrower than "this dialog
 * has a trap": it is that an element which tells AT the rest of the page is
 * INERT (`aria-modal="true"`) is also the element the trap holds Tab on. Those
 * two claims live in one opening tag, so the pairing is read out of the tag's
 * own attribute region via the shared lexer — no layout assumption, no
 * line-distance guess.
 *
 * A `role="dialog"` with NO `aria-modal` is a disclosure (the trigger keeps
 * focus, Escape and a click outside dismiss it) and is deliberately outside the
 * rule. That is exactly the line between the modals above and the header's
 * session popover, whose body can legitimately contain zero controls — and a
 * trap over zero focusables swallows Tab for as long as it is open, so forcing
 * one there would be a regression the gate would have caused.
 */
const TRAP_IDS = /const\s+([A-Za-z0-9_$]+)\s*=\s*useFocusTrap\s*(?:<[^>]*>)?\s*\(/g;
/** Writing `aria-modal` at all is the claim, whatever the expression around it
 *  is — `aria-modal={isVisible || undefined}` (StrategySearch) and
 *  `aria-modal={isEmbedded ? undefined : 'true'}` (LiveMarket) both hold the
 *  page behind them as soon as they are up. Only a value that is statically
 *  falsy makes the attribute say nothing. */
const WRITES_ARIA_MODAL = /\baria-modal\s*=/;
const STATICALLY_SILENT = /\baria-modal\s*=\s*(?:\{\s*(?:false|undefined)\s*\}|false|undefined)\s*(?:\}|\s|$)/;

function tsxWalk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) tsxWalk(full, acc);
        else if (/\.tsx$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

interface ModalSite { file: string; line: number; tag: string; why: string | null }

/** Every element in the tree that declares the page behind it inert, and
 *  whether the trap's ref actually sits on that same element. */
function inertDeclarations(files: { path: string; src: string }[]): ModalSite[] {
    const out: ModalSite[] = [];
    for (const { path: file, src } of files) {
        const traps = [...src.matchAll(TRAP_IDS)].map(m => m[1]);
        for (const tag of openTags(src)) {
            if (!WRITES_ARIA_MODAL.test(tag.attrs) || STATICALLY_SILENT.test(tag.attrs)) continue;
            const refMatch = /\bref=\{([A-Za-z0-9_$.]+)/.exec(tag.attrs);
            if (!refMatch) {
                out.push({ file, line: tag.line, tag: tag.name, why: 'no ref on the element that says aria-modal' });
                continue;
            }
            if (!traps.includes(refMatch[1])) {
                out.push({ file, line: tag.line, tag: tag.name, why: `ref={${refMatch[1]}} is not a useFocusTrap() container` });
                continue;
            }
            out.push({ file, line: tag.line, tag: tag.name, why: null });
        }
    }
    return out;
}

const POPULATION = [...tsxWalk(join(REPO_ROOT, 'components')), resolve(REPO_ROOT, 'App.tsx')]
    .map(file => ({ path: file, src: readFileSync(file, 'utf8') }));
const SITES = inertDeclarations(POPULATION);
const short = (f: string): string => relative(REPO_ROOT, f).replace(/\\/g, '/');

describe('every element that declares the page inert is the trap container (O-66)', () => {
    it('the scan sees the modal population (reach control)', () => {
        // Floor, not an exact count: a scanner that silently stopped matching
        // would report zero findings and look like a clean tree. 18 is every
        // `aria-modal` the tree writes outside a comment, measured; the named
        // members are the ones the audit listed plus the ones it missed.
        expect(SITES.length).toBeGreaterThanOrEqual(18);
        const named = ['AutomationEditorModal', 'ThinkingModal', 'ImageViewerModal', 'LiveMarket', 'UpdateOverlay', 'StrategySearch'];
        for (const comp of named) {
            expect(SITES.some(s => s.file.includes(comp)), `${comp} is not in the scanned modal set`).toBe(true);
        }
    });

    it('every aria-modal element carries the focus-trap ref', () => {
        const bad = SITES.filter(s => s.why).map(s => `${short(s.file)}:${s.line} <${s.tag}> ${s.why}`);
        expect(bad, bad.join('\n')).toEqual([]);
    });

    it('the scan fires on a modal whose trap was never attached (planted defect)', () => {
        // The historical bug in this very file: the hook ran, its ref stayed
        // on an inner node, and the dialog element carried nothing — so the
        // page behind the modal was inert to AT but not to Tab.
        const planted = inertDeclarations([{
            path: join(REPO_ROOT, 'components', 'probe.tsx'),
            src: `const Probe = () => {
    const trap = useFocusTrap<HTMLDivElement>(true);
    return <div role="dialog" aria-modal="true"><span ref={trap}>inner</span></div>;
};`,
        }]);
        expect(planted.length).toBe(1);
        expect(planted[0].why).toMatch(/no ref/);
    });

    it('the scan fires when the dialog ref is some other container (planted defect)', () => {
        const planted = inertDeclarations([{
            path: join(REPO_ROOT, 'components', 'probe4.tsx'),
            src: `const Probe = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const trap = useFocusTrap<HTMLDivElement>(true);
    return <div ref={scrollRef} role="dialog" aria-modal="true" />;
};`,
        }]);
        expect(planted.length).toBe(1);
        expect(planted[0].why).toMatch(/not a useFocusTrap/);
    });

    it('the scan fires on a modal with no trap at all (planted defect)', () => {
        const planted = inertDeclarations([{
            path: join(REPO_ROOT, 'components', 'probe2.tsx'),
            src: 'const Probe = () => <div role="dialog" aria-modal="true" aria-label="x"><button type="button">ok</button></div>;',
        }]);
        expect(planted.length).toBe(1);
        expect(planted[0].why).toMatch(/no ref/);
    });

    it('a disclosure without aria-modal stays out of the rule (no false refusal)', () => {
        const planted = inertDeclarations([{
            path: join(REPO_ROOT, 'components', 'probe3.tsx'),
            src: 'const Probe = () => <div role="dialog" aria-label="Session details"><span>text</span></div>;',
        }]);
        expect(planted).toEqual([]);
    });
});
