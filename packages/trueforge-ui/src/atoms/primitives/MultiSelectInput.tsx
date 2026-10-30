'use client';

import { useId } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';

export type MultiSelectInputProps<T> = {
  selected: readonly T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onRemove: (item: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  'aria-label': string;
  className?: string;
};

/** Text field that shows selected items as removable chips; Backspace on an empty query removes the last one. */
export function MultiSelectInput<T>({
  selected,
  getKey,
  getLabel,
  onRemove,
  query,
  onQueryChange,
  placeholder,
  'aria-label': ariaLabel,
  className,
}: MultiSelectInputProps<T>) {
  const inputId = useId();
  const last = selected.at(-1);

  return (
    <label
      htmlFor={inputId}
      className={auiInputClass(
        cn(
          'focus-within:ring-focus-ring/40 flex max-h-24 min-h-8 min-w-0 flex-wrap items-center gap-1 overflow-y-auto px-1.5 py-1 focus-within:ring-2',
          className,
        ),
      )}
    >
      {selected.map(item => {
        const label = getLabel(item);
        return (
          <button
            key={getKey(item)}
            type="button"
            aria-label={`Remove ${label}`}
            className="border-border bg-dropdown-selected-item-bg text-text-primary hover:bg-secondary-button-hover flex max-w-full cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
            onClick={() => onRemove(item)}
          >
            <span className="truncate">{label}</span>
            <Icon name="xmark" size="0.625rem" className="shrink-0" />
          </button>
        );
      })}
      <input
        id={inputId}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Backspace' && query.length === 0 && last !== undefined) onRemove(last);
        }}
        placeholder={selected.length === 0 ? placeholder : undefined}
        aria-label={ariaLabel}
        className="placeholder:text-text-secondary/70 h-6 min-w-24 flex-1 bg-transparent px-2 text-[0.8125rem] outline-none"
      />
    </label>
  );
}
