/**
 * CustomInstructionsEditor - CRUD UI for custom instruction sets.
 *
 * Extracted from SettingsMenu.tsx (Custom Instructions view).
 * Manages the Standard / Strict Mode / Pure AI instruction tabs,
 * the token-usage meter and the expandable instruction cards.
 *
 * Note: the active tab state is owned by the parent (SettingsMenu) so the
 * selected tab persists while navigating between settings views.
 */

import React, { useState, useMemo } from 'react';
import { CustomInstructionsMap, CustomInstruction } from '../../types';
import { ChevronDownIcon, TrashIcon } from '../shared/Icons';

// Instruction tabs (Standard / Strict Mode / Pure AI)
export type InstructionTab = 'general' | 'accuracyOriginal' | 'accuracyPure';

const MAX_WORD_COUNT = 3000;
const MAX_ITEMS = 5;

// Expandable instruction card with inline editing, delete and activate toggle
const InstructionCard: React.FC<{
    instruction: CustomInstruction;
    onUpdate: (id: string, updates: Partial<CustomInstruction>) => void;
    onDelete: (id: string) => void;
}> = ({ instruction, onUpdate, onDelete }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className={`rounded-2xl border transition-all duration-300 ${instruction.isActive ? 'bg-zinc-900/80 border-cyan-500/30 shadow-[0_0_15px_-5px_rgba(6,182,212,0.1)]' : 'bg-zinc-900/30 border-white/5 opacity-80 hover:opacity-100'}`}>
            <div className="p-3 flex items-center justify-between gap-3">
                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1 rounded hover:bg-white/5 transition-colors text-zinc-500 hover:text-zinc-300"
                    >
                        <ChevronDownIcon className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                        {isExpanded ? (
                            <input
                                type="text"
                                value={instruction.title}
                                onChange={(e) => onUpdate(instruction.id, { title: e.target.value })}
                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white font-bold focus:border-cyan-500/50 outline-none"
                                placeholder="Instruction Title"
                            />
                        ) : (
                            <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold truncate ${instruction.isActive ? 'text-cyan-100' : 'text-zinc-400'}`}>{instruction.title || 'Untitled'}</span>
                                {instruction.isActive && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20 uppercase tracking-wider font-bold">Active</span>}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <label className="relative inline-flex items-center cursor-pointer" title={instruction.isActive ? "Deactivate" : "Activate"}>
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={instruction.isActive}
                            onChange={(e) => onUpdate(instruction.id, { isActive: e.target.checked })}
                        />
                        <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-cyan-600"></div>
                    </label>

                    <button
                        onClick={() => { if (confirm('Delete this instruction?')) onDelete(instruction.id); }}
                        className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete"
                    >
                        <TrashIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in border-t border-white/5 pt-3">
                    <textarea
                        value={instruction.content}
                        onChange={(e) => onUpdate(instruction.id, { content: e.target.value })}
                        placeholder="Enter instruction content..."
                        className="w-full h-32 bg-zinc-950 border border-white/10 rounded-lg p-3 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/30 resize-none leading-relaxed custom-scrollbar font-mono"
                    />
                    <div className="flex justify-end mt-2">
                        <span className="text-[10px] text-zinc-500">
                            {instruction.content.trim().split(/\s+/).filter(Boolean).length} words
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

// Props interface
export interface CustomInstructionsEditorProps {
    customInstructions: CustomInstructionsMap;
    setCustomInstructions: (instructions: CustomInstructionsMap) => void;
    activeTab: InstructionTab;
    onTabChange: (tab: InstructionTab) => void;
}

const CustomInstructionsEditor: React.FC<CustomInstructionsEditorProps> = ({
    customInstructions,
    setCustomInstructions,
    activeTab,
    onTabChange,
}) => {
    const currentInstructions = useMemo(() => customInstructions[activeTab] || [], [customInstructions, activeTab]);

    const totalWordCount = useMemo(() => {
        return currentInstructions.reduce((sum, inst) => sum + (inst.content ? inst.content.trim().split(/\s+/).filter(Boolean).length : 0), 0);
    }, [currentInstructions]);

    const handleAddInstruction = () => {
        if (currentInstructions.length >= MAX_ITEMS) {
            return; // Button is disabled at limit; guard for safety
        }

        const newInstruction: CustomInstruction = {
            id: `inst-${Date.now()}`,
            title: `New Instruction ${currentInstructions.length + 1}`,
            content: '',
            isActive: true
        };

        setCustomInstructions({
            ...customInstructions,
            [activeTab]: [...currentInstructions, newInstruction]
        });
    };

    const handleUpdateInstruction = (id: string, updates: Partial<CustomInstruction>) => {
        const updatedList = currentInstructions.map(inst => inst.id === id ? { ...inst, ...updates } : inst);
        setCustomInstructions({
            ...customInstructions,
            [activeTab]: updatedList
        });
    };

    const handleDeleteInstruction = (id: string) => {
        setCustomInstructions({
            ...customInstructions,
            [activeTab]: currentInstructions.filter(inst => inst.id !== id)
        });
    };

    return (
        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4 custom-scrollbar">
            <p className="text-xs text-zinc-500 leading-relaxed">
                Define multiple custom instruction sets for how the AI should reason, behave, or filter trades.
                <strong className="text-zinc-400"> Select the mode below to manage its instructions.</strong>
            </p>

            {/* Tabs for Mode Selection */}
            <div className="flex space-x-1 bg-zinc-900 p-1 rounded-xl border border-white/5">
                <button
                    onClick={() => onTabChange('general')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${activeTab === 'general' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                    Standard
                </button>
                <button
                    onClick={() => onTabChange('accuracyOriginal')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${activeTab === 'accuracyOriginal' ? 'bg-cyan-900/40 text-cyan-200 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                    Strict Mode
                </button>
                <button
                    onClick={() => onTabChange('accuracyPure')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${activeTab === 'accuracyPure' ? 'bg-cyan-900/40 text-cyan-200 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                    Pure AI
                </button>
            </div>

            {/* Word Count Progress */}
            <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                    <span className="text-zinc-500 uppercase font-bold tracking-wider">Token Usage</span>
                    <span className={`${totalWordCount > MAX_WORD_COUNT ? 'text-red-400 font-bold' : 'text-zinc-400'}`}>
                        {totalWordCount} / {MAX_WORD_COUNT} words
                    </span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${totalWordCount > MAX_WORD_COUNT ? 'bg-red-500' : 'bg-cyan-600'}`}
                        style={{ width: `${Math.min(100, (totalWordCount / MAX_WORD_COUNT) * 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Instruction List */}
            <div className="space-y-3">
                {currentInstructions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-white/10 rounded-2xl">
                        <span className="text-3xl mb-3">📝</span>
                        <p className="text-xs text-zinc-600 italic">No custom instructions for this mode yet.</p>
                    </div>
                ) : (
                    currentInstructions.map(inst => (
                        <InstructionCard
                            key={inst.id}
                            instruction={inst}
                            onUpdate={handleUpdateInstruction}
                            onDelete={handleDeleteInstruction}
                        />
                    ))
                )}
            </div>

            {/* Add Button */}
            <button
                onClick={handleAddInstruction}
                disabled={currentInstructions.length >= MAX_ITEMS}
                className="w-full py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                + Add New Instruction ({currentInstructions.length}/{MAX_ITEMS})
            </button>
        </div>
    );
};

export default CustomInstructionsEditor;
