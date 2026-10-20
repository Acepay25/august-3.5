/**
 * Disclosure — the ONE expandable panel.
 *
 * The app had three ways to hide content behind a toggle, and they drifted:
 * the transcript's thinking row and its tool rows were native `<details>`,
 * while the automation card's "Reasoning (N)" was a `<button>` plus a
 * grid-collapse `<div>`. Two mechanisms means two keyboard behaviours, two
 * focus treatments and two ways for the same content to look — and the
 * automation card's is the older one: a different disclosure for the same
 * kind of thing.
 *
 * So there is one component, and it is the NATIVE one: a `<details>` is a
 * toggle in every state without JavaScript, it is keyboard-operable for free,
 * and it is what the transcript already ships (and what the CSS and the
 * screen-reader behaviour were written against).
 *
 * The props are deliberately thin. This owns the SHAPE — a summary that is
 * always a toggle, a body that is always reachable — and nothing about what
 * goes inside: the summary is the caller's, the body is the caller's, and
 * the caller's classes and ref travel through untouched. A component that
 * grew an opinion about its contents would be the second place the styling
 * lived.
 */
import React from 'react';

export interface DisclosureProps {
    /** The toggle's content. */
    summary: React.ReactNode;
    /** The panel's content. */
    children: React.ReactNode;
    /** The `<details>` element's classes. */
    className?: string;
    /** The `<summary>`'s classes. */
    summaryClassName?: string;
    /** The body's classes. */
    bodyClassName?: string;
    /** Controlled open state. Omit it and the element keeps its own. */
    open?: boolean;
    /** Fired with the new open state whenever the disclosure is toggled. */
    onToggle?: (open: boolean) => void;
    /** The accessible name of the toggle. */
    label?: string;
    /** Recorded on the element as `data-state` — the transcript's own
     *  vocabulary for "running" and "ok". */
    state?: string;
    /** The body's ref. A disclosure whose body scrolls needs to reach it. */
    bodyRef?: React.Ref<HTMLDivElement>;
    /** The body's scroll handler. */
    onBodyScroll?: React.UIEventHandler<HTMLDivElement>;
    /** The body's extra attributes (a `role`, an `aria-label`). */
    bodyProps?: React.HTMLAttributes<HTMLDivElement>;
    /** The `<details>` element's extra attributes (a `data-fold-count`). */
    detailsProps?: React.HTMLAttributes<HTMLElement> & Record<string, unknown>;
    testId?: string;
}

const Disclosure: React.FC<DisclosureProps> = ({
    summary,
    children,
    className = '',
    summaryClassName = '',
    bodyClassName = '',
    open,
    onToggle,
    label,
    state,
    bodyRef,
    onBodyScroll,
    bodyProps,
    detailsProps,
    testId,
}) => (
    <details
        className={className.trim()}
        data-state={state}
        data-testid={testId}
        open={open}
        onToggle={e => onToggle?.((e.target as HTMLDetailsElement).open)}
        {...detailsProps}
    >
        <summary className={summaryClassName.trim()} aria-label={label}>
            {summary}
        </summary>
        <div className={bodyClassName.trim()} ref={bodyRef} onScroll={onBodyScroll} {...bodyProps}>
            {children}
        </div>
    </details>
);

export default React.memo(Disclosure);
