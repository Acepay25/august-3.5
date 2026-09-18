import React from 'react';

interface TipProps {
    /** Hover text. Pass a `shortcut` alongside it to render the key hint. */
    label: string;
    shortcut?: string;
    /** `right` for the 48px activity rail, `below` for top-aligned chrome. */
    side?: 'right' | 'below';
    className?: string;
    children: React.ReactNode;
}

/**
 * Hover/focus hint built on the `.tip` CSS utilities. Deliberately not a
 * portal: the label is a sibling of its host, so a tooltip inside an
 * overflow-hidden ancestor clips instead of escaping.
 */
const Tip: React.FC<TipProps> = ({ label, shortcut, side = 'right', className = '', children }) => (
    <span className={`tip ${side === 'right' ? 'tip-right' : 'tip-below'} ${className}`.trim()}>
        {children}
        <span aria-hidden="true" className="tip-label">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
        </span>
    </span>
);

export default React.memo(Tip);
