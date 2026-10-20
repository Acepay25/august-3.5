import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Lightbulb, Plus, RefreshCw, Search, Settings } from '../shared/Icons';
import {
    listSkills,
    skillEnabledFlag,
    type SkillMeta,
} from '../../services/learning/SkillMemoryService';
import {
    reviewAllSkills,
    type SkillReviewFinding,
    type SkillReviewReport,
    type SkillReviewVerdict,
} from '../../services/learning/skillReview';
import { queueLearningProposal } from '../../utils/learningQueue';

/**
 * SkillsCatalog — the reference Customize → Skills screen, on August's own data.
 *
 * WHAT THIS IS NOT: a second place to approve a draft. The skill-draft path is
 * the Coach inbox (`probe-skill-approval.cjs` drives it byte-for-byte), and a
 * sixth approval surface is the exact information-architecture defect the
 * 2026-10-07 audit named. This is a BROWSER: it lists the roster, filters it,
 * and routes elsewhere for anything that changes a belief.
 *
 * Every field rendered here is real, none invented:
 *   name        ← the file slug
 *   description ← `SkillMeta.description`
 *   checkmark   ← `skillEnabledFlag(meta)` — the ONE place `enabled` is derived.
 *                 Suspension is `enabled:false` + `meta.suspendedAt`, NOT a
 *                 fourth `SkillStatus`, so this must never be derived a second
 *                 way or an unrelated attribution write silently un-suspends.
 *   tabs        ← `family` (falling back to `kind`), a real partition of the
 *                 roster. A tab with zero skills is not drawn at all — the
 *                 decorative-group defect this screen exists to avoid.
 */

/** A roster row, flattened for rendering. */
interface CatalogSkill {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    status: SkillMeta['status'];
    wins: number;
    losses: number;
    family: string;
}

/** Family → collection tab label. `kind` is the fallback partition so a roster
 *  with no families at all still gets one honest, non-empty group rather than an
 *  empty tab strip. */
const collectionOf = (meta: SkillMeta): string => meta.family?.trim() || (meta.kind === 'avoid' ? 'Avoid' : 'Repeat');

/**
 * What one manual re-read found, said in the trader's words.
 *
 * The Refresh press used to be invisible: `reload()` genuinely re-reads the
 * store, but when nothing on disk changed the screen was byte-identical after
 * it, so a working button and a dead one looked the same. That is what the
 * render-probe's inert-control gate measures, and the gate was right — the fix
 * is to report the outcome, not to exempt the control.
 */
const describeRosterSync = (prev: CatalogSkill[] | null, next: CatalogSkill[]): string => {
    if (prev === null) return 'Skill list read';
    const sig = (s: CatalogSkill): string =>
        `${s.name}|${s.description}|${s.enabled}|${s.status}|${s.wins}|${s.losses}|${s.family}`;
    const before = new Map(prev.map(s => [s.id, sig(s)]));
    let added = 0;
    let changed = 0;
    for (const s of next) {
        const old = before.get(s.id);
        if (old === undefined) added += 1;
        else if (old !== sig(s)) changed += 1;
        before.delete(s.id);
    }
    const parts: string[] = [];
    if (added) parts.push(`${added} new`);
    if (changed) parts.push(`${changed} updated`);
    if (before.size) parts.push(`${before.size} removed`);
    return parts.length ? `Refreshed — ${parts.join(', ')}` : 'Refreshed — nothing changed';
};

/** A deterministic tint per collection, from the theme's own ramp. The reference
 *  gives each skill a distinct vivid gradient; August has no per-skill colour
 *  data and inventing six gradients would be decoration with no meaning. The
 *  tile carries an icon on a neutral surface instead. */const tileClass = (enabled: boolean, kind: SkillMeta['kind']): string => {
    const base = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-control border';
    if (!enabled) return `${base} border-zinc-800 bg-zinc-900 text-zinc-600`;
    return kind === 'avoid'
        ? `${base} border-rose-500/30 bg-rose-500/10 text-rose-300`
        : `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-300`;
};

/**
 * The review's four verdicts, and how each one is WORDED.
 *
 * These are NOT run statuses, so `utils/runStatus.ts` does not apply to them —
 * that module is the vocabulary for a RUN (queued / running / done / stopped /
 * failed). A skill verdict is a different question: "is this file healthy?".
 * The wording is the load-bearing part, because two of the four are warnings
 * and one is a defect:
 *
 *  - **ghost** — the file is in the skills folder and does not parse. It is in
 *    the backup and the export and in NO list: not the index, not the
 *    retrieval, not the Health card. It is a defect, and the only one.
 *  - **dormant** — it parses, but it names no setup it applies to, so it will
 *    not fire. A WARNING, not a defect: a general rule is *meant* to be
 *    unscoped. It also holds one of the 30 index slots in file order.
 *  - **clipped** — the recall card drops characters, so the seat gets half a
 *    procedure in every prompt. A warning.
 *  - **fine** — everything checks out.
 */
const VERDICT_LABEL: Record<SkillReviewVerdict, string> = {
    fine: 'Fine',
    dormant: 'Dormant',
    clipped: 'Clipped',
    ghost: 'Ghost',
};

/** One line for the trader, per verdict. The reason it says "names no setup"
 *  and NOT "never fired" is the run-cap: the injection log is run-capped, so
 *  absence from it is the same fact as "aged out of the window" and proves
 *  nothing (`services/learning/memoryHealth.ts:15-18`). */
const VERDICT_HINT: Record<SkillReviewVerdict, string> = {
    fine: 'Every format check passes.',
    dormant: 'Names no setup it applies to — it will not fire, and it holds one of the 30 index slots.',
    clipped: 'The recall card drops characters — the seat gets half a procedure.',
    ghost: 'In the notebook, in the backup, and in no list at all.',
};

/** The theme's own semantic ramp: rose for the defect, amber for the two
 *  warnings, zinc for the quiet one. The same families `tileClass` uses. */
const VERDICT_TONE: Record<SkillReviewVerdict, string> = {
    fine: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dormant: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    clipped: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    ghost: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

/** The report's one-line summary. Every number is counted, never estimated. */
const describeReview = (report: SkillReviewReport): string => {
    const { fine, dormant, clipped, ghost } = report.counts;
    const total = fine + dormant + clipped + ghost;
    if (total === 0) return 'No skill files to review.';
    const parts = [`${fine} fine`];
    if (dormant) parts.push(`${dormant} dormant`);
    if (clipped) parts.push(`${clipped} clipped`);
    if (ghost) parts.push(`${ghost} ghost`);
    return `Reviewed ${total} skill file${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
};

export interface SkillsCatalogProps {
    /** Refresh — the gear routes to Settings → Skills. */
    onOpenSettings?: () => void;
    /** Add — opens the real skill-draft path in the Coach inbox. */
    onAddSkill?: () => void;
    /** Read — opens this skill's rendered record in the viewer panel. The
     *  browser's whole job is to make a row readable without leaving the
     *  surface; without this the catalog is a list of file names. */
    onOpenSkill?: (fileId: string) => void;
}

const SkillsCatalog: React.FC<SkillsCatalogProps> = ({ onOpenSettings, onOpenSkill, onAddSkill }) => {
    const [skills, setSkills] = useState<CatalogSkill[] | null>(null);
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState<string>('all');
    /** The last manual re-read, in words. null until the user presses Refresh. */
    const [syncNote, setSyncNote] = useState<string | null>(null);
    /** The last format review, or null until the user presses Review. */
    const [review, setReview] = useState<SkillReviewReport | null>(null);
    /** What the review said, and what the trader did about it. */
    const [reviewNote, setReviewNote] = useState<string | null>(null);

    const reload = (manual = false): void => {
        try {
            const next = listSkills().map(({ file, meta }) => ({
                id: file.id,
                name: file.name,
                description: meta.description ?? '',
                enabled: skillEnabledFlag(meta),
                status: meta.status,
                wins: meta.wins,
                losses: meta.losses,
                family: collectionOf(meta),
            }));
            if (manual) setSyncNote(describeRosterSync(skills, next));
            setSkills(next);
        } catch {
            // A store read failure is not a reason to draw an empty grid that
            // reads as "you have no skills" — leave it null so the empty state
            // says it could not load instead.
            setSkills(null);
            if (manual) setSyncNote('Could not read the skill files');
        }
    };

    useEffect(reload, []);

    /**
     * "Review all my skills" — a DETERMINISTIC read of every file in the skills
     * folder, and nothing else.
     *
     * The review finds the files the app cannot: `listSkills()` DROPS a skill
     * that does not parse, so a malformed file sits in the notebook, in the
     * backup and in the export while appearing in NO list — not the index, not
     * the retrieval, not the Health card. The same file, imported, is rejected
     * WITH A REASON. Two opposite answers for one file, depending on how it
     * arrived.
     *
     * THIS BUTTON WRITES NOTHING. Not the notebook, not a skill. It reads the
     * files and reports; a repair is a PROPOSAL, and it goes into the existing
     * approval queue where the human acts on it — never straight into the
     * notebook. That is the plan's rule and it is the safe one: a
     * reconstruction GIVES a skill a reach it did not have (it can suddenly be
     * matched and injected), so it must be confirmed by a person, one skill at
     * a time.
     */
    const runReview = (): void => {
        try {
            const report = reviewAllSkills();
            setReview(report);
            setReviewNote(describeReview(report));
        } catch {
            setReview(null);
            setReviewNote('Could not read the skill files');
        }
    };

    /**
     * Queue ONE repair as a proposal. The notebook is not touched: the queue
     * is where a human decision lives, and the queue's dedupe key means the
     * same repair is not proposed twice.
     */
    const proposeRepair = (finding: SkillReviewFinding): void => {
        const repair = finding.repair;
        if (!repair) return;
        const queued = queueLearningProposal({
            kind: repair.queueKind,
            skillSlug: finding.slug,
            text: `${repair.summary}\n${repair.reason}`
                + `\nSkill: ${finding.name}`
                + `\n${repair.widens
                    ? 'This repair WIDENS the skill\'s reach: it would become a skill the models can use. It is inactive until you approve it.'
                    : 'This repair only narrows the skill\'s reach.'}`
                + '\nNothing has been written — the notebook is unchanged until you approve this in the queue.',
            fingerprint: `skill-review|${repair.queueKind}|${finding.slug}|${repair.kind}`,
            payload: {
                source: 'skill-review',
                evidence: repair.reason,
                widens: repair.widens,
                old: { content: repair.before },
                new: { content: repair.after },
            },
        });
        setReviewNote(queued
            ? `Proposed a repair for ${finding.name}. It is waiting for you in the queue — nothing was written.`
            : `A repair for ${finding.name} is already waiting in the queue.`);
    };

    /** The problems, worst first: the defect before the warnings. */
    const problems = useMemo(() => {
        const rank: Record<SkillReviewVerdict, number> = { ghost: 0, clipped: 1, dormant: 2, fine: 3 };
        return (review?.findings ?? [])
            .filter(f => f.verdict !== 'fine')
            .sort((a, b) => rank[a.verdict] - rank[b.verdict]);
    }, [review]);

    /** The review's finding for each skill, by slug — so a roster row can
     *  carry its own verdict. */
    const verdictBySlug = useMemo(() => {
        const map = new Map<string, SkillReviewFinding>();
        for (const finding of review?.findings ?? []) {
            if (finding.verdict === 'fine') continue;
            map.set(finding.slug, finding);
        }
        return map;
    }, [review]);

    /** Collections that actually hold skills. An empty tab is never drawn. */
    const collections = useMemo(() => {
        const counts = new Map<string, number>();
        for (const s of skills ?? []) counts.set(s.family, (counts.get(s.family) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
    }, [skills]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (skills ?? []).filter(s => {
            if (collection !== 'all' && s.family !== collection) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [skills, query, collection]);

    // The active collection must survive a reload that drops it: pinning a tab
    // whose skills were all retired would render an empty grid that looks broken.
    const activeCollection = collections.some(c => c.label === collection) || collection === 'all'
        ? collection
        : 'all';

    return (
        <section
            className="rounded-control border border-zinc-800/80 bg-zinc-900 p-3"
            data-testid="skills-catalog"
            aria-label="Skill catalog"
        >
            {/* Title block + the reference's top row: search, refresh, gear, Add. */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="font-serif text-ui-xl text-zinc-100">Skills</h3>
                    <p className="mt-0.5 text-ui-dense text-zinc-500" role="status" data-testid="skills-status">
                        {syncNote ?? 'What the desk has learned to do, and what it has learned to avoid.'}
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="flex h-8 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5">
                        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search skills"
                            aria-label="Search skills"
                            className="h-6 w-40 bg-transparent text-ui-dense text-zinc-200 outline-none placeholder:text-zinc-600"
                        />
                    </div>
                    <button type="button" onClick={() => reload(true)} aria-label="Refresh the skill list" title="Refresh"
                        className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={runReview} aria-label="Review all my skills"
                        title="Review all my skills — check every skill file's format"
                        className="flex h-8 items-center gap-1 rounded-control border border-zinc-700 bg-zinc-800 px-2 text-ui-dense text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Review
                    </button>
                    {onOpenSettings && (
                        <button type="button" onClick={onOpenSettings} aria-label="Skill settings" title="Skill settings"
                            className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                    )}
                    {onAddSkill && (
                        <button type="button" onClick={onAddSkill}
                            className="flex h-8 items-center gap-1 rounded-full bg-zinc-100 px-3 text-ui-dense font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-100">
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            Add
                        </button>
                    )}
                </div>
            </div>

            {/* The review report. It appears only after the trader asks for
                it, and it is a REPORT: nothing here has been written. The
                block also appears on a FAILED read — a silent failure would
                leave the trader thinking the button did nothing. */}
            {(review || reviewNote) && (
                <div className="mt-3 rounded-control border border-zinc-800/80 bg-zinc-950/60 p-3" data-testid="skills-review">
                    <p className="text-ui-dense text-zinc-400" role="status" data-testid="skills-review-note">
                        {reviewNote ?? describeReview(review!)}
                    </p>
                    {!review ? null : problems.length === 0 ? (
                        <p className="mt-2 text-ui-dense text-zinc-500">
                            Every skill file parses, names a setup it applies to, and fits its recall card.
                        </p>
                    ) : (
                        <ul className="mt-2 flex flex-col gap-2">
                            {problems.map(finding => (
                                <li key={finding.fileId} data-testid="skills-review-row" className="rounded-control border border-zinc-800/80 bg-zinc-900/60 p-2.5">
                                    <div className="flex items-start gap-2">
                                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-ui-2xs font-semibold ${VERDICT_TONE[finding.verdict]}`}>
                                            {VERDICT_LABEL[finding.verdict]}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-mono text-ui-dense text-zinc-300" title={finding.name}>
                                                {finding.name}
                                            </span>
                                            <span className="mt-0.5 block text-ui-dense text-zinc-400">{finding.evidence}</span>
                                        </span>
                                    </div>
                                    {finding.reasons.length > 0 && (
                                        <ul className="mt-1.5 flex flex-col gap-0.5 pl-2">
                                            {finding.reasons.map((reason, i) => (
                                                <li key={i} className="text-ui-2xs text-zinc-500">· {reason}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {finding.repair && (
                                        <div className="mt-2 border-t border-zinc-800/80 pt-2">
                                            <p className="text-ui-2xs text-zinc-400">
                                                {finding.repair.summary}
                                            </p>
                                            {finding.repair.widens && (
                                                <p className="mt-1 text-ui-2xs text-amber-300">
                                                    This repair widens the skill&rsquo;s reach — it would become a skill the models can use.
                                                </p>
                                            )}
                                            <details className="mt-1.5">
                                                <summary className="cursor-pointer text-ui-2xs text-zinc-400 hover:text-zinc-200">
                                                    Show the proposed change
                                                </summary>
                                                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                    <div>
                                                        <p className="text-ui-2xs uppercase tracking-wider text-zinc-500">Now</p>
                                                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-zinc-800/80 bg-zinc-950 p-2 font-mono text-ui-2xs text-zinc-400">{finding.repair.before}</pre>
                                                    </div>
                                                    <div>
                                                        <p className="text-ui-2xs uppercase tracking-wider text-zinc-500">Proposed</p>
                                                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-zinc-800/80 bg-zinc-950 p-2 font-mono text-ui-2xs text-zinc-300">{finding.repair.after}</pre>
                                                    </div>
                                                </div>
                                            </details>
                                            <button type="button" onClick={() => proposeRepair(finding)}
                                                aria-label={`Propose the repair for ${finding.name}`}
                                                className="mt-2 flex h-8 items-center gap-1 rounded-control border border-zinc-700 bg-zinc-800 px-2.5 text-ui-dense text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                                                Propose this repair
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Segmented collection tabs — a real partition, so no empty groups. */}
            {collections.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Skill collections">
                    <button type="button" role="tab" aria-selected={activeCollection === 'all'}
                        onClick={() => setCollection('all')}
                        className={`rounded-full px-3 py-1 text-ui-dense font-medium transition-colors ${
                            activeCollection === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}>
                        All {(skills ?? []).length}
                    </button>
                    {collections.map(c => (
                        <button key={c.label} type="button" role="tab" aria-selected={activeCollection === c.label}
                            onClick={() => setCollection(c.label)}
                            className={`rounded-full px-3 py-1 text-ui-dense font-medium transition-colors ${
                                activeCollection === c.label ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                            }`}>
                            {c.label} {c.n}
                        </button>
                    ))}
                </div>
            )}

            {/* Section label on a hairline rule that runs to the right edge. */}
            <div className="mt-4 border-t border-zinc-700 pt-2">
                <h4 className="text-ui-dense font-medium text-zinc-200">
                    {activeCollection === 'all' ? 'Installed' : activeCollection}
                </h4>
            </div>

            {skills === null ? (
                <p className="py-6 text-center text-ui-dense text-zinc-500" data-testid="skills-catalog-error">
                    The skill library could not be read.
                </p>
            ) : shown.length === 0 ? (
                <p className="py-6 text-center text-ui-dense text-zinc-600" data-testid="skills-catalog-empty">
                    {query.trim() ? `No skill matches “${query.trim()}”.` : 'No skills yet.'}
                </p>
            ) : (
                <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="skills-catalog-grid">
                    {shown.map(s => (
                        <li key={s.id} className="flex items-center gap-3 py-1.5" data-testid="skills-catalog-card">
                            <span className={tileClass(s.enabled, s.status === 'retired' ? 'avoid' : 'repeat')} aria-hidden="true">
                                {/* aria-hidden on the glyph itself as well as its
                                    tile: the tile's hidden is enough for assistive
                                    tech, and the icon-semantics scan reads JSX, not
                                    the rendered tree — a glyph that is hidden in the
                                    DOM but unsaid in the source is a regression the
                                    guard cannot see coming back. */}
                                <Lightbulb className="h-4 w-4" aria-hidden="true" />
                            </span>
                            {/* The row is the opener: a catalog row that cannot be
                                pressed is a list of file names, and the record
                                behind it — description, body, outcome ledger —
                                was unreachable without leaving for the memory
                                manager. */}
                            <button type="button"
                                onClick={() => onOpenSkill?.(s.id)}
                                aria-label={`Read ${s.name}`}
                                className="min-w-0 flex-1 rounded-control text-left transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                                <span className="block truncate text-ui-dense font-semibold text-zinc-100" title={s.name}>
                                    {s.name}
                                </span>
                                <span className="block truncate text-ui-dense text-zinc-500" title={s.description || undefined}>
                                    {s.description || (s.status === 'retired' ? 'Retired' : 'No description')}
                                </span>
                            </button>
                            {s.enabled ? (
                                <Check className="h-4 w-4 shrink-0 text-zinc-400" aria-label="Enabled" />
                            ) : (
                                <span className="shrink-0 text-ui-2xs text-zinc-600" title="Not injected — disabled or suspended">
                                    off
                                </span>
                            )}
                            {/* The row says what the review found, so a problem is
                                visible where the skill is — not only in the
                                report. A ghost has no row at all (it is not in
                                the list), which is exactly why the report
                                exists. */}
                            {verdictBySlug.get(s.name.replace(/\.md$/i, '')) && (
                                <span
                                    data-testid="skills-row-verdict"
                                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-ui-2xs font-semibold ${VERDICT_TONE[verdictBySlug.get(s.name.replace(/\.md$/i, ''))!.verdict]}`}
                                    title={verdictBySlug.get(s.name.replace(/\.md$/i, ''))!.evidence}
                                >
                                    {VERDICT_LABEL[verdictBySlug.get(s.name.replace(/\.md$/i, ''))!.verdict]}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default React.memo(SkillsCatalog);
