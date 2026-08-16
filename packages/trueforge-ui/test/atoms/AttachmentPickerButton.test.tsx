import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentPickerButton } from '@/atoms/AttachmentPickerButton.js';

describe('AttachmentPickerButton', () => {
  it('provides an accessible button and forwards interaction props', () => {
    const onClick = vi.fn();
    render(<AttachmentPickerButton onClick={onClick} className="consumer-class" data-testid="picker" />);

    const button = screen.getByRole('button', { name: 'Add Attachment' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Add Attachment');
    expect(button).toHaveAttribute('data-testid', 'picker');
    expect(button).toHaveClass('consumer-class');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('honors the native disabled state', () => {
    const onClick = vi.fn();
    render(<AttachmentPickerButton disabled onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Add Attachment' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
