import React from 'react';

import { cn } from '../lib/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'small' | 'medium' | 'large';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  asChild?: never;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-button-bg text-primary-button-text shadow hover:bg-primary-button-hover',
  secondary:
    'border border-input-border bg-secondary-button-bg text-secondary-button-text shadow-sm hover:bg-secondary-button-hover',
  ghost: 'bg-ghost-button-bg text-ghost-button-text hover:bg-ghost-button-hover',
  destructive: 'bg-failure-bg text-failure-text shadow-sm hover:bg-failure-bg/90',
};

const sizeClasses: Record<ButtonSize, string> = {
  small: 'h-8 rounded-md px-2 text-xs',
  medium: 'h-9 px-4 py-2 text-sm',
  large: 'h-10 rounded-md px-8 text-base',
};

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

type ButtonBaseProps = ButtonProps & {
  variant: ButtonVariant;
};

const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonBaseProps>(
  ({ className, variant, size = 'medium', ...props }, ref) => {
    return (
      <button ref={ref} className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)} {...props} />
    );
  },
);

const PrimaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <ButtonBase {...props} ref={ref} variant="primary" />
));
const SecondaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <ButtonBase {...props} ref={ref} variant="secondary" />
));
const GhostButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <ButtonBase {...props} ref={ref} variant="ghost" />
));
const DestructiveButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <ButtonBase {...props} ref={ref} variant="destructive" />
));

export const Button = {
  Primary: PrimaryButton,
  Secondary: SecondaryButton,
  Ghost: GhostButton,
  Destructive: DestructiveButton,
};

PrimaryButton.displayName = 'Button.Primary';
SecondaryButton.displayName = 'Button.Secondary';
GhostButton.displayName = 'Button.Ghost';
DestructiveButton.displayName = 'Button.Destructive';
