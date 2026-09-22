// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RenameSessionModal } from '@/atoms/RenameSessionModal.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('RenameSessionModal', () => {
  it('focuses and selects the title when opened', () => {
    render(
      <SlotsProvider>
        <RenameSessionModal open initialTitle="Laptop sleep issue" onOpenChange={() => {}} onSave={() => {}} />
      </SlotsProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Session title' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Laptop sleep issue');
    expect(screen.getByRole('heading', { name: 'Rename session' })).toBeInTheDocument();
  });

  it('disables Save for blank titles and calls onSave with trimmed text', () => {
    const onSave = vi.fn();
    render(
      <SlotsProvider>
        <RenameSessionModal open initialTitle="Old" onOpenChange={() => {}} onSave={onSave} />
      </SlotsProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(input, { target: { value: '  New title  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('New title');
  });

  it('Cancel closes without saving', () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn();
    render(
      <SlotsProvider>
        <RenameSessionModal open initialTitle="Old" onOpenChange={onOpenChange} onSave={onSave} />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });
});
