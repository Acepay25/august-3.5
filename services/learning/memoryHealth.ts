/**
 * memoryHealth — one pure read over every memory surface (WS-4.3).
 *
 * The learning loop writes into a dozen places (notebook folders, skills,
 * drafts, proposals, amendments, forged tools, the graveyard, settled
 * beliefs) and until now each had its own surface to inspect it, so nobody
 * could answer "is memory actually healthy?" in one look. This is that answer:
 * a selector, not a service — it mutates nothing, queues nothing, and is safe
 * to call on every render of the Health tab.
 *
 * Staleness is measured against the ONE signal that exists: the injection log
 * (`MemoryInjectionService`, newest-first, capped at 400 runs). A file absent
 * from it was not injected *recently*, which is not the same as never — so the
 * report says "outside the retained window" rather than pretending to know.
 */

import { getMemoryFiles } from './MemoryFilesService';
import {
    listSkills, isSkillFile, parseSkillMarkdown, EVIDENCE_STALE_DAYS, type SkillMeta,
} from './SkillMemoryService';
import { getRecentMemoryInjections } from './MemoryInjectionService';
import { estimateMemoryTokensPerRun } from './MemoryRetrievalService';
import { readSettledBeliefs } from './settledBeliefs';
import { listTombstones } from './skillGraveyard';
import { listSkillDrafts } from '../../utils/skillDrafts';
import { listLearningProposals } from '../../utils/learningQueue';
import { listAmendments } from './memoryAmendments';
import { loadForgedTools } from '../tools/toolForge';
import { countPendingSupervision } from './skillSupervisor';
import { loadHygieneLog, type HygieneLine } from './memoryHygiene';
import { loadBotLearningStats, type BotLearningStat } from '../agents/botLearning';

export interface HealthFolder {
    name: string;
    files: number;
    enabled: number;
    chars: number;
}

export interface HealthSkillBucket {
    total: number;
    candidate: number;
    confirmed: number;
    retired: number;
    /** Approved but still untested — injected as a labeled hypothesis. */
    unproven: number;
    /** Latest causal eval said it hurts. */
    hurtsVerdict: number;
    /** No counted evidence inside the decay window. */
    staleEvidence: number;
    /** Auto-authored by a bot rather than the chart AI. */
    fromBots: number;
}

export interface HealthQueue {
    drafts: number;
    proposals: number;
    amendments: number;
    forgedTools: number;
    supervisorPending: number;
    graveyard: number;
    /** Proposal kinds that need a model-authored rewrite to actuate. */
    needsRewrite: number;
}

export interface MemoryHealthReport {
    generatedAt: number;
    folders: HealthFolder[];
    skills: HealthSkillBucket;
    notebook: {
        files: number;
        enabled: number;
        chars: number;
        /** Worst-case prompt cost of memory injection, in tokens. */
        promptTokensWorstCase: number;
    };
    /** Enabled files with no injection inside the retained log window. */
    unobserved: Array<{ path: string; chars: number; daysSinceEdit: number }>;
    beliefs: { settled: number; invalidated: number };
    queues: HealthQueue;
    diary: { files: number; entries: number };
    bots: BotLearningStat[];
    /** One-line entries the weekly hygiene pass writes; newest first. */
    hygiene: HygieneLine[];
    /** Plain-English problems worth showing the user, empty when healthy. */
    flags: string[];
}

const DAY_MS = 86_400_000;

const bucketSkills = (metas: SkillMeta[]): HealthSkillBucket => {
    const staleCutoff = Date.now() - EVIDENCE_STALE_DAYS * DAY_MS;
    const out: HealthSkillBucket = {
        total: metas.length, candidate: 0, confirmed: 0, retired: 0,
        unproven: 0, hurtsVerdict: 0, staleEvidence: 0, fromBots: 0,
    };
    for (const m of metas) {
        if (m.status === 'confirmed') out.confirmed += 1;
        else if (m.status === 'retired') out.retired += 1;
        else out.candidate += 1;
        if ((m.wins + m.losses) === 0 && m.status !== 'retired') out.unproven += 1;
        if (m.evalVerdict === 'hurts') out.hurtsVerdict += 1;
        const evid = m.lastEvidenceAt ? Date.parse(m.lastEvidenceAt) : NaN;
        if (m.status !== 'retired' && (Number.isFinite(evid) ? evid < staleCutoff : true)) out.staleEvidence += 1;
        if (m.originBotId) out.fromBots += 1;
    }
    return out;
};

/** Assemble the report. Async only because three stores are Preferences-backed. */
export const buildMemoryHealthReport = async (username: string): Promise<MemoryHealthReport> => {
    const { folders, files } = getMemoryFiles();
    const skillFiles = files.filter(isSkillFile);
    const metas = skillFiles
        .map(f => parseSkillMarkdown(f.content))
        .filter((m): m is SkillMeta => Boolean(m));

    const folderName = new Map(folders.map(f => [f.id, f.name]));
    const byFolder = new Map<string, HealthFolder>();
    for (const f of files) {
        const name = folderName.get(f.folderId) ?? f.folderId;
        const row = byFolder.get(name) ?? { name, files: 0, enabled: 0, chars: 0 };
        row.files += 1;
        row.chars += f.content.length;
        if (f.enabled) row.enabled += 1;
        byFolder.set(name, row);
    }

    // What retrieval ACTUALLY served, inside the retained log window.
    const injected = new Set<string>();
    try {
        for (const rec of await getRecentMemoryInjections(username)) {
            for (const s of rec.sources) injected.add(s.path);
        }
    } catch { /* no telemetry — treat every file as unobserved below */ }

    const unobserved = files
        .filter(f => f.enabled && !injected.has(`${folderName.get(f.folderId)}/${f.name}`) && !injected.has(`${folderName.get(f.folderId)}/${f.name}.md`))
        .map(f => ({
            path: `${folderName.get(f.folderId)}/${f.name}`,
            chars: f.content.length,
            daysSinceEdit: Math.max(0, Math.floor((Date.now() - (f.updatedAt || Date.now())) / DAY_MS)),
        }))
        .sort((a, b) => b.chars - a.chars)
        .slice(0, 12);

    const proposals = listLearningProposals(username);
    const beliefs = readSettledBeliefs();
    const tombstones = await listTombstones(username);
    const queues: HealthQueue = {
        drafts: listSkillDrafts(username).length,
        proposals: proposals.length,
        amendments: listAmendments('pending').length,
        forgedTools: loadForgedTools().filter(t => t.status === 'candidate').length,
        supervisorPending: countPendingSupervision(username),
        graveyard: tombstones.length,
        needsRewrite: proposals.filter(p => p.kind === 'rescope' || p.kind === 'contradiction').length,
    };

    const diaryFiles = files.filter(f => folderName.get(f.folderId) === 'trader-diary');
    const skills = bucketSkills(metas);

    const flags: string[] = [];
    if (queues.supervisorPending > 0) {
        flags.push(`${queues.supervisorPending} item${queues.supervisorPending === 1 ? '' : 's'} waiting on the supervisor.`);
    }
    if (skills.hurtsVerdict > 0) {
        flags.push(`${skills.hurtsVerdict} skill${skills.hurtsVerdict === 1 ? '' : 's'} with a "hurts" eval verdict still enabled.`);
    }
    if (skills.staleEvidence > 0) {
        flags.push(`${skills.staleEvidence} skill${skills.staleEvidence === 1 ? '' : 's'} with no counted evidence in ${EVIDENCE_STALE_DAYS}+ days.`);
    }
    if (queues.needsRewrite > 0) {
        flags.push(`${queues.needsRewrite} proposal${queues.needsRewrite === 1 ? '' : 's'} need a rewritten clause before anything can act on them.`);
    }

    return {
        generatedAt: Date.now(),
        folders: [...byFolder.values()].sort((a, b) => b.files - a.files),
        skills,
        notebook: {
            files: files.length,
            enabled: files.filter(f => f.enabled).length,
            chars: files.reduce((n, f) => n + f.content.length, 0),
            promptTokensWorstCase: estimateMemoryTokensPerRun().worstCase,
        },
        unobserved,
        beliefs: {
            settled: beliefs.filter(b => b.status === 'settled').length,
            invalidated: beliefs.filter(b => b.status === 'invalidated').length,
        },
        queues,
        diary: {
            files: diaryFiles.length,
            entries: diaryFiles.reduce((n, f) => n + (f.content.split('\n## ').length - 1), 0),
        },
        bots: loadBotLearningStats(),
        hygiene: await loadHygieneLog(username),
        flags,
    };
};

/** Cheap sync subset for a nav badge — counts only, no notebook walk. */
export const countPendingEverything = (username: string): number =>
    listSkillDrafts(username).length
    + listLearningProposals(username).length
    + listAmendments('pending').length;
