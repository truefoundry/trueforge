import React from 'react';

import { auiButtonClass, type AuiButtonSize, type AuiButtonVariant } from '../lib/buttonClasses.js';

export type ButtonVariant = AuiButtonVariant;
export type ButtonSize = AuiButtonSize;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: never;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return <button ref={ref} className={auiButtonClass({ variant, size, className })} {...props} />;
  },
);

Button.displayName = 'Button';
