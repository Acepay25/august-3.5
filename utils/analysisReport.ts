import { DebateRunEvent, DebateTurn, Message, TradeAnalysis } from '../types';
import { FINANCIAL_ADVICE_DISCLAIMER, sweepDeterministicClaims } from './trustSurface';

const esc = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface AnalysisReportJson {
    generatedAt: string;
    coin?: string;
    direction?: string;
    confidence?: string;
    probability?: number;
    entry?: string;
    stopLoss?: string;
    takeProfit?: string[];
    invalidation?: TradeAnalysis['invalidationCriteria'];
    contract?: TradeAnalysis['recommendationContract'];
    consensus?: TradeAnalysis['analystConsensus'];
    evidence?: TradeAnalysis['evidence'];
    debateTurns?: Array<{ speaker: string; round?: number; text: string }>;
    runLog?: DebateRunEvent[];
}

export const buildAnalysisReportJson = (message: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'>): AnalysisReportJson => {
    const analysis = message.analysis;
    return {
        generatedAt: new Date().toISOString(),
        coin: analysis?.coinName,
        direction: analysis?.direction,
        confidence: analysis?.confidence,
        probability: analysis?.probability,
        entry: analysis?.entryPoints?.[0]?.price,
        stopLoss: analysis?.stopLoss,
        takeProfit: (analysis?.takeProfit || []).map(t => t.price),
        invalidation: analysis?.invalidationCriteria,
        contract: analysis?.recommendationContract,
        consensus: analysis?.analystConsensus,
        evidence: analysis?.evidence,
        debateTurns: (message.debateTurns || []).map(t => ({ speaker: t.speaker, round: t.round, text: t.text })),
        runLog: message.debateRunLog,
    };
};

export const buildAnalysisReportMarkdown = (
    message: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'> & { text?: string }
): string => {
    const a = message.analysis;
    const lines: string[] = [
        `# Analysis report — ${a?.coinName || 'Trade'}`,
        `Generated: ${new Date().toISOString()}`,
        '',
        `**Verdict:** ${a?.direction || '—'} · ${a?.confidence || '—'} · ${a?.probability ?? '—'}%`,
        `**Entry:** ${a?.entryPoints?.[0]?.price || '—'} · **SL:** ${a?.stopLoss || '—'} · **TP:** ${(a?.takeProfit || []).map(t => t.price).join(', ') || '—'}`,
    ];
    if (a?.recommendationContract) {
        const c = a.recommendationContract;
        lines.push(`**Contract:** ${c.action} — ${c.riskBoundary}${c.validityMinutes ? ` · valid ${c.validityMinutes}m` : ''}`);
        lines.push(`**Thesis:** ${c.thesis}`);
    }
    if (a?.invalidationCriteria?.length) {
        lines.push('', '## Invalidation');
        for (const item of a.invalidationCriteria) {
            lines.push(`- ${item.level} — ${item.condition}`);
        }
    }
    if (a?.analystConsensus?.entries?.length) {
        lines.push('', '## Consensus');
        lines.push(`Divergence ${a.analystConsensus.divergence.score}/100${a.analystConsensus.divergence.isEchoChamber ? ' · echo chamber' : ''}`);
        for (const e of a.analystConsensus.entries) {
            lines.push(`- ${e.displayName}: ${e.direction || '—'} ${e.probability ?? '—'}% entry ${e.entry || '—'} SL ${e.stopLoss || '—'}`);
        }
    }
    if (message.debateTurns && message.debateTurns.length > 0) {
        lines.push('', '## Debate');
        for (const turn of message.debateTurns as DebateTurn[]) {
            lines.push('', `### ${turn.speaker}${turn.round ? ` · r${turn.round}` : ''}`, turn.text);
        }
    }
    if (message.debateRunLog?.length) {
        lines.push('', '## Run log');
        for (const event of message.debateRunLog) {
            lines.push(`- ${event.kind}${event.round ? ` r${event.round}` : ''}${event.speaker ? ` ${event.speaker}` : ''}: ${event.detail}`);
        }
    }
    return lines.join('\n');
};

/** Phone-sized execution sheet — levels, size, validity, cites. No debate dump. */
export const buildTicketSheet = (analysis: TradeAnalysis): string => {
    const cites = (analysis.levelCitations || []).map(c => `${c.label} ${c.price} (${c.sourceId})`).join('\n');
    // Rendered-copy sweep (Batch 7): soften any deterministic claim that
    // survived the prompt-side ban and close with the standing framing.
    const raw = [
        `${analysis.coinName || 'Ticket'} · ${analysis.direction || '—'} · ${analysis.confidence || '—'}`,
        `Entry ${analysis.entryPoints?.[0]?.price || '—'}  SL ${analysis.stopLoss || '—'}  TP ${(analysis.takeProfit || []).map(t => t.price).join(', ') || '—'}`,
        analysis.positionSize?.line ? `Size ${analysis.positionSize.line}` : '',
        analysis.recommendationContract
            ? `Contract ${analysis.recommendationContract.action} · ${analysis.recommendationContract.riskBoundary}${analysis.recommendationContract.validityMinutes ? ` · ${analysis.recommendationContract.validityMinutes}m` : ''}`
            : '',
        cites ? `Cites\n${cites}` : '',
        (analysis.invalidationCriteria || []).map(i => `Invalidate ${i.level} — ${i.condition}`).join('\n'),
    ].filter(Boolean).join('\n');
    const swept = sweepDeterministicClaims(raw);
    return `${swept.text}\n${FINANCIAL_ADVICE_DISCLAIMER}`;
};

export const buildAnalysisReportHtml = (message: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'> & { text?: string }): string => {
    const md = buildAnalysisReportMarkdown(message);
    const body = esc(md).replace(/\n/g, '<br/>');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>August analysis</title>
<style>body{background:#0a0a0a;color:#d4d4d8;font:14px/1.5 ui-sans-serif,system-ui;max-width:720px;margin:40px auto;padding:0 20px}</style>
</head><body>${body}</body></html>`;
};
