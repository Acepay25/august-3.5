/**
 * researchReport.ts — the printable research document (a Minara port: their
 * Deep Research output is "downloadable as PDF or Word"; ours is print-to-PDF
 * via the browser, like the existing trade report — no new PDF dependency).
 *
 * One builder, two inputs:
 *   - buildResearchReportDocument(markdown, title) — the Deep Research
 *     pipeline's cited markdown, wrapped in the print stylesheet.
 *   - buildVerdictReportDocument(analysis, turns) — a settled debate verdict
 *     rendered as a structured report (verdict prose, levels, the sizing
 *     trail, citations, provenance) so a floor verdict is shareable too.
 *
 * Everything is escaped (AI text can contain markup) and monochrome for print.
 */

import { TradeAnalysis } from '../types';
import type { DebateTurn } from '../types/message';
import { extractConvictions } from '../components/desk/VerdictCard';
import { FINANCIAL_ADVICE_DISCLAIMER } from './trustSurface';

const escapeHtml = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const SHELL = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #161618; margin: 2rem auto; max-width: 820px; padding: 0 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.35rem; margin: 0 0 .15rem; }
  h2 { font-size: 1rem; margin: 1.4rem 0 .4rem; border-bottom: 1px solid #d2d2d6; padding-bottom: .2rem; text-transform: uppercase; letter-spacing: .04em; color: #4f4f57; }
  h3 { font-size: .9rem; margin: 1rem 0 .3rem; }
  .sub { color: #4f4f57; font-size: .8rem; margin-bottom: 1.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; margin: .5rem 0; }
  th, td { border-bottom: 1px solid #d2d2d6; padding: .4rem .5rem; text-align: left; }
  th { background: #eef0f2; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #4f4f57; }
  .chip { display: inline-block; border: 1px solid #b0b0b6; border-radius: 999px; padding: .05rem .55rem; font-size: .72rem; margin-right: .3rem; }
  ul { margin: .3rem 0 .6rem; padding-left: 1.1rem; }
  .steps li { list-style: none; margin: .1rem 0; color: #3a3a41; }
  .quote { border-left: 3px solid #c2c2c8; padding-left: .7rem; color: #2e2e34; margin: .4rem 0; white-space: pre-wrap; }
  .foot { margin-top: 1.6rem; color: #4f4f57; font-size: .7rem; border-top: 1px solid #d2d2d6; padding-top: .6rem; }
  @media print { body { margin: 0; max-width: none; } }
</style>
</head>
<body>${body}<div class="foot">${escapeHtml(FINANCIAL_ADVICE_DISCLAIMER)} · Generated ${new Date().toLocaleString()}</div></body>
</html>`;

/** A minimal, safe markdown→HTML for the research body (headings, lists,
 *  bold/italic, and [n] citation markers kept as-is). No script, no raw HTML. */
const renderMarkdown = (md: string): string => {
    const lines = (md || '').replace(/\r/g, '').split('\n');
    const out: string[] = [];
    let inList = false;
    const closeList = (): void => { if (inList) { out.push('</ul>'); inList = false; } };
    const inline = (s: string): string => escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\*([^*]+)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const line of lines) {
        const t = line.trim();
        if (/^###\s+/.test(t)) { closeList(); out.push(`<h3>${inline(t.replace(/^###\s+/, ''))}</h3>`); continue; }
        if (/^##\s+/.test(t)) { closeList(); out.push(`<h2>${inline(t.replace(/^##\s+/, ''))}</h2>`); continue; }
        if (/^#\s+/.test(t)) { closeList(); out.push(`<h1>${inline(t.replace(/^#\s+/, ''))}</h1>`); continue; }
        if (/^[-*]\s+/.test(t)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>`); continue; }
        if (!t) { closeList(); continue; }
        closeList();
        out.push(`<p>${inline(t)}</p>`);
    }
    closeList();
    return out.join('\n');
};

export const buildResearchReportDocument = (markdown: string, title = 'August Deep Research'): string =>
    SHELL(title, renderMarkdown(markdown));

/** Structured verdict report — a settled debate rendered as a document. */
export const buildVerdictReportDocument = (
    analysis: TradeAnalysis,
    debateTurns?: DebateTurn[],
    modelsUsed?: Record<string, string>,
    runStats?: { promptVersion?: string; protocol?: string },
): string => {
    const a = analysis;
    const levels = [
        ['Entry', (a.entryPoints || []).map(e => e.price).join(' / ')],
        ['Stop Loss', a.stopLoss],
        ...((a.takeProfit || []).map((tp, i) => [`Take Profit ${i + 1}`, tp.price] as [string, string])),
    ].filter(r => r[1]).map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join('');
    const sizing = a.positionSize
        ? `<p><b>${escapeHtml(a.positionSize.label)} size</b> — ${escapeHtml(a.positionSize.line)}${a.positionSize.riskUsd ? ` · $${Math.round(a.positionSize.riskUsd)} risk` : ''}</p>`
        : '';
    const steps = a.positionSize?.adjustments?.length
        ? `<ul class="steps">${a.positionSize.adjustments.map(x => `<li>↳ ${escapeHtml(x.label)}${x.fractionEffect < 1 ? ` (×${x.fractionEffect})` : ''}</li>`).join('')}</ul>`
        : '';
    const citations = (a.evidence || []).length
        ? `<h2>Evidence</h2>${(a.evidence || []).map(e => `<div class="quote"><b>${escapeHtml(e.claim)}</b> — ${escapeHtml((e.sources || []).join(', '))} <span class="chip">${escapeHtml(e.state)}</span></div>`).join('')}`
        : '';
    const convictions = debateTurns && debateTurns.length
        ? (() => {
            const seats = extractConvictions(debateTurns);
            if (seats.length === 0) return '';
            return `<h2>Conviction auction</h2><table><thead><tr><th>Seat</th><th>Stake</th></tr></thead><tbody>${seats.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.value ?? '—'}</td></tr>`).join('')}</tbody></table>`;
        })()
        : '';
    const provenance: string[] = [];
    if (a.grade) provenance.push(`Grade ${a.grade}`);
    if (a.strategyFamily) provenance.push(escapeHtml(a.strategyFamily));
    if (a.detectedPatternFamily) provenance.push(escapeHtml(a.detectedPatternFamily));
    if (a.originalConfidence && a.originalConfidence !== a.confidence) provenance.push(`downgraded from ${a.originalConfidence}`);
    if (a.verdictReview) provenance.push(`verdict quarantined (${a.verdictReview.reason})`);
    const models = modelsUsed && Object.keys(modelsUsed).length
        ? `<h2>Provenance</h2><ul>${Object.entries(modelsUsed).map(([p, m]) => `<li>${escapeHtml(p)}: ${escapeHtml(m)}</li>`).join('')}${runStats?.protocol ? `<li>protocol: ${escapeHtml(runStats.protocol)}</li>` : ''}${runStats?.promptVersion ? `<li>prompt: v${escapeHtml(runStats.promptVersion)}</li>` : ''}</ul>`
        : '';
    const body = `
      <h1>${escapeHtml(a.coinName || 'Trade')} — ${escapeHtml(a.direction)} · ${escapeHtml(a.confidence)}</h1>
      <div class="sub">${provenance.map(p => `<span class="chip">${p}</span>`).join('')}</div>
      <h2>Verdict</h2>
      ${renderMarkdown(a.strategy || '')}
      ${levels ? `<h2>Levels</h2><table><tbody>${levels}</tbody></table>` : ''}
      ${sizing ? `<h2>Sizing</h2>${sizing}${steps}` : ''}
      ${citations}
      ${convictions}
      ${models}
    `;
    return SHELL(`August verdict — ${a.coinName || 'trade'}`, body);
};

/** Open a print document in a new tab (mirrors exportTradesHTML). */
export const openReportWindow = (html: string): void => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
