// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConnectorDetails from '@/containers/SettingsBuilder/ConnectorDetails.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase, ToolBase } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

const oauthMock = vi.hoisted(() => ({
  handleAuthorize: vi.fn(),
  isOAuthLoading: false,
}));

vi.mock('@/hooks/useMcpAuth.js', () => ({
  useMCPAuth: () => oauthMock,
}));

const connector: ConnectorBase = {
  id: 'conn-1',
  name: 'Linear',
  description: 'Issue tracker',
  url: 'https://mcp.linear.app/mcp',
  authenticated: true,
  requiresAuth: false,
  auth: { type: 'dcr' },
};

function wrapperFor(tools: ToolBase[]) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      connectorCatalog: {
        getConnectorCatalog: async () => [],
        listConnectors: async () => [],
        getConnector: async () => connector,
        getToolsByConnectorId: async () => tools,
        createConnector: async () => connector,
        updateConnector: async () => connector,
        authenticateConnector: async () => ({ authorization_endpoint: '' }),
        disconnectConnector: async () => connector,
      },
    }),
  });

  return ({ children }: { children: ReactNode }) => <ServerProvider server={server}>{children}</ServerProvider>;
}

describe('ConnectorDetails tool descriptions', () => {
  it('clamps long tool descriptions to one line and expands on Read more', async () => {
    const longDescription =
      'First line of the tool description that should wrap. Second line continues with more detail. Third line must stay hidden until the reader expands the description fully.';

    // jsdom does not layout text overflow; stub horizontal overflow detection.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);

    const Wrapper = wrapperFor([{ id: 'tool-1', name: 'create_issue', description: longDescription }]);

    render(
      <Wrapper>
        <ConnectorDetails
          connector={connector}
          onBack={() => {}}
          onConnectorRefreshed={() => {}}
          onDisconnect={() => {}}
        />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('create_issue')).toBeInTheDocument();
    });

    const description = screen.getByText(longDescription);
    expect(description).toHaveClass('whitespace-nowrap');

    const readMore = await screen.findByRole('button', { name: 'Read more' });
    expect(readMore).toHaveAttribute('aria-expanded', 'false');
    expect(readMore).toHaveClass('absolute', 'right-0');
    expect(readMore).toHaveTextContent('…Read more');

    fireEvent.click(readMore);

    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(description).not.toHaveClass('whitespace-nowrap');
    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
  });

  it('hides Read more when the description fits in one line', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);

    const Wrapper = wrapperFor([{ id: 'tool-2', name: 'list_issues', description: 'Short description' }]);

    render(
      <Wrapper>
        <ConnectorDetails
          connector={connector}
          onBack={() => {}}
          onConnectorRefreshed={() => {}}
          onDisconnect={() => {}}
        />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('list_issues')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
  });
});

describe('ConnectorDetails OAuth connection', () => {
  const unauthenticatedConnector: ConnectorBase = {
    ...connector,
    authenticated: false,
    requiresAuth: true,
  };

  it('shows Connect only for an unauthenticated DCR connector', () => {
    const Wrapper = wrapperFor([]);
    const headerConnector: ConnectorBase = {
      ...unauthenticatedConnector,
      auth: { type: 'header', headerName: 'Authorization' },
    };

    const { rerender } = render(
      <Wrapper>
        <ConnectorDetails
          connector={unauthenticatedConnector}
          onBack={() => {}}
          onConnectorRefreshed={() => {}}
          onDisconnect={() => {}}
        />
      </Wrapper>,
    );

    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();

    rerender(
      <Wrapper>
        <ConnectorDetails
          connector={headerConnector}
          onBack={() => {}}
          onConnectorRefreshed={() => {}}
          onDisconnect={() => {}}
        />
      </Wrapper>,
    );

    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });

  it('does not refresh connector details or tools when OAuth is unsuccessful', async () => {
    const getConnector = vi.fn(async () => unauthenticatedConnector);
    const getToolsByConnectorId = vi.fn(async () => []);
    oauthMock.handleAuthorize.mockImplementation(async (_id: string, callback: (isSuccess: boolean) => void) => {
      callback(false);
    });
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [],
          getConnector,
          getToolsByConnectorId,
          createConnector: async () => unauthenticatedConnector,
          updateConnector: async () => unauthenticatedConnector,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector: async () => unauthenticatedConnector,
        },
      }),
    });

    render(
      <ServerProvider server={server}>
        <ConnectorDetails
          connector={unauthenticatedConnector}
          onBack={() => {}}
          onConnectorRefreshed={() => {}}
          onDisconnect={() => {}}
        />
      </ServerProvider>,
    );

    await waitFor(() => {
      expect(getToolsByConnectorId).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(oauthMock.handleAuthorize).toHaveBeenCalledWith(unauthenticatedConnector.id, expect.any(Function));
    });
    expect(getConnector).not.toHaveBeenCalled();
    expect(getToolsByConnectorId).toHaveBeenCalledTimes(1);
  });

  it('refreshes the connector and its tools after successful OAuth', async () => {
    const refreshedConnector: ConnectorBase = {
      ...unauthenticatedConnector,
      authenticated: true,
      requiresAuth: false,
    };
    const initialTools: ToolBase[] = [
      { id: 'tool-before-auth', name: 'before_auth', description: 'Available before auth' },
    ];
    const refreshedTools: ToolBase[] = [
      { id: 'tool-after-auth', name: 'after_auth', description: 'Available after auth' },
    ];
    const getConnector = vi.fn(async () => refreshedConnector);
    const getToolsByConnectorId = vi.fn().mockResolvedValueOnce(initialTools).mockResolvedValueOnce(refreshedTools);
    oauthMock.handleAuthorize.mockImplementation(async (_id: string, callback: (isSuccess: boolean) => void) => {
      callback(true);
    });
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [],
          getConnector,
          getToolsByConnectorId,
          createConnector: async () => unauthenticatedConnector,
          updateConnector: async () => unauthenticatedConnector,
          authenticateConnector: async () => ({ authorization_endpoint: '' }),
          disconnectConnector: async () => unauthenticatedConnector,
        },
      }),
    });

    function StatefulDetails() {
      const [currentConnector, setCurrentConnector] = useState(unauthenticatedConnector);
      return (
        <ConnectorDetails
          connector={currentConnector}
          onBack={() => {}}
          onConnectorRefreshed={setCurrentConnector}
          onDisconnect={() => {}}
        />
      );
    }

    render(
      <ServerProvider server={server}>
        <StatefulDetails />
      </ServerProvider>,
    );

    expect(await screen.findByText('before_auth')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('after_auth')).toBeInTheDocument();
    });
    expect(getConnector).toHaveBeenCalledWith({ id: unauthenticatedConnector.id });
    expect(getToolsByConnectorId).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});
