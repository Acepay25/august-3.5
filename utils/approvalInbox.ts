import { Message, TradeAnalysis, TradeOutcome } from '../types';
import { AutopilotResolution } from '../services/ui/OutcomeAutopilotService';
import { ticketExpiryLine } from './paperPnl';
import { listSkillDrafts } from './skillDrafts';

export type ApprovalKind = 'autopilot' | 'expired' | 'ungrounded' | 'replace' | 'skill';
export type AutoJournalPolicy = 'ask' | 'always' | 'deny';

export interface ApprovalItem {
    id: string;
    kind: ApprovalKind;
    title: string;
    detail: string;
    messageId: string;
    coin?: string;
}

export interface AutoJournalRule {
    coin: string;
    policy: Exclude<AutoJournalPolicy, 'ask'>;
}

const LEGACY_RULES_KEY = 'approval_rules_v1';
const rulesKey = (username?: string): string =>
    `approval_rules_v1:${(username || 'default').trim() || 'default'}`;

const readRules = (username?: string): AutoJournalRule[] => {
    try {
        const raw = localStorage.getItem(rulesKey(username))
            ?? (!username ? localStorage.getItem(LEGACY_RULES_KEY) : null);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const getAutoJournalRules = (username?: string): AutoJournalRule[] =>
    typeof localStorage === 'undefined' ? [] : readRules(username);

export const setAutoJournalRule = (coin: string, policy: AutoJournalPolicy, username?: string): AutoJournalRule[] => {
    const key = coin.toUpperCase();
    const next = getAutoJournalRules(username).filter(r => r.coin !== key);
    if (policy !== 'ask') next.push({ coin: key, policy });
    try {
        localStorage.setItem(rulesKey(username), JSON.stringify(next));
    } catch { /* ignore */ }
    return next;
};

export const autoJournalPolicyFor = (coin?: string, username?: string): AutoJournalPolicy => {
    if (!coin) return 'ask';
    const hit = getAutoJournalRules(username).find(r => r.coin === coin.toUpperCase());
    return hit?.policy ?? 'ask';
};

export const collectApprovalItems = (
    messages: Message[],
    resolutions: Record<string, AutopilotResolution>,
    username?: string,
): ApprovalItem[] => {
    const items: ApprovalItem[] = [];
    for (const message of messages) {
        const coin = message.analysis?.coinName;
        const resolution = resolutions[message.id];
        if (resolution && message.outcome === TradeOutcome.PENDING) {
            items.push({
                id: `ap-${message.id}`,
                kind: 'autopilot',
                title: coin || 'Setup',
                detail: resolution.detail,
                messageId: message.id,
                coin,
            });
        }
        if (message.replacementOffer && !message.replacementOffer.chosenProviderId) {
            items.push({
                id: `rp-${message.id}`,
                kind: 'replace',
                title: `${message.replacementOffer.droppedName} dropped`,
                detail: 'Pick a replacement analyst or skip.',
                messageId: message.id,
                coin,
            });
        }
        const expiry = message.analysis ? ticketExpiryLine(message.analysis) : null;
        if (message.watched && expiry?.expired && message.outcome === TradeOutcome.PENDING) {
            items.push({
                id: `ex-${message.id}`,
                kind: 'expired',
                title: coin || 'Watched setup',
                detail: expiry.line,
                messageId: message.id,
                coin,
            });
        }
        const warn = message.analysis?.validationWarnings?.find(w => /Ungrounded/i.test(w));
        if (warn) {
            items.push({
                id: `ug-${message.id}`,
                kind: 'ungrounded',
                title: coin || 'Ticket',
                detail: warn,
                messageId: message.id,
                coin,
            });
        }
    }
    for (const draft of listSkillDrafts(username)) {
        items.push({
            id: draft.id,
            kind: 'skill',
            title: draft.crafted.name,
            detail: `IF ${draft.crafted.ifCondition} THEN ${draft.crafted.thenAction}`,
            messageId: draft.tradeId,
            coin: draft.coin,
        });
    }
    return items;
};

export const isUngroundedAvoid = (analysis?: TradeAnalysis): boolean =>
    Boolean(analysis?.validationWarnings?.some(w => /Ungrounded/i.test(w)));
