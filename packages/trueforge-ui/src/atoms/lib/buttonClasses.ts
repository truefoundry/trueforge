import { cn } from './cn.js';

export type AuiButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline';
export type AuiButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantClasses: Record<AuiButtonVariant, string> = {
  default: 'bg-primary-button-bg text-primary-button-text shadow hover:bg-primary-button-hover',
  secondary:
    'border border-input-border bg-secondary-button-bg text-secondary-button-text shadow-sm hover:bg-secondary-button-hover',
  ghost: 'bg-ghost-button-bg text-ghost-button-text hover:bg-ghost-button-hover',
  destructive: 'bg-failure-bg text-failure-text shadow-sm hover:bg-failure-bg/90',
  outline:
    'border border-input-border bg-secondary-button-bg text-secondary-button-text shadow-sm hover:bg-secondary-button-hover',
};

const sizeClasses: Record<AuiButtonSize, string> = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 rounded-md px-2 text-xs',
  lg: 'h-10 rounded-md px-8 text-base',
  icon: 'h-8 w-8',
};

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

/** Shared Button / native `<button>` className helper (SDK utilities are layered). */
export function auiButtonClass({
  variant = 'default',
  size = 'default',
  className,
}: {
  variant?: AuiButtonVariant;
  size?: AuiButtonSize;
  className?: string;
} = {}): string {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
}
