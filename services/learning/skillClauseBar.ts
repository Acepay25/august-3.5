/**
 * skillClauseBar — the cycle-free half of draftGates.
 *
 * `draftGates.ts` imports `listSkills` / `skillStrictlyMatchesSetup` from
 * SkillMemoryService, so SkillMemoryService cannot import draftGates back
 * without closing a runtime cycle — the TDZ class that crashed v1.0.20. The
 * eighth intake source (`ingestIfThenFromTrade`, inside SkillMemoryService)
 * needs the same bar the other seven pass, so the pure half lives here and the
 * two notebook-bound helpers arrive as INJECTED readers.
 *
 * Nothing here imports the notebook at all, so both sides can depend on it.
 * `draftGates.ts` re-exports these under their original names; that stays the
 * canonical public surface. This is the single implementation — do not fork it.
 */

import type { CraftedSkill } from '../../schemas/learning';

export const GENERIC_IF_RE = /^(follow trend|use risk management|be careful|manage risk|trade carefully)/i;

/** The same IF/THEN bar validateCraftedSkill applies to worth-gate creates. */
export const validateIfThen = (crafted: Pick<CraftedSkill, 'ifCondition' | 'thenAction'>): string | null => {
    const ic = (crafted.ifCondition || '').trim();
    const ta = (crafted.thenAction || '').trim();
    if (!ic || ic.length < 12) return 'IF condition too short or missing';
    if (!ta || ta.length < 12) return 'THEN action too short or missing';
    if (GENERIC_IF_RE.test(ic)) return 'IF condition is generic';
    return null;
};

/** Words that carry setup identity — generic trading vocabulary and numbers
 *  are stripped so keyword overlap compares pattern nouns, not boilerplate. */
const salientWords = (text: string): string[] => {
    const stop = new Set([
        'with', 'from', 'that', 'this', 'then', 'when', 'near', 'into', 'only', 'must',
        'have', 'been', 'were', 'their', 'they', 'after', 'before', 'while', 'about',
        'above', 'below', 'than', 'over', 'under', 'again', 'also', 'just', 'such',
        'most', 'more', 'some', 'each', 'make', 'made', 'take', 'skip', 'trade',
        'entry', 'enter', 'stop', 'target', 'price', 'level', 'trend', 'setup', 'chart',
    ]);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length >= 4 && !stop.has(w) && !/^\d+$/.test(w));
    return [...new Set(words)].slice(0, 8);
};

/** The minimum shape `coveredByLiveSkill` needs from a live skill. Kept
 *  structural so this module never imports the notebook's SkillMeta. */
export interface CoverableMeta {
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    ifCondition?: string;
    status?: string;
    supersededBy?: string;
}

export interface CoverReader<M extends CoverableMeta = CoverableMeta> {
    /** Enabled, non-superseded live skills the gate may suppress against. */
    listLive: () => M[];
    /** The STRICT (enforcement-grade) setup matcher. */
    strictMatches: (meta: M, setup: { coin?: string; direction?: string; family?: string; regime?: string }) => boolean;
}

/** Does an enabled live skill already cover this setup? Structural match on
 *  coin/direction/family when the source knows them, keyword overlap on the
 *  IF condition for coinless pattern drafts (the book seeds). */
export const coveredByLiveSkill = <M extends CoverableMeta>(
    crafted: Pick<CraftedSkill, 'ifCondition'>,
    reader: CoverReader<M>,
    coin?: string,
    direction?: string,
    family?: string,
): boolean => {
    try {
        const dir = direction && direction !== 'Neutral' ? direction
            : /\b(long|buy)\b/i.test(crafted.ifCondition) ? 'Long'
                : /\b(short|sell|fade)\b/i.test(crafted.ifCondition) ? 'Short'
                    : undefined;
        const words = salientWords(crafted.ifCondition);
        return reader.listLive().some((meta) => {
            if (meta.status === 'retired' || meta.supersededBy) return false;
            // COIN AGREEMENT IS A PREREQUISITE FOR COVERAGE — checked FIRST,
            // before every path below. The strict matcher returns true on
            // sameFamily WITHOUT looking at the coin, so without this a BTC
            // skill "covers" an ETH draft. Coverage is a suppression decision:
            // an ETH setup is not covered by a BTC skill merely because they
            // share a family. A coinless skill still covers cross-coin drafts
            // — it claims no coin scope.
            const normCoin = (c: string): string => c.toUpperCase().replace(/USDT?$/, '');
            if (coin && meta.coin && normCoin(coin) !== normCoin(meta.coin)) return false;
            if (reader.strictMatches(meta, { coin, direction: dir, family })) return true;
            if (words.length >= 3) {
                const hay = `${meta.ifCondition || ''}`.toLowerCase();
                if (words.filter(w => hay.includes(w)).length >= 2) return true;
            }
            return false;
        });
    } catch {
        return false;
    }
};
