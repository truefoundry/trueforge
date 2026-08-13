// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConnectorDetails from '@/containers/SettingsBuilder/ConnectorDetails.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase, ToolBase } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

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
        <ConnectorDetails connector={connector} onBack={() => {}} onDisconnect={() => {}} />
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
        <ConnectorDetails connector={connector} onBack={() => {}} onDisconnect={() => {}} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('list_issues')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
  });
});
