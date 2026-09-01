import { cn } from './cn.js';
import { auiInputClass } from './inputClasses.js';

/**
 * Shared dropdown chrome. Every select-like surface (PopoverSelect, the session
 * time-range popover) composes these so triggers, menus, and option rows stay
 * visually identical; callers pass `className` for width and placement only.
 */
export function auiSelectTriggerClass(className?: string): string {
  return auiInputClass(cn('flex h-9 cursor-pointer items-center justify-between gap-2 pr-2 text-left', className));
}

export function auiSelectMenuClass(className?: string): string {
  return cn(
    'bg-card-bg text-text-primary absolute top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border p-1 shadow-md',
    className,
  );
}

export function auiSelectOptionClass(className?: string): string {
  return cn(
    'text-text-primary flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors',
    'hover:bg-ghost-button-hover focus:bg-dropdown-selected-item-bg focus:text-dropdown-selected-item-text',
    'disabled:pointer-events-none disabled:opacity-50',
    className,
  );
}
