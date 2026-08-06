// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SlotsProvider } from '../theme/SlotsProvider.js';
import { ThreadListRow } from './ThreadListRow.js';
import { DropdownMenuItem } from './primitives/DropdownMenu.js';

describe('ThreadListRow', () => {
  it('hides actions when omitted', () => {
    render(
      <SlotsProvider>
        <ThreadListRow title="Session A" active={false} onSelect={() => {}} />
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Session actions' })).not.toBeInTheDocument();
  });

  it('renders actions without selecting the row when the action is clicked', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <SlotsProvider>
        <ThreadListRow
          title="Session A"
          active={false}
          onSelect={onSelect}
          actions={<DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies hover/active chrome on the row group so actions share the highlight', () => {
    const { container, rerender } = render(
      <SlotsProvider>
        <ThreadListRow title="Session A" active={false} onSelect={() => {}} />
      </SlotsProvider>,
    );
    const row = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(row?.className).toMatch(/hover:bg-accent/);
    expect(row?.className).not.toMatch(/bg-muted/);

    rerender(
      <SlotsProvider>
        <ThreadListRow title="Session A" active onSelect={() => {}} />
      </SlotsProvider>,
    );
    const activeRow = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(activeRow?.className).toMatch(/bg-muted/);
  });
});
