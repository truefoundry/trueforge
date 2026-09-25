// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareSessionDialog } from '@/atoms/ShareSessionDialog.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { ResolvedRoutesProvider } from '@/routing/ResolvedRoutesContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
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

function renderDialog({
  getSession = vi.fn(async () => ({
    id: 'session-1',
    isMutable: true,
    shared: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })),
  updateSession = vi.fn(async (req: { sessionId: string; shared?: boolean }) => ({
    id: req.sessionId,
    isMutable: true,
    shared: req.shared === true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })),
  getMe = vi.fn(async () => ({ tenantId: 'acme' })),
}: {
  getSession?: () => Promise<{
    id: string;
    isMutable: boolean;
    shared?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  updateSession?: (req: { sessionId: string; shared?: boolean }) => Promise<{
    id: string;
    isMutable: boolean;
    shared?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  getMe?: () => Promise<{ tenantId: string }>;
} = {}) {
  const server = createMockAgentUIServer({ getSession, updateSession, getMe });
  render(
    <SlotsProvider>
      <ToasterProvider>
        <ServerProvider server={server}>
          <ResolvedRoutesProvider routes={resolveRoutesConfig()}>
            <ShareSessionDialog sessionId="session-1" trigger={<button type="button">Share</button>} />
          </ResolvedRoutesProvider>
        </ServerProvider>
      </ToasterProvider>
    </SlotsProvider>,
  );
  return { getSession, updateSession, getMe };
}

async function openSharePopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(await screen.findByText('Change permissions')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

describe('ShareSessionDialog', () => {
  it('loads current sharing and copies the share URL', async () => {
    renderDialog();
    await openSharePopover();

    expect(await screen.findByRole('button', { name: 'Session sharing' })).toHaveTextContent('Only you');
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toContain('/sessions/share/session-1');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(new URL(String(writeText.mock.calls[0]?.[0])).pathname).toBe('/sessions/share/session-1');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('PATCHes shared when the tenant permission is selected', async () => {
    const { updateSession } = renderDialog();
    await openSharePopover();

    fireEvent.click(await screen.findByRole('button', { name: 'Session sharing' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Everyone within acme' }));

    await waitFor(() => {
      expect(updateSession).toHaveBeenCalledWith({ sessionId: 'session-1', shared: true });
    });
  });
});
