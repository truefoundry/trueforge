import React from 'react';

import { Button, type ButtonProps } from './Button.js';
import { Tooltip } from './Tooltip.js';

export type IconButtonProps = Omit<ButtonProps, 'size' | 'children'> & {
  'aria-label': string;
  tooltip?: string;
  children: React.ReactNode;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tooltip, children, ...props }, ref) => {
    return (
      <Tooltip content={tooltip} side="bottom">
        <Button ref={ref} size="icon" {...props}>
          {children}
        </Button>
      </Tooltip>
    );
  },
);

IconButton.displayName = 'IconButton';
