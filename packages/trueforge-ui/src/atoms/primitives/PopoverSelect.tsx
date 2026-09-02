'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import {
  auiSelectMenuClass,
  auiSelectOptionClass,
  auiSelectPrefixTriggerClass,
  auiSelectTriggerClass,
} from '../lib/selectClasses.js';

export type PopoverSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type CommonPopoverSelectProps<T extends string> = {
  options: readonly PopoverSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Which edge of the trigger the menu opens toward. Default `bottom`. */
  menuPlacement?: 'top' | 'bottom';
  /** When set, renders a labeled chip trigger (label | value chip + chevron). */
  prefix?: string;
  'aria-label': string;
};

export type PopoverSelectProps<T extends string> = CommonPopoverSelectProps<T> &
  (
    | {
        multiple?: false;
        value: T;
        onValueChange: (value: T) => void;
      }
    | {
        multiple: true;
        value: readonly T[];
        onValueChange: (value: T[]) => void;
      }
  );

export function PopoverSelect<T extends string>(props: PopoverSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selected = listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    const first = listboxRef.current?.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
    (selected ?? first)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

      const items = Array.from(
        listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [],
      );
      if (items.length === 0) return;

      event.preventDefault();
      const currentIndex = items.findIndex(item => item === document.activeElement);
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (currentIndex + 1) % items.length
              : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const isSelected = (value: T) => (props.multiple ? props.value.includes(value) : props.value === value);

  const selectedLabels = props.options.filter(option => isSelected(option.value)).map(option => option.label);
  const triggerLabel =
    selectedLabels.length === 0
      ? (props.placeholder ?? 'Select')
      : props.multiple && selectedLabels.length > 1
        ? `${selectedLabels.length} selected`
        : selectedLabels[0];

  const select = (option: PopoverSelectOption<T>) => {
    if (option.disabled) return;
    if (props.multiple) {
      props.onValueChange(
        props.value.includes(option.value)
          ? props.value.filter(value => value !== option.value)
          : [...props.value, option.value],
      );
      return;
    }
    props.onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const menuPlacement = props.menuPlacement ?? 'bottom';

  return (
    <div ref={rootRef} className={cn('relative', props.className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={props.disabled}
        aria-label={props['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={props.prefix != null ? auiSelectPrefixTriggerClass() : auiSelectTriggerClass()}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {props.prefix != null ? (
          <>
            <span className="text-text-primary shrink-0 border-r border-border px-3 font-semibold">{props.prefix}</span>
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2">
              <span className="bg-primary-button-bg/10 text-text-primary truncate rounded px-2 py-0.5 text-sm">
                {triggerLabel}
              </span>
              <Icon name="chevron-down" className="text-text-secondary size-4 shrink-0" />
            </span>
          </>
        ) : (
          <>
            <span className="truncate">{triggerLabel}</span>
            <Icon name="chevron-down" className="size-4 shrink-0" />
          </>
        )}
      </button>

      {open ? (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={props['aria-label']}
          aria-multiselectable={props.multiple || undefined}
          className={cn(
            auiSelectMenuClass('left-0 min-w-full'),
            menuPlacement === 'top' && 'top-auto bottom-full mt-0 mb-1',
          )}
        >
          {props.options.map(option => {
            const selected = isSelected(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                className={auiSelectOptionClass()}
                onClick={() => select(option)}
              >
                <span className="min-w-0 flex-1 whitespace-nowrap">{option.label}</span>
                <Icon name="check" className={cn('ml-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
