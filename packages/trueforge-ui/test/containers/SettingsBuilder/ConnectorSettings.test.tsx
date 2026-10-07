// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import ConnectorSettings from '@/containers/SettingsBuilder/ConnectorSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase, ConnectorCatalogEntry } from '@/server/types.js';
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

  it('asks for confirmation before deleting a configured connector', async () => {
    const connector: ConnectorBase = {
      id: 'custom-mcp',
      name: 'Custom MCP',
      description: 'Custom tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'none' },
    };
    const deleteConnector = vi.fn(async () => {});
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [connector],
          getConnector: async () => connector,
          getToolsByConnectorId: async () => [],
          createConnector: async () => connector,
          updateConnector: async () => connector,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector: async () => connector,
          deleteConnector,
        },
      }),
    });

    render(
      <ServerProvider server={server}>
        <ConnectorSettings />
      </ServerProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Custom MCP' }));
    expect(await screen.findByText('Remove connector?')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteConnector).toHaveBeenCalledWith({ id: connector.id }));
  });

  it('tracks connector saved after a none-auth catalog connect', async () => {
    const catalogEntry: ConnectorCatalogEntry = {
      id: 'cat-public',
      name: 'Public MCP',
      description: 'No auth',
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'none' },
    };
    const created: ConnectorBase = {
      id: 'public-mcp',
      name: catalogEntry.name,
      description: catalogEntry.description ?? catalogEntry.url,
      url: catalogEntry.url,
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'none' },
    };
    const createConnector = vi.fn(async () => created);
    const track = vi.fn();
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [catalogEntry],
          listConnectors: async () => [],
          getConnector: async () => created,
          getToolsByConnectorId: async () => [],
          createConnector,
          updateConnector: async () => created,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector: async () => created,
        },
      }),
    });

    render(
      <AnalyticsProvider track={track}>
        <ServerProvider server={server}>
          <ConnectorSettings />
        </ServerProvider>
      </AnalyticsProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(createConnector).toHaveBeenCalledWith({
        name: catalogEntry.name,
        description: catalogEntry.description,
        url: catalogEntry.url,
        auth: { type: 'none' },
      });
    });
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Settings.CONNECTOR_SAVED, {
      connector_name: catalogEntry.name,
      mode: 'create',
    });
  });

  it('tracks connector deleted after confirm', async () => {
    const connector: ConnectorBase = {
      id: 'custom-mcp',
      name: 'Custom MCP',
      description: 'Custom tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'none' },
    };
    const deleteConnector = vi.fn(async () => {});
    const track = vi.fn();
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [connector],
          getConnector: async () => connector,
          getToolsByConnectorId: async () => [],
          createConnector: async () => connector,
          updateConnector: async () => connector,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector: async () => connector,
          deleteConnector,
        },
      }),
    });

    render(
      <AnalyticsProvider track={track}>
        <ServerProvider server={server}>
          <ConnectorSettings />
        </ServerProvider>
      </AnalyticsProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Custom MCP' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteConnector).toHaveBeenCalledWith({ id: connector.id }));
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Settings.CONNECTOR_DELETED, {
      connector_name: connector.name,
    });
  });

  it('tracks connector disconnected without emitting deleted', async () => {
    const connector: ConnectorBase = {
      id: 'oauth-mcp',
      name: 'OAuth MCP',
      description: 'OAuth tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'dcr' },
    };
    const disconnectConnector = vi.fn(async () => ({ ...connector, authenticated: false, requiresAuth: true }));
    const track = vi.fn();
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [connector],
          getConnector: async () => connector,
          getToolsByConnectorId: async () => [],
          createConnector: async () => connector,
          updateConnector: async () => connector,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector,
          deleteConnector: async () => {},
        },
      }),
    });

    render(
      <AnalyticsProvider track={track}>
        <ServerProvider server={server}>
          <ConnectorSettings />
        </ServerProvider>
      </AnalyticsProvider>,
    );

    fireEvent.click(await screen.findByText(connector.name));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(disconnectConnector).toHaveBeenCalledWith({ id: connector.id }));
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Settings.CONNECTOR_DISCONNECTED, {
      connector_name: connector.name,
    });
    expect(track).not.toHaveBeenCalledWith(AnalyticsEvents.Settings.CONNECTOR_DELETED, expect.anything());
  });
});
