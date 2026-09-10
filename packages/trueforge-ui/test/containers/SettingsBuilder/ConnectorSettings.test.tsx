// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import ConnectorSettings from '@/containers/SettingsBuilder/ConnectorSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('ConnectorSettings edit flow', () => {
  it('opens the shared form for every configured connector and updates its auth', async () => {
    const connector: ConnectorBase = {
      id: 'custom-mcp',
      name: 'Custom MCP',
      description: 'Custom tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'header', headerName: 'X-API-Key' },
    };
    const updateConnector = vi.fn(async () => ({ ...connector, auth: { type: 'none' } }) satisfies ConnectorBase);
    const connectorCatalog = {
      getConnectorCatalog: async () => [],
      listConnectors: async () => [connector],
      getConnector: async () => connector,
      getToolsByConnectorId: async () => [],
      createConnector: async () => connector,
      updateConnector,
      authenticateConnector: async () => ({ authorization_endpoint: '' }),
      disconnectConnector: async () => connector,
    };
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({ connectorCatalog }),
    });

    render(
      <ServerProvider server={server}>
        <ConnectorSettings />
      </ServerProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.queryByRole('button', { name: 'Replace Key' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit MCP server' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue(connector.name);

    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnector).toHaveBeenCalledWith({
        id: connector.id,
        name: connector.name,
        description: connector.description,
        url: connector.url,
        auth: { type: 'none' },
      });
    });
  });
});
