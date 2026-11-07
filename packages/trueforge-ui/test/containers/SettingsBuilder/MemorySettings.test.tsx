// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import MemorySettings from '@/containers/SettingsBuilder/MemorySettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConfigurationServer, MemoryCatalogServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog, tenantSessionSharing } from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

async function unavailable(): Promise<never> {
  throw new Error('Unexpected memory settings call');
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const memoryCatalog: MemoryCatalogServer = {
  getMemoryProviderCatalog: async () => [{ id: 'zep', name: 'Zep', type: 'zep' }],
  listMemoryProviders: async () => [],
  createMemoryProvider: unavailable,
  updateMemoryProvider: unavailable,
};

const memoryOn: ConfigurationServer = {
  getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
  updateConfiguration: unavailable,
};

function renderSettings(
  configuration: ConfigurationServer | undefined,
  options: { manageProviders?: boolean; catalog?: MemoryCatalogServer | null } = {},
) {
  const { manageProviders = true, catalog = memoryCatalog } = options;
  const getCapabilities = vi.fn(async () => ({
    data: {
      sandbox: { enabled: true },
      skill: { enabled: true },
      sessionSharing: tenantSessionSharing,
      settings: { ...allSettingsSections(true), memoryProviders: { enabled: true, manageProviders } },
    },
  }));
  const server = createMockAgentUIServer({
    catalog: createMockCatalog(catalog === null ? {} : { memoryCatalog: catalog }),
    ...(configuration ? { configuration } : {}),
    getCapabilities,
  });
  render(
    <ServerProvider server={server}>
      <MemorySettings />
    </ServerProvider>,
  );
  return { getCapabilities };
}

describe('MemorySettings tenant switch', () => {
  it('shows the stored value', async () => {
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: false } }),
      updateConfiguration: unavailable,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow memory' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('No agent remembers details from past chats.')).toBeInTheDocument();
  });

  it('saves only the memory switch and re-renders from the response', async () => {
    const updateConfiguration = vi.fn(async () => ({ webSearch: { enabled: true }, memory: { enabled: false } }));
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
      updateConfiguration,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow memory' });
    toggle.click();

    await waitFor(() => {
      expect(updateConfiguration).toHaveBeenCalledWith({ memory: { enabled: false } });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Allow memory' })).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('refreshes capabilities after saving, so the agent Memory toggle unlocks right away', async () => {
    const { getCapabilities } = renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: false } }),
      updateConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow memory' });
    await waitFor(() => {
      expect(getCapabilities).toHaveBeenCalled();
    });
    const callsBeforeSave = getCapabilities.mock.calls.length;
    toggle.click();

    await waitFor(() => {
      expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave);
    });
  });

  it('says the setting is unavailable when the host has neither port', () => {
    renderSettings(undefined, { catalog: null });

    expect(screen.getByText('Memory settings are not available.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Allow memory' })).not.toBeInTheDocument();
  });
});

describe('MemorySettings providers', () => {
  it('lists Zep from the catalog when the caller manages providers', async () => {
    renderSettings(memoryOn);

    expect(await screen.findByText('Zep')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
  });

  it('keeps only the switch when the platform owns providers', async () => {
    const listMemoryProviders = vi.fn(async () => []);
    renderSettings(memoryOn, { manageProviders: false, catalog: { ...memoryCatalog, listMemoryProviders } });

    expect(await screen.findByRole('switch', { name: 'Allow memory' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Zep')).not.toBeInTheDocument();
    });
    expect(listMemoryProviders).not.toHaveBeenCalled();
  });

  it('saves the API key and server URL for a new provider', async () => {
    const createMemoryProvider = vi.fn(async () => ({
      id: 'zep',
      name: 'Zep',
      catalogId: 'zep',
      isConnected: true,
      serverUrl: 'https://zep.example.com',
    }));
    renderSettings(memoryOn, { catalog: { ...memoryCatalog, createMemoryProvider } });

    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.change(await screen.findByLabelText(/API key/), { target: { value: 'zep-secret' } });
    fireEvent.change(screen.getByLabelText(/Server URL/), { target: { value: 'https://zep.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createMemoryProvider).toHaveBeenCalledWith({
        catalogId: 'zep',
        name: 'Zep',
        type: 'zep',
        apiKey: 'zep-secret',
        serverUrl: 'https://zep.example.com',
      });
    });
  });

  it('waits for the switch before listing providers, so an off tenant never flashes them', async () => {
    let resolveConfiguration: (value: { webSearch: { enabled: boolean }; memory: { enabled: boolean } }) => void = () =>
      undefined;
    const getMemoryProviderCatalog = vi.fn(memoryCatalog.getMemoryProviderCatalog);
    renderSettings(
      {
        getConfiguration: () =>
          new Promise(resolve => {
            resolveConfiguration = resolve;
          }),
        updateConfiguration: unavailable,
      },
      { catalog: { ...memoryCatalog, getMemoryProviderCatalog } },
    );

    await waitFor(() => {
      expect(getMemoryProviderCatalog).toHaveBeenCalled();
    });
    // Let the catalog load land while the switch is still pending.
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(screen.queryByText('Zep')).not.toBeInTheDocument();

    resolveConfiguration({ webSearch: { enabled: true }, memory: { enabled: true } });
    expect(await screen.findByText('Zep')).toBeInTheDocument();
  });
});
