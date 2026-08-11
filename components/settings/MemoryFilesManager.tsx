import React, { useState, useEffect, useCallback } from 'react';
import { MemoryFile, MemoryFolder } from '../../types';
import { useToastActions } from '../shared/Toast';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import {
    initMemoryFiles,
    getMemoryFiles,
    getMemoryFilesStats,
    createMemoryFolder,
    renameMemoryFolder,
    moveMemoryFolder,
    deleteMemoryFolder,
    createMemoryFile,
    updateMemoryFile,
    deleteMemoryFile,
} from '../../services/learning/MemoryFilesService';

interface MemoryFilesManagerProps {
    /** Active user — notebook files are stored per-user. */
    username?: string;
}

/**
 * Settings → Personal edge → Trader Notebook: folders of markdown files the
 * model can actually READ. Every enabled file's full content is injected into
 * analyst prompts, the moderator bundle, and post-mortem prompts. The harness
 * auto-maintains profile/memory.md, trader-diary/<coin>.md and
 * rules/recurring-mistakes.md; everything else is the user's own knowledge.
 */
const MemoryFilesManager: React.FC<MemoryFilesManagerProps> = ({ username }) => {
    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [folders, setFolders] = useState<MemoryFolder[]>([]);
    const [files, setFiles] = useState<MemoryFile[]>([]);
    const [stats, setStats] = useState({ enabledCount: 0, charCount: 0 });
    const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isPreview, setIsPreview] = useState(false);
    // Inline create forms
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    // Folder rename (inline input) + drag-to-reorder
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renameFolderName, setRenameFolderName] = useState('');
    const [dragFolderId, setDragFolderId] = useState<string | null>(null);

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
            // Land on the first folder when the view opens (skip 'all').
            setSelectedFolderId(prev => {
                const { folders } = getMemoryFiles();
                return prev === 'all' && folders.length > 0 ? folders[0].id : prev;
            });
        });
        return () => { cancelled = true; };
    }, [activeUser, refresh]);

    const selectedFile = selectedFileId ? files.find(f => f.id === selectedFileId) ?? null : null;

    // Folder-filtered file list ('all' shows every file).
    const visibleFiles = selectedFolderId === 'all'
        ? files
        : files.filter(f => f.folderId === selectedFolderId);

    const openFile = useCallback((file: MemoryFile) => {
        setSelectedFileId(file.id);
        setDraft(file.content);
        setIsDirty(false);
        setIsPreview(false);
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
        } catch (e: any) {
            toast.error('Could not create folder', e?.message || 'Unknown error');
        }
    }, [newFolderName, activeUser, refresh, toast]);

    const handleRenameFolder = useCallback(async (folder: MemoryFolder) => {
        const name = renameFolderName.trim();
        setRenamingFolderId(null);
        setRenameFolderName('');
        if (!name || name === folder.name) return;
        try {
            const clean = await renameMemoryFolder(folder.id, name, activeUser);
            refresh();
            toast.success('Folder renamed', `Folder is now "${clean ?? name}".`);
        } catch (e: any) {
            toast.error('Could not rename folder', e?.message || 'Unknown error');
        }
    }, [renameFolderName, activeUser, refresh, toast]);

    const handleDropOn = useCallback(async (targetId: string) => {
        if (!dragFolderId || dragFolderId === targetId) return;
        try {
            const targetIndex = folders.findIndex(f => f.id === targetId);
            await moveMemoryFolder(dragFolderId, targetIndex, activeUser);
            refresh();
        } catch (e: any) {
            toast.error('Could not reorder folder', e?.message || 'Unknown error');
        } finally {
            setDragFolderId(null);
        }
    }, [dragFolderId, folders, activeUser, refresh, toast]);

    const handleDeleteFolder = useCallback(async (folder: MemoryFolder) => {
        const count = files.filter(f => f.folderId === folder.id).length;
        const ok = await confirm({
            title: `Delete "${folder.name}"?`,
            message: count > 0
                ? `This deletes the folder and its ${count} file${count === 1 ? '' : 's'}. This cannot be undone.`
                : 'This folder is empty. Delete it?',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMemoryFolder(folder.id, activeUser);
            if (selectedFolderId === folder.id) setSelectedFolderId('all');
            if (selectedFileId && files.some(f => f.id === selectedFileId && f.folderId === folder.id)) {
                setSelectedFileId(null);
            }
            refresh();
            toast.success('Folder deleted', `"${folder.name}" was removed.`);
        } catch (e: any) {
            toast.error('Could not delete folder', e?.message || 'Unknown error');
        }
    }, [files, selectedFolderId, selectedFileId, activeUser, refresh, toast, confirm]);

    const handleCreateFile = useCallback(async () => {
        const name = newFileName.trim();
        if (!name || selectedFolderId === 'all') return;
        try {
            const content = `# ${name.replace(/\.md$/i, '')}\n\nWrite what the model should know about this topic — it reads this file on every analysis.\n`;
            const file = await createMemoryFile(selectedFolderId, name, content, activeUser);
            refresh();
            setIsCreatingFile(false);
            setNewFileName('');
            openFile(file);
            toast.success('File created', `"${file.name}" was added to the notebook.`);
        } catch (e: any) {
            toast.error('Could not create file', e?.message || 'Unknown error');
        }
    }, [newFileName, selectedFolderId, activeUser, refresh, toast, openFile]);

    const handleSave = useCallback(async () => {
        if (!selectedFile) return;
        try {
            await updateMemoryFile(selectedFile.id, { content: draft }, activeUser);
            setIsDirty(false);
            refresh();
            toast.success('Saved', `"${selectedFile.name}" is now injected into future prompts.`);
        } catch (e: any) {
            toast.error('Could not save', e?.message || 'Unknown error');
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
        } catch (e: any) {
            toast.error('Could not toggle file', e?.message || 'Unknown error');
        }
    }, [activeUser, refresh, toast]);

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
        } catch (e: any) {
            toast.error('Could not delete file', e?.message || 'Unknown error');
        }
    }, [selectedFileId, activeUser, refresh, toast, confirm]);

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Header — what this is + what the model sees */}
            <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-zinc-800 shrink-0">
                <div>
                    <h4 className="text-sm font-bold text-white">📓 Trader Notebook</h4>
                    <p className="text-xs text-zinc-500 mt-0.5">
                        Markdown files the model can READ — every enabled file is injected into analyses, debates, and post-mortems.
                    </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 shrink-0">
                    {stats.enabledCount} file{stats.enabledCount === 1 ? '' : 's'} on · {stats.charCount.toLocaleString()} chars
                </span>
            </div>

            {/* Body — folder sidebar + file browser/editor */}
            <div className="flex-1 min-h-0 flex gap-3 pt-3">
                {/* Folders */}
                <div className="w-52 shrink-0 flex flex-col min-h-0 border border-zinc-800/80 rounded-xl bg-zinc-900/60 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 shrink-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Folders</span>
                        <button
                            onClick={() => { setIsCreatingFolder(v => !v); setIsCreatingFile(false); }}
                            className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            + New
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                        {isCreatingFolder && (
                            <div className="p-1.5 flex gap-1">
                                <input
                                    autoFocus
                                    value={newFolderName}
                                    onChange={e => setNewFolderName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); } }}
                                    placeholder="folder-name"
                                    className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-100 focus:outline-none focus:border-cyan-500/60"
                                />
                            </div>
                        )}
                        <button
                            onClick={() => setSelectedFolderId('all')}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                selectedFolderId === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                            }`}
                        >
                            <span>All files</span>
                            <span className="text-[9px] font-mono text-zinc-600">{files.length}</span>
                        </button>
                        {folders.map(folder => {
                            const count = files.filter(f => f.folderId === folder.id).length;
                            const isActive = selectedFolderId === folder.id;
                            const isRenaming = renamingFolderId === folder.id;
                            return (
                                <div
                                    key={folder.id}
                                    draggable
                                    onDragStart={() => setDragFolderId(folder.id)}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={() => handleDropOn(folder.id)}
                                    onDragEnd={() => setDragFolderId(null)}
                                    className={`group flex items-center rounded-lg ${dragFolderId === folder.id ? 'opacity-40' : ''}`}
                                    title="Drag to reorder — the model reads folders top to bottom"
                                >
                                    {isRenaming ? (
                                        <div className="flex-1 min-w-0 px-1 py-1">
                                            <input
                                                autoFocus
                                                value={renameFolderName}
                                                onChange={e => setRenameFolderName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') handleRenameFolder(folder);
                                                    if (e.key === 'Escape') { setRenamingFolderId(null); setRenameFolderName(''); }
                                                }}
                                                onBlur={() => { setRenamingFolderId(null); setRenameFolderName(''); }}
                                                className="w-full px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-100 focus:outline-none focus:border-cyan-500/60"
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setSelectedFolderId(folder.id)}
                                            className={`flex-1 min-w-0 flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                                isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                                            }`}
                                        >
                                            <span className="truncate">{folder.name}</span>
                                            <span className="text-[9px] font-mono text-zinc-600 shrink-0 ml-1">{count}</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); }}
                                        className="opacity-0 group-hover:opacity-100 ml-0.5 p-1 rounded text-zinc-600 hover:text-cyan-300 transition-all"
                                        aria-label={`Rename folder ${folder.name}`}
                                        title="Rename"
                                    >
                                        ✎
                                    </button>
                                    <button
                                        onClick={() => handleDeleteFolder(folder)}
                                        className="opacity-0 group-hover:opacity-100 ml-0.5 p-1 rounded text-zinc-600 hover:text-rose-400 transition-all"
                                        aria-label={`Delete folder ${folder.name}`}
                                        title={`Delete ${folder.name}`}
                                    >
                                        ✕
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="shrink-0 px-3 py-2 border-t border-zinc-800/80">
                        <p className="text-[9px] text-zinc-600 leading-relaxed">
                            Drag folders to reorder — the model reads them top to bottom.
                        </p>
                    </div>
                </div>

                {/* Files + editor */}
                <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-3">
                    {selectedFile ? (
                        <>
                            {/* File header — name, toggles, actions */}
                            <div className="shrink-0 flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl border border-zinc-800/80 bg-zinc-900/60">
                                <span className="text-xs font-bold text-white truncate max-w-[200px]">{selectedFile.name}</span>
                                <span className="text-[9px] font-mono text-zinc-600 shrink-0">{selectedFile.folderId}/</span>
                                {selectedFile.autoManaged && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0" title="The app rewrites this file automatically">auto</span>
                                )}
                                <span className="text-[9px] font-mono text-zinc-600 shrink-0">{draft.length.toLocaleString()} chars</span>
                                <div className="ml-auto flex items-center gap-2 shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Inject</span>
                                        <ToggleSwitch checked={selectedFile.enabled} onChange={() => handleToggleEnabled(selectedFile)} label="Toggle file injection" />
                                    </div>
                                    <button
                                        onClick={() => setIsPreview(v => !v)}
                                        className="px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                    >
                                        {isPreview ? 'Write' : 'Preview'}
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={!isDirty}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => handleDeleteFile(selectedFile)}
                                        className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            {/* Editor / preview */}
                            <div className="flex-1 min-h-0 rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden flex flex-col">
                                {isPreview ? (
                                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 prose-sm">
                                        <MarkdownRenderer content={draft} />
                                    </div>
                                ) : (
                                    <textarea
                                        value={draft}
                                        onChange={e => { setDraft(e.target.value); setIsDirty(true); }}
                                        spellCheck={false}
                                        className="flex-1 w-full resize-none bg-transparent p-4 text-[12px] leading-relaxed text-zinc-200 font-mono focus:outline-none custom-scrollbar"
                                        placeholder="# Write what the model should know…"
                                    />
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0 border border-zinc-800/80 rounded-xl bg-zinc-900/60 overflow-hidden">
                            {/* File list header */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 shrink-0">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                                    {selectedFolderId === 'all' ? 'All files' : folders.find(f => f.id === selectedFolderId)?.name ?? 'Files'}
                                </span>
                                <button
                                    onClick={() => { setIsCreatingFile(v => !v); setIsCreatingFolder(false); }}
                                    disabled={selectedFolderId === 'all'}
                                    className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    title={selectedFolderId === 'all' ? 'Pick a folder first' : 'Create a markdown file'}
                                >
                                    + New file
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                                {isCreatingFile && (
                                    <div className="p-1.5 flex gap-1">
                                        <input
                                            autoFocus
                                            value={newFileName}
                                            onChange={e => setNewFileName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleCreateFile(); if (e.key === 'Escape') { setIsCreatingFile(false); setNewFileName(''); } }}
                                            placeholder="my-note.md"
                                            className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-100 focus:outline-none focus:border-cyan-500/60"
                                        />
                                    </div>
                                )}
                                {visibleFiles.length === 0 ? (
                                    <div className="p-6 text-center">
                                        <p className="text-xs text-zinc-500">
                                            {selectedFolderId === 'all'
                                                ? 'No files yet — pick a folder and create the first note.'
                                                : 'This folder is empty. Create the first file.'}
                                        </p>
                                    </div>
                                ) : (
                                    visibleFiles.map(file => (
                                        <button
                                            key={file.id}
                                            onClick={() => handleFileSwitch(file)}
                                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                                                selectedFileId === file.id ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                                            }`}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${file.enabled ? 'bg-cyan-400' : 'bg-zinc-700'}`} title={file.enabled ? 'Injected into prompts' : 'Not injected'} />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-[11px] font-semibold text-zinc-200 truncate">{file.name}</span>
                                                <span className="block text-[9px] font-mono text-zinc-600">
                                                    {file.content.length.toLocaleString()} chars · {new Date(file.updatedAt).toLocaleDateString()}
                                                    {file.autoManaged ? ' · auto' : ''}
                                                </span>
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

export default React.memo(MemoryFilesManager);
