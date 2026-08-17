// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BottomSheet } from '@/atoms/primitives/BottomSheet.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const showModal = vi.fn(function showModal(this: HTMLDialogElement) {
  this.open = true;
});
const close = vi.fn(function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
});

beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: close,
  });
});

afterEach(() => {
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

function getNativeDialog(container: HTMLElement) {
  const dialog = container.querySelector('dialog');
  if (dialog === null) {
    throw new Error('Expected a native dialog');
  }
  return dialog;
}

describe('BottomSheet', () => {
  it('synchronizes the controlled open state with the native dialog', () => {
    const onOpenChange = vi.fn();
    const view = render(
      <BottomSheet open={false} onOpenChange={onOpenChange} aria-label="Picker">
        Content
      </BottomSheet>,
    );
    const dialog = getNativeDialog(view.container);

    expect(dialog).not.toHaveAttribute('open');
    expect(showModal).not.toHaveBeenCalled();

    view.rerender(
      <BottomSheet open onOpenChange={onOpenChange} aria-label="Picker">
        Content
      </BottomSheet>,
    );
    expect(dialog).toHaveAttribute('open');
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <BottomSheet open onOpenChange={onOpenChange} aria-label="Picker">
        Content
      </BottomSheet>,
    );
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <BottomSheet open={false} onOpenChange={onOpenChange} aria-label="Picker">
        Content
      </BottomSheet>,
    );
    expect(dialog).not.toHaveAttribute('open');
    expect(close).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports native close and backdrop requests but ignores child clicks', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <BottomSheet open onOpenChange={onOpenChange} aria-label="Picker">
        <button type="button">Inside action</button>
      </BottomSheet>,
    );
    const dialog = getNativeDialog(container);

    fireEvent.click(screen.getByRole('button', { name: 'Inside action' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent(dialog, new Event('close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

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

    const cancelEvent = new Event('cancel', { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('dialog', { name: 'Picker' }), cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onParentCancel).not.toHaveBeenCalled();
  });

  it('forwards its id, accessible label, custom class, and children', () => {
    render(
      <BottomSheet
        open
        onOpenChange={() => undefined}
        id="attachment-picker"
        aria-label="Choose an attachment"
        className="custom-sheet"
      >
        <section>Sheet content</section>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Choose an attachment' });
    expect(dialog).toHaveAttribute('id', 'attachment-picker');
    expect(dialog).toHaveClass('custom-sheet');
    expect(dialog).toHaveStyle({ height: 'min(70dvh, 30rem)', maxHeight: '85dvh' });
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });
});
