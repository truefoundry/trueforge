// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreThreadListAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { ChatHistorySearchButton } from '@/atoms/ChatHistorySearchButton.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
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

function RuntimeHarness({ threadList, children }: { threadList: ExternalStoreThreadListAdapter; children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: message => message,
    onNew: async () => {},
    adapters: { threadList },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function renderSearch(adapter: ExternalStoreThreadListAdapter, track = vi.fn()) {
  return render(
    <AnalyticsProvider track={track}>
      <SlotsProvider>
        <CompactLayoutProvider>
          <RuntimeHarness threadList={adapter}>
            <ChatHistorySearchButton variant="recent-history" />
          </RuntimeHarness>
        </CompactLayoutProvider>
      </SlotsProvider>
    </AnalyticsProvider>,
  );
}

describe('ChatHistorySearchButton', () => {
  it('opens a centered search dialog of persisted chats and filters by title', () => {
    const track = vi.fn();
    renderSearch(
      {
        threads: [
          { status: 'regular', id: 't1', remoteId: 's1', title: 'Greeting exchange' },
          { status: 'regular', id: 't2', remoteId: 's2', title: 'Custom Stripe Subscriptions Setup' },
          { status: 'regular', id: 't3', title: 'Unsaved draft' },
        ],
      },
      track,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search chat history' }));
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Session.HISTORY_SEARCH_OPENED, undefined);

    const dialog = screen.getByRole('dialog', { name: 'Search chat history' });
    expect(within(dialog).getByText('Recent chats')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Greeting exchange' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Custom Stripe Subscriptions Setup' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Unsaved draft' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search chat history' }), {
      target: { value: 'stripe' },
    });

    expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(within(dialog).getByText('Results')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Custom Stripe Subscriptions Setup' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Greeting exchange' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(within(dialog).getByRole('searchbox', { name: 'Search chat history' })).toHaveValue('');
    expect(within(dialog).getByText('Recent chats')).toBeInTheDocument();
  });

  it('closes when the X button is clicked', () => {
    renderSearch({
      threads: [{ status: 'regular', id: 't1', remoteId: 's1', title: 'Hello' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Search chat history' }));
    const dialog = screen.getByRole('dialog', { name: 'Search chat history' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Search chat history' })).not.toBeInTheDocument();
  });
});
