import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  /** Shown as a disabled first row when set (e.g. "Analyze: <current input>"). */
  inputPreview?: string;
}

/**
 * Ctrl/Cmd+K command palette — filterable action list with keyboard
 * navigation (↑/↓/Enter/Esc), Escape-close and a focus trap.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, actions, inputPreview }) => {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeClose(isOpen, onClose);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(a => `${a.label} ${a.hint ?? ''}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlighted(0);
      // Focus after mount so typing filters immediately.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => setHighlighted(0), [query]);

  if (!isOpen) return null;

  const run = (action: PaletteAction) => {
    action.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-3.5 py-2.5">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => (filtered.length === 0 ? 0 : Math.min(filtered.length - 1, h + 1))); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(0, h - 1)); }
              else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); run(filtered[highlighted]); }
            }}
            placeholder="Type a command…"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">ESC</kbd>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5 custom-scrollbar">
          {inputPreview && (
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 truncate">Analyze: {inputPreview}</div>
          )}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-zinc-500">No matching commands.</div>
          )}
          {filtered.map((action, index) => (
            <button
              key={action.id}
              type="button"
              onClick={() => run(action)}
              onMouseEnter={() => setHighlighted(index)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${index === highlighted ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'}`}
            >
              <span className="min-w-0 truncate text-xs font-medium">{action.label}</span>
              {action.hint && <span className="shrink-0 font-mono text-[10px] text-zinc-500">{action.hint}</span>}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] bg-zinc-950/60 px-3 py-2 text-[10px] text-zinc-500 font-mono">
          <div className="flex items-center gap-2">
            <span><kbd className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">↑↓</kbd> navigate</span>
            <span><kbd className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">↵</kbd> select</span>
          </div>
          <span>August Trading</span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(CommandPalette);
