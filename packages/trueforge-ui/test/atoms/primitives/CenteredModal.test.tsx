// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';

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

describe('CenteredModal', () => {
  it('synchronizes the controlled open state with the native dialog', () => {
    const onOpenChange = vi.fn();
    const view = render(
      <CenteredModal open={false} onOpenChange={onOpenChange} title="Account">
        Account body
      </CenteredModal>,
    );
    const dialog = getNativeDialog(view.container);

    expect(dialog).not.toHaveAttribute('open');
    expect(showModal).not.toHaveBeenCalled();

    view.rerender(
      <CenteredModal open onOpenChange={onOpenChange} title="Account">
        Account body
      </CenteredModal>,
    );
    expect(dialog).toHaveAttribute('open');
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <CenteredModal open onOpenChange={onOpenChange} title="Account">
        Account body
      </CenteredModal>,
    );
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <CenteredModal open={false} onOpenChange={onOpenChange} title="Account">
        Account body
      </CenteredModal>,
    );
    expect(dialog).not.toHaveAttribute('open');
    expect(close).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports native close, close-button, and cancel requests', () => {
    const onOpenChange = vi.fn();
    const onParentCancel = vi.fn();
    render(
      <dialog open onCancel={onParentCancel}>
        <CenteredModal open onOpenChange={onOpenChange} title="Account">
          <button type="button">Inside action</button>
        </CenteredModal>
      </dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Account' });

    fireEvent.click(screen.getByRole('button', { name: 'Inside action' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    const cancelEvent = new Event('cancel', { bubbles: true, cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onParentCancel).not.toHaveBeenCalled();

    onOpenChange.mockClear();
    fireEvent(dialog, new Event('close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('wires its title, optional description, icon, children, and accessible name', () => {
    const { container } = render(
      <CenteredModal
        open
        onOpenChange={() => undefined}
        title="Account settings"
        description="Manage your profile"
        headerIcon={<span data-testid="header-icon">icon</span>}
        aria-label="Account dialog"
        contentSized
        className="custom-modal"
      >
        <section>Modal content</section>
      </CenteredModal>,
    );
    const dialog = getNativeDialog(container);
    const title = screen.getByRole('heading', { name: 'Account settings' });
    const description = screen.getByText('Manage your profile');

    expect(dialog).toHaveAttribute('aria-label', 'Account dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
    expect(dialog).toHaveClass('custom-modal');
    expect(dialog).toHaveStyle({ height: 'fit-content', maxHeight: '85dvh' });
    expect(screen.getByTestId('header-icon')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('uses the title as the label and omits description wiring when absent', () => {
    render(
      <CenteredModal open onOpenChange={() => undefined} title="Untitled description">
        Body
      </CenteredModal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Untitled description' });
    expect(dialog).toHaveAttribute('aria-label', 'Untitled description');
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });
});
