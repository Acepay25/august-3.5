import React, { useEffect, useRef } from 'react';
import { BrainIcon, CloseIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface ThinkingModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    content?: string;
    children?: React.ReactNode;
}

/** Shared full-detail viewer for model reasoning and analyst thinking. */
const ThinkingModal: React.FC<ThinkingModalProps> = ({ isOpen, onClose, title, subtitle, content, children }) => {
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => closeButtonRef.current?.focus());
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="status-surface flex max-h-[min(86vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-zinc-950 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="thinking-modal-title">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 bg-zinc-900/90 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BrainIcon className="h-4 w-4" /></div>
                        <div className="min-w-0">
                            <h2 id="thinking-modal-title" className="truncate text-sm font-bold text-white sm:text-base">{title}</h2>
                            {subtitle && <p className="mt-0.5 truncate text-[10px] text-zinc-500">{subtitle}</p>}
                        </div>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label="Close thinking viewer" title="Close thinking viewer"><CloseIcon /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 custom-scrollbar sm:px-6">
                    {children ?? (content ? <MarkdownContent content={content} className="text-sm leading-7 text-zinc-300" /> : <p className="text-sm italic text-zinc-600">This model did not return a separate reasoning trace.</p>)}
                </div>
                <div className="shrink-0 border-t border-white/10 px-4 py-3 text-[10px] text-zinc-600 sm:px-6">Model reasoning is provided for review and may be incomplete. Press Escape to close.</div>
            </div>
        </div>
    );
};

export default ThinkingModal;
