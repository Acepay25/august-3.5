/**
 * The Chart AI dock is the Chat surface's compact form, not a reduced one.
 *
 * The trader asked for the two to be "just in sync" — same bots, same rooms,
 * same approvals — with the dock simply being the smaller of the two. The dock
 * already opened existing rooms and created bots; what it could not do was
 * CREATE a room or reach the Coach inbox, so "groups in the dock" quietly meant
 * "the groups that already exist on the other surface". That is the shape of
 * bug this test exists to stop: a feature that is present in one surface and
 * absent in the other reads as a defect of the product, not of the layout.
 *
 * Source-contract rather than jsdom: the dock's menu lives inside a 2k-line
 * memo component whose surrounding state is not worth mounting for three
 * buttons, and the same pattern is already used for the surface-enter CSS.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const panelSrc = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
const viewSrc = readFileSync('components/trade/TradeView.tsx', 'utf8');
const appSrc = readFileSync('App.tsx', 'utf8');
const pickerSrc = readFileSync('components/shared/ModelPicker.tsx', 'utf8');

/** The dock's "Start"/customization menu body. */
const newMenu = (): string => {
    const at = panelSrc.indexOf('data-testid="chat-new-menu"');
    expect(at, 'the dock customization menu is gone').toBeGreaterThan(-1);
    return panelSrc.slice(at, panelSrc.indexOf('</div>', panelSrc.indexOf('groups.length > 0', at) + 400));
};

describe('the dock offers what the Chat rail offers', () => {
    it('can create a group room, not only open existing ones', () => {
        expect(newMenu()).toMatch(/onNewGroup/);
        expect(panelSrc).toMatch(/data-testid="new-group-option"/);
        // Forwarded all the way from App, or the button would be a dead control.
        expect(viewSrc).toMatch(/onNewGroup\?: \(\) => void/);
        expect(appSrc).toMatch(/onNewGroup=\{\(\) => setIsNewGroupOpen\(true\)\}/);
    });

    it('can reach the Coach inbox, with the same pending count the rail shows', () => {
        expect(newMenu()).toMatch(/onOpenCoach/);
        expect(panelSrc).toMatch(/data-testid="dock-coach-option"/);
        expect(appSrc).toMatch(/onOpenCoach=\{openCoachInLearn\}/);
        // One handler, two surfaces — not a second Coach route.
        expect(appSrc.match(/onOpenCoach=\{openCoachInLearn\}/g)?.length).toBe(2);
    });

    it('already creates bots, and keeps doing so', () => {
        expect(panelSrc).toMatch(/data-testid="new-agent-option"/);
        expect(panelSrc).toMatch(/<NewBotDialog/);
    });

    it('renders a row only when it can honor it', () => {
        // A control with no handler is the dead affordance this repo's probes
        // keep catching; the row is gated rather than shown-and-inert.
        expect(panelSrc).toMatch(/\{onNewGroup && \(/);
        expect(panelSrc).toMatch(/\{onOpenCoach && \(/);
    });
});

describe('the model search reads from the left edge', () => {
    it('left-aligns the query text, and does not fight the layout', () => {
        const at = pickerSrc.indexOf('data-testid="model-picker-search"');
        expect(at).toBeGreaterThan(-1);
        const cls = /className="([^"]*)"/.exec(pickerSrc.slice(at, at + 400))?.[1] ?? '';
        expect(cls, 'the search input must opt into left alignment explicitly')
            .toMatch(/text-left/);
        // `text-left` is a no-op without a direction to align against, and the
        // input must not have inherited one from a flex parent.
        expect(cls).not.toMatch(/text-center|text-right/);
    });
});
