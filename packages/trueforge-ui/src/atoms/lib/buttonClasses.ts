import { cn } from './cn.js';

export type AuiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type AuiButtonSize = 'large' | 'small' | 'icon';

const variantClasses: Record<AuiButtonVariant, string> = {
  primary: 'bg-primary-button-bg text-primary-button-text shadow hover:bg-primary-button-hover',
  secondary:
    'border border-input-border bg-secondary-button-bg text-secondary-button-text hover:bg-secondary-button-hover',
  ghost: 'bg-ghost-button-bg text-ghost-button-text hover:bg-ghost-button-hover',
  destructive: 'bg-failure-bg text-failure-text shadow-sm hover:bg-failure-bg/90',
};

/** Glyph sizes match the shared design-system Button (`iconSizeMap`: large 0.875rem, small 0.75rem). */
const sizeClasses: Record<AuiButtonSize, string> = {
  large: 'h-8 gap-2 px-2.5 text-sm [&_svg]:size-3.5',
  small: 'h-6 gap-1 px-1.5 text-xs [&_svg]:size-3',
  icon: 'h-8 w-8 shrink-0 gap-0 p-0 [&_svg]:size-3.5',
};

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

/** Sidebar / rail nav control corner radius: 12px. */
export const sidebarButtonRadiusClassName = 'rounded-[0.75rem]';

/** Compact sidebar rail control: 66×54px → 4.125rem × 3.375rem. */
export const sidebarRailButtonClassName = cn(
  sidebarButtonRadiusClassName,
  'h-[3.375rem] w-[4rem] shrink-0 flex-col gap-1 whitespace-normal px-0.5 text-[0.625rem] font-normal leading-tight !justify-center shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text [&_svg]:size-3.5',
);

/** Shared Button / native `<button>` className helper (SDK utilities are layered). */
export function auiButtonClass({
  variant = 'primary',
  size = 'large',
  className,
}: {
  variant?: AuiButtonVariant;
  size?: AuiButtonSize;
  className?: string;
} = {}): string {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
}
