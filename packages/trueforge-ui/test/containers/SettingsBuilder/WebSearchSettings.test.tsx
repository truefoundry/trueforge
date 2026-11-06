// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import WebSearchSettings from '@/containers/SettingsBuilder/WebSearchSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConfigurationServer, WebSearchCatalogServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

async function unavailable(): Promise<never> {
  throw new Error('Unexpected web search call');
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

const webSearchCatalog: WebSearchCatalogServer = {
  getWebSearchProviderCatalog: async () => [{ id: 'parallel', name: 'Parallel', type: 'parallel' }],
  listWebSearchProviders: async () => [],
  createWebSearchProvider: unavailable,
  updateWebSearchProvider: unavailable,
};

function renderSettings(
  configuration: ConfigurationServer | undefined,
  options: { manageProviders?: boolean; catalog?: WebSearchCatalogServer } = {},
) {
  const { manageProviders = true, catalog = webSearchCatalog } = options;
  const sections = allSettingsSections(true);
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({ webSearchCatalog: catalog }),
    ...(configuration ? { configuration } : {}),
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { ...sections, webSearch: { enabled: true, manageProviders } },
      },
    }),
  });
  return render(
    <ServerProvider server={server}>
      <WebSearchSettings />
    </ServerProvider>,
  );
}

describe('WebSearchSettings tenant switch', () => {
  it('shows the switch on and lists providers when the tenant allows web search', async () => {
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
      updateConfiguration: unavailable,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Parallel')).toBeInTheDocument();
  });

  it('hides the provider list while the tenant switch is off', async () => {
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: false }, memory: { enabled: true } }),
      updateConfiguration: unavailable,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(screen.queryByText('Parallel')).not.toBeInTheDocument();
    });
  });

  it('says the switch can be turned back on while it is off', async () => {
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: false }, memory: { enabled: true } }),
      updateConfiguration: unavailable,
    });

    expect(await screen.findByText(/Turn this back on whenever you want/)).toHaveTextContent(
      'provider setup comes back with it',
    );
    expect(screen.getByText('New chats cannot use web search. Chats already using it keep it.')).toBeInTheDocument();
  });

  it('drops the provider sentence when the platform owns providers', async () => {
    renderSettings(
      {
        getConfiguration: async () => ({ webSearch: { enabled: false }, memory: { enabled: true } }),
        updateConfiguration: unavailable,
      },
      { manageProviders: false },
    );

    const note = await screen.findByText(/Turn this back on whenever you want/);
    expect(note).not.toHaveTextContent('provider setup comes back with it');
  });

  it('asks before turning web search off, then saves and re-renders from the response', async () => {
    const updateConfiguration = vi.fn(async () => ({ webSearch: { enabled: false }, memory: { enabled: true } }));
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
      updateConfiguration,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    fireEvent.click(toggle);

    expect(updateConfiguration).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Turn off web search?' })).toHaveTextContent(
      'Existing chats, agents, and schedules that already use web search keep access',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => {
      expect(updateConfiguration).toHaveBeenCalledWith({ webSearch: { enabled: false } });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Allow web search' })).toHaveAttribute('aria-checked', 'false');
    });
    expect(screen.queryByRole('dialog', { name: 'Turn off web search?' })).not.toBeInTheDocument();
  });

  it('leaves web search on when the turn-off confirmation is cancelled', async () => {
    const updateConfiguration = vi.fn(unavailable);
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
      updateConfiguration,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(updateConfiguration).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('dialog', { name: 'Turn off web search?' })).not.toBeInTheDocument();
  });

  it('turns web search back on without a confirmation', async () => {
    const updateConfiguration = vi.fn(async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }));
    renderSettings({
      getConfiguration: async () => ({ webSearch: { enabled: false }, memory: { enabled: true } }),
      updateConfiguration,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    fireEvent.click(toggle);

    expect(screen.queryByRole('dialog', { name: 'Turn off web search?' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(updateConfiguration).toHaveBeenCalledWith({ webSearch: { enabled: true } });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Allow web search' })).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('omits the switch and keeps providers when the host has no configuration port', async () => {
    renderSettings(undefined);

    expect(await screen.findByText('Parallel')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Allow web search' })).not.toBeInTheDocument();
  });

  it('keeps the switch but drops provider controls when the platform owns providers', async () => {
    const listWebSearchProviders = vi.fn(async () => []);
    renderSettings(
      {
        getConfiguration: async () => ({ webSearch: { enabled: true }, memory: { enabled: true } }),
        updateConfiguration: unavailable,
      },
      { manageProviders: false, catalog: { ...webSearchCatalog, listWebSearchProviders } },
    );

    expect(await screen.findByRole('switch', { name: 'Allow web search' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(screen.queryByText('Parallel')).not.toBeInTheDocument();
    });
    expect(listWebSearchProviders).not.toHaveBeenCalled();
  });

  it('waits for the switch before listing providers, so an off tenant never flashes them', async () => {
    let resolveConfiguration: (value: { webSearch: { enabled: boolean }; memory: { enabled: boolean } }) => void = () =>
      undefined;
    renderSettings({
      getConfiguration: () =>
        new Promise(resolve => {
          resolveConfiguration = resolve;
        }),
      updateConfiguration: unavailable,
    });

    await waitFor(() => {
      expect(screen.queryByText('Parallel')).not.toBeInTheDocument();
    });

    resolveConfiguration({ webSearch: { enabled: true }, memory: { enabled: true } });
    expect(await screen.findByText('Parallel')).toBeInTheDocument();
  });
});
