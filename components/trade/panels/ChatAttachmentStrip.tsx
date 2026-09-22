/**
 * ChatAttachmentStrip — the composer's pending-attachment chip row.
 *
 * Extracted from TradeChatPanel unchanged. The parent keeps OWNING the
 * attachment list (`send()` and the full-analysis launch both read it), so
 * this row is render-only: it draws one chip per queued attachment — an image
 * thumbnail or a file glyph — and reports removals upward.
 */

import React from 'react';
import { FileText, X } from 'lucide-react';
import type { Attachment } from '../../../hooks/useChatAttachments';

export interface ChatAttachmentStripProps {
    attachments: Attachment[];
    onRemove: (id: string) => void;
}

const ChatAttachmentStrip: React.FC<ChatAttachmentStripProps> = ({ attachments, onRemove }) => (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
        {attachments.map(a => (
            <span key={a.id} className="flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-800 py-1 pl-1 pr-1.5 text-ui-xs text-zinc-300">
                {a.kind === 'image'
                    ? <img src={a.payload} alt={a.name} className="h-8 w-12 rounded object-cover" />
                    : <FileText className="h-3 w-3 text-zinc-500" />}
                <span className="max-w-[120px] truncate">{a.name}</span>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}
                    className="text-zinc-500 hover:text-rose-400"><X className="h-3 w-3" /></button>
            </span>
        ))}
    </div>
);

export default ChatAttachmentStrip;
