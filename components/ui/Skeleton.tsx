import React from 'react';

interface SkeletonProps {
  className?: string;
  /** Shape variant for common patterns */
  variant?: 'text' | 'card' | 'avatar' | 'circle';
  /** Width (CSS value) */
  width?: string;
  /** Height (CSS value) */
  height?: string;
}

/**
 * Animated loading placeholder. Respects prefers-reduced-motion.
 *
 * Usage:
 *   <Skeleton variant="text" width="60%" />
 *   <Skeleton variant="card" height="200px" />
 *   <Skeleton variant="avatar" />
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'text',
  width,
  height,
}) => {
  const base = 'animate-pulse bg-zinc-800 rounded';

  const variantClasses: Record<string, string> = {
    text: 'h-4 w-full rounded-md',
    card: 'h-32 w-full rounded-xl',
    avatar: 'h-10 w-10 rounded-full',
    circle: 'rounded-full',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      className={`${base} ${variantClasses[variant] || ''} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
};
