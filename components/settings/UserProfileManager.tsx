import React, { useState, useRef } from 'react';
import { BotIcon, UserIcon, UploadIcon, TrashIcon, CloseIcon } from '../shared/Icons';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface UserProfileManagerProps {
  isVisible: boolean;
  isLoading?: boolean;
  onUserSelect: (username: string) => void | Promise<void>;
  existingUsers: string[];
  onImportProfile: (fileContent: string) => Promise<void>;
  onDeleteUser: (username: string) => void | Promise<void>;
  onClose?: () => void;
}

const UserProfileManager: React.FC<UserProfileManagerProps> = ({ isVisible, isLoading = false, onUserSelect, existingUsers, onImportProfile, onDeleteUser, onClose }) => {
  const [newUsername, setNewUsername] = useState('');
  const [formError, setFormError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = isLoading || isPending;

  const isFreshBlank = isVisible && existingUsers.length === 0;
  // A fresh install cannot close to a blank canvas, nor can a pending
  // profile operation be dismissed halfway through.
  const canClose = !isFreshBlank && !isBusy;
  useEscapeClose(Boolean(onClose) && isVisible && canClose, () => onClose?.());

  if (!isVisible) return null;

  const runAction = async (action: () => void | Promise<void>, username: string | null = null): Promise<void> => {
    // The ref also guards repeated events before React commits disabled state.
    if (isLoading || pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    setSelectedUser(username);
    setFormError('');
    try {
      await action();
    } catch (error) {
      console.error('[UserProfileManager] Profile operation failed:', error);
      setFormError('Could not complete the profile operation. Please try again.');
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  };

  const handleCreateUser = (e: React.FormEvent): void => {
    e.preventDefault();
    if (isBusy || pendingRef.current) return;
    const trimmedUsername = newUsername.trim();
    if (trimmedUsername) {
      if (existingUsers.find(u => u.toLowerCase() === trimmedUsername.toLowerCase())) {
        setFormError('Username already exists. Please choose another.');
      } else {
        void runAction(() => onUserSelect(trimmedUsername), trimmedUsername);
      }
    }
  };

  const handleImportClick = (): void => {
    if (!isBusy && !pendingRef.current) fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void runAction(async (): Promise<void> => {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Could not read the file.'));
        };
        reader.onerror = (): void => reject(new Error('Error reading file.'));
        reader.readAsText(file);
      });
      await onImportProfile(text);
    });
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="User profile selection" aria-busy={isBusy} onClick={(e) => { if (e.target === e.currentTarget && canClose && !pendingRef.current) onClose?.(); }}>
      <div className="relative w-full max-w-md bg-zinc-900 rounded-3xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative px-8 py-10 text-center border-b border-white/5">
              {onClose && !isFreshBlank && (
                  <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => { if (!pendingRef.current) onClose(); }}
                      aria-label="Close user selection"
                      className="absolute right-4 top-4 p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                      <CloseIcon />
                  </button>
              )}
              <div className="flex justify-center mb-6">
                  <div className="w-20 h-20 bg-zinc-800 border border-zinc-700 rounded-2xl shadow-xl shadow-black/20 flex items-center justify-center text-zinc-200 transform rotate-3 hover:rotate-0 transition-transform duration-500">
                      <BotIcon />
                  </div>
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight mb-2">August Trading</h1>
              <p className="text-zinc-400 text-sm font-medium">Advanced Trading Intelligence Terminal</p>
          </div>

          <div className="p-8 space-y-8">
             {isBusy && <p role="status" className="text-sm text-zinc-300">{selectedUser ? `Loading profile ${selectedUser}…` : 'Profile operation in progress…'}</p>}
             {/* Existing Users */}
             {existingUsers.length > 0 && (
                 <div className="space-y-3">
                     <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1 block">Continue Session</label>
                     <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                         {existingUsers.map(user => (
                             <div key={user} className="flex items-center gap-1 rounded-xl bg-zinc-800 border border-white/5 pr-2">
                                 <button
                                    type="button"
                                    aria-label={`Continue session as ${user}`}
                                    aria-busy={isBusy && selectedUser === user}
                                    disabled={isBusy}
                                    className="group flex flex-1 min-w-0 items-center gap-3 p-3 rounded-xl text-left hover:bg-zinc-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-60 disabled:cursor-wait"
                                    onClick={() => { void runAction(() => onUserSelect(user), user); }}
                                 >
                                     <span className="w-10 h-10 shrink-0 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200 transition-colors">
                                         <UserIcon />
                                     </span>
                                     <span className="flex-1 truncate font-medium text-zinc-200 group-hover:text-white">{user}</span>
                                     {isBusy && selectedUser === user && <span className="text-xs text-zinc-400">Loading…</span>}
                                 </button>
                                 <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => { void runAction(() => onDeleteUser(user)); }}
                                    aria-label={`Delete user ${user}`}
                                    className="p-2 text-zinc-600 hover:text-red-400 focus-visible:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-60 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-wait disabled:opacity-30"
                                    title="Delete User"
                                 >
                                     <TrashIcon />
                                 </button>
                             </div>
                         ))}
                     </div>
                 </div>
             )}

             {/* New User Form */}
             <form onSubmit={handleCreateUser} className="space-y-4">
                 <div className="relative group">
                    <input 
                        type="text"
                        disabled={isBusy}
                        value={newUsername} 
                        onChange={(e) => { setNewUsername(e.target.value); setFormError(''); }} 
                        placeholder="Create New Workspace" 
                        className={`w-full bg-zinc-950 border rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all font-medium ${formError ? 'border-red-500/50' : 'border-white/10'}`}
                        autoFocus
                        aria-invalid={!!formError}
                        aria-describedby={formError ? 'username-error' : undefined}
                    />
                    {formError && <p id="username-error" className="mt-2 text-xs text-red-400" role="alert">{formError}</p>}
                    <button 
                        type="submit" 
                        disabled={isBusy || !newUsername.trim()}
                        className="absolute right-2 top-2 bottom-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg disabled:opacity-0 disabled:translate-x-4 transition-all duration-300"
                    >
                        Enter
                    </button>
                 </div>
             </form>

             {/* Footer Actions */}
             <div className="pt-4 border-t border-white/5 flex justify-center">
                 <input 
                     type="file"
                     disabled={isBusy}
                     ref={fileInputRef} 
                     onChange={handleFileChange} 
                     className="hidden" 
                     accept=".json" 
                 />
                 <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleImportClick} 
                    className="flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-cyan-400 uppercase tracking-widest transition-colors py-2 px-4 rounded-lg hover:bg-zinc-800"
                 >
                     <UploadIcon /> Import Backup Data
                 </button>
             </div>
          </div>
      </div>
    </div>
  );
};

export default UserProfileManager;