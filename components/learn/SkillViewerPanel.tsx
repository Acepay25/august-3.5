import React, { useState } from 'react';
import { Check, Copy, Download, FileText, Lightbulb, X } from '../shared/Icons';
import { copyText } from '../../utils/clipboard';
import { downloadTextFile } from '../../utils/transcriptExport';
import MarkdownContent from '../shared/MarkdownContent';
import { STATUS_BADGE, KIND_BADGE } from '../skills/SkillDetail';
import {
    skillEnabledFlag,
    skillExpectancyR,
    EXPECTANCY_MIN_R_SAMPLE,
    type SkillMeta,
} from '../../services/learning/SkillMemoryService';
import type { MemoryFile } from '../../types';

/**
 * SkillViewerPanel — the `SKILL.md`-shaped reader (gap 1 of
 * docs/plans/ui-ux-target-plan-2026-10-11.md).
 *
 * The reference shows a skill as a rendered document: `Description` as its own
 * labelled field, the body below it, and `Save skill` / `Copy` in the header.
 * August stored the same record as a raw notebook file you could only edit as
 * text in the memory manager, so nothing on this surface could be READ. This
 * is the reader, mounted in the shared `RightPanel` shell and opened from a
 * `SkillsCatalog` row.
 *
 * WHY DESCRIPTION LEADS: `skillMatchesSetup` retrieves on the description's
 * words (R1), so the field the matcher reads must be the most visible field on
 * the record. A viewer that buried it under the body would be decoration over
 * the one mechanism that decides the skill ever reaches a model.
 *
 * A BROWSER, not an editor: this surface changes nothing. The SkillsCatalog's
 * rule holds — anything that changes a belief routes to the Studio or the
 * Coach inbox — so the header carries the two actions that move the record
 * OUT (copy the markdown, save the file), and no write path at all. No new
 * state, no storage: every field rendered here is read from the store on open.
 */

export interface SkillViewerRecord {
    file: MemoryFile;
    meta: SkillMeta;
}

/** Outcome line, or the honest words for what is missing. Expectancy is the
 *  hard case: below EXPECTANCY_MIN_R_SAMPLE sampled outcomes it is UNMEASURED,
 *  which is not break-even, so it says so rather than printing a zero. */
const outcomeLine = (meta: SkillMeta): string => {
    const wl = `${meta.wins}W – ${meta.losses}L`;
    const expectancy = skillExpectancyR(meta);
    const counted = meta.evidenceCount ?? (meta.wins + meta.losses);
    const parts = [wl];
    parts.push(expectancy === undefined
        ? `expectancy unmeasured (needs ${EXPECTANCY_MIN_R_SAMPLE} sampled)`
        : `expectancy ${expectancy > 0 ? '+' : ''}${expectancy.toFixed(2)}R`);
    parts.push(`${counted} counted`);
    return parts.join(' · ');
};

/** Scope keys that say when this skill applies. Only what is set is printed —
 *  an absent key is not rendered as "none". */
const scopeOf = (meta: SkillMeta): Array<[string, string]> => {
    const rows: Array<[string, string]> = [];
    if (meta.coin) rows.push(['coin', meta.coin]);
    if (meta.direction) rows.push(['direction', meta.direction]);
    if (meta.family) rows.push(['family', meta.family]);
    if (meta.regime) rows.push(['regime', meta.regime]);
    if (meta.timeframe) rows.push(['timeframe', meta.timeframe]);
    return rows;
};

const SkillViewerPanel: React.FC<{ skill: SkillViewerRecord; onClose?: () => void }> = ({ skill, onClose }) => {
    const { file, meta } = skill;
    const [copied, setCopied] = useState(false);
    const status = STATUS_BADGE[meta.status] ?? STATUS_BADGE.candidate;
    const kind = KIND_BADGE[meta.kind] ?? KIND_BADGE.repeat;
    const scope = scopeOf(meta);

    const onCopy = (): void => {
        void copyText(file.content).then(ok => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        });
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="skill-viewer">
            {/* Header: the file, and the two actions that move it out. The close
                control lives here rather than in the shell's capsule strip,
                which the shell draws only when more than one panel is open —
                a single panel with no close of its own could not be dismissed. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                <h3 className="min-w-0 flex-1 truncate font-mono text-ui-dense font-semibold text-zinc-100" title={file.name}>
                    {file.name}
                </h3>
                {onClose && (
                    <button type="button"
                        onClick={onClose}
                        aria-label="Close the skill viewer"
                        title="Close"
                        className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                )}
                <button type="button"
                    onClick={onCopy}
                    aria-label={copied ? 'Copied' : 'Copy this skill'}
                    title={copied ? 'Copied' : 'Copy the SKILL.md markdown'}
                    className="flex h-8 items-center gap-1 rounded-control px-2 text-ui-dense text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button type="button"
                    onClick={() => downloadTextFile(file.name, file.content, 'text/markdown')}
                    aria-label="Save this skill as a file"
                    title="Save this skill as a .md file"
                    className="flex h-8 items-center gap-1.5 rounded-full bg-zinc-100 px-3 text-ui-dense font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-100">
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Save skill
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 py-3">
                {/* DESCRIPTION — its own labelled field, above the body, because
                    it is the retrieval trigger the matcher reads. */}
                <section aria-labelledby="skill-viewer-description-label">
                    <h4 id="skill-viewer-description-label"
                        className="text-ui-2xs font-semibold uppercase tracking-wider text-zinc-500">
                        Description
                    </h4>
                    {meta.description?.trim() ? (
                        <p className="mt-1 whitespace-pre-wrap text-ui-base leading-relaxed text-zinc-100" data-testid="skill-viewer-description">
                            {meta.description}
                        </p>
                    ) : (
                        <p className="mt-1 text-ui-dense text-amber-400/90" data-testid="skill-viewer-description-missing">
                            No description — the retrieval trigger is empty, so this skill can only match on its structured fields.
                        </p>
                    )}
                </section>

                {/* Who it is and what it has done. */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-ui-2xs font-semibold ${status.className}`}>{status.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-ui-2xs font-semibold ${kind.className}`}>{kind.label}</span>
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-ui-2xs font-semibold ${
                        skillEnabledFlag(meta) ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-900 text-zinc-500'
                    }`}>
                        <Lightbulb className="h-3 w-3" aria-hidden="true" />
                        {skillEnabledFlag(meta) ? 'injected' : 'not injected'}
                    </span>
                </div>
                <p className="mt-2 font-mono text-ui-dense tabular-nums text-zinc-300" data-testid="skill-viewer-outcome">
                    {outcomeLine(meta)}
                </p>

                {scope.length > 0 && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1" data-testid="skill-viewer-scope">
                        {scope.map(([label, value]) => (
                            <div key={label} className="flex items-baseline justify-between gap-2">
                                <dt className="text-ui-dense text-zinc-500">{label}</dt>
                                <dd className="truncate text-ui-dense text-zinc-200" title={value}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}

                {/* The body: the procedure itself, rendered. */}
                <div className="mt-4 border-t border-zinc-800/80 pt-3">
                    <h4 className="text-ui-2xs font-semibold uppercase tracking-wider text-zinc-500">Body</h4>
                    <div className="mt-1 text-ui-base leading-relaxed text-zinc-200">
                        <MarkdownContent content={meta.body || 'No body yet.'} />
                    </div>
                </div>

                {meta.originMessageId && (
                    <p className="mt-4 text-ui-2xs text-zinc-600" title="The logged trade whose cluster produced this skill">
                        origin trade {meta.originMessageId}
                    </p>
                )}
            </div>
        </div>
    );
};

export default React.memo(SkillViewerPanel);
