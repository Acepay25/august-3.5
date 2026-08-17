import { Message } from '../types';

export type AnalysisTraceTone = 'neutral' | 'good' | 'warning' | 'blocked';

export interface AnalysisTraceEvent {
    id: string;
    at?: string;
    label: string;
    detail: string;
    tone: AnalysisTraceTone;
}

const formatTime = (value?: string): string | undefined => {
    if (!value) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return undefined;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * Reconstruct the important observable stages of a run from persisted message
 * data. This is deliberately provider-agnostic: it explains what August
 * received, parsed, gated, and rendered without exposing hidden chain of
 * thought or requiring a second provider call.
 */
export const buildAnalysisTrace = (message: Message): AnalysisTraceEvent[] => {
    const events: AnalysisTraceEvent[] = [];
    const add = (event: Omit<AnalysisTraceEvent, 'id'>, suffix: string): void => {
        events.push({ ...event, id: `${events.length}-${suffix}` });
    };

    if (message.runStats?.startedAt) {
        add({
            at: message.runStats.startedAt,
            label: 'Run started',
            detail: message.runStats.analystCount
                ? `${message.runStats.analystCount} analyst${message.runStats.analystCount === 1 ? '' : 's'} assigned`
                : 'Analysis request accepted',
            tone: 'neutral',
        }, 'start');
    }

    const gateResult = message.analysis?.gateResult;
    if (gateResult) {
        const cap = Math.round(gateResult.confidenceCap * 100);
        add({
            label: gateResult.passed ? 'Gate passed' : 'Gate blocked',
            detail: `Confidence cap ${cap}% · ${gateResult.warnings[0] || gateResult.insights[0] || 'No additional gate note'}`,
            tone: gateResult.passed ? 'good' : 'blocked',
        }, 'gate');
    }

    const analysts = message.ensembleProgress?.analysts ?? [];
    for (const analyst of analysts) {
        const detail = analyst.error
            ? analyst.error
            : analyst.reasoning || analyst.thoughtProcess
                ? `Reasoning received${analyst.finalOutput ? ' · public output received' : ''}`
                : analyst.status === 'complete' ? 'Public output received' : analyst.status;
        add({
            label: analyst.displayName || analyst.providerName || 'Analyst',
            detail,
            tone: analyst.error ? 'blocked' : analyst.status === 'complete' ? 'good' : 'neutral',
        }, `analyst-${analyst.key}`);
    }

    for (const event of message.debateRunLog ?? []) {
        add({
            at: event.at,
            label: event.kind === 'pre_step' ? 'Pipeline step' : event.kind,
            detail: [event.speaker, event.round ? `round ${event.round}` : undefined, event.detail]
                .filter(Boolean)
                .join(' · '),
            tone: event.kind === 'gate' && /block|veto|fail|cap|downgrad/i.test(event.detail) ? 'blocked' : 'neutral',
        }, `log-${event.at}-${event.kind}`);
    }

    const turnCount = (message.debateTurns ?? message.postMortemDebateTurns ?? []).length;
    if (turnCount > 0) {
        add({
            label: 'Transcript parsed',
            detail: `${turnCount} public debate turn${turnCount === 1 ? '' : 's'} attached to the message`,
            tone: 'good',
        }, 'transcript');
    }

    const reasoningCount = Object.values(message.reasoningProcesses ?? {})
        .filter(value => Boolean(value?.trim())).length;
    const thoughtCount = Object.values(message.thoughtProcesses ?? {})
        .filter(value => Boolean(value?.trim())).length;
    if (reasoningCount > 0 || thoughtCount > 0) {
        add({
            label: 'Reasoning lanes',
            detail: `${reasoningCount} provider reasoning trace${reasoningCount === 1 ? '' : 's'} · ${thoughtCount} public thought lane${thoughtCount === 1 ? '' : 's'}`,
            tone: 'good',
        }, 'reasoning');
    }

    if (message.analysis?.originalConfidence && message.analysis.originalConfidence !== message.analysis.confidence) {
        add({
            label: 'Confidence adjusted',
            detail: `${message.analysis.originalConfidence} → ${message.analysis.confidence}${message.analysis.validationWarnings?.[0] ? ` · ${message.analysis.validationWarnings[0]}` : ''}`,
            tone: message.analysis.confidence === 'Avoid' ? 'blocked' : 'warning',
        }, 'confidence');
    }

    for (const warning of message.analysis?.validationWarnings ?? []) {
        if (!/adjust|cap|veto|downgrad|avoid/i.test(warning)) continue;
        add({
            label: 'Decision rule',
            detail: warning.replace(/^\s+/, '').replace(/^⚠️\s*/u, '').replace(/^🚫\s*/u, '').trim(),
            tone: /veto|avoid/i.test(warning) ? 'blocked' : 'warning',
        }, `rule-${warning}`);
    }

    if (message.analysis?.validationWarnings?.length) {
        add({
            label: 'Validation result',
            detail: `${message.analysis.validationWarnings.length} warning${message.analysis.validationWarnings.length === 1 ? '' : 's'} recorded`,
            tone: message.analysis.confidence === 'Avoid' ? 'blocked' : 'warning',
        }, 'validation');
    }

    if (message.analysis) {
        add({
            at: message.runStats?.finishedAt,
            label: 'Verdict rendered',
            detail: `${message.analysis.direction} · ${message.analysis.confidence} · ${Math.round(message.analysis.probability)}%`,
            tone: message.analysis.confidence === 'Avoid' ? 'blocked' : 'good',
        }, 'verdict');
    }

    if (events.length === 0) {
        add({ label: 'No trace data', detail: 'This older message predates the run trace fields.', tone: 'neutral' }, 'empty');
    }
    return events;
};

export const formatTraceTime = formatTime;
