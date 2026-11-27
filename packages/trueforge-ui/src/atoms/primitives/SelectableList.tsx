import type { ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';

export type SelectableListProps<T> = {
  items: readonly T[];
  selectedKey: string | undefined;
  getKey: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  'aria-label': string;
  className?: string;
  /** Rendered instead of the list when `items` is empty. */
  noDataPlaceholder?: ReactNode;
  disabled?: boolean;
};

/** Single-select list with a check mark on the selected row; the caller bounds its height via `className`. */
export function SelectableList<T>({
  items,
  selectedKey,
  getKey,
  renderOption,
  onSelect,
  'aria-label': ariaLabel,
  className,
  noDataPlaceholder,
  disabled = false,
}: SelectableListProps<T>) {
  if (items.length === 0 && noDataPlaceholder != null) {
    return <div className={className}>{noDataPlaceholder}</div>;
  }

  return (
    <div role="listbox" aria-label={ariaLabel} className={cn('flex flex-col overflow-y-auto', className)}>
      {items.map(item => {
        const key = getKey(item);
        const selected = key === selectedKey;
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onSelect(item)}
            className={cn(
              'flex min-h-12 w-full shrink-0 cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
              'focus-visible:ring-focus-ring focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed',
              selected ? 'bg-secondary-bg' : 'hover:bg-ghost-button-hover',
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">{renderOption(item)}</span>
            {selected ? <Icon name="check" className="text-success-bg size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}
