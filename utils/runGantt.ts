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
