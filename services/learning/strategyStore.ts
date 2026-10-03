/**
 * strategyStore — a named, versioned TRADE PLAN the model can propose.
 *
 * A skill could only ever say "when X, do Y". That is a trigger, not a
 * strategy: three skills that each described the reclaim setup carried three
 * copies of the same entry/stop/target, and they drifted. A Strategy is the
 * one object those rules point at.
 *
 * Deliberate choices:
 *
 *  - **It lives in the notebook, not SQLite.** Skills, rules and notes are
 *    already markdown in the `memory_files_v1_<user>` blob with a working
 *    draft/approve/evidence pipeline. A second persistence path means a second
 *    backup + export namespace — the exact phantom-namespace bug the Teams
 *    roster carried until it was deleted.
 *  - **It is NOT a backtester.** A strategy reuses LiveBacktestService and the
 *    outcome engine for evidence; it gets no simulation of its own.
 *  - **Fields are free text on purpose.** `entry: "above the reclaim candle
 *    high"` is a legitimate plan; `entry: "104231.77"` would be a number the
 *    model cannot see. What the app needs is a COMPLETE plan in fields it can
 *    show, not prices it cannot verify.
 */
import {
    createMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    getMemoryFiles,
    updateMemoryFileUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';

export const STRATEGY_FOLDER = 'strategies';

export type StrategyStatus = 'draft' | 'active' | 'retired';

/**
 * The plan. `entry` + `invalidation` are the two that make it a strategy at
 * all; `stop`/`target`/`sizing` are what make it tradable. A plan missing
 * either of the first two is a rule wearing a plan's clothes, so the writer
 * rejects it.
 */
export interface StrategyMeta {
    status: StrategyStatus;
    name: string;
    /** One sentence: what this plan is for. */
    description?: string;
    /** How to get in. */
    entry: string;
    /** What voids the setup — the honest "I was wrong" line. */
    invalidation: string;
    stop?: string;
    target?: string;
    sizing?: string;
    /** Conditions that must hold for this to be tradable right now. */
    conditions?: string[];
    /** Scope, mirroring a skill's: when the plan applies. */
    coin?: string;
    direction?: string;
    family?: string;
    timeframe?: string;
    /** How many times it was traded, won and lost — filled by the evidence
     *  path, never by the model. */
    wins?: number;
    losses?: number;
    createdAt: string;
    modifiedAt?: string;
}

const LIST_PREFIX = '- ';
const pickList = (raw: string | undefined, cap = 8): string[] | undefined => {
    if (!raw) return undefined;
    const items = raw.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith(LIST_PREFIX))
        .map(l => l.slice(LIST_PREFIX.length))
        .filter(Boolean)
        .slice(0, cap);
    return items.length ? items : undefined;
};

const listLine = (items: string[] | undefined): string =>
    (items ?? [])
        // A newline inside an item would start a new frontmatter line, so a
        // condition containing one could inject `invalidation:` and REWRITE the
        // plan's load-bearing field on the next parse. Flatten instead.
        .map(i => `  ${LIST_PREFIX}${i.replace(/\s*[\r\n]+\s*/g, ' ').trim()}`)
        .join('\n');

/** Parse a strategies/*.md file. Returns null when the plan is unusable. */
export function parseStrategyMarkdown(content: string): StrategyMeta | null {
    const lines = content.split('\n');
    if (!lines[0]?.startsWith('---')) return null;
    const end = lines.indexOf('---', 1);
    if (end < 0) return null;
    const fm: Record<string, string> = {};
    for (let i = 1; i < end; i++) {
        const line = lines[i];
        // A `key:|` line opens an indented block (the conditions list). The
        // following indented lines belong to THAT key, not to a fresh pair —
        // without this the list was dropped on read and the plan came back
        // missing the conditions that decide whether it is tradable.
        const openKey = line.match(/^([A-Za-z]+):\|\s*$/);
        if (openKey) {
            const collected: string[] = [];
            let j = i + 1;
            while (j < end && /^\s+\S/.test(lines[j])) {
                collected.push(lines[j].trim());
                j++;
            }
            fm[openKey[1]] = collected.join('\n');
            i = j - 1;
            continue;
        }
        const at = line.indexOf(':');
        if (at > 0) fm[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    const entry = fm.entry ?? '';
    const invalidation = fm.invalidation ?? '';
    // A plan without an entry or without an invalidation is not a strategy.
    if (!entry || !invalidation) return null;
    const name = fm.name || entry.slice(0, 48);
    return {
        // One status parser, one home: anything unrecognised is a draft, which
        // is the safe default — a plan the trader never approved.
        status: fm.status === 'active' || fm.status === 'retired' ? fm.status : 'draft',
        name,
        description: fm.description || undefined,
        entry,
        invalidation,
        stop: fm.stop || undefined,
        target: fm.target || undefined,
        sizing: fm.sizing || undefined,
        conditions: pickList(fm.conditions),
        coin: fm.coin || undefined,
        direction: fm.direction || undefined,
        family: fm.family || undefined,
        timeframe: fm.timeframe || undefined,
        wins: fm.wins !== undefined && Number.isFinite(Number(fm.wins)) ? Number(fm.wins) : undefined,
        losses: fm.losses !== undefined && Number.isFinite(Number(fm.losses)) ? Number(fm.losses) : undefined,
        createdAt: fm.created || new Date().toISOString(),
        modifiedAt: fm.modified || undefined,
    };
}

/** Render a plan back to markdown. Inverse of parseStrategyMarkdown. */
export function serializeStrategy(meta: StrategyMeta): string {
    const fm: string[] = [
        `status: ${meta.status}`,
        `name: ${meta.name}`,
        meta.description ? `description: ${meta.description}` : '',
        `entry: ${meta.entry}`,
        `invalidation: ${meta.invalidation}`,
        meta.stop ? `stop: ${meta.stop}` : '',
        meta.target ? `target: ${meta.target}` : '',
        meta.sizing ? `sizing: ${meta.sizing}` : '',
        meta.conditions?.length ? `conditions:|\n${listLine(meta.conditions)}` : '',
        meta.coin ? `coin: ${meta.coin}` : '',
        meta.direction ? `direction: ${meta.direction}` : '',
        meta.family ? `family: ${meta.family}` : '',
        meta.timeframe ? `timeframe: ${meta.timeframe}` : '',
        typeof meta.wins === 'number' ? `wins: ${meta.wins}` : '',
        typeof meta.losses === 'number' ? `losses: ${meta.losses}` : '',
        `created: ${meta.createdAt}`,
        meta.modifiedAt ? `modified: ${meta.modifiedAt}` : '',
    ].filter(Boolean);
    const body = [
        `# ${meta.name}`,
        '',
        meta.description || '',
        '',
        '**Entry**', meta.entry,
        '',
        '**Invalidation**', meta.invalidation,
        meta.stop ? `\n**Stop** ${meta.stop}` : '',
        meta.target ? `\n**Target** ${meta.target}` : '',
        meta.sizing ? `\n**Size** ${meta.sizing}` : '',
        meta.conditions?.length ? `\n**Requires**\n${meta.conditions.map(c => `- ${c}`).join('\n')}` : '',
        '',
    ].filter(l => l !== undefined).join('\n');
    return `---\n${fm.join('\n')}\n---\n\n${body}`;
}

/** Filesystem slug. Stable and human-readable in the notebook UI. */
export const strategySlug = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'strategy';

/** The notebook file a plan lives in. Exported so no caller re-derives the
 *  slug — a second copy of this rule is how a rename writes a second file. */
export const strategyFileName = (name: string): string => `${strategySlug(name)}.md`;

/** Whether `file` is a plan in the strategies folder. The folderId check is
 *  load-bearing, not decorative: without it any note dropped into
 *  strategies/ would be parsed as a plan and could reach a seat. */
export const isStrategyFile = (file: { folderId: string; name: string }): boolean =>
    file.name.endsWith('.md')
    && getMemoryFiles().folders.some(f => f.id === file.folderId && f.name === STRATEGY_FOLDER);

/** Whether a plan's frontmatter marks it live. A DRAFT is not guidance: it is
 *  an unapproved proposal, and presenting it to a seat as a plan it should
 *  follow is the same defect as an unwritten lens file — worse, because it
 *  looks authoritative. Only `active` reaches the model. */


/** The plans a seat may act on: active, not retired. */
export const listActiveStrategies = (): StrategyMeta[] =>
    listStrategies().filter(s => s.status === 'active');

/** The block a seat reads: the ACTIVE plans, or '' when there are none. */
export const activeStrategiesBlock = (max = 3): string => {
    const active = listActiveStrategies();
    if (active.length === 0) return '';
    const shown = active.slice(0, max);
    const lines = [
        `**ACTIVE STRATEGIES** (${active.length}) — named trade plans the trader has activated. A skill may reference one; when a skill's rule matches an active strategy, follow the strategy's levels and sizing.`,
        '',
        ...shown.map(describeStrategy),
    ];
    if (active.length > shown.length) {
        lines.push(`(+${active.length - shown.length} more)`);
    }
    return lines.join('\n');
};

const strategyFolder = (): { id: string } | undefined =>
    getMemoryFiles().folders.find(f => f.name === STRATEGY_FOLDER);

/** Every strategy for this user, newest first. */
export const listStrategies = (): StrategyMeta[] => {
    const folder = strategyFolder();
    if (!folder) return [];
    return getMemoryFiles().files
        .filter(f => f.folderId === folder.id && isStrategyFile(f))
        .map(f => parseStrategyMarkdown(f.content))
        .filter((m): m is StrategyMeta => m !== null);
};

/** One strategy by slug, or null. */
export const getStrategy = (slug: string): StrategyMeta | null => {
    const folder = strategyFolder();
    if (!folder) return null;
    const file = getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === `${slug}.md`);
    if (!file) return null;
    return parseStrategyMarkdown(file.content);
};

/** A proposed plan, as a model may hand it over. */
export interface StrategyProposal {
    name: string;
    description?: string;
    entry: string;
    invalidation: string;
    stop?: string;
    target?: string;
    sizing?: string;
    conditions?: string[];
    coin?: string;
    direction?: string;
    family?: string;
    timeframe?: string;
}

/** Why a proposal was refused, or '' when it is acceptable. */
export const strategyProposalError = (p: StrategyProposal): string => {
    if (!p.name || p.name.trim().length < 2) return 'name is required';
    if (!p.entry || p.entry.trim().length < 3) return 'entry is required — a strategy must say how to get in';
    if (!p.invalidation || p.invalidation.trim().length < 3) {
        // This is the one that matters: a plan with no "I was wrong" line
        // cannot be falsified, so it can never be retired by evidence.
        return 'invalidation is required — a strategy must say what would make it wrong';
    };
    return '';
};

const writeStrategyUnlocked = async (
    proposal: StrategyProposal,
    username: string,
): Promise<{ slug: string; created: boolean }> => {
    await ensureHarnessFoldersUnlocked(username);
    const folder = strategyFolder();
    if (!folder) return { slug: '', created: false };
    const slug = strategySlug(proposal.name);
    const fileName = `${slug}.md`;
    const existing = getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === fileName);
    const meta: StrategyMeta = {
        status: 'draft',
        name: proposal.name.trim(),
        description: proposal.description?.trim() || undefined,
        entry: proposal.entry.trim(),
        invalidation: proposal.invalidation.trim(),
        stop: proposal.stop?.trim() || undefined,
        target: proposal.target?.trim() || undefined,
        sizing: proposal.sizing?.trim() || undefined,
        conditions: proposal.conditions?.map(c => c.trim()).filter(Boolean).slice(0, 8),
        coin: proposal.coin?.trim() || undefined,
        direction: proposal.direction?.trim() || undefined,
        family: proposal.family?.trim() || undefined,
        timeframe: proposal.timeframe?.trim() || undefined,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
    };
    if (existing) {
        // Re-proposing the same name REVISES the plan and keeps its record, so
        // a refined plan does not fork into a second near-identical strategy.
        const prior = parseStrategyMarkdown(existing.content);
        meta.status = prior?.status ?? 'draft';
        meta.createdAt = prior?.createdAt ?? meta.createdAt;
        meta.wins = prior?.wins;
        meta.losses = prior?.losses;
        await updateMemoryFileUnlocked(existing.id, { content: serializeStrategy(meta) }, username);
        return { slug, created: false };
    }
    await createMemoryFileUnlocked(folder.id, fileName, serializeStrategy(meta), username, true);
    return { slug, created: true };
};

/** Propose a strategy. Best-effort, never throws. */
export const proposeStrategy = async (
    proposal: StrategyProposal,
    username = getActiveUsername(),
): Promise<{ ok: true; slug: string; created: boolean } | { ok: false; error: string }> => {
    const error = strategyProposalError(proposal);
    if (error) return { ok: false, error };
    try {
        const { slug, created } = await withNotebookWriteLock(() => writeStrategyUnlocked(proposal, username));
        return { ok: true, slug, created };
    } catch (e) {
        console.warn('[Strategy] Could not persist the proposed plan:', e);
        return { ok: false, error: 'could not write to the notebook' };
    }
};

/** Activate or retire a plan. Retirement keeps the record for evidence. */
export const setStrategyStatus = async (
    slug: string,
    status: StrategyStatus,
    username = getActiveUsername(),
): Promise<boolean> => {
    try {
        return await withNotebookWriteLock(async () => {
            const folder = strategyFolder();
            if (!folder) return false;
            const file = getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === `${slug}.md`);
            if (!file) return false;
            const meta = parseStrategyMarkdown(file.content);
            if (!meta) return false;
            meta.status = status;
            meta.modifiedAt = new Date().toISOString();
            await updateMemoryFileUnlocked(file.id, { content: serializeStrategy(meta) }, username);
            return true;
        });
    } catch (e) {
        console.warn('[Strategy] Status change failed:', e);
        return false;
    }
};

/** The compact form a seat reads: the plan, one line per field. */
export const describeStrategy = (meta: StrategyMeta): string => [
    `STRATEGY "${meta.name}" (${meta.status})`,
    `  Entry: ${meta.entry}`,
    `  Invalidation: ${meta.invalidation}`,
    meta.stop ? `  Stop: ${meta.stop}` : '',
    meta.target ? `  Target: ${meta.target}` : '',
    meta.sizing ? `  Size: ${meta.sizing}` : '',
    meta.conditions?.length ? `  Requires: ${meta.conditions.join('; ')}` : '',
    typeof meta.wins === 'number' || typeof meta.losses === 'number'
        ? `  Record: ${meta.wins ?? 0}W/${meta.losses ?? 0}L`
        : '',
].filter(Boolean).join('\n');
