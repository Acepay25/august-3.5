import React from 'react';
import type { ApprovalItem } from '../../utils/approvalInbox';
import { CheckIcon, CloseIcon as XIcon } from '../shared/Icons';
/**
 * InlineApprovalCard (ROUND-37 / U5): approvals appear as a compact card in
 * the chat flow — right under the message they belong to — instead of only
 * living in the modal Inbox. Same actions as the Inbox (Allow/Deny/Always/
 * Never/Show); the card disappears once the item is resolved.
 *
 * Rendered by MessageItem when `approvalItems` contains an entry whose
 * messageId matches the current message.
 */

const KIND_LABEL: Record<ApprovalItem['kind'], string> = {
    autopilot: 'Autopilot outcome',
    expired: 'Watch expired',
    ungrounded: 'Ungrounded ticket',
    replace: 'Replacement needed',
    skill: 'Skill proposal',
};

interface InlineApprovalCardProps {
    item: ApprovalItem;
    onAllow: (item: ApprovalItem) => void;
    onDeny: (item: ApprovalItem) => void;
    onAlways?: (item: ApprovalItem) => void;
    onNever?: (item: ApprovalItem) => void;
    onShow?: (item: ApprovalItem) => void;
}

const InlineApprovalCard: React.FC<InlineApprovalCardProps> = ({
    item, onAllow, onDeny, onAlways, onNever, onShow,
}) => {
    return (
        <div
            data-inline-approval
            className="status-surface mb-2 rounded-xl border border-white/10 bg-zinc-900/60 p-3"
        >
            <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">
                    {item.title}
                </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{item.detail}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {item.kind === 'autopilot' ? (
                    <>
                        <button type="button" onClick={() => onAllow(item)} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800" title="Log this outcome now">
                            <CheckIcon className="h-3 w-3" /> Allow once
                        </button>
                        <button type="button" onClick={() => onDeny(item)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300" title="Ignore this resolution">
                            <XIcon className="h-3 w-3" /> Deny
                        </button>
                        {item.coin && onAlways && (
                            <button type="button" onClick={() => onAlways(item)} className="rounded-lg border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200" title={`Auto-confirm future ${item.coin} outcomes`}>
                                Always {item.coin}
                            </button>
                        )}
                        {item.coin && onNever && (
                            <button type="button" onClick={() => onNever(item)} className="rounded-lg border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500" title={`Never auto-confirm ${item.coin} outcomes`}>
                                Never {item.coin}
                            </button>
                        )}
                    </>
                ) : item.kind === 'skill' ? (
                    <>
                        <button type="button" onClick={() => onAllow(item)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-950/40" title="Save this skill to your notebook">
                            <CheckIcon className="h-3 w-3" /> Save skill
                        </button>
                        <button type="button" onClick={() => onDeny(item)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                            <XIcon className="h-3 w-3" /> Discard
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" onClick={() => onAllow(item)} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800">
                            <CheckIcon className="h-3 w-3" /> Resolve
                        </button>
                        <button type="button" onClick={() => onDeny(item)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">Dismiss</button>
                    </>
                )}
                {onShow && (
                    <button type="button" onClick={() => onShow(item)} className="ml-auto rounded-lg px-1.5 py-0.5 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
                        Show
                    </button>
                )}
            </div>
        </div>
    );
};

export default InlineApprovalCard;
