/**
 * MemoryBrowser — ZCode-style 3-level drill-down for the Journal Memory tab.
 *
 * Level 1: Category list (notebook folders + file counts)
 * Level 2: File list within a selected folder
 * Level 3: Rendered markdown content of a selected file
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MemoryFile, MemoryFolder } from '../../types';
import { initMemoryFiles, getMemoryFiles } from '../../services/learning/MemoryFilesService';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    RefreshIcon,
    FolderIcon,
    FileTextIcon,
} from '../shared/Icons';

interface MemoryBrowserProps {
    /** Active user — notebook files are stored per-user. */
    username?: string;
    /** Whether global memory injection is enabled (read-only here, toggled in Settings). */
    isGlobalMemoryEnabled?: boolean;
}

type ViewLevel = 'categories' | 'files' | 'content';

const MemoryBrowser: React.FC<MemoryBrowserProps> = ({
    username,
    isGlobalMemoryEnabled = false,
}) => {
    const [view, setView] = useState<ViewLevel>('categories');
    const [folders, setFolders] = useState<MemoryFolder[]>([]);
    const [files, setFiles] = useState<MemoryFile[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<MemoryFolder | null>(null);
    const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);

    const activeUser = username || 'default';

    // Load data on mount
    useEffect(() => {
        initMemoryFiles(activeUser).then(() => {
            const store = getMemoryFiles();
            setFolders(store.folders);
            setFiles(store.files);
        });
    }, [activeUser]);

    // Refresh from cache
    const refresh = useCallback(() => {
        const store = getMemoryFiles();
        setFolders(store.folders);
        setFiles(store.files);
    }, []);

    // Files in the selected folder (sorted by name)
    const folderFiles = useMemo(() => {
        if (!selectedFolder) return [];
        return files
            .filter(f => f.folderId === selectedFolder.id)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [files, selectedFolder]);

    // File count per folder
    const folderFileCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        files.forEach(f => {
            counts[f.folderId] = (counts[f.folderId] || 0) + 1;
        });
        return counts;
    }, [files]);

    // Last updated for a folder (most recent file)
    const folderLastUpdated = useCallback(
        (folderId: string): number | null => {
            const folderFiles = files.filter(f => f.folderId === folderId);
            if (folderFiles.length === 0) return null;
            const mostRecent = folderFiles.reduce((latest, f) =>
                f.updatedAt > latest.updatedAt ? f : latest
            );
            return mostRecent.updatedAt;
        },
        [files]
    );

    // Navigate to folder
    const openFolder = useCallback((folder: MemoryFolder) => {
        setSelectedFolder(folder);
        setView('files');
    }, []);

    // Navigate to file
    const openFile = useCallback((file: MemoryFile) => {
        setSelectedFile(file);
        setView('content');
    }, []);

    // Back navigation
    const goBack = useCallback(() => {
        if (view === 'content') {
            setSelectedFile(null);
            setView('files');
        } else if (view === 'files') {
            setSelectedFolder(null);
            setView('categories');
        }
    }, [view]);

    // Format relative time (from Unix timestamp in ms)
    const formatRelativeTime = useCallback((timestamp: number | null): string => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `${diffH}h ago`;
        const diffD = Math.floor(diffH / 24);
        if (diffD < 7) return `${diffD}d ago`;
        return date.toLocaleDateString();
    }, []);

    // ─── Level 1: Categories ──────────────────────────────────────────
    if (view === 'categories') {
        return (
            <div className="flex flex-col h-full bg-transparent overflow-y-auto custom-scrollbar">
                <div className="p-4 sm:p-6 space-y-6">
                    {/* Title */}
                    <h2 className="text-xl font-bold text-white">Memory</h2>

                    {/* Workspace Memory toggle */}
                    <div className="p-4 bg-zinc-900 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-bold text-white">Workspace Memory</h3>
                                <p className="text-xs text-zinc-400 mt-1">
                                    Save and reuse long-term context in workspaces. Applies to new
                                    sessions and may increase model requests and token costs.
                                </p>
                            </div>
                            <div className="ml-4 shrink-0">
                                <ToggleSwitch
                                    checked={isGlobalMemoryEnabled}
                                    onChange={() => {}}
                                    label="Workspace Memory"
                                    disabled
                                />
                            </div>
                        </div>
                    </div>

                    {/* Saved categories section */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-bold text-white">Saved memory categories</h3>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                    Select a category to view all of its saved files.
                                </p>
                            </div>
                            <button
                                onClick={refresh}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                title="Refresh"
                            >
                                <RefreshIcon className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Folder list */}
                        <div className="space-y-2">
                            {folders
                                .sort((a, b) => a.order - b.order)
                                .map(folder => {
                                    const count = folderFileCounts[folder.id] || 0;
                                    const lastUpd = folderLastUpdated(folder.id);
                                    return (
                                        <button
                                            key={folder.id}
                                            onClick={() => openFolder(folder)}
                                            className="w-full flex items-center gap-3 p-3 bg-zinc-900 rounded-xl border border-white/5 hover:bg-zinc-800 transition-colors text-left group"
                                        >
                                            <FolderIcon className="w-5 h-5 text-zinc-500 group-hover:text-zinc-300 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-medium text-white">
                                                    {folder.name}
                                                </span>
                                                <span className="text-xs text-zinc-500 ml-2">
                                                    {count} {count === 1 ? 'file' : 'files'}
                                                    {lastUpd && (
                                                        <> · Updated {formatRelativeTime(lastUpd)}</>
                                                    )}
                                                </span>
                                            </div>
                                            <ChevronRightIcon className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                                        </button>
                                    );
                                })}
                        </div>
                    </div>

                    {/* Edit note */}
                    <p className="text-[10px] text-zinc-600 text-center">
                        Editing happens in Settings → Memory
                    </p>
                </div>
            </div>
        );
    }

    // ─── Level 2: File List ───────────────────────────────────────────
    if (view === 'files' && selectedFolder) {
        return (
            <div className="flex flex-col h-full bg-transparent overflow-y-auto custom-scrollbar">
                <div className="p-4 sm:p-6 space-y-5">
                    {/* Back + refresh header */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={goBack}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        >
                            <ChevronLeftIcon className="w-3.5 h-3.5" /> Back
                        </button>
                        <button
                            onClick={refresh}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                            title="Refresh"
                        >
                            <RefreshIcon className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Folder header */}
                    <div>
                        <h2 className="text-xl font-bold text-white">{selectedFolder.name}</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {folderFiles.length} {folderFiles.length === 1 ? 'file' : 'files'}
                        </p>
                    </div>

                    {/* File list */}
                    <div className="space-y-2">
                        {folderFiles.map(file => (
                            <button
                                key={file.id}
                                onClick={() => openFile(file)}
                                className="w-full flex items-center gap-3 p-3 bg-zinc-900 rounded-xl border border-white/5 hover:bg-zinc-800 transition-colors text-left group"
                            >
                                <FileTextIcon className="w-5 h-5 text-zinc-500 group-hover:text-zinc-300 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-white">
                                        {file.name}
                                    </span>
                                    {file.autoManaged && (
                                        <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                                            auto
                                        </span>
                                    )}
                                </div>
                                <ChevronRightIcon className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                            </button>
                        ))}
                        {folderFiles.length === 0 && (
                            <p className="text-xs text-zinc-600 italic text-center py-8">
                                No files in this folder yet
                            </p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ─── Level 3: Content View ────────────────────────────────────────
    if (view === 'content' && selectedFile) {
        return (
            <div className="flex flex-col h-full bg-transparent overflow-y-auto custom-scrollbar">
                <div className="p-4 sm:p-6 space-y-5">
                    {/* Back + refresh header */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={goBack}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        >
                            <ChevronLeftIcon className="w-3.5 h-3.5" /> Back
                        </button>
                        <button
                            onClick={refresh}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                            title="Refresh"
                        >
                            <RefreshIcon className="w-4 h-4" />
                        </button>
                    </div>

                    {/* File header */}
                    <div>
                        <h2 className="text-xl font-bold text-white">{selectedFile.name}</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {selectedFolder?.name}
                            {selectedFile.autoManaged && (
                                <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                                    auto
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Rendered content */}
                    {selectedFile.content ? (
                        <div className="p-4 bg-zinc-900 rounded-xl border border-white/5">
                            <MarkdownRenderer content={selectedFile.content} />
                        </div>
                    ) : (
                        <div className="text-xs text-zinc-600 italic text-center py-8">
                            This file is empty
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Fallback (shouldn't happen)
    return null;
};

export default MemoryBrowser;
