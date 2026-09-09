// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SideDrawer } from '@/atoms/primitives/SideDrawer.js';

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

describe('SideDrawer', () => {
  it('opens with right-anchored md width classes', () => {
    render(
      <SideDrawer open onOpenChange={() => undefined} title="Drawer" anchor="right" size="md">
        <p>body</p>
      </SideDrawer>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Drawer' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog.className).toContain('md:ml-auto');
    expect(dialog.className).toContain('md:w-[28rem]');
    expect(dialog.className).toContain('rounded-none');
    expect(dialog.className).not.toContain('rounded-l-xl');
    expect(dialog).toHaveAttribute('closedby', 'closerequest');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('does not close when the dialog backdrop surface is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <SideDrawer open onOpenChange={onOpenChange} title="Drawer">
        <p>body</p>
      </SideDrawer>,
    );

    fireEvent.click(screen.getByRole('dialog', { name: 'Drawer' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('supports left anchor and xl size', () => {
    render(
      <SideDrawer open onOpenChange={() => undefined} title="Left" anchor="left" size="xl">
        <p>left body</p>
      </SideDrawer>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Left' });
    expect(dialog.className).toContain('md:mr-auto');
    expect(dialog.className).toContain('md:w-[42rem]');
  });

  it('closes via the close button', () => {
    const onOpenChange = vi.fn();
    render(
      <SideDrawer open onOpenChange={onOpenChange} title="Drawer">
        <p>body</p>
      </SideDrawer>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a sticky footer when provided', () => {
    render(
      <SideDrawer open onOpenChange={() => undefined} title="Drawer" footer={<button type="button">Save</button>}>
        <p>body</p>
      </SideDrawer>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
