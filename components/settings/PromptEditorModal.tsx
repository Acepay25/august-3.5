import React, { useState, useEffect } from 'react';
import { CloseIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface PromptEditorModalProps {
    isOpen: boolean;
    /** Modal title, e.g. "Normal Mode Prompt" or "Lenses · Macro & Volatility". */
    title: string;
    subtitle?: string;
    /** The built-in prompt — shown when no override exists. */
    defaultPrompt: string;
    /** Current override ('' = none → built-in is used). */
    value: string;
    /** null = reset to default (clear the override). */
    onSave: (prompt: string | null) => void;
    onClose: () => void;
}

/**
 * Modal for viewing and editing a mode's analysis prompt.
 * Shows the prompt with proper formatting (monospace, preserved line breaks)
 * and an Edit mode backed by a textarea; overrides persist via the caller.
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
            className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-4 animate-fade-in pointer-events-auto"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-zinc-800/60 shrink-0">
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{title}</h3>
                        {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {hasOverride && (
                            <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
                                Custom
                            </span>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                            aria-label="Close prompt editor"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 min-h-0 p-4 overflow-y-auto">
                    {!isEditing ? (
                        <>
                            {/* Formatted markdown preview — bold, highlights, boxes. */}
                            <div className="rounded-xl bg-zinc-950 border border-white/10 max-h-72 overflow-y-auto custom-scrollbar">
                                <div className="p-3 sm:p-4">
                                    <MarkdownContent content={displayPrompt || '(empty prompt)'} />
                                </div>
                            </div>
                            <div className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
                                {hasOverride
                                    ? 'You are using a custom prompt — it replaces the built-in prompt for this mode.'
                                    : 'This is the built-in prompt. Click "Edit" to customize it; the analysis contract sections (rules, formatting, evidence discipline) are still appended by the app.'}
                            </div>
                        </>
                    ) : (
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            rows={18}
                            spellCheck={false}
                            className="w-full rounded-xl bg-zinc-950 border border-white/10 p-3 text-[11px] sm:text-xs font-mono leading-relaxed text-zinc-300 focus:outline-none focus:border-cyan-500/50 resize-y"
                            aria-label="Edit prompt"
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 bg-zinc-800/40 shrink-0">
                    {hasOverride ? (
                        <button
                            onClick={() => {
                                onSave(null);
                                setIsEditing(false);
                                setDraft(defaultPrompt);
                            }}
                            className="text-[11px] text-zinc-400 hover:text-rose-400 transition-colors"
                        >
                            Reset to default
                        </button>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                        {!isEditing ? (
                            <button
                                onClick={() => {
                                    setDraft(value || defaultPrompt);
                                    setIsEditing(true);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
                            >
                                Edit
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => setIsEditing(false)}
                                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        onSave(draft.trim() ? draft : null);
                                        setIsEditing(false);
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
                                >
                                    Save
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PromptEditorModal;
