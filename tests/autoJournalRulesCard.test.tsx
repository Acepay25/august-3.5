/**
 * The auto-journal rules the approvals inbox creates must be visible and
 * revocable. Before `AutoJournalRulesCard` they were enforced
 * (`autoJournalPolicyFor` reads them) but had no surface — a rule could only
 * be "undone" by clicking the opposite policy, which wrote ANOTHER rule.
 *
 * Both directions are pinned here: the list renders what the store holds for
 * THIS profile, and revoking goes through storage's own delete path (policy
 * 'ask' = no row) rather than a hand-written shape.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoJournalRulesCard } from '../components/settings/AutoJournalRulesCard';
import {
    getAutoJournalRules, setAutoJournalRule, autoJournalPolicyFor,
} from '../utils/approvalInbox';

const USER = 'rules-user';

beforeEach(() => localStorage.clear());

describe('AutoJournalRulesCard', () => {
    it('starts with the honest empty state, not a blank box', () => {
        render(<AutoJournalRulesCard username={USER} />);
        expect(screen.getByText('No standing rules')).toBeTruthy();
        expect(screen.getByText(/asks before it journals/)).toBeTruthy();
    });

    it('lists the standing rules the inbox created, per profile', () => {
        setAutoJournalRule('BTC', 'always', USER);
        setAutoJournalRule('SOL', 'deny', USER);
        // Another profile's rule is not this profile's business.
        setAutoJournalRule('ETH', 'always', 'someone-else');

        render(<AutoJournalRulesCard username={USER} />);
        expect(screen.getByText('BTC')).toBeTruthy();
        expect(screen.getByText('Always journal — logged without asking.')).toBeTruthy();
        expect(screen.getByText('SOL')).toBeTruthy();
        expect(screen.getByText('Never journal — dismissed without asking.')).toBeTruthy();
        expect(screen.queryByText('ETH')).toBeNull();
        expect(screen.queryByText('No standing rules')).toBeNull();
    });

    it('revokes through the storage delete path — the rule leaves list AND store', () => {
        setAutoJournalRule('BTC', 'always', USER);
        setAutoJournalRule('SOL', 'deny', USER);

        render(<AutoJournalRulesCard username={USER} />);
        fireEvent.click(screen.getByRole('button', {
            name: 'Remove the always journal rule for BTC',
        }));

        // Gone from the rendered list…
        expect(screen.queryByText('BTC')).toBeNull();
        expect(screen.getByText('SOL')).toBeTruthy(); // the other rule survives
        // …from the store, via policy 'ask' (which writes no row)…
        expect(getAutoJournalRules(USER).map(r => r.coin)).toEqual(['SOL']);
        expect(autoJournalPolicyFor('BTC', USER)).toBe('ask');
    });
});
