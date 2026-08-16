// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Modal } from '@/atoms/primitives/Dialog.js';

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

describe('Dialog', () => {
  it('synchronizes the controlled open state and reports native close events', () => {
    const onOpenChange = vi.fn();
    const view = render(
      <Dialog open={false} onOpenChange={onOpenChange} aria-label="Settings">
        Dialog body
      </Dialog>,
    );
    const dialog = getNativeDialog(view.container);

    expect(dialog).not.toHaveAttribute('open');
    expect(showModal).not.toHaveBeenCalled();

    view.rerender(
      <Dialog open onOpenChange={onOpenChange} aria-label="Settings">
        Dialog body
      </Dialog>,
    );
    expect(dialog).toHaveAttribute('open');
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <Dialog open onOpenChange={onOpenChange} aria-label="Settings">
        Dialog body
      </Dialog>,
    );
    expect(showModal).toHaveBeenCalledOnce();

    view.rerender(
      <Dialog open={false} onOpenChange={onOpenChange} aria-label="Settings">
        Dialog body
      </Dialog>,
    );
    expect(dialog).not.toHaveAttribute('open');
    expect(close).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent(dialog, new Event('close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requests closure only when the dialog backdrop itself is clicked', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <Dialog open onOpenChange={onOpenChange} aria-label="Settings">
        <button type="button">Keep editing</button>
      </Dialog>,
    );
    const dialog = getNativeDialog(container);

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('forwards accessibility attributes, custom classes, and children', () => {
    render(
      <>
        <h1 id="settings-title">Workspace settings</h1>
        <Dialog
          open
          onOpenChange={() => undefined}
          aria-label="Settings fallback"
          aria-labelledby="settings-title"
          className="custom-dialog"
        >
          <span>Dialog child</span>
        </Dialog>
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Workspace settings' });
    expect(dialog).toHaveAttribute('aria-label', 'Settings fallback');
    expect(dialog).toHaveAttribute('aria-labelledby', 'settings-title');
    expect(dialog).toHaveClass('custom-dialog');
    expect(screen.getByText('Dialog child')).toBeInTheDocument();
  });
});

describe('Dialog subcomponents', () => {
  it('renders semantic children and forwards HTML attributes', () => {
    render(
      <DialogContent className="content-class" data-testid="content">
        <DialogHeader className="header-class" data-testid="header">
          <DialogTitle className="title-class" id="subcomponent-title" data-state="ready">
            Confirm action
          </DialogTitle>
        </DialogHeader>
        <DialogFooter className="footer-class" data-testid="footer">
          <button type="button">Confirm</button>
        </DialogFooter>
      </DialogContent>,
    );

    expect(screen.getByTestId('content')).toHaveClass('content-class');
    expect(screen.getByTestId('header')).toHaveClass('header-class');
    expect(screen.getByRole('heading', { name: 'Confirm action', level: 2 })).toHaveClass('title-class');
    expect(screen.getByRole('heading', { name: 'Confirm action' })).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('footer')).toHaveClass('footer-class');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('renders accessible content and closes only from backdrop or Escape', () => {
    const onClose = vi.fn();
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const { container } = render(
      <Modal open onClose={onClose} aria-label="Legacy settings">
        <button type="button">Inside legacy modal</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Legacy settings' });
    const backdrop = container.querySelector('[role="presentation"]');
    if (backdrop === null) {
      throw new Error('Expected the modal backdrop');
    }

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    fireEvent(document, escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses the first control, traps Tab, and restores prior focus on close', () => {
    const onClose = vi.fn();
    const view = render(
      <>
        <button type="button">Open legacy modal</button>
        <Modal open={false} onClose={onClose} aria-label="Legacy settings">
          <button type="button">First control</button>
          <button type="button" disabled>
            Disabled control
          </button>
          <a href="#last">Last control</a>
        </Modal>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open legacy modal' });
    trigger.focus();

    view.rerender(
      <>
        <button type="button">Open legacy modal</button>
        <Modal open onClose={onClose} aria-label="Legacy settings">
          <button type="button">First control</button>
          <button type="button" disabled>
            Disabled control
          </button>
          <a href="#last">Last control</a>
        </Modal>
      </>,
    );
    const first = screen.getByRole('button', { name: 'First control' });
    const last = screen.getByRole('link', { name: 'Last control' });
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    view.rerender(
      <>
        <button type="button">Open legacy modal</button>
        <Modal open={false} onClose={onClose} aria-label="Legacy settings">
          <button type="button">First control</button>
          <button type="button" disabled>
            Disabled control
          </button>
          <a href="#last">Last control</a>
        </Modal>
      </>,
    );
    expect(trigger).toHaveFocus();
  });
});
