// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentsPage } from '@/atoms/environments/EnvironmentsPage.js';
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
    status: 'active',
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
  providers = [{ data: { id: 'daytona', name: 'Daytona', catalogId: 'daytona', isConnected: true } }],
  environmentOverrides = {},
}: {
  environments?: SandboxEnvironment[];
  providers?: Array<{ data: { id: string; name: string; catalogId: string; isConnected: boolean } }>;
  environmentOverrides?: Partial<SandboxEnvironmentServer>;
} = {}) {
  const environmentServer = createMockSandboxEnvironmentServer({
    listEnvironments: vi.fn(async () => ({ data: environments })),
    ...environmentOverrides,
  });
  const catalog = createMockCatalog({
    sandboxCatalog: {
      getSandboxProviderCatalog: async () => [],
      listSandboxProviders: async () =>
        providers.map(entry => ({
          data: entry.data,
          snapshotSyncStatus: { status: 'ready' as const },
        })),
      createSandboxProvider: vi.fn(),
      updateSandboxProvider: vi.fn(),
    },
  });
  const server = createMockAgentUIServer({
    catalog,
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
  it('shows configure-provider empty state when no sandbox provider exists', async () => {
    renderPage({ providers: [] });
    await waitFor(() => {
      expect(screen.getByText('Configure a sandbox provider first')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Open Sandbox settings' })).toBeInTheDocument();
  });

  it('lists environments when a provider is configured', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('python-data')).toBeInTheDocument();
    });
    expect(screen.getByText('Python with httpx')).toBeInTheDocument();
    expect(screen.getByText('2 vCPU · 4 GB RAM · 10 GB disk')).toBeInTheDocument();
    expect(screen.getByText('1 allowed domain')).toBeInTheDocument();
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
});
