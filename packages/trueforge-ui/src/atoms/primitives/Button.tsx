import React from 'react';

import { auiButtonClass, type AuiButtonSize, type AuiButtonVariant } from '../lib/buttonClasses.js';

export type ButtonVariant = AuiButtonVariant;
export type ButtonSize = AuiButtonSize;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: never;
};

export type FixedVariantButtonProps = Omit<ButtonProps, 'variant'>;

const ButtonRoot = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'large', ...props }, ref) => {
    return <button ref={ref} className={auiButtonClass({ variant, size, className })} {...props} />;
  },
);

ButtonRoot.displayName = 'Button';

function fixedVariant(variant: ButtonVariant, displayName: string) {
  const Fixed = React.forwardRef<HTMLButtonElement, FixedVariantButtonProps>((props, ref) => (
    <ButtonRoot ref={ref} variant={variant} {...props} />
  ));
  Fixed.displayName = displayName;
  return Fixed;
}

export const Button = Object.assign(ButtonRoot, {
  Primary: fixedVariant('primary', 'Button.Primary'),
  Secondary: fixedVariant('secondary', 'Button.Secondary'),
  Ghost: fixedVariant('ghost', 'Button.Ghost'),
  Destructive: fixedVariant('destructive', 'Button.Destructive'),
});
