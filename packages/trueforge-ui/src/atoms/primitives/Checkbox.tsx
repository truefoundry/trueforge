'use client';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';

export type CheckboxProps = {
  checked: boolean;
  className?: string;
};

/**
 * Presentational checkbox box. Callers own the interactive element and its checked semantics,
 * so this stays `aria-hidden`.
 */
export function Checkbox({ checked, className }: CheckboxProps) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
        checked
          ? 'border-primary-button-bg bg-primary-button-bg text-primary-button-text'
          : 'border-text-secondary/60 bg-input-box-bg',
        className,
      )}
      aria-hidden
    >
      {checked ? <Icon name="check" className="size-3" /> : null}
    </span>
  );
}
