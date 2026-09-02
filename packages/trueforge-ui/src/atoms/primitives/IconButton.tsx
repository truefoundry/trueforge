import React from 'react';

import { cn } from '../lib/cn.js';
import { Button, type ButtonProps } from './Button.js';

export type IconButtonProps = Omit<ButtonProps, 'children'> & {
  'aria-label': string;
  tooltip?: string;
  children: React.ReactNode;
};

function createIconButton(ButtonComponent: typeof Button.Primary) {
  return React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ tooltip, children, className, size = 'small', ...props }, ref) => (
      <ButtonComponent ref={ref} size={size} className={cn('aspect-square px-0', className)} title={tooltip} {...props}>
        {children}
      </ButtonComponent>
    ),
  );
}

const PrimaryIconButton = createIconButton(Button.Primary);
const SecondaryIconButton = createIconButton(Button.Secondary);
const GhostIconButton = createIconButton(Button.Ghost);
const DestructiveIconButton = createIconButton(Button.Destructive);

export const IconButton = {
  Primary: PrimaryIconButton,
  Secondary: SecondaryIconButton,
  Ghost: GhostIconButton,
  Destructive: DestructiveIconButton,
};

PrimaryIconButton.displayName = 'IconButton.Primary';
SecondaryIconButton.displayName = 'IconButton.Secondary';
GhostIconButton.displayName = 'IconButton.Ghost';
DestructiveIconButton.displayName = 'IconButton.Destructive';
