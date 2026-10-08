/**
 * Pending permission requests from the autopilot, rendered as a section of the
 * Approvals tab instead of a drawer the nav rail opened.
 *
 * These used to be a separate surface because they arrive from a different
 * place than a skill draft: the autopilot wants leave to log or replace a trade
 * NOW, while a draft is a belief to consider. Two approval surfaces for two
 * verbs is how "where do I approve this?" stopped being answerable, so they
 * share one column now and keep their own buttons — Allow once / Always BTC /
 * Never BTC is a scope decision the Coach thread has no equivalent of.
 *
 * A `skill` item is NOT rendered here any more. `collectApprovalItems` still
 * yields them, because the Chart AI dock reads that list for its own notice,
 * but a draft has exactly one place a press saves it: Learn → Approvals.
 */

import React from 'react';
import { ApprovalItem } from '../../utils/approvalInbox';

interface ActionApprovalsProps {
    items: ApprovalItem[];
    onAllow: (item: ApprovalItem) => void;
    onDeny: (item: ApprovalItem) => void;
    onAlways: (item: ApprovalItem) => void;
    onNever: (item: ApprovalItem) => void;
    onOpen: (item: ApprovalItem) => void;
}

/** Everything but a skill draft: the actions the harness wants permission for. */
export const isActionItem = (item: ApprovalItem): boolean => item.kind !== 'skill';

const ActionApprovals: React.FC<ActionApprovalsProps> = ({ items, onAllow, onDeny, onAlways, onNever, onOpen }) => {
    const actions = items.filter(isActionItem);
    // An empty inbox says nothing. The tab already lists the drafts and the
    // amendments, so a "0 waiting" header here would be decoration.
    if (actions.length === 0) return null;

    return (
        <section
            className="rounded-control border border-zinc-800/80 bg-zinc-900"
            aria-label="Actions waiting on you"
            data-testid="action-approvals"
        >
            <header className="flex items-baseline gap-2 border-b border-zinc-800/80 px-3 py-2">
                <h2 className="text-ui-sm font-semibold text-zinc-100">Waiting on you</h2>
                <span className="font-mono text-ui-2xs text-zinc-500" data-testid="action-approvals-count">
                    {actions.length}
                </span>
                <p className="ml-auto text-ui-dense text-zinc-500">the autopilot cannot take these without a press</p>
            </header>
            <ul className="divide-y divide-zinc-800/70">
                {actions.map(item => (
                    <li key={item.id} className="px-3 py-2.5">
                        <div className="text-ui-2xs font-bold uppercase tracking-widest text-zinc-600">{item.kind}</div>
                        <p className="mt-0.5 text-ui-sm font-semibold text-zinc-100">{item.title}</p>
                        <p className="mt-0.5 text-ui-dense leading-relaxed text-zinc-400">{item.detail}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {item.kind === 'autopilot' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => onAllow(item)}
                                        data-testid={`action-allow-${item.id}`}
                                        className="rounded-control border border-zinc-600 px-2.5 py-1 text-ui-dense font-semibold text-zinc-100 hover:bg-zinc-800"
                                    >
                                        Allow once
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeny(item)}
                                        data-testid={`action-deny-${item.id}`}
                                        className="rounded-control border border-zinc-800 px-2.5 py-1 text-ui-dense text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                    >
                                        Deny
                                    </button>
                                    {item.coin && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => onAlways(item)}
                                                data-testid={`action-always-${item.id}`}
                                                className="rounded-control border border-zinc-800 px-2.5 py-1 text-ui-dense text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                            >
                                                Always {item.coin}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onNever(item)}
                                                data-testid={`action-never-${item.id}`}
                                                className="rounded-control border border-zinc-800 px-2.5 py-1 text-ui-dense text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                            >
                                                Never {item.coin}
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                            {/* A settled-but-odd trade (expired / ungrounded /
                                replace) has no permission to grant; the one
                                action is to go look at it. */}
                            {item.kind !== 'autopilot' && (
                                <button
                                    type="button"
                                    onClick={() => onOpen(item)}
                                    data-testid={`action-show-${item.id}`}
                                    className="rounded-control border border-zinc-800 px-2.5 py-1 text-ui-dense text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                                >
                                    Show the trade
                                </button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
};

export default ActionApprovals;
