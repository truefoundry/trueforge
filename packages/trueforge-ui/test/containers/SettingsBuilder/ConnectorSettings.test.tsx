// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectorSettings from '@/containers/SettingsBuilder/ConnectorSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

const connectedLinear: ConnectorBase = {
  id: 'linear',
  name: 'linear',
  description: 'Search, read, and create Linear issues.',
  url: 'https://mcp.linear.app/mcp',
  auth: { type: 'dcr' },
  requiresAuth: false,
  authenticated: true,
};

function renderConnectorSettings({ deleteConnector }: { deleteConnector?: (req: { id: string }) => Promise<void> }) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      connectorCatalog: {
        getConnectorCatalog: async () => [],
        listConnectors: async () => [connectedLinear],
        getConnector: async () => connectedLinear,
        getToolsByConnectorId: async () => [],
        createConnector: async () => connectedLinear,
        updateConnector: async () => connectedLinear,
        authenticateConnector: async () => ({ authorization_endpoint: '' }),
        disconnectConnector: async () => connectedLinear,
        ...(deleteConnector ? { deleteConnector } : {}),
      },
    }),
  });

  render(
    <ServerProvider server={server}>
      <ConnectorSettings />
    </ServerProvider>,
  );
}

describe('ConnectorSettings Remove button (fixes #494)', () => {
  it('hides Remove when the host has not wired deleteConnector', async () => {
    renderConnectorSettings({});
    await screen.findByText('linear');
    expect(screen.queryByRole('button', { name: 'Remove linear' })).not.toBeInTheDocument();
  });

  it('shows Remove and calls deleteConnector when the host supports it', async () => {
    const deleteConnector = vi.fn(async () => undefined);
    renderConnectorSettings({ deleteConnector });

    const row = await screen.findByText('linear');
    const removeButton = within(row.closest('article') as HTMLElement).getByRole('button', { name: 'Remove linear' });
    fireEvent.click(removeButton);

    await waitFor(() => expect(deleteConnector).toHaveBeenCalledWith({ id: 'linear' }));
  });

  it('Remove does not open the connector details view (stops propagation)', async () => {
    const deleteConnector = vi.fn(async () => undefined);
    renderConnectorSettings({ deleteConnector });

    const row = await screen.findByText('linear');
    const removeButton = within(row.closest('article') as HTMLElement).getByRole('button', { name: 'Remove linear' });
    fireEvent.click(removeButton);

    await waitFor(() => expect(deleteConnector).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Connectors' })).not.toBeInTheDocument();
  });
});
