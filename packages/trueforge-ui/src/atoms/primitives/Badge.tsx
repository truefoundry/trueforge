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
  success: 'border-success-bg/30 bg-success-bg/10 text-success-bg',
  info: 'border-primary-button-bg/30 bg-primary-button-bg/10 text-primary-button-bg',
  warning: 'border-warning-bg/40 bg-warning-bg/10 text-warning-bg',
  destructive: 'border-failure-bg/30 bg-failure-bg/10 text-failure-bg',
  outline: 'border-border bg-transparent text-text-secondary',
};

const DOT_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-text-secondary',
  success: 'bg-success-bg',
  info: 'bg-primary-button-bg',
  warning: 'bg-warning-bg',
  destructive: 'bg-failure-bg',
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
