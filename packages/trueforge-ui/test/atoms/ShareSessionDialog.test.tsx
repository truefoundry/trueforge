// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareSessionDialog } from '@/atoms/ShareSessionDialog.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { ResolvedRoutesProvider } from '@/routing/ResolvedRoutesContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { SessionAccessGrant, SessionAccessSubject } from '@/server/types.js';
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

type SessionStub = {
  id: string;
  isMutable: boolean;
  shared?: boolean;
  createdBy?: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
};

const baseSession: SessionStub = {
  id: 'session-1',
  isMutable: true,
  shared: false,
  createdBy: { id: 'owner', displayName: 'Sajal Preet Singh' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const aliceGrant: SessionAccessGrant = {
  subjectType: 'user',
  subjectId: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  createdAt: '2026-01-01T00:00:00Z',
};

function renderDialog({
  session = baseSession,
  grants = [],
  sessionSharingEnabled = true,
}: {
  session?: SessionStub;
  grants?: SessionAccessGrant[];
  sessionSharingEnabled?: boolean;
} = {}) {
  const listAccess = vi.fn(async () => grants);
  const grantAccess = vi.fn(async (req: { sessionId: string; subjects: SessionAccessSubject[] }) => [
    ...grants,
    ...req.subjects.map((subject): SessionAccessGrant => ({
      ...subject,
      displayName: 'Bob',
      email: null,
      createdAt: '2026-01-02T00:00:00Z',
    })),
  ]);
  const revokeAccess = vi.fn(async () => undefined);
  const updateSession = vi.fn(async (req: { sessionId: string; shared?: boolean }) => ({
    ...session,
    shared: req.shared === true,
  }));
  const searchUsers = vi.fn(async () => ({
    data: [
      { id: 'u1', displayName: 'Alice', email: 'alice@example.com' },
      { id: 'u2', displayName: 'Bob', email: 'bob@example.com' },
    ],
  }));
  const server = createMockAgentUIServer({
    getSession: vi.fn(async () => session),
    getMe: vi.fn(async () => ({ tenantId: 'acme' })),
    updateSession,
    sessionAccess: { listAccess, grantAccess, revokeAccess, searchUsers },
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
        sessionSharing: { enabled: sessionSharingEnabled },
      },
    }),
  });
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
  return { listAccess, grantAccess, revokeAccess, searchUsers, updateSession };
}

async function openSharePopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(await screen.findByText('Change permissions')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

describe('ShareSessionDialog', () => {
  it('hides the share URL while access is Only you', async () => {
    renderDialog();
    await openSharePopover();

    expect(await screen.findByRole('button', { name: 'Session sharing' })).toHaveTextContent('Only you');
    expect(screen.queryByLabelText('Share URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('loads tenant sharing and copies the share URL', async () => {
    renderDialog({
      session: { ...baseSession, shared: true },
    });
    await openSharePopover();

    expect(await screen.findByRole('button', { name: 'Session sharing' })).toHaveTextContent('Everyone within acme');
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toContain('/sessions/share/session-1');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(new URL(String(writeText.mock.calls[0]?.[0])).pathname).toBe('/sessions/share/session-1');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await screen.findByText('Link copied to your clipboard')).toBeInTheDocument();
  });

  it('updates session.shared when switching access', async () => {
    const { updateSession } = renderDialog();
    await openSharePopover();

    fireEvent.click(await screen.findByRole('button', { name: 'Session sharing' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Everyone within acme' }));

    await waitFor(() => {
      expect(updateSession).toHaveBeenCalledWith({ sessionId: 'session-1', shared: true });
    });
    expect(screen.getByLabelText('Share URL')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Session sharing' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Only you' }));

    await waitFor(() => {
      expect(updateSession).toHaveBeenCalledWith({ sessionId: 'session-1', shared: false });
    });
    expect(screen.queryByLabelText('Share URL')).not.toBeInTheDocument();
  });

  it('closes permission options on outside click without changing access', async () => {
    const { updateSession } = renderDialog();
    await openSharePopover();

    fireEvent.click(await screen.findByRole('button', { name: 'Session sharing' }));
    expect(await screen.findByRole('option', { name: 'Everyone within acme' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('Change permissions'));

    expect(screen.queryByRole('option', { name: 'Everyone within acme' })).not.toBeInTheDocument();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('closes the permission menu without changing access when the current option is clicked', async () => {
    const { updateSession } = renderDialog();
    await openSharePopover();

    fireEvent.click(await screen.findByRole('button', { name: 'Session sharing' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Only you' }));

    expect(screen.queryByRole('option', { name: 'Only you' })).not.toBeInTheDocument();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('lists the owner and collaborators and shows the share URL once someone is invited', async () => {
    renderDialog({ grants: [aliceGrant] });
    await openSharePopover();

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('can access')).toBeInTheDocument();
    expect(screen.getByText('Sajal Preet Singh')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByLabelText('Share URL')).toBeInTheDocument();
  });

  it('removes a collaborator', async () => {
    const { revokeAccess } = renderDialog({ grants: [aliceGrant] });
    await openSharePopover();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Alice' }));

    await waitFor(() => {
      expect(revokeAccess).toHaveBeenCalledWith({ sessionId: 'session-1', subjectType: 'user', subjectId: 'u1' });
    });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('searches users, hides people who already have access, and invites the selection', async () => {
    const { grantAccess, searchUsers } = renderDialog({ grants: [aliceGrant] });
    await openSharePopover();
    await screen.findByText('Alice');

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'b' } });
    await waitFor(() => {
      expect(searchUsers).toHaveBeenCalledWith({ query: 'b', limit: 25 });
    });

    const results = await screen.findByRole('listbox', { name: 'Matching users' });
    expect(within(results).queryByText('Alice')).not.toBeInTheDocument();
    fireEvent.click(await within(results).findByRole('option', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => {
      expect(grantAccess).toHaveBeenCalledWith({
        sessionId: 'session-1',
        subjects: [{ subjectType: 'user', subjectId: 'u2' }],
      });
    });
  });

  it('hides the invite search when session_sharing.enabled is false', async () => {
    renderDialog({ sessionSharingEnabled: false, grants: [aliceGrant] });
    await openSharePopover();

    expect(await screen.findByRole('button', { name: 'Session sharing' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Search users')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});
