// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThreadListRow } from '@/atoms/ThreadListRow.js';
import { DropdownMenuItem } from '@/atoms/primitives/DropdownMenu.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

describe('ThreadListRow', () => {
  it('renders the title button when not renaming', () => {
    render(
      <SlotsProvider>
        <ThreadListRow title="Session A" active onSelect={() => {}} />
      </SlotsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Session A' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Session title' })).not.toBeInTheDocument();
  });

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
    expect(row?.className).toMatch(/aui-shell-hover/);
    expect(row?.className).not.toMatch(/bg-dropdown-selected-item-bg/);

    rerender(
      <SlotsProvider>
        <ThreadListRow title="Session A" active onSelect={() => {}} />
      </SlotsProvider>,
    );
    const activeRow = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(activeRow?.className).toMatch(/aui-shell-selected/);
    expect(screen.getByText('Session A').className).toMatch(/text-inherit/);
  });

  it('marks overflowing titles so hover can scroll the full name', () => {
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.getAttribute('data-slot') === 'aui_thread-list-item-title' ? 240 : 80;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.getAttribute('data-slot') === 'aui_thread-list-item-title' ? 240 : 80;
      },
    });

    try {
      const { container } = render(
        <SlotsProvider>
          <ThreadListRow title="Write me a very long message about GDPR" active={false} onSelect={() => {}} />
        </SlotsProvider>,
      );
      const title = container.querySelector('[data-slot="aui_thread-list-item-title"]');
      expect(title).toHaveClass('aui-thread-list-title-scroll');
      expect(title).toHaveAttribute('data-overflow', 'true');
    } finally {
      if (clientWidth != null) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
      if (scrollWidth != null) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
    }
  });

  it('keeps kebab hover-only for normal chats (no age in the row)', () => {
    const lastMessageAt = new Date(Date.now() - 30 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Hello chat"
          active={false}
          onSelect={() => {}}
          lastMessageAt={lastMessageAt}
          actions={
            <button type="button" aria-label="Session actions">
              …
            </button>
          }
        />
      </SlotsProvider>,
    );
    expect(screen.getByText('Hello chat')).toBeInTheDocument();
    expect(screen.queryByText('30m')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-item-age"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-item-agent-icon"]')).not.toBeInTheDocument();
    const actionsSlot = screen.getByRole('button', { name: 'Session actions' }).parentElement;
    expect(actionsSlot?.className).toMatch(/md:opacity-0/);
    expect(actionsSlot?.className).toMatch(/md:group-hover:opacity-100/);
  });

  it('for try-agent chats shows a trailing agent icon that swaps to kebab on hover', () => {
    const lastMessageAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Hello"
          active={false}
          onSelect={() => {}}
          showTryAgentIcon
          lastMessageAt={lastMessageAt}
          actions={
            <button type="button" aria-label="Session actions">
              …
            </button>
          }
        />
      </SlotsProvider>,
    );
    expect(screen.queryByText('2d')).not.toBeInTheDocument();
    const agentIcon = container.querySelector('[data-slot="aui_thread-list-item-agent-icon"]');
    expect(agentIcon).toBeInTheDocument();
    expect(agentIcon?.className).toMatch(/md:opacity-100/);
    expect(agentIcon?.className).toMatch(/md:group-hover:opacity-0/);
    const actionsSlot = screen.getByRole('button', { name: 'Session actions' }).parentElement;
    expect(actionsSlot?.getAttribute('data-slot')).toBe('aui_thread-list-item-actions');
    expect(actionsSlot?.className).toMatch(/md:opacity-0/);
    expect(actionsSlot?.className).toMatch(/md:group-hover:opacity-100/);
  });

  it('shimmers the title when running and replaces the relative age with jumping dots', () => {
    const lastMessageAt = new Date(Date.now() - 30 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Running chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="running"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('Running chat')).toHaveClass('aui-text-shimmer');
    expect(screen.getByText('Running', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.queryByText('30m')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-item-running-dots"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="session-status-dot"]')).not.toBeInTheDocument();
  });

  it('keeps age in the hover tip when the trailing slot shows running dots', () => {
    const lastMessageAt = new Date(Date.now() - 18 * 60 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Running chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="running"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    const row = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    fireEvent.mouseEnter(row);
    expect(screen.getByRole('tooltip')).toHaveTextContent('18h');
  });

  it('replaces the relative age with a paused status dot when activity is recent', () => {
    const lastMessageAt = new Date(Date.now() - 30 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Paused chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="paused"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    const pausedDot = container.querySelector('[data-slot="session-status-dot"]');
    expect(pausedDot?.querySelector('.bg-warning-bg')).toBeInTheDocument();
    expect(pausedDot?.querySelector('.motion-safe\\:animate-ping')).toBeInTheDocument();
    expect(screen.getByText('Waiting for input', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.queryByText('30m')).not.toBeInTheDocument();
  });

  it('hides the paused status dot when activity is older than 48 hours (age stays in the tip only)', () => {
    const lastMessageAt = new Date(Date.now() - 49 * 60 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Stale paused chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="paused"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    expect(container.querySelector('[data-slot="session-status-dot"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for input', { selector: '.sr-only' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-item-age"]')).not.toBeInTheDocument();
  });

  it('shows no failure chrome for error and keeps age out of the row', () => {
    const lastMessageAt = new Date(Date.now() - 30 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Failed chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="error"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    expect(container.querySelector('[data-slot="session-status-dot"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed', { selector: '.sr-only' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-item-age"]')).not.toBeInTheDocument();
  });

  it('shows a desktop hover tip with the full title and relative age', () => {
    const lastMessageAt = new Date(Date.now() - 18 * 60 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow title="Hello what can youndo" active={false} onSelect={() => {}} lastMessageAt={lastMessageAt} />
      </SlotsProvider>,
    );

    const row = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    fireEvent.mouseEnter(row);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Hello what can youndo');
    expect(tip).toHaveTextContent('18h');
  });

  it('keeps age in the hover tip when the trailing slot shows a status dot', () => {
    const lastMessageAt = new Date(Date.now() - 18 * 60 * 60_000);
    const { container } = render(
      <SlotsProvider>
        <ThreadListRow
          title="Paused chat"
          active={false}
          onSelect={() => {}}
          lastTurnStatus="paused"
          lastMessageAt={lastMessageAt}
        />
      </SlotsProvider>,
    );

    const row = container.querySelector('[data-slot="aui_thread-list-item"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    fireEvent.mouseEnter(row);
    expect(screen.getByRole('tooltip')).toHaveTextContent('18h');
  });
});
