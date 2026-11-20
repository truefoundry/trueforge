'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { auiSelectMenuClass, auiSelectOptionClass } from '../lib/selectClasses.js';

export type MultiSelectInputProps<T> = {
  selected: readonly T[];
  /** Matches for the current query. The list opens only while `query` is non-empty. */
  options?: readonly T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** Option row contents. Defaults to `getLabel`. */
  renderOption?: (item: T) => ReactNode;
  onRemove: (item: T) => void;
  onSelect?: (item: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  'aria-label': string;
  /** Accessible name of the option list. Defaults to `aria-label`. */
  optionsLabel?: string;
  /** Rendered under the options, for example a load-more control. Shown with the list. */
  menuFooter?: ReactNode;
  /** Shown in the list when `query` is non-empty and there are no options. */
  noDataPlaceholder?: string;
  className?: string;
};

/** Chip field plus a floating option list. Backspace on an empty query removes the last chip. */
export function MultiSelectInput<T>({
  selected,
  options = [],
  getKey,
  getLabel,
  renderOption,
  onRemove,
  onSelect,
  query,
  onQueryChange,
  placeholder,
  'aria-label': ariaLabel,
  optionsLabel,
  menuFooter,
  noDataPlaceholder,
  className,
}: MultiSelectInputProps<T>) {
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const last = selected.at(-1);
  const hasQuery = query.trim().length > 0;
  // Dismissible open flag — query alone must not pin the popup over rows below.
  const [open, setOpen] = useState(hasQuery);
  // A picked match clears `query` in the parent; drop open before paint so Escape reaches the share menu.
  if (!hasQuery && open) setOpen(false);
  const showEmpty = hasQuery && options.length === 0 && menuFooter == null && noDataPlaceholder != null;
  const showOptions = open && hasQuery && (options.length > 0 || menuFooter != null || showEmpty);

  // Close list and clear search — same dismiss contract as shadcn Combobox.
  const dismiss = () => {
    setOpen(false);
    if (hasQuery) onQueryChange('');
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
      onQueryChange('');
    };
    // Capture: parent DropdownMenu stops mousedown bubbling on its surface.
    document.addEventListener('mousedown', handlePointerDown, true);
    return () => document.removeEventListener('mousedown', handlePointerDown, true);
  }, [onQueryChange, open]);

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <label
        htmlFor={inputId}
        className={auiInputClass(
          'focus-within:ring-focus-ring/40 flex max-h-24 min-h-8 w-full flex-wrap items-center gap-1 overflow-y-auto px-1.5 py-1 focus-within:ring-2',
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
          onChange={event => {
            const next = event.target.value;
            onQueryChange(next);
            setOpen(next.trim().length > 0);
          }}
          onFocus={() => {
            if (hasQuery) setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape' && showOptions) {
              // Keep the parent share menu open; only dismiss this list.
              event.preventDefault();
              event.stopPropagation();
              dismiss();
              return;
            }
            if (event.key === 'Backspace' && query.length === 0 && last !== undefined) onRemove(last);
          }}
          placeholder={selected.length === 0 ? placeholder : undefined}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={showOptions}
          aria-controls={showOptions ? listboxId : undefined}
          role="combobox"
          className="placeholder:text-text-secondary/70 h-6 min-w-24 flex-1 bg-transparent px-2 text-[0.8125rem] outline-none"
        />
      </label>
      {showOptions ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={optionsLabel ?? ariaLabel}
          className={auiSelectMenuClass('absolute top-full left-0 z-50 mt-1 w-full')}
          // Keep focus in the field so the next character can be typed right away.
          onMouseDown={event => event.preventDefault()}
        >
          {showEmpty ? (
            <p className="text-text-secondary px-2 py-1.5 text-sm">{noDataPlaceholder}</p>
          ) : (
            options.map(item => (
              <button
                key={getKey(item)}
                type="button"
                role="option"
                aria-selected={false}
                className={auiSelectOptionClass()}
                onClick={() => onSelect?.(item)}
              >
                {renderOption == null ? <span className="truncate">{getLabel(item)}</span> : renderOption(item)}
              </button>
            ))
          )}
          {menuFooter}
        </div>
      ) : null}
    </div>
  );
}
