'use client';

import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../lib/cn.js';

export type SwitchSize = 'sm' | 'md';

export type SwitchProps = Omit<ComponentPropsWithoutRef<'button'>, 'aria-checked' | 'children' | 'onClick' | 'role'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: SwitchSize;
};

const sizeClasses: Record<SwitchSize, { track: string; thumb: string; checkedThumb: string }> = {
  sm: {
    track: 'h-5 w-9 p-0.5',
    thumb: 'size-4',
    checkedThumb: 'translate-x-4',
  },
  md: {
    track: 'h-6 w-11 p-0.5',
    thumb: 'size-5',
    checkedThumb: 'translate-x-5',
  },
};

export function Switch({ checked, onCheckedChange, size = 'sm', disabled, className, ...props }: SwitchProps) {
  const classes = sizeClasses[size];

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      className={cn(
        'flex shrink-0 cursor-pointer items-center overflow-hidden rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        classes.track,
        checked ? 'bg-primary-button-bg' : 'bg-text-secondary/35 dark:bg-text-secondary/50',
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        aria-hidden
        className={cn(
          'shrink-0 translate-x-0 rounded-full shadow-sm transition-[transform,background-color]',
          checked ? 'bg-primary-button-text' : 'bg-primary-bg',
          classes.thumb,
          checked && classes.checkedThumb,
        )}
      />
    </button>
  );
}
