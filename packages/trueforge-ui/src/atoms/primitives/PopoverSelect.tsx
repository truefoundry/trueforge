'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import {
  auiSelectMenuClass,
  auiSelectOptionClass,
  auiSelectPrefixTriggerClass,
  auiSelectTriggerClass,
} from '../lib/selectClasses.js';
import { themePortalRoot } from '../lib/themePortalRoot.js';

const MENU_GAP_PX = 4;
/** Matches `max-h-64` on the shared select menu chrome. */
const MENU_MAX_HEIGHT_PX = 256;

type MenuPlacement = 'top' | 'bottom';

function estimateMenuHeight({ optionCount, hasFooter }: { optionCount: number; hasFooter: boolean }): number {
  // Approximate option row (`text-sm` + `py-1.5`) plus menu `p-1` padding.
  const rows = Math.max(optionCount, 1) * 32;
  const footer = hasFooter ? 40 : 0;
  return Math.min(8 + rows + footer, MENU_MAX_HEIGHT_PX);
}

function resolveMenuPlacement({
  preferred,
  spaceAbove,
  spaceBelow,
  menuHeight,
}: {
  preferred: MenuPlacement;
  spaceAbove: number;
  spaceBelow: number;
  menuHeight: number;
}): MenuPlacement {
  if (preferred === 'bottom') {
    if (spaceBelow >= menuHeight) return 'bottom';
    if (spaceAbove >= menuHeight) return 'top';
    return spaceAbove > spaceBelow ? 'top' : 'bottom';
  }
  if (spaceAbove >= menuHeight) return 'top';
  if (spaceBelow >= menuHeight) return 'bottom';
  return spaceBelow > spaceAbove ? 'bottom' : 'top';
}

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
  menuClassName?: string;
  /** Preferred open edge; flips when that side lacks room. Default `bottom`. */
  menuPlacement?: MenuPlacement;
  /** When set, renders a labeled chip trigger (label | value chip + chevron). */
  prefix?: string;
  emptyContent?: ReactNode;
  footer?: ReactNode;
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: MenuPlacement } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const focusedOpenRef = useRef(false);
  const listboxId = useId();
  const preferredPlacement = props.menuPlacement ?? 'bottom';
  const hasFooter = props.footer != null;
  const optionCount = props.options.length;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP_PX;
      const spaceAbove = rect.top - MENU_GAP_PX;
      const measuredHeight = menuRef.current?.offsetHeight;
      const menuHeight =
        measuredHeight != null && measuredHeight > 0 ? measuredHeight : estimateMenuHeight({ optionCount, hasFooter });
      const placement = resolveMenuPlacement({
        preferred: preferredPlacement,
        spaceAbove,
        spaceBelow,
        menuHeight,
      });
      setPos({
        top: placement === 'top' ? rect.top - MENU_GAP_PX : rect.bottom + MENU_GAP_PX,
        left: rect.left,
        width: rect.width,
        placement,
      });
    };

    update();
    // Remeasure after the menu mounts so flip uses the real height.
    const rafId = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, preferredPlacement, optionCount, hasFooter]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      focusedOpenRef.current = false;
      return;
    }
    if (pos == null || focusedOpenRef.current) return;
    const selected = listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    const first = listboxRef.current?.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
    (selected ?? first)?.focus();
    focusedOpenRef.current = true;
  }, [open, pos]);

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

  const menu =
    open && pos != null
      ? createPortal(
          <div
            ref={menuRef}
            className={cn(auiSelectMenuClass('fixed z-[200]'), props.menuClassName)}
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: pos.placement === 'top' ? 'translateY(-100%)' : undefined,
            }}
            onMouseDown={event => event.stopPropagation()}
          >
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={props['aria-label']}
              aria-multiselectable={props.multiple || undefined}
            >
              {props.options.length === 0
                ? props.emptyContent
                : props.options.map(option => {
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
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        <Icon
                          name="check"
                          className={cn('ml-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                        />
                      </button>
                    );
                  })}
            </div>
            {props.footer}
          </div>,
          themePortalRoot(rootRef.current),
        )
      : null;

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
      {menu}
    </div>
  );
}
