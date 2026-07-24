import React from 'react';

interface EmptyStateProps {
  /** Icon element (SVG or component) */
  icon?: React.ReactNode;
  /** Main heading */
  title: string;
  /** Supporting description */
  description?: string;
  /** Optional action button/link */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Standardized empty state for lists, panels, and dashboards.
 *
 * Usage:
 *   <EmptyState
 *     icon={<BookmarkIcon className="w-8 h-8" />}
 *     title="No saved analyses"
 *     description="Analyses you bookmark will appear here."
 *     action={<button>Run an Analysis</button>}
 *   />
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      {icon && (
        <div className="mb-4 text-zinc-600">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-zinc-400 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-zinc-600 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
};
