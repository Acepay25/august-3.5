import React, { useState, useRef } from 'react';
import { BotIcon, UserIcon, UploadIcon, TrashIcon } from '../shared/Icons';

interface UserProfileManagerProps {
  isVisible: boolean;
  onUserSelect: (username: string) => void;
  existingUsers: string[];
  onImportProfile: (fileContent: string) => Promise<void>;
  onDeleteUser: (username: string) => void;
}

const UserProfileManager: React.FC<UserProfileManagerProps> = ({ isVisible, onUserSelect, existingUsers, onImportProfile, onDeleteUser }) => {
  const [newUsername, setNewUsername] = useState('');
  const [formError, setFormError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isVisible) return null;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = newUsername.trim();
    if (trimmedUsername) {
      if (existingUsers.find(u => u.toLowerCase() === trimmedUsername.toLowerCase())) {
        setFormError('Username already exists. Please choose another.');
      } else {
        setFormError('');
        onUserSelect(trimmedUsername);
      }
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        await onImportProfile(text);
      } else {
        setFormError('Could not read the file.');
      }
    };
    reader.onerror = () => {
      setFormError('Error reading file.');
    };
    reader.readAsText(file);

    if(event.target) {
      event.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="User profile selection">
      <div className="relative w-full max-w-md bg-zinc-900 rounded-3xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative px-8 py-10 text-center border-b border-white/5">
              <div className="flex justify-center mb-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-xl shadow-cyan-500/20 flex items-center justify-center text-white transform rotate-3 hover:rotate-0 transition-transform duration-500">
                      <BotIcon />
                  </div>
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight mb-2">August 3.5</h1>
              <p className="text-zinc-400 text-sm font-medium">Advanced Trading Intelligence Terminal</p>
          </div>

          <div className="p-8 space-y-8">
             {/* Existing Users */}
             {existingUsers.length > 0 && (
                 <div className="space-y-3">
                     <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1 block">Continue Session</label>
                     <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                         {existingUsers.map(user => (
                             <div key={user} className="group flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer" onClick={() => onUserSelect(user)}>
                                 <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-cyan-400 group-hover:bg-cyan-500/10 transition-colors">
                                     <UserIcon />
                                 </div>
                                 <span className="flex-1 font-medium text-zinc-200 group-hover:text-white">{user}</span>
                                 <button 
                                    onClick={(e) => { e.stopPropagation(); onDeleteUser(user); }}
                                    className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
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
                        value={newUsername} 
                        onChange={(e) => { setNewUsername(e.target.value); setFormError(''); }} 
                        placeholder="Create New Workspace" 
                        className={`w-full bg-zinc-950/50 border rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all font-medium ${formError ? 'border-red-500/50' : 'border-white/10'}`}
                        autoFocus
                        aria-invalid={!!formError}
                        aria-describedby={formError ? 'username-error' : undefined}
                    />
                    {formError && <p id="username-error" className="mt-2 text-xs text-red-400" role="alert">{formError}</p>}
                    <button 
                        type="submit" 
                        disabled={!newUsername.trim()}
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
                     ref={fileInputRef} 
                     onChange={handleFileChange} 
                     className="hidden" 
                     accept=".json" 
                 />
                 <button 
                    onClick={handleImportClick} 
                    className="flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-cyan-400 uppercase tracking-widest transition-colors py-2 px-4 rounded-lg hover:bg-white/5"
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