import React, { useState, useEffect, useCallback } from 'react';
import { MemoryFile, MemoryFolder } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { useToastActions } from '../shared/Toast';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import MarkdownContent from '../shared/MarkdownContent';
import { FileTextIcon, ChevronRightIcon, ChevronLeftIcon, FolderIcon } from '../shared/Icons';
import { Sparkles, Loader2 } from 'lucide-react';
import { runNotebookReview } from '../../services/learning/MemoryReviewService';
import { parseSkillMarkdown, serializeSkill, titleFromMeta} from '../../services/learning/SkillMemoryService';
import {
    initMemoryFiles,
    getMemoryFiles,
    getMemoryFilesStats,
    createMemoryFolder,
    createMemoryFile,
    updateMemoryFile,
    deleteMemoryFile,
    moveMemoryFolder,
    SUGGESTIONS_FILE_NAME,
    subscribeMemoryFilesChanged,
} from '../../services/learning/MemoryFilesService';

interface MemoryFilesManagerProps {
    /** Active user — notebook files are stored per-user. */
    username?: string;
    isGlobalMemoryEnabled?: boolean;
    setIsGlobalMemoryEnabled?: (enabled: boolean) => void;
    /** Memory provider/model picker (Settings). */
    memoryConfig?: ProviderConfig | null;
}

/**
 * Settings → Memory: folders of markdown files the model can READ.
 * The harness auto-maintains profile/, trader-diary/, rules/, and skills/.
 */
const MemoryFilesManager: React.FC<MemoryFilesManagerProps> = ({
    username,
    isGlobalMemoryEnabled,
    setIsGlobalMemoryEnabled,
    memoryConfig,
}) => {
    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [folders, setFolders] = useState<MemoryFolder[]>([]);
    const [files, setFiles] = useState<MemoryFile[]>([]);
    const [stats, setStats] = useState({ enabledCount: 0, charCount: 0 });
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isPreview, setIsPreview] = useState(false);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [newFileName, setNewFileName] = useState('');

    const activeUser = username || 'default';

    const refresh = useCallback(() => {
        const { folders, files } = getMemoryFiles();
        setFolders(folders);
        setFiles(files);
        setStats(getMemoryFilesStats());
    }, []);

    useEffect(() => {
        let cancelled = false;
        initMemoryFiles(activeUser).then(() => {
            if (cancelled) return;
            refresh();
        });
        return () => { cancelled = true; };
    }, [activeUser, refresh]);

    useEffect(() => subscribeMemoryFilesChanged(() => refresh()), [refresh]);

    const selectedFile = selectedFileId ? files.find(f => f.id === selectedFileId) ?? null : null;

    const selectedFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) ?? null : null;

    const suggestionsFile = files.find(f => f.name === SUGGESTIONS_FILE_NAME) ?? null;

    const visibleFiles = selectedFolderId
        ? files.filter(f => f.folderId === selectedFolderId && f.name !== SUGGESTIONS_FILE_NAME)
        : [];

    const openFile = useCallback((file: MemoryFile) => {
        setSelectedFileId(file.id);
        setDraft(file.content);
        setIsDirty(false);
        setIsPreview(true);
    }, []);

    const handleFileSwitch = useCallback(async (file: MemoryFile) => {
        if (isDirty) {
            const ok = await confirm({
                title: 'Discard unsaved changes?',
                message: `You have unsaved edits to "${selectedFile?.name}". They will be lost if you switch files.`,
                confirmLabel: 'Discard',
                destructive: true,
            });
            if (!ok) return;
        }
        openFile(file);
    }, [isDirty, selectedFile, confirm, openFile]);

    const goBackToList = useCallback(async () => {
        if (isDirty) {
            const ok = await confirm({
                title: 'Discard unsaved changes?',
                message: `You have unsaved edits to "${selectedFile?.name}". They will be lost if you go back.`,
                confirmLabel: 'Discard',
                destructive: true,
            });
            if (!ok) return;
        }
        setSelectedFileId(null);
        setIsDirty(false);
    }, [isDirty, selectedFile, confirm]);

    const goBackToFolders = useCallback(async () => {
        if (selectedFileId) {
            await goBackToList();
            return;
        }
        setSelectedFolderId(null);
        setIsCreatingFile(false);
    }, [selectedFileId, goBackToList]);

    const handleCreateFolder = useCallback(async () => {
        const name = newFolderName.trim();
        if (!name) return;
        try {
            const folder = await createMemoryFolder(name, activeUser);
            refresh();
            setIsCreatingFolder(false);
            setNewFolderName('');
            setSelectedFolderId(folder.id);
            toast.success('Folder created', `"${folder.name}" is ready for files.`);
        } catch (e: unknown) {
            toast.error('Could not create folder', e instanceof Error ? e.message : 'Unknown error');
        }
    }, [newFolderName, activeUser, refresh, toast]);

    const handleCreateFile = useCallback(async () => {
        const name = newFileName.trim();
        if (!name || !selectedFolderId) return;
        try {
            const content = `# ${name.replace(/\.md$/i, '')}\n\nWrite what the model should know about this topic — it reads this file on every analysis.\n`;
            const file = await createMemoryFile(selectedFolderId, name, content, activeUser);
            refresh();
            setIsCreatingFile(false);
            setNewFileName('');
            openFile(file);
            toast.success('File created', `"${file.name}" was added to the notebook.`);
        } catch (e: unknown) {
            toast.error('Could not create file', e instanceof Error ? e.message : 'Unknown error');
        }
    }, [newFileName, selectedFolderId, activeUser, refresh, toast, openFile]);

    const handleSave = useCallback(async () => {
        if (!selectedFile) return;
        try {
            await updateMemoryFile(selectedFile.id, { content: draft }, activeUser);
            setIsDirty(false);
            refresh();
            toast.success('Saved', `"${selectedFile.name}" is now injected into future prompts.`);
        } catch (e: unknown) {
            toast.error('Could not save', e instanceof Error ? e.message : 'Unknown error');
        }
    }, [selectedFile, draft, activeUser, refresh, toast]);

    const handleToggleEnabled = useCallback(async (file: MemoryFile) => {
        try {
            await updateMemoryFile(file.id, { enabled: !file.enabled }, activeUser);
            refresh();
            toast.success(file.enabled ? 'Disabled' : 'Enabled',
                file.enabled
                    ? `"${file.name}" is no longer injected.`
                    : `"${file.name}" is now injected into every prompt.`);
        } catch (e: unknown) {
            toast.error('Could not toggle file', e instanceof Error ? e.message : 'Unknown error');
        }
    }, [activeUser, refresh, toast]);

    const formatFolderUpdated = useCallback((folderId: string): string => {
        const inFolder = files.filter(f => f.folderId === folderId && f.name !== SUGGESTIONS_FILE_NAME);
        if (inFolder.length === 0) return 'Empty';
        const latest = inFolder.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
        const date = new Date(latest.updatedAt);
        const now = new Date();
        const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
        if (date.toDateString() === now.toDateString()) return `Updated today at ${time}`;
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return `Updated yesterday at ${time}`;
        return `Updated ${date.toLocaleDateString()}`;
    }, [files]);

    const handleDeleteFile = useCallback(async (file: MemoryFile) => {
        const ok = await confirm({
            title: `Delete "${file.name}"?`,
            message: file.autoManaged
                ? 'This file is auto-maintained by the app and will be regenerated on the next sync.'
                : 'This file will be permanently removed from the notebook.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMemoryFile(file.id, activeUser);
            if (selectedFileId === file.id) setSelectedFileId(null);
            refresh();
            toast.success('File deleted', `"${file.name}" was removed.`);
        } catch (e: unknown) {
            toast.error('Could not delete file', e instanceof Error ? e.message : 'Unknown error');
        }
    }, [selectedFileId, activeUser, refresh, toast, confirm]);

    const handleRunReview = useCallback(async () => {
        if (!memoryConfig?.apiKey) {
            toast.error('Pick a Memory model', 'Settings → Memory needs a provider before reviews can run.');
            return;
        }
        setIsReviewing(true);
        try {
            const wrote = await runNotebookReview(activeUser, memoryConfig);
            refresh();
            if (wrote) toast.success('Suggestions updated', 'The Memory model finished reviewing the notebook.');
            else toast.success('Review finished', 'No new suggestions this time.');
        } catch (e: unknown) {
            toast.error('Review failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsReviewing(false);
        }
    }, [memoryConfig, activeUser, refresh, toast]);

    return (
        <div className="flex flex-col h-full min-h-0 px-8 py-8 lg:px-12 lg:py-10">
            <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0">
            <div className="flex items-start justify-between gap-4 shrink-0 mb-8">
                <div>
                    <h3 className="text-3xl font-semibold text-zinc-100 tracking-tight">Memory</h3>
                    <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
                        Notebook files the model reads. Skills, diaries, and rules live here.
                    </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500 pt-2">
                    {stats.enabledCount} enabled · {stats.charCount.toLocaleString()} chars
                </span>
            </div>

            <div className="flex flex-wrap items-end gap-4 shrink-0 mb-8">
                {/* ROUND-33: the Memory Model picker moved to Settings →
                    AI Setup (it owns every learning pass); this surface shows
                    a read-only pointer so ownership stays discoverable. */}
                {memoryConfig && (
                    <div className="pb-2">
                        <span className="text-[10px] uppercase tracking-widest text-zinc-600">Managed by </span>
                        <span className="text-xs text-zinc-400">{memoryConfig.selectedModel || memoryConfig.name || 'memory model'}</span>
                    </div>
                )}
                {setIsGlobalMemoryEnabled && (
                    <div className="flex items-center gap-3 pb-2 ml-auto">
                        <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">Global memory</span>
                        <ToggleSwitch
                            checked={!!isGlobalMemoryEnabled}
                            onChange={() => setIsGlobalMemoryEnabled(!isGlobalMemoryEnabled)}
                            label="Toggle Global Memory"
                        />
                    </div>
                )}
            </div>

            {isCreatingFolder && !selectedFolder && !selectedFile && (
                <div className="shrink-0 mb-4">
                    <input
                        autoFocus
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleCreateFolder(); if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); } }}
                        placeholder="new-folder"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                    />
                </div>
            )}

            {showSuggestions ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <button
                        type="button"
                        onClick={() => setShowSuggestions(false)}
                        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-6 self-start"
                    >
                        <ChevronLeftIcon className="w-4 h-4" /> Back
                    </button>
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <h4 className="text-lg font-medium text-zinc-100 tracking-tight">Suggestions</h4>
                        <button
                            type="button"
                            onClick={() => { void handleRunReview(); }}
                            disabled={isReviewing}
                            className="px-3 py-1.5 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 transition-colors"
                        >
                            {isReviewing ? 'Reviewing…' : 'Review now'}
                        </button>
                    </div>
                    <p className="text-sm text-zinc-500 mb-8">
                        Memory model review of your notebook. Not injected into analyses.
                    </p>
                    <div className="flex-1 min-h-[320px] rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                        {isReviewing ? (
                            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-zinc-500">
                                <Loader2 className="w-4 h-4 animate-spin" /> Reviewing notebook…
                            </div>
                        ) : suggestionsFile?.content.trim() ? (
                            <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-8 lg:px-10 lg:py-10">
                                <MarkdownContent content={suggestionsFile.content} className="text-[15px] leading-8" />
                            </div>
                        ) : (
                            <p className="text-sm text-zinc-500 text-center py-16 px-8">
                                No suggestions yet. After notebook files change, the Memory model reviews them here. You can also tap Review now.
                            </p>
                        )}
                    </div>
                </div>
            ) : selectedFile ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <button
                        onClick={() => { void goBackToList(); }}
                        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-6 self-start"
                    >
                        <ChevronLeftIcon className="w-4 h-4" /> Back
                    </button>
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <h4 className="text-lg font-medium text-zinc-100 tracking-tight font-mono">
                            {selectedFile.name}
                        </h4>
                        <div className="flex items-center gap-2 shrink-0">
                            <ToggleSwitch
                                checked={selectedFile.enabled}
                                onChange={() => { void handleToggleEnabled(selectedFile); }}
                                label="Toggle file injection"
                            />
                            <button
                                onClick={() => setIsPreview(v => !v)}
                                className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
                            >
                                {isPreview ? 'Write' : 'Preview'}
                            </button>
                            <button
                                onClick={() => { void handleSave(); }}
                                disabled={!isDirty}
                                className="px-3 py-1.5 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 transition-colors"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => { void handleDeleteFile(selectedFile); }}
                                className="status-surface px-3 py-1.5 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mb-8 flex-wrap">
                        <p className="text-sm text-zinc-500">
                            {folders.find(f => f.id === selectedFile.folderId)?.name ?? selectedFile.folderId}
                            {selectedFile.autoManaged ? ' · auto-maintained' : ''}
                            {' · '}{draft.length.toLocaleString()} chars
                        </p>
                        {selectedFolder?.name === 'skills' && (
                            <button
                                type="button"
                                title="Which debate audience may load this skill"
                                onClick={() => {
                                    const meta = parseSkillMarkdown(draft);
                                    if (!meta) return;
                                    const order: Array<'all' | 'analyst' | 'moderator'> = ['all', 'analyst', 'moderator'];
                                    const next = order[(order.indexOf(meta.audience ?? 'all') + 1) % order.length];
                                    const updated = { ...meta, audience: next, modifiedAt: new Date().toISOString() };
                                    const serialized = serializeSkill(updated, titleFromMeta(updated));
                                    setDraft(serialized);
                                    setIsDirty(true);
                                }}
                                className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors bg-zinc-900 border-white/10 text-zinc-400 hover:text-zinc-100"
                            >
                                audience: {(parseSkillMarkdown(draft)?.audience ?? 'all')}
                            </button>
                        )}
                    </div>
                    <div className="flex-1 min-h-[320px] rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                        {isPreview ? (
                            <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-8 lg:px-10 lg:py-10">
                                <MarkdownContent content={draft || '(empty file)'} className="text-[15px] leading-8" />
                            </div>
                        ) : (
                            <textarea
                                value={draft}
                                onChange={e => { setDraft(e.target.value); setIsDirty(true); }}
                                spellCheck={false}
                                className="flex-1 w-full resize-none bg-transparent px-8 py-8 lg:px-10 lg:py-10 text-[15px] leading-8 text-zinc-200 font-mono focus:outline-none custom-scrollbar"
                                placeholder="# Write what the model should know…"
                                aria-label={`Edit ${selectedFile.name}`}
                            />
                        )}
                    </div>
                </div>
            ) : selectedFolder ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <button
                        onClick={() => { void goBackToFolders(); }}
                        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-6 self-start"
                    >
                        <ChevronLeftIcon className="w-4 h-4" /> Back
                    </button>
                    <h4 className="text-lg font-medium text-zinc-100 tracking-tight font-mono mb-8">
                        {selectedFolder.name}
                    </h4>
                    <div className="flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                        <div className="flex items-center justify-end px-5 py-3 border-b border-zinc-800 shrink-0">
                            <button
                                type="button"
                                onClick={() => { setIsCreatingFile(v => !v); setIsCreatingFolder(false); }}
                                className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
                            >
                                New file
                            </button>
                        </div>
                        {isCreatingFile && (
                            <div className="px-5 py-3 border-b border-zinc-800">
                                <input
                                    autoFocus
                                    value={newFileName}
                                    onChange={e => setNewFileName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') void handleCreateFile(); if (e.key === 'Escape') { setIsCreatingFile(false); setNewFileName(''); } }}
                                    placeholder="my-note.md"
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                                />
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {visibleFiles.length === 0 ? (
                                <p className="text-sm text-zinc-500 text-center py-16">
                                    This folder is empty. Create the first file.
                                </p>
                            ) : (
                                visibleFiles.map(file => (
                                    <button
                                        key={file.id}
                                        type="button"
                                        onClick={() => { void handleFileSwitch(file); }}
                                        className="w-full flex items-center gap-3 px-5 py-4 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-800/80 transition-colors text-left"
                                    >
                                        <FileTextIcon className="w-5 h-5 text-zinc-500 shrink-0" />
                                        <span className="flex-1 min-w-0 font-mono text-sm text-zinc-100 truncate">
                                            {file.name}
                                        </span>
                                        {file.autoManaged && (
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 shrink-0">auto</span>
                                        )}
                                        {!file.enabled && (
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-600 shrink-0">off</span>
                                        )}
                                        <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-end px-5 py-3 border-b border-zinc-800 shrink-0">
                        <button
                            type="button"
                            onClick={() => { setIsCreatingFolder(v => !v); setIsCreatingFile(false); }}
                            className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
                        >
                            New folder
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <button
                            type="button"
                            onClick={() => {
                                setShowSuggestions(true);
                                setSelectedFolderId(null);
                                setSelectedFileId(null);
                            }}
                            className="w-full flex items-center gap-3.5 px-4 py-3.5 border-b border-zinc-800 hover:bg-zinc-800/80 transition-colors text-left"
                        >
                            <span className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center shrink-0">
                                <Sparkles className="w-4 h-4 text-zinc-400" />
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-medium text-zinc-100 truncate">Suggestions</span>
                                <span className="block text-xs text-zinc-500 mt-0.5 truncate">
                                    {suggestionsFile?.content.trim()
                                        ? `Updated ${new Date(suggestionsFile.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                                        : 'Memory model review — tap to open'}
                                </span>
                            </span>
                            <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                        </button>
                        {folders.length === 0 ? (
                            <p className="text-sm text-zinc-500 text-center py-16">No folders yet.</p>
                        ) : (
                            [...folders].sort((a, b) => a.order - b.order).map((folder, index, sorted) => {
                                const count = files.filter(f => f.folderId === folder.id && f.name !== SUGGESTIONS_FILE_NAME).length;
                                const handleMove = async (direction: -1 | 1): Promise<void> => {
                                    const target = sorted[index + direction];
                                    if (!target) return;
                                    try {
                                        await moveMemoryFolder(folder.id, target.order, activeUser);
                                        await initMemoryFiles(activeUser);
                                        setFolders(getMemoryFiles().folders);
                                        toast.success('Folder moved', `"${folder.name}" is now ${direction === -1 ? 'higher' : 'lower'} in the notebook.`);
                                    } catch (e) {
                                        toast.error('Could not move folder', e instanceof Error ? e.message : 'Unknown error');
                                    }
                                };
                                return (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedFolderId(folder.id);
                                            setIsCreatingFolder(false);
                                            setIsCreatingFile(false);
                                        }}
                                        className="w-full flex items-center gap-3.5 px-4 py-3.5 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-800/80 transition-colors text-left group/folder"
                                    >
                                        <span className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center shrink-0">
                                            <FolderIcon className="w-4 h-4 text-zinc-400" />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-sm font-medium text-zinc-100 truncate">
                                                {folder.name}
                                            </span>
                                            <span className="block text-xs text-zinc-500 mt-0.5 truncate">
                                                {count} {count === 1 ? 'file' : 'files'} · {formatFolderUpdated(folder.id)}
                                            </span>
                                        </span>
                                        <span className="hidden group-hover/folder:flex items-center shrink-0">
                                            <button
                                                type="button"
                                                aria-label={`Move ${folder.name} up`}
                                                title="Move up"
                                                disabled={index === 0}
                                                onClick={e => { e.stopPropagation(); void handleMove(-1); }}
                                                className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-30"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Move ${folder.name} down`}
                                                title="Move down"
                                                disabled={index === sorted.length - 1}
                                                onClick={e => { e.stopPropagation(); void handleMove(1); }}
                                                className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-30"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                                            </button>
                                        </span>
                                        <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0 group-hover/folder:hidden" />
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
            {ConfirmDialogComponent}
            </div>
        </div>
    );
};

export default React.memo(MemoryFilesManager);
