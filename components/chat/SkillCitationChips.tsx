import React from 'react';

// Skill-citation chips (Batch 13, plan §10.1 — with a premise correction).
//
// The plan claimed attachVerdictCitations "already parses cited skill slugs
// into turn metadata". It does not — that function parses ANALYST-SEAT
// alignment (who the moderator quoted), not skills. The real substrate for
// "which skills acted in this verdict" is the MemoryInjectionService log:
// every actual skill injection is recorded as `skills/<slug>` with
// kind:'skill'. These chips render exactly that set for the run's window.
//
// Two actions per chip:
//   tap chip  → opens the skill's card in Settings → Skills (lift, history,
//               status) via the august:open-skill event;
//   wrong-here → records a harness lesson (kind 'injection') naming the
//               skill and this message as evidence — the negative-evidence
//               path the lessons store already consumes, surfaced right
//               where the skill acted instead of three menus away.

import { getRecentMemoryInjections } from '../../services/learning/MemoryInjectionService';
import { recordHarnessLesson } from '../../services/learning/harnessLessons';
import { getActiveUsername } from '../../utils/activeUser';

interface SkillCitationChipsProps {
    messageCreatedAt?: string;
    /** Upper bound of the run's injection window (runStats.finishedAt) —
     *  without it, a later run's injections fall inside [createdAt, now]
     *  and leak their skills onto this card's chips. */
    messageFinishedAt?: string;
    messageId: string;
    /** Called after a lesson is recorded so the host can toast. */
    onLessonRecorded?: (text: string) => void;
}

/** Extract skill slugs from injection records (kind:'skill' sources). */
export const skillSlugsFromRecords = (
    recs: { stage: string; sources: { path: string; kind: string }[] }[],
): { slug: string; stage: string }[] => {
    const seen = new Set<string>();
    const out: { slug: string; stage: string }[] = [];
    for (const r of recs) {
        for (const s of r.sources) {
            if (s.kind !== 'skill' || !s.path.startsWith('skills/')) continue;
            const slug = s.path.slice('skills/'.length);
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);
            out.push({ slug, stage: r.stage });
        }
    }
    return out;
};

/** Open a skill's card in Settings → Skills (SkillsGrid listens). */
export const openSkillCard = (slug: string): void => {
    pendingSkillOpen = slug;
    window.dispatchEvent(new CustomEvent('august:open-skill', { detail: { slug } }));
};

/** A chip tap can arrive BEFORE SkillsGrid mounts (the settings menu opens
 *  on the same event). SkillsGrid consumes this on mount so the deep link
 *  survives the remount race. */
let pendingSkillOpen: string | null = null;
export const consumePendingSkillOpen = (): string | null => {
    const v = pendingSkillOpen;
    pendingSkillOpen = null;
    return v;
};

export const SkillCitationChips: React.FC<SkillCitationChipsProps> = ({
    messageCreatedAt,
    messageFinishedAt,
    messageId,
    onLessonRecorded,
}) => {
    const [citations, setCitations] = React.useState<{ slug: string; stage: string }[]>([]);
    // Local flag feedback: the chat context carries no toast, so the chip
    // itself shows that the ⚑ landed (per-message, resets on unmount).
    const [flagged, setFlagged] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        if (!messageCreatedAt) return;
        let cancelled = false;
        const startMs = Date.parse(messageCreatedAt);
        // Bounded window: [createdAt, finishedAt]. The run's injections all
        // land inside it; a later run's do not. Unsettled messages (no
        // finishedAt) keep the open-ended "now" bound so live chips fill in.
        const endMs = messageFinishedAt ? Date.parse(messageFinishedAt) : Date.now();
        void getRecentMemoryInjections(getActiveUsername()).then(recs => {
            if (cancelled) return;
            setCitations(skillSlugsFromRecords(
                recs.filter(r => {
                    const t = Date.parse(r.ts);
                    return Number.isFinite(t) && t >= startMs - 1000 && t <= endMs + 1000;
                }),
            ));
        });
        return () => { cancelled = true; };
    }, [messageCreatedAt, messageFinishedAt]);

    if (citations.length === 0) return null;

    const flagWrong = (slug: string): void => {
        recordHarnessLesson({
            kind: 'injection',
            scope: 'skillGuidance',
            pattern: `skill:${slug}`,
            lesson: `Skill "${slug}" was injected into a run whose verdict the trader flagged as wrong here — review its rule before it fires again.`,
            evidenceId: `message:${messageId}`,
        });
        setFlagged(prev => new Set(prev).add(slug));
        onLessonRecorded?.(`Flagged "${slug}" — recorded as a harness lesson (Settings → Harness → lessons).`);
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="skill-citation-chips">
            <span className="text-[9px] uppercase tracking-widest text-zinc-600">skills used:</span>
            {citations.map(c => (
                <span
                    key={c.slug}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] pl-2 text-[10px] text-zinc-300"
                    title={`Injected at ${c.stage} — click opens the skill card`}
                >
                    <button
                        type="button"
                        onClick={() => openSkillCard(c.slug)}
                        className="hover:text-zinc-100 hover:underline"
                    >
                        /{c.slug}
                    </button>
                    <button
                        type="button"
                        onClick={() => flagWrong(c.slug)}
                        className="rounded-r-full px-1.5 py-0.5 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-200"
                        title="This skill was wrong here — record negative evidence"
                        aria-label={`Flag ${c.slug} as wrong in this run`}
                    >
                        {flagged.has(c.slug) ? '✓' : '⚑'}
                    </button>
                </span>
            ))}
        </div>
    );
};
