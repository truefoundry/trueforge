import type { ComponentProps } from 'react';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';

export type AttachmentPickerButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'>;

export function AttachmentPickerButton({ className, ...props }: AttachmentPickerButtonProps) {
  return (
    <button
      type="button"
      aria-label="Add Attachment"
      title="Add Attachment"
      className={auiButtonClass({
        variant: 'ghost',
        size: 'icon',
        className: `size-7 rounded-full p-1 ${className ?? ''}`,
      })}
      {...props}
    >
      <Icon name="paperclip" />
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AttachmentPickerButton: typeof AttachmentPickerButton;
  }
}
