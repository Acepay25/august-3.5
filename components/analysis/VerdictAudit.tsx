import React from 'react';
import { TradeAnalysis } from '../../types';
import EvidencePackCard from './EvidencePackCard';
import RunContractPanel from './RunContractPanel';
import { WaitForConfirmationBanner, WhyAvoidPanel } from './WhyAvoidPanel';

/**
 * VerdictAudit — the one home for "why did this run say what it said".
 *
 * Three finished panels used to be dead code: the structured why-avoid
 * breakdown, the wait-for-confirmation trigger, and the verdict evidence pack
 * plus run contract. They are mounted here, and this component is mounted on
 * BOTH surfaces that show a settled verdict — the Agents transcript and the
 * Chart AI dock — so the explanation is written once rather than twice.
 *
 * Deliberately a child of neither surface: it takes the verdict pieces a host
 * already has rather than a `Message`, because the dock does not hold a
 * `Message` (it holds a flattened answer plus the id of one) and copying an
 * analysis into the persisted chat store to make the prop fit would bloat
 * every stored entry.
 */

/** A directional call the user should not act on yet. */
const WATCH_CONFIDENCES = new Set(['low', 'medium']);

/**
 * Anything thrown inside the audit is caught here and renders nothing.
 *
 * This is not a way to swallow bugs — the panels have their own tests, and the
 * two crash shapes found when this block was first mounted are fixed where they
 * live. It exists because of where the block sits: it renders inside a
 * transcript's `messages.map()`, so a throw from a decorative panel does not
 * lose the panel, it loses EVERY message after it and leaves the user with a
 * conversation that silently stops rendering. The verdict answer itself is
 * owned by the host and stays on screen either way.
 */
class AuditBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        console.warn('[VerdictAudit] suppressed an audit render failure:', error instanceof Error ? error.message : error);
    }

    render(): React.ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

interface VerdictAuditProps {
    analysis: TradeAnalysis;
    /** `Message.evidencePack` — what the moderator was actually shown. */
    evidencePack?: {
        statsLine: string;
        causePattern: string;
        similar: Array<{ outcome: string; coin: string; direction: string; date: string; lesson: string; similarity: number }>;
        skills: string[];
        doctrineHeader: string;
    };
    /** `Message.runContract` — the stage ladder, with honest skip notes. */
    runContract?: Array<{ id: string; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; note?: string }>;
    /** A host that renders the verdict inside a chat bubble wants tighter
     *  spacing than one rendering it as a panel. */
    className?: string;
}

const VerdictAudit: React.FC<VerdictAuditProps> = ({
    analysis, evidencePack, runContract, className = '',
}) => {
    const direction = analysis.direction ?? '';
    const confidence = (analysis.confidence ?? '').toLowerCase();
    const declined = (direction !== 'Long' && direction !== 'Short') || confidence === 'avoid';
    // Mutually exclusive by the two panels' own definitions, and that is the
    // point: a watch must never read as a no-trade, and a no-trade must never
    // offer a "get in when X" line. Both fall out of the verdict itself, so
    // neither needs the pipeline to still be running.
    const watch = !declined && WATCH_CONFIDENCES.has(confidence);
    const hasAudit = Boolean(evidencePack) || (runContract?.length ?? 0) > 0;

    if (!declined && !watch && !hasAudit) return null;

    // No disclosure wrapper here on purpose. `EvidencePackCard` already owns
    // its own collapse ("collapsed by default" is its stated design), and the
    // run contract exists precisely so a stage that did not run is VISIBLE
    // rather than silent — putting it behind a second click would undo the
    // reason it was written.
    return (
        <AuditBoundary>
            <div className={className} data-testid="verdict-audit">
                {declined && <WhyAvoidPanel analysis={analysis} />}
                {watch && <WaitForConfirmationBanner analysis={analysis} />}
                {hasAudit && (
                    <div className="mt-1.5 border-t border-white/5 pt-1.5">
                        <EvidencePackCard pack={evidencePack} />
                        <RunContractPanel stages={runContract} />
                    </div>
                )}
            </div>
        </AuditBoundary>
    );
};

export default React.memo(VerdictAudit);
