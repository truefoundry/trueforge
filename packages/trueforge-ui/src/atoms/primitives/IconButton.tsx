import React from 'react';

import { Button, type ButtonProps } from './Button.js';

export type IconButtonProps = Omit<ButtonProps, 'size' | 'children'> & {
  'aria-label': string;
  tooltip?: string;
  children: React.ReactNode;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tooltip, children, ...props }, ref) => {
    return (
      <Button ref={ref} size="icon" title={tooltip} {...props}>
        {children}
      </Button>
    );
  },
);

IconButton.displayName = 'IconButton';
