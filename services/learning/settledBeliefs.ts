/**
 * Settled-beliefs registry (compounding memory).
 *
 * Doctrine is rewritten from scratch every 15 closed trades — anything the
 * rewriter drops is forgotten. Truly permanent lessons live here instead:
 * `settled-beliefs/settled-beliefs.md` (legacy: `profile/settled-beliefs.md`),
 * one `## slug` section per belief with a metadata line
 * (status · added · evidence · regime) and a short body.
 *
 * Rules:
 *  - Injection: only `settled` beliefs reach prompts, as their own slot
 *    ABOVE the doctrine (settledBeliefsBlock).
 *  - The doctrine rewriter may never delete or reword a settled belief.
 *    Its only move is a standalone `INVALIDATE <slug>: <reason>` line in
 *    its output; we parse those, flip the belief to `invalidated` (kept in
 *    the file for audit, excluded from injection), and strip the lines from
 *    the doctrine text before it lands.
 *  - Beliefs are written by the weekly rollup (evidence-backed) or by the
 *    user in the notebook UI. The rewriter never adds beliefs directly.
 */

import {
    getMemoryFiles,
    createMemoryFileUnlocked,
    updateMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';

export const SETTLED_BELIEFS_FILE_NAME = 'settled-beliefs.md';

export type SettledBeliefStatus = 'settled' | 'invalidated';

export interface SettledBelief {
    slug: string;
    status: SettledBeliefStatus;
    /** YYYY-MM-DD the belief was first settled. */
    added: string;
    /** Counted trades backing the belief (wins + losses of the source skill). */
    evidenceCount: number;
    regime?: string;
    /** One or two sentences — the belief itself + optional invalidation rule. */
    body: string;
    /** Set when the doctrine rewriter invalidated it. */
    invalidationReason?: string;
}

const slugify = (text: string): string =>
    text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'belief';

/** Parse the markdown registry into structured beliefs (order preserved). */
export const parseSettledBeliefs = (content: string): SettledBelief[] => {
    if (!content) return [];
    const beliefs: SettledBelief[] = [];
    let current: SettledBelief | null = null;
    const bodyLines: string[] = [];
    const flush = (): void => {
        if (current) {
            current.body = bodyLines.join('\n').trim();
            beliefs.push(current);
        }
        current = null;
        bodyLines.length = 0;
    };
    for (const raw of content.split('\n')) {
        const line = raw.trimEnd();
        const heading = line.match(/^##\s+(.+)$/);
        if (heading) {
            flush();
            current = { slug: heading[1].trim(), status: 'settled', added: '', evidenceCount: 0, body: '' };
            continue;
        }
        if (!current) continue; // preamble before the first belief
        const metaLine = line.match(/^status:\s*(settled|invalidated)\s*(?:·|\|)?\s*(.*)$/i);
        if (metaLine) {
            current.status = metaLine[1].toLowerCase() as SettledBeliefStatus;
            for (const part of metaLine[2].split(/·|\|/)) {
                const added = part.match(/added\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
                if (added) current.added = added[1];
                const evidence = part.match(/evidence\s*:?\s*(\d+)/i);
                if (evidence) current.evidenceCount = parseInt(evidence[1], 10);
                const regime = part.match(/regime\s*:?\s*([A-Za-z_ -]+)/i);
                if (regime) current.regime = regime[1].trim();
                const reason = part.match(/reason\s*:\s*(.+)$/i);
                if (reason) current.invalidationReason = reason[1].trim();
            }
            continue;
        }
        if (line.trim()) bodyLines.push(line.trim());
    }
    flush();
    return beliefs;
};

const serializeBelief = (b: SettledBelief): string => {
    const meta = [
        `status: ${b.status}`,
        b.added ? `added: ${b.added}` : '',
        `evidence: ${b.evidenceCount}`,
        b.regime ? `regime: ${b.regime}` : '',
        b.invalidationReason ? `reason: ${b.invalidationReason}` : '',
    ].filter(Boolean).join(' · ');
    return `## ${b.slug}\n${meta}\n${b.body.trim()}`;
};

export const serializeSettledBeliefs = (beliefs: SettledBelief[]): string =>
    beliefs.map(serializeBelief).join('\n\n');

/** Folder the registry lives in. New notebooks get a dedicated
 *  `settled-beliefs` folder (DEFAULT_FOLDERS); legacy notebooks that predate
 *  it keep the file under `profile`. Reads check both; writes prefer the
 *  dedicated folder. */
const SETTLED_BELIEFS_FOLDER = 'settled-beliefs';

const beliefsFolder = (): { id: string; name: string } | undefined => {
    const { folders } = getMemoryFiles();
    return folders.find(f => f.name === SETTLED_BELIEFS_FOLDER)
        ?? folders.find(f => f.name === 'profile');
};

const findBeliefsFile = () => {
    const { files, folders } = getMemoryFiles();
    const hosts = [SETTLED_BELIEFS_FOLDER, 'profile']
        .map(name => folders.find(f => f.name === name))
        .filter((f): f is NonNullable<typeof f> => Boolean(f));
    for (const folder of hosts) {
        const hit = files.find(f => f.folderId === folder.id && f.name === SETTLED_BELIEFS_FILE_NAME);
        if (hit) return hit;
    }
    return undefined;
};

/** Sync read of the registry (empty list when the file is absent). */
export const readSettledBeliefs = (): SettledBelief[] => {
    const file = findBeliefsFile();
    return file ? parseSettledBeliefs(file.content) : [];
};

/** Only beliefs that should reach prompts. */
export const listActiveBeliefs = (): SettledBelief[] =>
    readSettledBeliefs().filter(b => b.status === 'settled');

/**
 * Add a belief, or refresh an existing one (evidence count + body). The
 * first-settled date is preserved across refreshes. Caller must hold the
 * notebook write lock.
 */
export const upsertSettledBeliefUnlocked = async (
    belief: { slug: string; body: string; evidenceCount: number; regime?: string },
    username: string,
): Promise<void> => {
    await ensureHarnessFoldersUnlocked(username);
    const folder = beliefsFolder();
    if (!folder) return;
    const slug = slugify(belief.slug);
    const body = belief.body.replace(/\s+/g, ' ').trim();
    if (!body) return;
    const existing = findBeliefsFile();
    const beliefs = existing ? parseSettledBeliefs(existing.content) : [];
    const found = beliefs.find(b => b.slug === slug);
    if (found) {
        const prevEvidence = found.evidenceCount;
        found.evidenceCount = Math.max(prevEvidence, belief.evidenceCount);
        found.body = body;
        if (belief.regime) found.regime = belief.regime;
        // An invalidated belief stays invalidated — only strictly more
        // evidence (a fresh rollup) may re-settle it.
        if (found.status === 'settled' || belief.evidenceCount > prevEvidence) {
            found.status = 'settled';
            found.invalidationReason = undefined;
        }
    } else {
        beliefs.push({
            slug,
            status: 'settled',
            added: new Date().toISOString().slice(0, 10),
            evidenceCount: belief.evidenceCount,
            regime: belief.regime,
            body,
        });
    }
    const content = serializeSettledBeliefs(beliefs);
    if (existing) {
        await updateMemoryFileUnlocked(existing.id, { content }, username);
    } else {
        await createMemoryFileUnlocked(folder.id, SETTLED_BELIEFS_FILE_NAME, content, username, true);
    }
};

/** Flip a belief to invalidated (kept for audit). Caller holds the lock. */
export const invalidateSettledBeliefUnlocked = async (
    slug: string,
    reason: string,
    username: string,
): Promise<boolean> => {
    const existing = findBeliefsFile();
    if (!existing) return false;
    const beliefs = parseSettledBeliefs(existing.content);
    const target = slugify(slug);
    const found = beliefs.find(b => b.slug === target && b.status === 'settled');
    if (!found) return false;
    found.status = 'invalidated';
    found.invalidationReason = reason.replace(/\s+/g, ' ').trim().slice(0, 200) || 'invalidated';
    await updateMemoryFileUnlocked(existing.id, { content: serializeSettledBeliefs(beliefs) }, username);
    return true;
};

export const upsertSettledBelief = (
    belief: { slug: string; body: string; evidenceCount: number; regime?: string },
    username: string,
): Promise<void> => withNotebookWriteLock(() => upsertSettledBeliefUnlocked(belief, username));

export const invalidateSettledBelief = (
    slug: string,
    reason: string,
    username: string,
): Promise<boolean> => withNotebookWriteLock(() => invalidateSettledBeliefUnlocked(slug, reason, username));

/** Max chars of the injected slot — it rides OUTSIDE the stage budget. */
export const SETTLED_BELIEFS_BLOCK_MAX = 350;

/**
 * Injection slot: one line per settled belief. Rendered above the doctrine
 * so the model reads permanent convictions before revisable ones.
 */
export const settledBeliefsBlock = (max = SETTLED_BELIEFS_BLOCK_MAX): string => {
    const active = listActiveBeliefs();
    if (active.length === 0) return '';
    const lines = active.map(b =>
        `- ${b.body}${b.evidenceCount > 0 ? ` (evidence: ${b.evidenceCount}${b.regime ? `, ${b.regime}` : ''})` : ''}`
    );
    const text = `SETTLED BELIEFS (permanent — do not contradict without strong new evidence):\n${lines.join('\n')}`;
    return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n…`;
};

/**
 * Pull `INVALIDATE <slug>: <reason>` directives out of a doctrine-rewriter
 * response. Returns the parsed pairs; the caller strips the lines from the
 * doctrine text and applies them to the registry.
 */
export const extractInvalidations = (text: string): Array<{ slug: string; reason: string }> => {
    const found: Array<{ slug: string; reason: string }> = [];
    for (const line of text.split('\n')) {
        const m = line.trim().match(/^[-*]?\s*INVALIDATE\s+([A-Za-z0-9_-]+)\s*:\s*(.+)$/i);
        if (m) found.push({ slug: m[1], reason: m[2].trim() });
    }
    return found;
};

/** Remove invalidation directive lines from doctrine output. */
export const stripInvalidationLines = (text: string): string =>
    text.split('\n').filter(l => !/^[-*]?\s*INVALIDATE\s+[A-Za-z0-9_-]+\s*:/i.test(l.trim())).join('\n').trim();
