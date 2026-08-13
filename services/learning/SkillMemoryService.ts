/**
 * Evidence-gated skills in the trader notebook (skills/*.md).
 *
 * A skill is a procedure with a trigger and a win/loss score. The harness
 * creates one only after a cluster of similar closed trades; each new
 * WIN/LOSS updates the score; weak skills are retired. Analysts retrieve
 * matching skills — they do not get every skill dumped into the prompt.
 */

import { LoggedTrade, MemoryFile, TradeOutcome } from '../../types';
import {
    createMemoryFile,
    deleteMemoryFile,
    ensureHarnessFolders,
    extractLessonFromPostMortem,
    getMemoryFiles,
    slugifyName,
    updateMemoryFile,
} from './MemoryFilesService';

export type SkillStatus = 'candidate' | 'confirmed' | 'retired';
export type SkillKind = 'repeat' | 'avoid';

export interface SkillMeta {
    status: SkillStatus;
    kind: SkillKind;
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    wins: number;
    losses: number;
    tradeIds: string[];
    body: string;
}

export const MIN_CLUSTER_FOR_SKILL = 3;
export const MIN_SAMPLE_CONFIRMED = 5;
export const MIN_SAMPLE_RETIRE = 6;

const folderName = (folderId: string): string =>
    getMemoryFiles().folders.find(f => f.id === folderId)?.name ?? '';

export const isSkillFile = (file: MemoryFile): boolean =>
    folderName(file.folderId) === 'skills' && file.name.endsWith('.md');

export const parseSkillMarkdown = (content: string): SkillMeta | null => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;
    const fm = match[1];
    const body = (match[2] || '').trim();
    const pick = (key: string): string | undefined => {
        const line = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
        const v = line?.[1]?.trim();
        return v && v !== 'undefined' && v !== '' ? v : undefined;
    };
    const num = (key: string): number => {
        const n = parseInt(pick(key) || '0', 10);
        return Number.isFinite(n) ? n : 0;
    };
    const statusRaw = (pick('status') || 'candidate').toLowerCase();
    const status: SkillStatus = statusRaw === 'confirmed' || statusRaw === 'retired' ? statusRaw : 'candidate';
    const kind: SkillKind = (pick('kind') || '').toLowerCase() === 'repeat' ? 'repeat' : 'avoid';
    const tradeIds = (pick('tradeIds') || '').split(',').map(s => s.trim()).filter(Boolean);
    return {
        status,
        kind,
        coin: pick('coin'),
        direction: pick('direction'),
        family: pick('family'),
        regime: pick('regime'),
        wins: num('wins'),
        losses: num('losses'),
        tradeIds,
        body,
    };
};

export const serializeSkill = (meta: SkillMeta, title: string): string => {
    const lines = [
        '---',
        `status: ${meta.status}`,
        `kind: ${meta.kind}`,
        ...(meta.coin ? [`coin: ${meta.coin}`] : []),
        ...(meta.direction ? [`direction: ${meta.direction}`] : []),
        ...(meta.family ? [`family: ${meta.family}`] : []),
        ...(meta.regime ? [`regime: ${meta.regime}`] : []),
        `wins: ${meta.wins}`,
        `losses: ${meta.losses}`,
        `sample: ${meta.wins + meta.losses}`,
        `tradeIds: ${meta.tradeIds.slice(-20).join(',')}`,
        '---',
        '',
        `# ${title}`,
        '',
        meta.body.trim(),
        '',
    ];
    return lines.join('\n');
};

export const skillMatchesSetup = (
    meta: SkillMeta,
    setup: { coin?: string; direction?: string; family?: string; pattern?: string; regime?: string }
): boolean => {
    if (meta.status === 'retired') return false;
    let hits = 0;
    const coin = setup.coin?.toUpperCase().replace(/USDT?$/, '');
    const skillCoin = meta.coin?.toUpperCase().replace(/USDT?$/, '');
    if (coin && skillCoin && coin === skillCoin) hits += 2;
    if (setup.direction && meta.direction && setup.direction === meta.direction) hits += 2;
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    if (fam && meta.family && fam.includes(meta.family.toLowerCase())) hits += 2;
    if (setup.regime && meta.regime && setup.regime === meta.regime) hits += 1;
    return hits >= 2;
};

const deriveStatus = (meta: SkillMeta): SkillStatus => {
    const sample = meta.wins + meta.losses;
    const winRate = sample > 0 ? meta.wins / sample : 0;
    if (sample >= MIN_SAMPLE_RETIRE) {
        if (meta.kind === 'repeat' && winRate < 0.4) return 'retired';
        if (meta.kind === 'avoid' && winRate > 0.6) return 'retired';
    }
    if (sample >= MIN_SAMPLE_CONFIRMED) {
        if (meta.kind === 'repeat' && winRate >= 0.6) return 'confirmed';
        if (meta.kind === 'avoid' && winRate <= 0.4) return 'confirmed';
        return 'candidate';
    }
    return 'candidate';
};

const titleFromMeta = (meta: SkillMeta): string => {
    const bits = [meta.kind === 'avoid' ? 'Avoid' : 'Repeat', meta.coin, meta.direction, meta.family]
        .filter(Boolean);
    return bits.join(' ') || 'Skill';
};

const fileNameFromMeta = (meta: SkillMeta): string => {
    const slug = slugifyName([meta.coin, meta.direction, meta.family, meta.kind].filter(Boolean).join(' '))
        || 'skill';
    return `${slug}.md`;
};

const clusterKey = (trade: LoggedTrade): string => {
    const coin = (trade.analysis?.coinName || 'GEN').toUpperCase().replace(/USDT?$/, '');
    const dir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : 'Neutral';
    const fam = trade.analysis?.detectedPatternFamily || trade.analysis?.marketConditions?.pattern || 'any';
    return `${coin}|${dir}|${fam}`;
};

/**
 * After a closed trade, bump wins/losses on every matching skill.
 */
export const applySkillEvidence = async (trade: LoggedTrade, username: string): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    await ensureHarnessFolders(username);
    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    for (const file of getMemoryFiles().files.filter(isSkillFile)) {
        const meta = parseSkillMarkdown(file.content);
        if (!meta || !skillMatchesSetup(meta, setup)) continue;
        if (meta.tradeIds.includes(trade.id)) continue;
        if (trade.outcome === TradeOutcome.WIN) meta.wins += 1;
        else meta.losses += 1;
        meta.tradeIds = [...meta.tradeIds, trade.id];
        meta.status = deriveStatus(meta);
        await updateMemoryFile(file.id, {
            content: serializeSkill(meta, titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);
    }
};

/**
 * Create a skill when a similar cluster reaches MIN_CLUSTER_FOR_SKILL and
 * no matching skill exists yet. Evidence-gated — not a free-form LLM spawn.
 */
export const maybeUpsertSkill = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<MemoryFile | null> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return null;
    await ensureHarnessFolders(username);
    const key = clusterKey(trade);
    const cluster = allTrades.filter(t =>
        (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key
    );
    if (cluster.length < MIN_CLUSTER_FOR_SKILL) return null;

    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction === 'Neutral' ? undefined : trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    const existing = getMemoryFiles().files.filter(isSkillFile).some(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta ? skillMatchesSetup(meta, setup) : false;
    });
    if (existing) return null;

    const wins = cluster.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = cluster.filter(t => t.outcome === TradeOutcome.LOSS).length;
    const kind: SkillKind = losses >= wins ? 'avoid' : 'repeat';
    const lesson = extractLessonFromPostMortem(trade.postMortem ?? '')
        || (kind === 'avoid'
            ? 'Do not repeat this setup until structure and invalidation are clearer.'
            : 'Repeat this setup only when the same confluence is present.');
    const meta: SkillMeta = {
        status: 'candidate',
        kind,
        coin: trade.analysis?.coinName,
        direction: setup.direction,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        wins,
        losses,
        tradeIds: cluster.map(t => t.id),
        body: [
            `**Trigger:** ${[setup.coin, setup.direction, setup.family].filter(Boolean).join(' · ') || 'matching setup'}`,
            `**Procedure:** ${lesson}`,
            `**Invalidates:** thesis break or a different regime than ${setup.regime || 'the one that produced this cluster'}.`,
        ].join('\n'),
    };
    meta.status = deriveStatus(meta);

    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return null;
    const content = serializeSkill(meta, titleFromMeta(meta));
    return createMemoryFile(folder.id, fileNameFromMeta(meta), content, username, true);
};

/**
 * Disable retired skills and merge exact-duplicate triggers (same file stem).
 */
export const consolidateSkills = async (username: string): Promise<void> => {
    await ensureHarnessFolders(username);
    const skills = getMemoryFiles().files.filter(isSkillFile);
    const byKey = new Map<string, MemoryFile[]>();
    for (const file of skills) {
        const meta = parseSkillMarkdown(file.content);
        const key = meta
            ? [meta.coin, meta.direction, meta.family, meta.kind].join('|').toLowerCase()
            : file.name;
        const list = byKey.get(key) ?? [];
        list.push(file);
        byKey.set(key, list);
    }
    for (const group of byKey.values()) {
        if (group.length < 2) {
            const meta = parseSkillMarkdown(group[0].content);
            if (meta?.status === 'retired' && group[0].enabled) {
                await updateMemoryFile(group[0].id, { enabled: false }, username);
            }
            continue;
        }
        const metas = group.map(f => parseSkillMarkdown(f.content)).filter(Boolean) as SkillMeta[];
        const keep = group[0];
        const merged: SkillMeta = {
            ...metas[0],
            wins: metas.reduce((s, m) => s + m.wins, 0),
            losses: metas.reduce((s, m) => s + m.losses, 0),
            tradeIds: [...new Set(metas.flatMap(m => m.tradeIds))],
            body: metas[0].body,
        };
        merged.status = deriveStatus(merged);
        await updateMemoryFile(keep.id, {
            content: serializeSkill(merged, titleFromMeta(merged)),
            enabled: merged.status !== 'retired',
        }, username);
        for (const extra of group.slice(1)) {
            await deleteMemoryFile(extra.id, username);
        }
    }
};
