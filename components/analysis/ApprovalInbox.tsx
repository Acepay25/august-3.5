import React from 'react';
import { Inbox } from 'lucide-react';
import { ApprovalItem, AutoJournalPolicy } from '../../utils/approvalInbox';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { CloseIcon } from '../shared/Icons';
import { EmptyState } from '../ui/EmptyState';
import * as supervisorStore from '../../services/learning/supervisorStore';

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
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 sm:items-stretch" role="dialog" aria-label="Approvals" data-testid="approval-inbox">
            <button type="button" className="absolute inset-0 cursor-default" aria-label="Close approvals overlay" onClick={onClose} />
            <div ref={dialogRef} className="relative flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-950 shadow-2xl sm:h-full sm:rounded-none sm:border-l sm:border-t-0 sm:border-b-0">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                    <h2 className="text-sm font-semibold text-zinc-100">Approvals</h2>
                    <span className="text-ui-dense text-zinc-500">{items.length}</span>
                    <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close approvals">
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                    {items.length === 0 ? (
                        <EmptyState
                            compact
                            icon={<Inbox className="h-5 w-5" />}
                            title="Nothing needs you"
                            description="The supervisor works the skill drafts on its own. What lands here is autopilot gating, ungrounded tickets, dropped seats, and anything it could not decide."
                        />
                    ) : items.map(item => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                            <div className="text-ui-xs font-bold uppercase tracking-widest text-zinc-600">{item.kind}</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{item.title}</div>
                            <p className="mt-1 text-ui-sm leading-relaxed text-zinc-400">{item.detail}</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {(item.kind === 'autopilot') && (
                                    <>
                                        <button type="button" onClick={() => onAllow(item)} className="rounded-lg border border-white/15 px-2.5 py-1 text-ui-dense text-zinc-200">Allow once</button>
                                        <button type="button" onClick={() => onDeny(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-ui-dense text-zinc-500">Deny</button>
                                        {item.coin && (
                                            <>
                                                <button type="button" onClick={() => onAlways(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-ui-dense text-zinc-400">Always {item.coin}</button>
                                                <button type="button" onClick={() => onNever(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-ui-dense text-zinc-500">Never {item.coin}</button>
                                            </>
                                        )}
                                    </>
                                )}
                                {item.kind === 'skill' && (
                                    <>
                                        {/* A skill draft only reaches a human when the
                                            supervisor did NOT decide it — paused, no
                                            ready provider, or a verdict it couldn't
                                            parse. Saying so keeps this an override
                                            surface instead of reading as the normal
                                            path the model was built to walk. */}
                                        <p className="mb-1.5 w-full text-ui-xs leading-4 text-zinc-600">
                                            {supervisorStore.isAutoEnabled()
                                                ? 'The supervisor could not decide this one — it is yours to judge.'
                                                : 'Automatic supervision is paused, so drafts wait for you here.'}
                                        </p>
                                        <button type="button" onClick={() => onAllow(item)} className="rounded-lg border border-white/15 px-2.5 py-1 text-ui-dense text-zinc-200">Save skill</button>
                                        <button type="button" onClick={() => onDeny(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-ui-dense text-zinc-500">Discard</button>
                                    </>
                                )}
                                {/* A skill draft's messageId is the trade it was
                                    drafted from, not a transcript entry — there
                                    is nothing here to locate. */}
                                {item.kind !== 'skill' && (
                                    <button type="button" onClick={() => onOpen(item)} className="rounded-lg border border-white/10 px-2.5 py-1 text-ui-dense text-zinc-300">Show</button>
                                )}
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
