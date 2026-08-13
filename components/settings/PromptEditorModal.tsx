import React, { useState, useEffect } from 'react';
import { ChevronLeftIcon, CloseIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface PromptEditorModalProps {
    isOpen: boolean;
    title: string;
    subtitle?: string;
    defaultPrompt: string;
    value: string;
    onSave: (prompt: string | null) => void;
    onClose: () => void;
}

/**
 * Full-screen prompt viewer/editor (chat attach bar and lens overrides).
 */
const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
    isOpen, title, subtitle, defaultPrompt, value, onSave, onClose,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<string>('');

    useEffect(() => {
        if (isOpen) {
            setDraft(value || defaultPrompt);
            setIsEditing(false);
        }
    }, [isOpen, value, defaultPrompt]);

    if (!isOpen) return null;

    const hasOverride = !!value && value.trim().length > 0;
    const displayPrompt = value || defaultPrompt;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[60] bg-zinc-950 flex flex-col animate-fade-in"
        >
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="px-8 pt-8 pb-16 max-w-4xl mx-auto w-full">
                    <div className="flex items-center justify-between mb-8">
                        <button
                            onClick={onClose}
                            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
                            aria-label="Back"
                        >
                            <ChevronLeftIcon className="w-4 h-4" /> Back
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800"
                            aria-label="Close prompt editor"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    <h2 className="text-3xl font-semibold text-zinc-100 tracking-tight">{title}</h2>
                    {subtitle && <p className="text-sm text-zinc-500 mt-2 mb-8">{subtitle}</p>}
                    {!subtitle && <div className="mb-8" />}

                    {hasOverride && (
                        <p className="text-xs text-zinc-500 mb-4">Custom override is live</p>
                    )}

                    <div className="flex items-center gap-2 mb-6">
                        {!isEditing ? (
                            <button
                                onClick={() => {
                                    setDraft(value || defaultPrompt);
                                    setIsEditing(true);
                                }}
                                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm transition-colors"
                            >
                                Edit
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => setIsEditing(false)}
                                    className="px-4 py-2 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        onSave(draft.trim() ? draft : null);
                                        setIsEditing(false);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
                                >
                                    Save
                                </button>
                            </>
                        )}
                        {hasOverride && (
                            <button
                                onClick={() => {
                                    onSave(null);
                                    setIsEditing(false);
                                    setDraft(defaultPrompt);
                                }}
                                className="status-surface ml-auto text-sm text-zinc-400 hover:text-rose-400 transition-colors"
                            >
                                Reset to default
                            </button>
                        )}
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-8 py-8 min-h-[320px]">
                        {!isEditing ? (
                            <MarkdownContent content={displayPrompt || '(empty prompt)'} className="text-zinc-200 leading-8" />
                        ) : (
                            <textarea
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                spellCheck={false}
                                className="w-full min-h-[50vh] bg-transparent text-sm font-mono leading-7 text-zinc-200 focus:outline-none resize-y"
                                aria-label="Edit prompt"
                            />
                        )}
                    </div>
                    <p className="mt-4 text-xs text-zinc-600 leading-relaxed">
                        {hasOverride
                            ? 'This custom prompt replaces the built-in prompt for this mode.'
                            : 'Built-in prompt. Edit to customize; analysis contract sections are still appended by the app.'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PromptEditorModal;
