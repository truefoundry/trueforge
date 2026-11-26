import { cn } from './cn.js';

export type AuiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type AuiButtonSize = 'large' | 'small' | 'icon';

const variantClasses: Record<AuiButtonVariant, string> = {
  primary: 'bg-primary-button-bg text-primary-button-text shadow hover:bg-primary-button-hover',
  secondary: 'aui-secondary-button-fill border border-input-border text-secondary-button-text transition-none',
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

/** Sidebar / list nav control corner radius: 12px. */
export const sidebarButtonRadiusClassName = 'rounded-[0.75rem]';

/** Soft blue sidebar / list hover (pairs with `shellSelectedClassName`). */
export const shellHoverClassName = 'aui-shell-hover';

/** Icon-only app rail control: 36×36 circle with 16px glyphs. */
export const sidebarRailButtonClassName = cn(
  'rounded-full',
  'size-9 shrink-0 !justify-center p-0 font-normal shadow-none',
  shellHoverClassName,
  '[&_svg]:size-4',
);

/** Collapsed labeled-sidebar control: 32×32 circle (matches selected chrome). */
export const sidebarCompactNavButtonClassName = cn(
  'size-8 shrink-0 !justify-center rounded-full p-0 text-sm font-normal text-sidebar-text shadow-none',
  shellHoverClassName,
);

/** Active rail / chat-history selection (solid fill). Keep the control's own radius (same as hover). */
export const shellSelectedClassName = 'aui-shell-selected';

/** Active icon-rail control: selected chrome + primary text on hover. */
export const shellRailSelectedClassName = cn(
  shellSelectedClassName,
  'rounded-full font-medium hover:text-text-primary',
);

/** Icon-rail hover label: pill to the right of the control (black / #343439). */
export const shellRailTooltipClassName = cn(
  'rounded-full bg-black px-4 py-2 text-xs font-medium text-white',
  'shadow-[0_0.25rem_0.75rem_rgba(0,0,0,0.15)]',
  'dark:bg-[#343439]',
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
