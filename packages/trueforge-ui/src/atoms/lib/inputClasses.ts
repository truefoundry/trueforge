import { cn } from './cn.js';

const baseClasses =
  'w-full cursor-text rounded-md border border-input-border bg-input-box-bg px-3 text-sm text-text-primary outline-none placeholder:text-text-secondary/70 focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:cursor-not-allowed';

/**
 * Shared text-input / textarea className helper. Callers add height, shadow, or
 * layout via `className` (e.g. `auiInputClass('h-11 shadow-sm')`) so the token
 * surface, border, and focus ring stay identical across every settings form.
 */
export function auiInputClass(className?: string): string {
  return cn(baseClasses, className);
}
