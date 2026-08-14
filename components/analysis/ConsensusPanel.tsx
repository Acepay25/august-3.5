import React from 'react';
import { AnalystConsensus } from '../../types';

interface ConsensusPanelProps {
    consensus: AnalystConsensus;
}

const ConsensusPanel: React.FC<ConsensusPanelProps> = ({ consensus }) => {
    const { entries, divergence } = consensus;
    if (!entries.length) return null;
    return (
        <div className="pt-1">
            <div className="flex flex-wrap items-baseline gap-2">
                <span className="ui-kicker">Consensus</span>
                <span className="text-[11px] text-zinc-400">Divergence {divergence.score}/100</span>
                {divergence.isEchoChamber && (
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-400">Echo chamber</span>
                )}
            </div>
            <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
                            <th className="py-1 pr-2 font-semibold">Analyst</th>
                            <th className="py-1 pr-2 font-semibold">Dir</th>
                            <th className="py-1 pr-2 font-semibold">P</th>
                            <th className="py-1 pr-2 font-semibold">Entry</th>
                            <th className="py-1 font-semibold">SL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => (
                            <tr key={entry.thoughtsKey || entry.providerId} className="border-t border-white/5 text-zinc-300">
                                <td className="py-1 pr-2 max-w-[140px] truncate" title={entry.displayName}>{entry.displayName}</td>
                                <td className="py-1 pr-2">{entry.direction || '—'}</td>
                                <td className="py-1 pr-2 tabular-nums">{entry.probability ?? '—'}</td>
                                <td className="py-1 pr-2 tabular-nums">{entry.entry || '—'}</td>
                                <td className="py-1 tabular-nums">{entry.stopLoss || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {divergence.details.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{divergence.details.join(' · ')}</p>
            )}
            {consensus.citations && consensus.citations.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-white/5 pt-2">
                    {consensus.citations.map(c => (
                        <li key={c.displayName} className="text-[11px] text-zinc-400">
                            <span className="font-semibold text-zinc-300">{c.displayName}</span>
                            {' — '}{c.aligned ? 'used' : 'not used'}: {c.note}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default React.memo(ConsensusPanel);
