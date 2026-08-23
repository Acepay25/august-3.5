import React from 'react';
import { Task, TaskTrigger, TaskContent } from '../ui/task';
import AuditPanel from '../shared/AuditPanel';

/**
 * Minimal shape mirrored on Message.evidencePack (kept structural so the
 * component does not import from services/).
 */
export interface EvidencePackView {
    statsLine: string;
    causePattern: string;
    similar: Array<{ outcome: string; coin: string; direction: string; date: string; lesson: string; similarity: number }>;
    skills: string[];
    doctrineHeader: string;
}

interface EvidencePackCardProps {
    pack?: EvidencePackView;
}

const stripMd = (text: string): string => text.replace(/\*\*/g, '');

/**
 * Verdict evidence card (ROUND-28/U2, ROUND-29 container pass): shows the
 * journal evidence the moderator's verdict was grounded in — cluster record,
 * similar closed trades, matched notebook skills, doctrine header. Mirrors
 * the prompt-side evidence pack byte-for-byte in content, so the user audits
 * exactly what the arbiter saw. Charcoal-only; collapsed by default.
 * Wrapped in AuditPanel — the one container language for audit surfaces.
 */
const EvidencePackCard: React.FC<EvidencePackCardProps> = ({ pack }) => {
    if (!pack) return null;
    const { statsLine, causePattern, similar, skills, doctrineHeader } = pack;
    const parts = [
        statsLine ? 'journal record' : '',
        causePattern ? 'failure pattern' : '',
        similar.length > 0 ? `${similar.length} similar trade${similar.length === 1 ? '' : 's'}` : '',
        skills.length > 0 ? `${skills.length} skill${skills.length === 1 ? '' : 's'}` : '',
        doctrineHeader ? 'doctrine' : '',
    ].filter(Boolean);
    if (parts.length === 0) return null;

    return (
        <div className="mb-2">
            <AuditPanel>
                <Task defaultOpen={false} className="rounded-xl">
                <TaskTrigger title={`Verdict evidence · ${parts.join(' · ')}`} />
                <TaskContent>
                    {statsLine && (
                        <p className="text-[11px] leading-relaxed text-zinc-300">{stripMd(statsLine)}</p>
                    )}
                    {causePattern && (
                        <p className="status-surface text-[11px] leading-relaxed font-medium">{stripMd(causePattern)}</p>
                    )}
                    {similar.length > 0 && (
                        <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Similar closed trades</p>
                            <ul className="mt-1 space-y-1">
                                {similar.map((s, i) => (
                                    <li key={`${s.coin}-${s.date}-${i}`} className="text-[11px] leading-snug text-zinc-400">
                                        <span className={s.outcome === 'WIN' ? 'font-semibold text-zinc-100' : s.outcome === 'LOSS' ? 'font-semibold text-zinc-500' : 'font-semibold'}>{s.outcome}</span>
                                        {' · '}{s.date} {s.coin} {s.direction}
                                        <span className="text-zinc-600"> · {s.similarity}% match</span>
                                        {s.lesson ? <span className="text-zinc-500"> — {s.lesson}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {skills.length > 0 && (
                        <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Matched notebook skills</p>
                            <ul className="mt-1 space-y-1">
                                {skills.map((s, i) => (
                                    <li key={i} className="text-[11px] leading-snug text-zinc-400">{stripMd(s).replace(/^-\s*/, '')}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {doctrineHeader && (
                        <p className="border-t border-white/5 pt-2 text-[11px] italic leading-relaxed text-zinc-500">
                            Doctrine: {stripMd(doctrineHeader)}
                        </p>
                    )}
                </TaskContent>
            </Task>
            </AuditPanel>
        </div>
    );
};

export default EvidencePackCard;
