// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activeThread = vi.hoisted(() => ({ remoteId: null as string | null }));

vi.mock('@/assistant-ui.js', () => ({
  useAuiState: (selector: (state: { threadListItem: { remoteId: string | null } }) => unknown) =>
    selector({ threadListItem: { remoteId: activeThread.remoteId } }),
}));

import { ShareChatButton } from '@/atoms/ShareChatButton.js';
import { ActiveSessionPermissionsProvider } from '@/hooks/useResourcePermissions.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { ResolvedRoutesProvider } from '@/routing/ResolvedRoutesContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  activeThread.remoteId = null;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

describe('ShareChatButton', () => {
  it('is hidden until the active chat has a persisted session id', () => {
    render(
      <SlotsProvider>
        <ShareChatButton />
      </SlotsProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('opens the share popover and copies the routed shared-session URL', async () => {
    activeThread.remoteId = 'session-1';
    render(
      <SlotsProvider>
        <ResolvedRoutesProvider routes={resolveRoutesConfig()}>
          <ShareChatButton />
        </ResolvedRoutesProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Change permissions')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(new URL(String(writeText.mock.calls[0]?.[0])).pathname).toBe('/sessions/share/session-1');
  });

  it('disables Share without session MANAGE permission', async () => {
    activeThread.remoteId = 'session-1';
    const server = createMockAgentUIServer({
      permissions: {
        listPermissions: vi.fn(async () => ({
          data: { type: 'session', permissions: { 'session-1': [] } },
        })),
      },
    });
    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ActiveSessionPermissionsProvider sessionId="session-1">
            <ShareChatButton />
          </ActiveSessionPermissionsProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByText('Change permissions')).not.toBeInTheDocument();
  });
});
