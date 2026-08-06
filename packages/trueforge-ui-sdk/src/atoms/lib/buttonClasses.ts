import { cn } from './cn.js';

export type AuiButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline';
export type AuiButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantClasses: Record<AuiButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
};

const sizeClasses: Record<AuiButtonSize, string> = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-8 text-base',
  icon: 'h-8 w-8',
};

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

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
