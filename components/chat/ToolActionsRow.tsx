/**
 * ToolActionsRow — Hermes-style transcript status rows for model
 * side-effects. When a seat proposes a tool (forge_tool), amends
 * memory (amend_memory), or runs a custom tool, the run persists
 * ToolAction entries and this renders them as one-line status rows
 * (count chip on grouped rows). A row expands to its per-item detail
 * with the review location — the human knows where to act without a
 * hover. Rejected proposals render DESTRUCTIVE ("Blocked — nothing
 * stored"): a refusal is a status, not a footnote.
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
                const icon = ICON_OK[g.tool] ?? ICON_OK.custom;
                const label = actionLabel(g.tool, g.items);
                // One-line action rows (OpenBot ToolLine shape): muted while
                // fine, DESTRUCTIVE when the harness refused — a rejection is
                // a status, not a footnote, and zinc-400 read as a normal
                // row. Every row expands to the per-item detail with where
                // each item is reviewed — that location used to live only in
                // a hover tooltip.
                const summary = g.ok
                    ? (
                        <>
                            {icon}
                            <span className="min-w-0 flex-1 truncate">
                                {who ? <span className="text-zinc-500">{who} · </span> : null}
                                {label}
                            </span>
                            {n > 1 && (
                                <span className="shrink-0 rounded-full border border-zinc-600 px-1.5 py-px text-[9px] font-bold tabular-nums leading-tight text-zinc-300">
                                    {n}
                                </span>
                            )}
                        </>
                    )
                    : (
                        <>
                            <span className="w-3.5 shrink-0 text-center">⚠</span>
                            <span className="min-w-0 flex-1 truncate">
                                <span className="font-semibold">Blocked</span>
                                {' — '}{who ? `${who}: ` : ''}{g.tool} rejected, nothing stored
                            </span>
                        </>
                    );
                return (
                    <details
                        key={`${g.tool}-${g.ok ? 'ok' : 'fail'}`}
                        className="group/tool-line"
                    >
                        <summary
                            className={`flex cursor-pointer list-none items-center gap-2 text-[11px] [&::-webkit-details-marker]:hidden ${g.ok ? 'text-zinc-400' : 'text-rose-300'}`}
                            title={g.ok
                                ? `${who ? `${who} — ` : ''}${n} item${n === 1 ? '' : 's'} awaiting human review`
                                : `${g.tool} was rejected by the harness — nothing was stored.`}
                        >
                            <span
                                aria-hidden="true"
                                className="shrink-0 text-[9px] text-zinc-500 transition-transform group-open/tool-line:rotate-90"
                            >
                                ▸
                            </span>
                            {summary}
                        </summary>
                        <div className="mb-1 mt-1 space-y-0.5 border-l border-white/10 pl-4">
                            {g.items.map((a, i) => (
                                <p key={`${a.at}-${i}`} className="truncate text-[10px] leading-4 text-zinc-500">
                                    <span className="text-zinc-400">{a.verb}</span> {a.label}
                                    {a.review ? <span className="text-zinc-600"> — review: {a.review}</span> : null}
                                </p>
                            ))}
                        </div>
                    </details>
                );
            })}
        </div>
    );
};

export default ToolActionsRow;
