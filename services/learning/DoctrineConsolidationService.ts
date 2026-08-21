/**
 * DoctrineConsolidationService — distills the closed-trade log into a short,
 * stable "trading doctrine" the model receives as its own settled beliefs.
 *
 * Raw diary entries are records; the doctrine is conclusions. Every N newly
 * closed trades an LLM pass rewrites profile/doctrine.md in first person:
 * only durable, evidence-backed stances survive ("In compression regimes I
 * wait for the break — front-running cost me 4 of my last 5"). Recent
 * exceptions stay attached so the doctrine never goes stale.
 *
 * Best-effort by design: any failure leaves the previous doctrine untouched.
 */

import { LoggedTrade, TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import {
    getMemoryFiles,
    createMemoryFile,
    updateMemoryFile,
    ensureHarnessFolders,
} from './MemoryFilesService';
import { sendChatTurn } from '../providers/GenericProviderService';

/** Rewrite the doctrine after every N newly-closed trades. */
const DOCTRINE_EVERY_N_TRADES = 10;
/** Hard cap on doctrine length — it is injected on every analysis. */
const MAX_DOCTRINE_CHARS = 1800;

export const DOCTRINE_FILE_NAME = 'doctrine.md';

export interface DoctrineResult {
    updated: boolean;
    reason?: string;
}

const countClosed = (trades: LoggedTrade[]): number =>
    trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS).length;

/**
 * Should consolidation run? True when the closed-trade count has crossed a
 * multiple of N since the last doctrine write (the last count is stamped in
 * the doctrine's front-matter).
 */
export const shouldConsolidateDoctrine = (trades: LoggedTrade[]): boolean => {
    const closed = countClosed(trades);
    if (closed < DOCTRINE_EVERY_N_TRADES) return false;
    const { files } = getMemoryFiles();
    const existing = files.find(f => f.name === DOCTRINE_FILE_NAME);
    const lastCount = (() => {
        const m = existing?.content.match(/<!-- trades:\s*(\d+)\s*-->/);
        return m ? parseInt(m[1], 10) : 0;
    })();
    return closed - lastCount >= DOCTRINE_EVERY_N_TRADES;
};

export const buildDoctrinePrompt = (trades: LoggedTrade[], currentDoctrine: string): string => {
    const closed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const recent = closed.slice(-40).map(t => {
        const a = t.analysis ?? {};
        const post = (t.postMortem || '').replace(/\s+/g, ' ').slice(0, 200);
        return `- ${new Date(t.timestamp).toLocaleDateString()} ${a.coinName ?? '?'} ${a.direction ?? '?'} ${t.outcome}${typeof t.pnlPercent === 'number' ? ` (${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent}%)` : ''}${post ? ` — ${post}` : ''}`;
    }).join('\n');

    return `You maintain your own trading doctrine — the settled beliefs you bring to every analysis.

Below are your recent closed trades with their outcomes and lessons. Distill them into your UPDATED doctrine.

RULES:
- First person, past-tense evidence: "I keep losing when I chase extended moves" not "The trader should avoid...".
- Only stances backed by at least two concrete trades. No generic advice.
- Keep what still holds from the CURRENT doctrine; revise what the new evidence contradicts.
- Attach recent exceptions where a belief did NOT hold recently.
- Maximum 25 lines. Plain markdown bullets. No preamble, no JSON.

CURRENT DOCTRINE:
${currentDoctrine || '(none yet — write the first one)'}

RECENT CLOSED TRADES (oldest → newest):
${recent || '(no closed trades)'}

Output ONLY the new doctrine markdown.`;
};

export const consolidateDoctrine = async (
    trades: LoggedTrade[],
    username: string,
    config: ProviderConfig,
): Promise<DoctrineResult> => {
    try {
        await ensureHarnessFolders(username);
        const { files, folders } = getMemoryFiles();
        const profileFolder = folders.find(f => f.name === 'profile');
        if (!profileFolder) return { updated: false, reason: 'profile folder missing' };

        const existing = files.find(f => f.name === DOCTRINE_FILE_NAME && f.folderId === profileFolder.id);
        const current = existing?.content.split('\n', 2)[0] === '<!--'
            ? existing!.content
            : existing?.content || '';

        if (!shouldConsolidateDoctrine(trades)) {
            return { updated: false, reason: 'not enough new evidence' };
        }

        const prompt = buildDoctrinePrompt(trades, current);
        const result = await sendChatTurn(config, [{ role: 'user', content: prompt }], {
            temperature: 0.3,
            maxTokens: 700,
        });
        let text = (result.text || '').trim();
        if (!text) return { updated: false, reason: 'empty model response' };

        // Strip code fences if the model wrapped the output.
        text = text.replace(/^```(?:markdown)?\n?/, '').replace(/\n```$/, '').trim();
        if (text.length > MAX_DOCTRINE_CHARS) text = `${text.slice(0, MAX_DOCTRINE_CHARS).trimEnd()}\n…`;

        const stamped = `<!-- trades: ${countClosed(trades)} -->\n${text}`;
        if (existing) {
            await updateMemoryFile(existing.id, { content: stamped }, username);
        } else {
            await createMemoryFile(profileFolder.id, DOCTRINE_FILE_NAME, stamped, username, true);
        }
        return { updated: true };
    } catch (e) {
        console.warn('[Doctrine] Consolidation failed (previous doctrine kept):', e instanceof Error ? e.message : e);
        return { updated: false, reason: 'consolidation error' };
    }
};

/** Extract the doctrine body for prompt injection (front-matter stamp removed). */
export const readDoctrineForInjection = (): string => {
    const { files, folders } = getMemoryFiles();
    const profileFolder = folders.find(f => f.name === 'profile');
    if (!profileFolder) return '';
    const file = files.find(f => f.name === DOCTRINE_FILE_NAME && f.folderId === profileFolder.id);
    if (!file?.enabled) return '';
    return file.content.replace(/^<!--[^>]*-->\n?/, '').trim();
};
