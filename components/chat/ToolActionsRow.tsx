/**
 * ToolActionsRow — Hermes-style transcript status rows for model
 * side-effects (R54). When a seat proposes a tool (forge_tool), amends
 * memory (amend_memory), or runs a custom tool, the run persists
 * ToolAction entries and this renders them the way the reference does:
 * compact status rows with a count chip ("Saved to memory · 6 entries")
 * and a ⚠ row for rejected/failed proposals. Monochrome; the review
 * location rides the row so the human knows where to act.
 */

import React from 'react';
import { Brain, Wrench, FilePlus2, Sparkles, NotebookPen } from 'lucide-react';
import type { ToolAction } from '../../types/message';

export interface ToolActionsRowProps {
    actions: ToolAction[];
}

const ICON_OK: Record<string, React.ReactNode> = {
    amend_memory: <Brain className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
    forge_tool: <Wrench className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
    skill_draft: <Sparkles className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
    skill_ingest: <Sparkles className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
    notebook_note: <NotebookPen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
    custom: <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />,
};

/** Human label per tool class — where it lands and who reviews it. */
const actionLabel = (tool: string, items: ToolAction[]): string => {
    const n = items.length;
    const plural = n === 1 ? '' : 's';
    switch (tool) {
        case 'amend_memory':
            return `Memory amendment${plural} proposed — review in Settings → Memory`;
        case 'forge_tool':
            return `Desk tool${plural} proposed — review in Settings → AI Models`;
        case 'skill_draft':
            return `Skill draft${plural} queued — review with the Coach`;
        case 'skill_ingest':
            return n === 1
                ? `Skill created from evidence — ${items[0].label}`
                : `${n} skills created from evidence`;
        case 'notebook_note':
            return items.length === 1
                ? `Notebook ${items[0].verb} — ${items[0].label}`
                : `${n} notebook notes written`;
        default:
            return items.length === 1
                ? `Ran ${items[0].label.replace(/^custom_/, '')}`
                : `Ran ${items[0].tool.replace(/^custom_/, '')} ×${n}`;
    }
};

interface Group {
    tool: string;
    ok: boolean;
    items: ToolAction[];
    speakers: string[];
}

export const ToolActionsRow: React.FC<ToolActionsRowProps> = ({ actions }) => {
    if (!actions.length) return null;
    // Group by tool+ok — one row per class, Hermes-style ("N items").
    const groups = new Map<string, Group>();
    for (const a of actions) {
        const key = `${a.tool}::${a.ok ? 'ok' : 'fail'}`;
        const g = groups.get(key) ?? { tool: a.tool, ok: a.ok, items: [], speakers: [] };
        g.items.push(a);
        if (!g.speakers.includes(a.speaker)) g.speakers.push(a.speaker);
        groups.set(key, g);
    }
    return (
        <div className="mb-2 space-y-1" data-testid="tool-actions-row">
            {[...groups.values()].map(g => {
                const n = g.items.length;
                const who = g.speakers.filter(Boolean).join(', ');
                if (!g.ok) {
                    return (
                        <p
                            key={`${g.tool}-fail`}
                            className="flex items-center gap-2 text-[11px] text-zinc-400"
                            title={`${g.tool} was rejected by the harness — nothing was stored.`}
                        >
                            <span className="w-3.5 shrink-0 text-center text-zinc-400">⚠</span>
                            <span className="min-w-0 flex-1 truncate">
                                {who ? `${who}: ` : ''}{g.tool} rejected — nothing stored
                            </span>
                        </p>
                    );
                }
                const icon = ICON_OK[g.tool] ?? ICON_OK.custom;
                const label = actionLabel(g.tool, g.items);
                return (
                    <p
                        key={`${g.tool}-ok`}
                        className="flex items-center gap-2 text-[11px] text-zinc-400"
                        title={`${who ? `${who} — ` : ''}${n} item${n === 1 ? '' : 's'} awaiting human review`}
                    >
                        {icon}
                        <span className="min-w-0 flex-1 truncate">
                            {who ? <span className="text-zinc-500">{who} · </span> : null}
                            {label}
                        </span>
                        {n > 1 && (
                            <span
                                className="shrink-0 rounded-full border border-zinc-600 px-1.5 py-px text-[9px] font-bold tabular-nums leading-tight text-zinc-300"
                            >
                                {n}
                            </span>
                        )}
                    </p>
                );
            })}
        </div>
    );
};

export default ToolActionsRow;
