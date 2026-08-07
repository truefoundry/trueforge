// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import SandboxSettings from '@/containers/SettingsBuilder/SandboxSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  CreateSandboxProviderRequest,
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  UpdateSandboxProviderRequest,
} from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const catalogEntry: SandboxProviderCatalogEntry = {
  id: 'cat-daytona',
  name: 'Daytona',
  type: 'daytona',
  snapshotName: 'daytona-default',
  execTimeoutMs: 300000,
  autoStopIntervalInMinutes: 15,
  autoArchiveIntervalInMinutes: 10080,
  autoDeleteIntervalInMinutes: 43200,
};

function createFakeHost(initial: SandboxProviderBase[] = []) {
  let providers = [...initial];
  const created: CreateSandboxProviderRequest[] = [];
  const updated: UpdateSandboxProviderRequest[] = [];

  const sandboxCatalog = {
    getSandboxProviderCatalog: async () => [catalogEntry],
    listSandboxProviders: async () => providers,
    createSandboxProvider: async (req: CreateSandboxProviderRequest) => {
      created.push(req);
      const provider: SandboxProviderBase = {
        id: `sb-${req.catalogId}`,
        name: req.name,
        catalogId: req.catalogId,
        isConnected: true,
        snapshotName: req.snapshotName,
        execTimeoutMs: req.execTimeoutMs,
        autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
        autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
        autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
      };
      providers = [...providers, provider];
      return provider;
    },
    updateSandboxProvider: async (req: UpdateSandboxProviderRequest) => {
      updated.push(req);
      providers = providers.map(provider =>
        provider.id === req.id
          ? {
              ...provider,
              snapshotName: req.snapshotName,
              execTimeoutMs: req.execTimeoutMs,
              autoStopIntervalInMinutes: req.autoStopIntervalInMinutes,
              autoArchiveIntervalInMinutes: req.autoArchiveIntervalInMinutes,
              autoDeleteIntervalInMinutes: req.autoDeleteIntervalInMinutes,
            }
          : provider,
      );
      const next = providers.find(provider => provider.id === req.id);
      if (next === undefined) {
        throw new Error(`Sandbox provider "${req.id}" not found`);
      }
      return next;
    },
  };

  const server = createMockAgentUIServer({
    catalog: createMockCatalog({ sandboxCatalog }),
  });

  return {
    created,
    updated,
    getProviders: () => providers,
    wrapper: ({ children }: { children: ReactNode }) => <ServerProvider server={server}>{children}</ServerProvider>,
  };
}

describe('SandboxSettings', () => {
  it('autofills create form from catalog except apiKey', async () => {
    const host = createFakeHost();
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <SandboxSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Daytona')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Snapshot name')).toHaveProperty('value', 'daytona-default');
    });
    expect(screen.getByLabelText('Exec timeout (ms)')).toHaveProperty('value', '300000');
    expect(screen.getByLabelText('Auto-stop interval (minutes)')).toHaveProperty('value', '15');
    expect(screen.getByLabelText('Auto-archive interval (minutes)')).toHaveProperty('value', '10080');
    expect(screen.getByLabelText('Auto-delete interval (minutes)')).toHaveProperty('value', '43200');
    expect(screen.getByLabelText('API key')).toHaveProperty('value', '');

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'dtn_secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(host.created).toHaveLength(1);
    });
    expect(host.created[0]).toMatchObject({
      catalogId: 'cat-daytona',
      name: 'Daytona',
      type: 'daytona',
      snapshotName: 'daytona-default',
      execTimeoutMs: 300000,
      autoStopIntervalInMinutes: 15,
      autoArchiveIntervalInMinutes: 10080,
      autoDeleteIntervalInMinutes: 43200,
      apiKey: 'dtn_secret',
    });
  });

  it('prefills update form and allows saving without re-entering apiKey', async () => {
    const existing: SandboxProviderBase = {
      id: 'sb-1',
      name: 'Daytona',
      catalogId: 'cat-daytona',
      isConnected: true,
      snapshotName: 'custom-snap',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 30,
      autoArchiveIntervalInMinutes: 1440,
      autoDeleteIntervalInMinutes: 10080,
    };
    const host = createFakeHost([existing]);
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <SandboxSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Snapshot name')).toHaveProperty('value', 'custom-snap');
    });
    expect(screen.getByLabelText('Exec timeout (ms)')).toHaveProperty('value', '60000');
    expect(screen.getByLabelText('Auto-stop interval (minutes)')).toHaveProperty('value', '30');
    expect(screen.getByLabelText(/API key/)).toHaveProperty('value', '');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(host.updated).toHaveLength(1);
    });
    expect(host.updated[0]).toEqual({
      id: 'sb-1',
      snapshotName: 'custom-snap',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 30,
      autoArchiveIntervalInMinutes: 1440,
      autoDeleteIntervalInMinutes: 10080,
    });
    expect(host.updated[0]).not.toHaveProperty('apiKey');
  });

  it('hides other catalog providers once one is configured', async () => {
    const existing: SandboxProviderBase = {
      id: 'sb-1',
      name: 'Daytona',
      catalogId: 'cat-daytona',
      isConnected: true,
      snapshotName: 'custom-snap',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 30,
      autoArchiveIntervalInMinutes: 1440,
      autoDeleteIntervalInMinutes: 10080,
    };
    const host = createFakeHost([existing]);
    const { wrapper: Wrapper } = host;
    render(
      <Wrapper>
        <SandboxSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Sandbox providers')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(
      screen.getByText('A sandbox provider is already configured. Remove it to choose a different one.'),
    ).toBeTruthy();
  });
});
