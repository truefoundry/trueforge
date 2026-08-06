// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BottomSheet } from './BottomSheet.js';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};

describe('BottomSheet', () => {
  it('handles Escape without closing a parent dialog', () => {
    const onOpenChange = vi.fn();
    const onParentCancel = vi.fn();

    render(
      <dialog open onCancel={onParentCancel}>
        <BottomSheet open onOpenChange={onOpenChange} aria-label="Picker">
          Content
        </BottomSheet>
      </dialog>,
    );

    fireEvent(screen.getByRole('dialog', { name: 'Picker' }), new Event('cancel', { bubbles: true }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onParentCancel).not.toHaveBeenCalled();
  });
});
