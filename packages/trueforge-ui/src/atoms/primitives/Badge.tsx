import React from 'react';

import { cn } from '../lib/cn.js';

export type BadgeVariant = 'default' | 'success' | 'info' | 'warning' | 'destructive' | 'outline';
export type BadgeShape = 'rounded' | 'pill';
export type BadgeSize = 'sm' | 'md';

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  shape?: BadgeShape;
  size?: BadgeSize;
  dot?: boolean;
};

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default: 'border-border bg-card-bg text-text-primary',
  success:
    'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-300',
  info: 'border-sky-600/30 bg-sky-500/10 text-sky-800 dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-300',
  warning:
    'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-300',
  destructive:
    'border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-300',
  outline: 'border-border bg-transparent text-text-secondary',
};

const DOT_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-text-secondary',
  success: 'bg-emerald-600 dark:bg-emerald-400',
  info: 'bg-sky-600 dark:bg-sky-400',
  warning: 'bg-amber-600 dark:bg-amber-400',
  destructive: 'bg-red-600 dark:bg-red-400',
  outline: 'bg-text-secondary',
};

const SHAPE_STYLES: Record<BadgeShape, string> = {
  rounded: 'rounded-sm',
  pill: 'rounded-full',
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-xs',
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', shape = 'rounded', size = 'sm', dot = false, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        data-slot="badge"
        data-variant={variant}
        data-shape={shape}
        data-size={size}
        className={cn(
          'inline-flex items-center gap-1.5 border font-medium leading-normal',
          VARIANT_STYLES[variant],
          SHAPE_STYLES[shape],
          SIZE_STYLES[size],
          className,
        )}
        {...props}
      >
        {dot ? <span className={cn('size-1.5 shrink-0 rounded-full', DOT_STYLES[variant])} aria-hidden /> : null}
        {children}
      </span>
    );
  },
);

Badge.displayName = 'Badge';
