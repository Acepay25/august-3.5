import { EnsembleAnalystProgress, EnsembleProgress } from '../types';

export interface GanttLane {
    id: string;
    label: string;
    fill: number;
    live: boolean;
    failed: boolean;
}

export const laneFillForStatus = (status: EnsembleAnalystProgress['status']): number => {
    if (status === 'complete') return 100;
    if (status === 'analyzing') return 62;
    if (status === 'error') return 100;
    return 6;
};

export const lastThoughtSnippet = (text?: string, max = 72): string => {
    if (!text) return '';
    const line = text.trim().split('\n').filter(Boolean).pop() ?? '';
    const compact = line.replace(/\s+/g, ' ').trim();
    if (compact.length <= max) return compact;
    return `${compact.slice(0, max - 1)}…`;
};

/**
 * Compact AI prose for the tiny stage bubbles. These bubbles are deliberately
 * not full Markdown surfaces, so remove formatting markers while preserving
 * the words the model actually produced.
 */
export const formatStageSnippet = (text?: string, max = 72): string => {
    if (!text) return '';
    const compact = text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/[*_~`]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (compact.length <= max) return compact;
    return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};

/**
 * Select the newest completed sentence for the live ticker. A decimal point
 * only counts as punctuation when followed by whitespace or the end of the
 * string, so prices such as 63.748 do not rotate the bubble prematurely.
 * While a sentence is incomplete, the newest bounded tail keeps the text
 * feeling alive between punctuation marks.
 */
export const stageTickerText = (text?: string, max = 72): string => {
    const compact = formatStageSnippet(text, Number.MAX_SAFE_INTEGER);
    if (!compact) return '';
    const sentences = (compact.match(/.*?(?:[.!?](?=\s|$)|$)/g) ?? [compact]).filter(Boolean);
    const completed = sentences.filter(sentence => /[.!?]\s*$/.test(sentence));
    const trailing = sentences[sentences.length - 1] || compact;
    const candidate = /[.!?]\s*$/.test(trailing)
        ? (completed[completed.length - 1] || trailing)
        : trailing;
    return formatStageSnippet(candidate, max);
};

export const buildAnalystGantt = (progress: EnsembleProgress): GanttLane[] => {
    const lanes: GanttLane[] = progress.analysts.map(analyst => ({
        id: analyst.key,
        label: analyst.displayName,
        fill: laneFillForStatus(analyst.status),
        live: analyst.status === 'analyzing',
        failed: analyst.status === 'error',
    }));
    lanes.push({
        id: 'moderator',
        label: 'Moderator',
        fill: progress.moderator.status === 'reviewing' ? 55 : progress.moderator.status === 'error' ? 100 : 6,
        live: progress.moderator.status === 'reviewing',
        failed: progress.moderator.status === 'error',
    });
    return lanes;
};
