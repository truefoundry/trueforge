import type { ComponentProps } from 'react';

import { Icon } from '../icons/Icon.js';
import { Button } from './primitives/Button.js';

export type AttachmentPickerButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'>;

export function AttachmentPickerButton({ className, ...props }: AttachmentPickerButtonProps) {
  return (
    <Button.Ghost
      type="button"
      aria-label="Add Attachment"
      title="Add Attachment"
      size="small"
      className={`aspect-square size-7 rounded-full px-0 p-1 ${className ?? ''}`}
      {...props}
    >
      <Icon name="paperclip" />
    </Button.Ghost>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AttachmentPickerButton: typeof AttachmentPickerButton;
  }
}
