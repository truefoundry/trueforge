// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentsPage, PENDING_ENVIRONMENTS_POLL_INTERVAL_MS } from '@/atoms/environments/EnvironmentsPage.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { SandboxEnvironment, SandboxEnvironmentServer } from '@/server/types.js';
import {
  createMockAgentUIServer,
  createMockCatalog,
  createMockSandboxEnvironmentServer,
} from '../../server/mockServer.js';

const sampleEnvironments: SandboxEnvironment[] = [
  {
    id: 'e1',
    name: 'python-data',
    description: 'Python with httpx',
    status: 'ready',
    statusReason: null,
    manifest: {
      name: 'python-data',
      description: 'Python with httpx',
      resources: { cpu: 2, memory: 4, disk: 10 },
      networking: { networkBlockAll: false, domainAllowList: 'api.example.com' },
    },
    createdBySubject: {
      subjectId: 'user-1',
      subjectType: 'user',
      subjectDisplayName: 'alice',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  window.history.replaceState(null, '', '/environments');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
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

function renderPage({
  environments = sampleEnvironments,
  environmentOverrides = {},
}: {
  environments?: SandboxEnvironment[];
  environmentOverrides?: Partial<SandboxEnvironmentServer>;
} = {}) {
  const environmentServer = createMockSandboxEnvironmentServer({
    listEnvironments: vi.fn(async () => ({ data: environments })),
    ...environmentOverrides,
  });
  const server = createMockAgentUIServer({
    catalog: createMockCatalog(),
    sandboxEnvironments: environmentServer,
  });

  return render(
    <ServerProvider server={server}>
      <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
        <ToasterProvider>
          <EnvironmentsPage />
        </ToasterProvider>
      </ShellModeProvider>
    </ServerProvider>,
  );
}

describe('EnvironmentsPage', () => {
  it('lists environments without calling sandbox providers', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('python-data')).toBeInTheDocument();
    });
    expect(screen.getByText('Python with httpx')).toBeInTheDocument();
    expect(screen.getByText('2 vCPU · 4 GB RAM · 10 GB disk')).toBeInTheDocument();
    expect(screen.getByText('1 allowed domain')).toBeInTheDocument();
  });

  it('shows a friendly load error instead of raw fetch failures', async () => {
    renderPage({
      environmentOverrides: {
        listEnvironments: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      },
    });

    expect(await screen.findByRole('heading', { name: "Couldn't load environments" })).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load environments')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('opens create drawer from New Environment', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Environment/i })).toBeEnabled();
    });
    screen.getByRole('button', { name: /New Environment/i }).click();
    await waitFor(() => {
      expect(screen.getByText('New environment')).toBeInTheDocument();
    });
  });

  it('polls pending environments using getEnvironment in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pendingEnv = {
      id: 'env-1',
      name: 'building-env',
      description: '',
      status: 'pending' as const,
      statusReason: null,
      manifest: { name: 'building-env' },
      createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
    };
    const listEnvironments = vi.fn(async () => ({
      data: [pendingEnv],
    }));
    const getEnvironment = vi.fn(async () => ({
      ...pendingEnv,
      status: 'ready' as const,
    }));

    try {
      renderPage({ environmentOverrides: { listEnvironments, getEnvironment } });
      await waitFor(() => {
        expect(screen.getByText('building-env')).toBeInTheDocument();
      });

      expect(getEnvironment).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(PENDING_ENVIRONMENTS_POLL_INTERVAL_MS + 100);
      });

      expect(getEnvironment).toHaveBeenCalledWith({ name: 'building-env' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists environments when sandbox provider listing is forbidden', async () => {
    const listSandboxProviders = vi.fn(async () => {
      throw new Error('Forbidden');
    });
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: vi.fn(async () => ({ data: sampleEnvironments })),
    });
    const catalog = createMockCatalog({
      sandboxCatalog: {
        getSandboxProviderCatalog: async () => [],
        listSandboxProviders,
        createSandboxProvider: vi.fn(),
        updateSandboxProvider: vi.fn(),
      },
    });
    const server = createMockAgentUIServer({
      catalog,
      sandboxEnvironments: environmentServer,
    });

    render(
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
          <ToasterProvider>
            <EnvironmentsPage />
          </ToasterProvider>
        </ShellModeProvider>
      </ServerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('python-data')).toBeInTheDocument();
    });
    expect(listSandboxProviders).not.toHaveBeenCalled();
  });
});
