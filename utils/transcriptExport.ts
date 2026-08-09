import { DebateTurn, TradeAnalysis } from '../types';

/**
 * Transcript export helpers — serialize a debate to Markdown or JSON and
 * download it as a file. Pure string builders (testable) + one DOM-triggered
 * download helper.
 */

const cleanHeading = (s: string): string =>
  s.replace(/[#*`~\[\]()>|]/g, '').trim().slice(0, 80) || 'Trade';

export const buildTranscriptMarkdown = (
  turns: DebateTurn[],
  analysis?: TradeAnalysis | null
): string => {
  const coin = analysis?.coinName || 'Trade';
  const lines: string[] = [];
  lines.push(`# Debate Transcript — ${cleanHeading(coin)}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (analysis) {
    const entry = analysis.entryPoints?.[0]?.price;
    const tp = analysis.takeProfit?.[0]?.price;
    const verdict = [
      `**Verdict:** ${analysis.direction}`,
      analysis.confidence ? `· ${analysis.confidence} confidence` : '',
      `· ${analysis.probability}%`,
      entry ? `· Entry ${entry}` : '',
      analysis.stopLoss ? `· SL ${analysis.stopLoss}` : '',
      tp ? `· TP ${tp}` : '',
    ].filter(Boolean).join(' ');
    lines.push(verdict);
    if (analysis.strategy) lines.push(`**Strategy:** ${analysis.strategy}`);
  }
  lines.push('');
  lines.push(`Total turns: ${turns.length}`);

  let lastRound: number | undefined;
  for (const turn of turns) {
    if (turn.round !== undefined && turn.round !== lastRound) {
      lines.push('');
      lines.push(`## Round ${turn.round}`);
      lastRound = turn.round;
    }
    lines.push('');
    lines.push(`### ${turn.speaker}${turn.round !== undefined ? ` (Round ${turn.round})` : ''}`);
    lines.push(turn.text);
  }

  return lines.join('\n').trim() + '\n';
};

export const buildTranscriptJson = (
  turns: DebateTurn[],
  analysis?: TradeAnalysis | null
): string => {
  const payload = {
    exportedAt: new Date().toISOString(),
    ...(analysis
      ? {
          analysis: {
            coinName: analysis.coinName,
            direction: analysis.direction,
            confidence: analysis.confidence,
            probability: analysis.probability,
            strategy: analysis.strategy,
            entry: analysis.entryPoints?.[0]?.price ?? null,
            stopLoss: analysis.stopLoss ?? null,
            takeProfit: analysis.takeProfit?.[0]?.price ?? null,
          },
        }
      : {}),
    turns,
  };
  return JSON.stringify(payload, null, 2);
};

export const downloadTextFile = (filename: string, content: string, mime = 'text/plain'): void => {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Release the object URL on the next tick so the download can read it first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const buildTranscriptFilename = (analysis: TradeAnalysis | null | undefined, ext: 'md' | 'json'): string => {
  const coin = analysis?.coinName ? analysis.coinName.replace(/[^A-Za-z0-9-]/g, '').slice(0, 16) : 'trade';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `debate-${coin}-${stamp}.${ext}`;
};
