// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WebSearchSettings from '@/containers/SettingsBuilder/WebSearchSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConfigurationsServer, WebSearchCatalogServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

async function unavailable(): Promise<never> {
  throw new Error('Unexpected web search call');
}

const webSearchCatalog: WebSearchCatalogServer = {
  getWebSearchProviderCatalog: async () => [{ id: 'parallel', name: 'Parallel', type: 'parallel' }],
  listWebSearchProviders: async () => [],
  createWebSearchProvider: unavailable,
  updateWebSearchProvider: unavailable,
};

function renderSettings(configurations: ConfigurationsServer | undefined) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({ webSearchCatalog }),
    ...(configurations ? { configurations } : {}),
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
      getConfigurations: async () => ({ webSearch: { enabled: true } }),
      updateConfigurations: unavailable,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Parallel')).toBeInTheDocument();
  });

  it('hides the provider list while the tenant switch is off', async () => {
    renderSettings({
      getConfigurations: async () => ({ webSearch: { enabled: false } }),
      updateConfigurations: unavailable,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(screen.queryByText('Parallel')).not.toBeInTheDocument();
    });
  });

  it('saves the new value and re-renders from the response', async () => {
    const updateConfigurations = vi.fn(async () => ({ webSearch: { enabled: false } }));
    renderSettings({
      getConfigurations: async () => ({ webSearch: { enabled: true } }),
      updateConfigurations,
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow web search' });
    toggle.click();

    await waitFor(() => {
      expect(updateConfigurations).toHaveBeenCalledWith({ webSearch: { enabled: false } });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Allow web search' })).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('omits the switch and keeps providers when the host has no configurations port', async () => {
    renderSettings(undefined);

    expect(await screen.findByText('Parallel')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Allow web search' })).not.toBeInTheDocument();
  });
});
