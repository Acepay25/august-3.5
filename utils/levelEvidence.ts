import { EvidenceClaim, TradeAnalysis } from '../types';

export interface LevelCitation {
    source: string;
    state: EvidenceClaim['state'];
}

export interface StructuredLevelCite {
    label: string;
    price: string;
    sourceId: string;
}

const digits = (value: string): string => value.replace(/[^\d.]/g, '');

const labelKeys = (label: string): string[] => {
    const l = label.toLowerCase();
    if (l.startsWith('entry')) return ['entry', 'entries'];
    if (l.includes('stop')) return ['stop', 'sl', 'invalidation'];
    if (l.startsWith('tp')) return ['tp', 'take profit', 'target', l.replace(/\s+/g, '')];
    return [l];
};

const structuredHit = (
    label: string,
    price: string,
    structured?: StructuredLevelCite[],
): StructuredLevelCite | undefined => {
    const keys = labelKeys(label);
    const priceKey = digits(price);
    return (structured ?? []).find(c => {
        const labelOk = keys.some(k => c.label.toLowerCase().includes(k) || k.includes(c.label.toLowerCase()));
        const priceOk = !priceKey || !digits(c.price) || digits(c.price).includes(priceKey.slice(0, 6)) || priceKey.includes(digits(c.price).slice(0, 6));
        return labelOk && priceOk;
    });
};

export const citeLevel = (
    label: string,
    price: string,
    evidence?: EvidenceClaim[],
    structured?: StructuredLevelCite[],
): LevelCitation => {
    const bound = structuredHit(label, price, structured);
    if (bound) return { source: bound.sourceId, state: 'observed' };

    const priceKey = digits(price);
    const keys = labelKeys(label);
    const claims = evidence ?? [];
    const hit = claims.find(c => {
        const blob = `${c.claim} ${c.sources.join(' ')}`.toLowerCase();
        const priceHit = priceKey.length >= 3 && digits(c.claim).includes(priceKey.slice(0, 6));
        const labelHit = keys.some(k => blob.includes(k));
        return priceHit || labelHit;
    });
    if (!hit) return { source: 'ungrounded', state: 'unobserved' };
    const source = hit.sources[0] || hit.claim.slice(0, 48) || 'cited';
    return { source, state: hit.state };
};

export const buildLevelCitations = (analysis: TradeAnalysis): StructuredLevelCite[] => {
    if (analysis.levelCitations && analysis.levelCitations.length > 0) return analysis.levelCitations;
    const rows: Array<{ label: string; price?: string }> = [
        { label: 'Entry', price: analysis.entryPoints?.[0]?.price },
        { label: 'Stop Loss', price: analysis.stopLoss },
        ...(analysis.takeProfit ?? []).slice(0, 3).map((tp, i) => ({ label: `TP${i + 1}`, price: tp.price })),
    ];
    return rows
        .filter((r): r is { label: string; price: string } => Boolean(r.price))
        .map(r => ({
            label: r.label,
            price: r.price,
            sourceId: citeLevel(r.label, r.price, analysis.evidence).source,
        }));
};
