// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ConnectMcpStep } from '@/containers/Onboarding/ConnectMcpStep.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ConnectorBase, ConnectorCatalogEntry, CreateConnectorRequest } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

const oauthMock = vi.hoisted(() => ({ handleAuthorize: vi.fn(), isOAuthLoading: false }));

vi.mock('@/hooks/useMcpAuth.js', () => ({
  useMCPAuth: () => oauthMock,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const oauthEntry: ConnectorCatalogEntry = {
  id: 'notion',
  name: 'Notion',
  description: 'Docs and wikis',
  url: 'https://mcp.notion.example',
  auth: { type: 'dcr' },
};
const keyEntry: ConnectorCatalogEntry = {
  id: 'exa',
  name: 'Exa',
  url: 'https://mcp.exa.example',
  auth: { type: 'header', headerName: 'x-api-key' },
};
const openEntry: ConnectorCatalogEntry = {
  id: 'docs',
  name: 'Docs',
  url: 'https://mcp.docs.example',
  auth: { type: 'none' },
};

function connectorFor(entry: ConnectorCatalogEntry, request: CreateConnectorRequest): ConnectorBase {
  return {
    id: entry.id,
    name: request.name,
    description: request.description,
    url: request.url,
    auth: entry.auth,
    requiresAuth: entry.auth.type !== 'none',
    authenticated: entry.auth.type === 'none',
  };
}

function renderStep() {
  const configured: ConnectorBase[] = [];
  const createConnector = vi.fn(async (request: CreateConnectorRequest) => {
    const entry = [oauthEntry, keyEntry, openEntry].find(candidate => candidate.url === request.url);
    if (entry === undefined) throw new Error('unknown entry');
    const connector = connectorFor(entry, request);
    configured.push(connector);
    return connector;
  });
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      connectorCatalog: {
        ...createMockCatalog().connectorCatalog,
        getConnectorCatalog: async () => [oauthEntry, keyEntry, openEntry],
        listConnectors: async () => [...configured],
        createConnector,
      },
    }),
  });
  const handlers = { onBack: vi.fn(), onSkip: vi.fn(), onDone: vi.fn() };
  render(
    <ServerProvider server={server}>
      <ConnectMcpStep {...handlers} />
    </ServerProvider>,
  );
  return { createConnector, ...handlers };
}

describe('ConnectMcpStep', () => {
  it('filters connectors by the search query', async () => {
    renderStep();
    await screen.findByText('Notion');
    fireEvent.change(screen.getByPlaceholderText('Search connectors'), { target: { value: 'wiki' } });
    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.queryByText('Exa')).not.toBeInTheDocument();
  });

  it('fires the footer callbacks', async () => {
    const { onBack, onSkip, onDone } = renderStep();
    await screen.findByText('Notion');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('creates an OAuth connector and continues into authorization', async () => {
    const { createConnector } = renderStep();
    await screen.findByText('Notion');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Notion' }));

    await waitFor(() => expect(oauthMock.handleAuthorize).toHaveBeenCalledWith('notion', expect.any(Function)));
    expect(createConnector).toHaveBeenCalledWith(
      expect.objectContaining({ url: oauthEntry.url, auth: { type: 'dcr' } }),
    );
  });

  it('keeps Connect usable after the OAuth popup opens, even if it never reports back', async () => {
    renderStep();
    await screen.findByText('Notion');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Notion' }));

    // The mocked handleAuthorize resolves once the popup is open and never calls its callback,
    // which is what an abandoned popup looks like to this step.
    await waitFor(() => expect(oauthMock.handleAuthorize).toHaveBeenCalledWith('notion', expect.any(Function)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Connect Exa' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Docs' })).toBeEnabled();
  });

  it('asks for an API key before creating a header-auth connector', async () => {
    const { createConnector } = renderStep();
    await screen.findByText('Exa');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Exa' }));
    expect(createConnector).not.toHaveBeenCalled();

    fireEvent.change(await screen.findByLabelText(/API key/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(createConnector).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { type: 'header', apiKey: 'secret', headerName: 'x-api-key' } }),
      ),
    );
  });

  it('adds a no-auth connector directly', async () => {
    const { createConnector } = renderStep();
    await screen.findByText('Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Docs' }));

    await waitFor(() =>
      expect(createConnector).toHaveBeenCalledWith(expect.objectContaining({ auth: { type: 'none' } })),
    );
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });
});
