/**
 * MemoryHealthCard — one look at whether memory is actually healthy (WS-4.3).
 *
 * The pieces of the learning loop each had their own surface: the queue in the
 * Studio, the notebook in Settings, the supervisor in the dock, the graveyard
 * nowhere you could reach. This renders the single pure read over all of them
 * (`buildMemoryHealthReport`) as dense one-line rows — counts first, problems
 * only when there are problems, and no card nested inside a card.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, Loader2 } from '../shared/Icons';
import { buildMemoryHealthReport, type MemoryHealthReport } from '../../services/learning/memoryHealth';
import { isHygieneDue, runMemoryHygiene } from '../../services/learning/memoryHygiene';
import { loadProviderConfigs } from '../../services/infrastructure/ProviderConfigService';
import { listTombstones, type SkillTombstone } from '../../services/learning/skillGraveyard';
import { phtClock } from '../../utils/timezone';
import StatusPill from '../ui/StatusPill';

interface MemoryHealthCardProps {
    username: string;
    /** Bumped after a manual pass to re-read the report. */
    refreshKey?: number;
}

const Row: React.FC<{ label: string; value: React.ReactNode; title?: string }> = ({ label, value, title }) => (
    <div className="flex items-baseline justify-between gap-3 py-1" title={title}>
        <span className="min-w-0 truncate text-ui-dense text-zinc-500">{label}</span>
        <span className="shrink-0 font-mono text-ui-dense tabular-nums text-zinc-200">{value}</span>
    </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="border-t border-zinc-800/80 px-3 py-2 first:border-t-0">
        <h4 className="mb-1 text-ui-xs font-bold uppercase tracking-wider text-zinc-600">{title}</h4>
        {children}
    </div>
);

const MemoryHealthCard: React.FC<MemoryHealthCardProps> = ({ username, refreshKey = 0 }) => {
    const [report, setReport] = useState<MemoryHealthReport | null>(null);
    const [due, setDue] = useState(false);
    const [running, setRunning] = useState(false);
    /** When the LAST manual hygiene pass finished. A pass that merged and
     *  suspended nothing writes no log line, so without this the card cannot
     *  distinguish "I ran it" from "nothing happened" — silence is not a
     *  receipt. */
    const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
    // A read that FAILED is not a read that found nothing. These used to be the
    // same state — `catch { setReport(null) }` — so a store that could not be
    // read rendered an indefinite "Reading memory…" spinner, which is the one
    // display that tells the trader nothing and never resolves. Worse on this
    // card than anywhere else: the thing it reports on is whether memory is
    // being saved at all, so a card that cannot report is worse than no card.
    const [readError, setReadError] = useState<string | null>(null);
    /** A hygiene pass that failed. The report stays — one failed sweep is not a
     *  reason to throw away everything the card already knows. */
    const [hygieneError, setHygieneError] = useState<string | null>(null);
    // The plan asked for a graveyard VIEW; until now the whole store showed up
    // as one number in the queues section.
    const [tombstones, setTombstones] = useState<SkillTombstone[]>([]);

    const load = useCallback(async (): Promise<void> => {
        try {
            setReport(await buildMemoryHealthReport(username));
            setDue(await isHygieneDue(username));
            setTombstones(await listTombstones(username));
            setReadError(null);
        } catch (e) {
            setReport(null);
            setReadError(e instanceof Error ? e.message : String(e));
        }
    }, [username]);

    useEffect(() => { void load(); }, [load, refreshKey]);

    const runNow = async (): Promise<void> => {
        setRunning(true);
        setHygieneError(null);
        try {
            await runMemoryHygiene(username, { providerConfigs: await loadProviderConfigs() });
            await load();
            setLastRunAt(new Date());
        } catch (e) {
            // Previously try/finally with no catch: a failed pass rejected out
            // of the click handler, so the button simply stopped working and
            // the last report stayed on screen implying the pass had succeeded.
            setHygieneError(e instanceof Error ? e.message : String(e));
        } finally { setRunning(false); }
    };

    if (readError) {
        return (
            <div className="p-4" data-testid="memory-health-error">
                <div className="flex items-start gap-2 text-ui-dense leading-4 text-rose-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">Could not read memory health.</p>
                        {/* The message is the diagnosis — this card exists to say
                            "learning is not being saved", so the reason it could
                            not find out is the one thing worth showing. */}
                        <p className="mt-0.5 text-zinc-500">{readError}</p>
                        <p className="mt-0.5 text-zinc-600">
                            Nothing below is missing because it was fine — it was never read.
                        </p>
                    </div>
                </div>
                <button type="button" onClick={() => { void load(); }}
                    data-testid="memory-health-retry"
                    className="mt-2 rounded-control border border-zinc-700 px-2 py-1 text-ui-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800">
                    Try again
                </button>
            </div>
        );
    }

    if (!report) {
        return (
            <div className="flex items-center gap-2 p-4 text-ui-dense text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading memory…
            </div>
        );
    }

    const q = report.queues;
    const s = report.skills;
    return (
        <div className="overflow-hidden rounded-control border border-zinc-800/80 bg-zinc-900" data-testid="memory-health-card">
            <div className="flex items-center gap-2 px-3 py-2">
                <Activity className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                <span className="text-ui-sm font-semibold text-zinc-100">Memory health</span>
                {report.notebook.writeFailure
                    ? <StatusPill tone="down" kicker className="ml-auto">not saving</StatusPill>
                    : report.flags.length === 0
                        ? <StatusPill tone="up" kicker className="ml-auto">clean</StatusPill>
                        : <StatusPill tone="warn" kicker className="ml-auto">{report.flags.length} to look at</StatusPill>}
            </div>

            {report.flags.length > 0 && (
                <ul className="space-y-1 border-t border-zinc-800/80 px-3 py-2">
                    {report.flags.map(f => (
                        <li key={f} className="flex items-start gap-1.5 text-ui-dense leading-4 text-amber-300/90">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>{f}</span>
                        </li>
                    ))}
                </ul>
            )}

            <Section title="Skills">
                <Row label="confirmed / candidate / retired"
                    value={`${s.confirmed} / ${s.candidate} / ${s.retired}`} />
                <Row label="approved, still untested" value={s.unproven}
                    title="Learned skills injected as a labeled hypothesis until evidence lands. Book seeds are excluded — they are 0W/0L by design." />
                <Row label="book seeds (curated priors)" value={s.bookSeeds}
                    title="Seeded from literature, not this trader's record. They inject from birth and are not counted as untested." />
                <Row label="no counted evidence in 30+ days" value={s.staleEvidence} />
                <Row label="latest eval verdict “hurts”" value={s.hurtsVerdict} />
                <Row label="authored by a bot" value={s.fromBots} />
            </Section>

            <Section title="Queues">
                <Row label="skill drafts" value={q.drafts} />
                <Row label="lifecycle proposals" value={`${q.proposals}${q.needsRewrite ? ` (${q.needsRewrite} need a rewrite)` : ''}`} />
                <Row label="memory amendments" value={q.amendments} />
                <Row label="forged tool candidates" value={q.forgedTools} />
                <Row label="graveyard" value={q.graveyard} />
            </Section>

            {report.gateThrottled.length > 0 && (
                <Section title={`Worth-gate held back (${report.gateThrottled.length})`}>
                    <p className="mb-1 text-ui-xs leading-4 text-zinc-600">
                        Clusters with enough evidence to judge, that the gate could not run on. Each retries on its own
                        once the cluster gains a trade the gate has not seen — this is the throttle, not a failure.
                    </p>
                    {report.gateThrottled.map(g => (
                        <Row key={g.key} label={g.key}
                            value={`${g.attempts} attempt${g.attempts === 1 ? '' : 's'} · ${g.lastAt.slice(0, 10)}`} />
                    ))}
                </Section>
            )}

            <Section title="Notebook">
                <Row label="files enabled / total" value={`${report.notebook.enabled} / ${report.notebook.files}`} />
                <Row label="stored characters" value={report.notebook.chars.toLocaleString()} />
                {/* The whole notebook is ONE rewritten Preferences blob, so the
                    number that can actually break memory is its byte size, not
                    its character count — this is the line that shows up in a
                    bug report when a write is refused. `bytes` is UTF-16, the
                    unit the web origin meters its quota in. */}
                <Row label="blob size"
                    value={report.notebook.pressure === null
                        ? 'unmeasured'
                        : `${(report.notebook.bytes / (1024 * 1024)).toFixed(2)} MB · ${report.notebook.pressure}`}
                    title="Whole notebook blob, UTF-16 bytes. Soft 1 MB · refuses new files at 1.5 MB · refuses every notebook write at 2 MB. Nothing is ever evicted to make room." />
                <Row label="writes reaching disk"
                    value={report.notebook.writeFailure
                        ? <span className="text-rose-400" data-testid="memory-write-failing">
                            {`${report.notebook.writeFailure.streak} refused`}
                          </span>
                        : 'none refused'}
                    title={report.notebook.writeFailure
                        ? `Last refused ${report.notebook.writeFailure.message} — counted since the write that did reach disk.`
                        : 'No notebook write has been refused by the storage layer this session. This counts writes, so it is silent before the first one.'} />
                <Row label="skills suspended from prompts"
                    value={String(report.notebook.suspended)}
                    title="Idle long enough that the lifecycle stopped injecting them. Still in the library, still earning matches, and back on their own if a trigger fires again — re-enable one in the notebook." />
                <Row label="worst-case prompt cost" value={`~${report.notebook.promptTokensWorstCase} tok`}
                    title="Doctrine slot + skill body + rules + mistake line + verdict extras. Display-only." />
                <Row label="diary entries (never injected)" value={`${report.diary.entries} in ${report.diary.files} files`}
                    title="Raw storage: the model reads conclusions, not the journal." />
            </Section>

            {report.folders.length > 0 && (
                <Section title="By folder">
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {report.folders.map(f => (
                            <span key={f.name} className="rounded-full border border-zinc-800 px-2 py-0.5 font-mono text-ui-xs tabular-nums text-zinc-400">
                                {f.name} {f.enabled}/{f.files}
                            </span>
                        ))}
                    </div>
                </Section>
            )}

            {report.unobserved.length > 0 && (
                <Section title="Outside the injection window">
                    <p className="mb-1 text-ui-xs leading-4 text-zinc-600">
                        Not served into a prompt within the retained injection log — for a skill this usually means its
                        setup stopped matching, not that it is broken.
                    </p>
                    {report.unobserved.map(u => (
                        <Row key={u.path} label={u.path} value={`${u.chars}c · ${u.daysSinceEdit}d`} />
                    ))}
                </Section>
            )}

            {report.staleFiles.length > 0 && (
                <Section title="No hit in 30+ days">
                    <p className="mb-1 text-ui-xs leading-4 text-zinc-600">
                        The injection log places a real hit on each of these, and its newest one is older than the
                        evidence-decay window the loop already uses.
                    </p>
                    {report.staleFiles.map(f => (
                        <Row key={f.path} label={f.path} value={`${f.chars}c · ${f.daysSinceHit}d`}
                            title={`last served ${f.lastHitAt.slice(0, 10)}`} />
                    ))}
                </Section>
            )}

            <Section title="Settled beliefs">
                <Row label="settled / invalidated"
                    value={`${report.beliefs.settled} / ${report.beliefs.invalidated}`} />
                <Row label="standing but contradicted" value={report.beliefs.challenged}
                    title="A challenge flag is queued against these; nothing auto-invalidates a settled belief." />
            </Section>

            <Section title={`Graveyard (${tombstones.length})`}>
                {tombstones.length === 0 ? (
                    <p className="py-1 text-ui-dense text-zinc-600">Nothing has been retired and recorded.</p>
                ) : (
                    <>
                        <p className="mb-1 text-ui-xs leading-4 text-zinc-600">
                            Why each rule stopped, and what it stopped on. Re-entry needs a fresh evidence cluster —
                            the next matching draft is what asks for it, not a timer.
                        </p>
                        {tombstones.map(t => (
                            <Row key={`${t.slug}-${t.retiredAt}`} label={t.slug}
                                title={`sample ${t.sampleN}${t.liftPts === null ? '' : ` · lift ${t.liftPts}pts`}`}
                                value={`${t.reason} · ${t.retiredAt.slice(0, 10)}`} />
                        ))}
                    </>
                )}
            </Section>

            {report.bots.length > 0 && (
                <Section title="Bots">
                    {report.bots.map(b => (
                        <Row key={b.id} label={`@${b.name}`}
                            value={`${b.lessons} lessons · ${b.skillsAuthored} skills${b.lastLessonAt ? ` · ${b.lastLessonAt}` : ''}`} />
                    ))}
                </Section>
            )}

            <Section title="Hygiene">
                <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-ui-dense leading-4 text-zinc-500">
                        {report.hygiene[0]?.text ?? 'No maintenance pass has run yet.'}
                    </p>
                    <button type="button" onClick={() => void runNow()} disabled={running}
                        className="shrink-0 rounded-control border border-zinc-700 px-2 py-1 text-ui-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40">
                        {running ? 'Running…' : due ? 'Run now' : 'Run again'}
                    </button>
                </div>
                {lastRunAt && !running && (
                    <p className="mt-1 text-ui-xs text-zinc-600" data-testid="memory-hygiene-ran">
                        Pass finished at {phtClock(lastRunAt)}.
                    </p>
                )}
                {hygieneError && (
                    <p role="alert" data-testid="memory-hygiene-error"
                        className="mt-1.5 flex items-start gap-1.5 text-ui-xs leading-4 text-rose-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        {/* Deliberately not claiming the pass changed nothing —
                            a partial run is possible and the log above is the
                            only record of what it got through. What IS certain
                            is that the line it would have written never landed,
                            so the report must not read as if it did. */}
                        <span>The pass did not finish ({hygieneError}). The summary above is from the previous run, not this one.</span>
                    </p>
                )}
                {report.hygiene.length > 1 && (
                    <ul className="mt-1.5 space-y-0.5 border-t border-zinc-800/80 pt-1.5">
                        {report.hygiene.slice(1, 6).map(l => (
                            <li key={`${l.atMs}-${l.text}`} className="flex items-start gap-1.5 text-ui-xs leading-4 text-zinc-600">
                                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500/70" aria-hidden="true" />
                                <span>{l.text}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
};

export default React.memo(MemoryHealthCard);
