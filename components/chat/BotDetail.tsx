/**
 * BotDetail — the reference's bot page: large avatar, name,
 * `Bot · @handle` (mono), description, a "This device" host chip
 * (august bots are in-process), and the Open chat button. Shown as the
 * empty state when entering a bot thread that has no messages yet;
 * Open chat dismisses it and reveals the conversation + composer.
 */

import React from 'react';
import { Monitor } from 'lucide-react';
import { BotAvatar } from './BotAvatar';
import type { AgentBot } from '../../services/agents/agentRoster';
import { botHandle } from '../../services/agents/botMailbox';

export interface BotDetailProps {
    bot: AgentBot;
    onOpenChat: () => void;
}

export const BotDetail: React.FC<BotDetailProps> = ({ bot, onOpenChat }) => (
    <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
        data-testid="bot-detail"
    >
        <BotAvatar bot={bot} size={80} />
        <h2 className="text-xl font-semibold text-zinc-100">{bot.name}</h2>
        <p className="font-mono text-[12px] text-zinc-500" data-testid="bot-detail-handle">
            Bot · @{botHandle(bot.name)}
        </p>
        {bot.description && (
            <p className="max-w-sm text-[12px] leading-relaxed text-zinc-400">{bot.description}</p>
        )}
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            <Monitor className="h-3.5 w-3.5" />
            This device
        </span>
        <button
            type="button"
            onClick={onOpenChat}
            data-testid="bot-detail-open"
            className="mt-3 rounded-lg bg-zinc-800 px-5 py-2 text-[13px] font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
        >
            Open chat
        </button>
        {!bot.description && (
            <p className="max-w-sm text-[11px] leading-relaxed text-zinc-600">
                Open this bot&apos;s continuous chat. Its background work keeps running when you switch away.
            </p>
        )}
    </div>
);

export default BotDetail;
