import { cn } from './cn.js';

const baseClasses =
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

/**
 * Shared text-input / textarea className helper. Callers add height, shadow, or
 * layout via `className` (e.g. `auiInputClass('h-11 shadow-sm')`) so the token
 * surface, border, and focus ring stay identical across every settings form.
 */
export function auiInputClass(className?: string): string {
  return cn(baseClasses, className);
}
