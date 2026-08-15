import React from 'react';
import { ApprovalItem, AutoJournalPolicy } from '../../utils/approvalInbox';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { CloseIcon } from '../shared/Icons';

interface ApprovalInboxProps {
    isVisible: boolean;
    onClose: () => void;
    items: ApprovalItem[];
    onAllow: (item: ApprovalItem) => void;
    onDeny: (item: ApprovalItem) => void;
    onAlways: (item: ApprovalItem) => void;
    onNever: (item: ApprovalItem) => void;
    onOpen: (item: ApprovalItem) => void;
}

const ApprovalInbox: React.FC<ApprovalInboxProps> = ({
    isVisible, onClose, items, onAllow, onDeny, onAlways, onNever, onOpen,
}) => {
    useEscapeClose(isVisible, onClose);
    const dialogRef = useFocusTrap<HTMLDivElement>(isVisible);
    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 sm:items-stretch" role="dialog" aria-label="Approvals">
            <button type="button" className="absolute inset-0 cursor-default" aria-label="Close approvals overlay" onClick={onClose} />
            <div ref={dialogRef} className="relative flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-950 shadow-2xl sm:h-full sm:rounded-none sm:border-l sm:border-t-0 sm:border-b-0">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                    <h2 className="text-sm font-semibold text-zinc-100">Approvals</h2>
                    <span className="text-[11px] text-zinc-500">{items.length}</span>
                    <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close approvals">
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                    {items.length === 0 ? (
                        <p className="px-2 py-8 text-center text-[13px] text-zinc-500">Nothing needs you. Outcomes, ungrounded tickets, dropped seats, and skill drafts land here.</p>
                    ) : items.map(item => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">{item.kind}</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{item.title}</div>
                            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{item.detail}</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {(item.kind === 'autopilot') && (
                                    <>
                                        <button type="button" onClick={() => onAllow(item)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-zinc-200">Allow once</button>
                                        <button type="button" onClick={() => onDeny(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-500">Deny</button>
                                        {item.coin && (
                                            <>
                                                <button type="button" onClick={() => onAlways(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400">Always {item.coin}</button>
                                                <button type="button" onClick={() => onNever(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-500">Never {item.coin}</button>
                                            </>
                                        )}
                                    </>
                                )}
                                {item.kind === 'skill' && (
                                    <>
                                        <button type="button" onClick={() => onAllow(item)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-zinc-200">Save skill</button>
                                        <button type="button" onClick={() => onDeny(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-500">Discard</button>
                                    </>
                                )}
                                <button type="button" onClick={() => onOpen(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">Show</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ApprovalInbox;
export type { AutoJournalPolicy };
