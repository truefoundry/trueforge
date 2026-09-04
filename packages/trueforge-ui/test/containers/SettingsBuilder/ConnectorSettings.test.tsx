// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

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

const brightData: ConnectorCatalogEntry = {
  id: 'bright-data',
  name: 'bright-data',
  description: 'Search the web and scrape pages, including sites behind bot protection.',
  url: 'https://mcp.brightdata.com/mcp',
  auth: { type: 'header', headerName: 'Authorization' },
};

const connectedBrightData: ConnectorBase = {
  id: 'bright-data',
  name: 'bright-data',
  description: brightData.description ?? '',
  url: brightData.url,
  auth: { type: 'header', headerName: 'Authorization' },
  requiresAuth: false,
  authenticated: true,
};

/** `succeedsWhen` decides, per attempt, whether the just-saved header value should test as reachable. */
function renderConnectorSettings(succeedsWhen: (headerValue: string) => boolean) {
  let lastAuthValue: string | undefined;
  const attempts: string[] = [];
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      connectorCatalog: {
        getConnectorCatalog: async () => [brightData],
        listConnectors: async () => [],
        getConnector: async () => connectedBrightData,
        getToolsByConnectorId: async () => {
          if (lastAuthValue === undefined || !succeedsWhen(lastAuthValue)) {
            throw new Error(`upstream returned 401 Unauthorized for "${lastAuthValue}"`);
          }
          return [];
        },
        createConnector: async req => {
          const value = req.auth.type === 'header' ? (req.auth.apiKey ?? '') : '';
          lastAuthValue = value;
          attempts.push(value);
          return connectedBrightData;
        },
        updateConnector: async req => {
          const value = req.auth.type === 'header' ? (req.auth.apiKey ?? '') : '';
          lastAuthValue = value;
          attempts.push(value);
          return connectedBrightData;
        },
        authenticateConnector: async () => ({ authorization_endpoint: '' }),
        disconnectConnector: async () => connectedBrightData,
      },
    }),
  });

  render(
    <ServerProvider server={server}>
      <ConnectorSettings />
    </ServerProvider>,
  );

  return { attempts };
}

async function openConnectModal() {
  const row = await screen.findByText('bright-data');
  const connectButton = within(row.closest('article') as HTMLElement).getByRole('button', { name: 'Connect' });
  fireEvent.click(connectButton);
  return within(await screen.findByRole('dialog'));
}

function submit(dialog: ReturnType<typeof within>, apiKey: string) {
  fireEvent.change(dialog.getByLabelText('API key / token'), { target: { value: apiKey } });
  fireEvent.click(dialog.getByRole('button', { name: /Connect|Testing/ }));
}

describe('ConnectorSettings auto-probing header auth (fixes #490)', () => {
  it('stores the raw key when it works on the first try', async () => {
    const { attempts } = renderConnectorSettings(value => value === 'abc123');
    const dialog = await openConnectModal();
    submit(dialog, 'abc123');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(attempts).toEqual(['abc123']);
  });

  it('falls back to a Bearer prefix when the raw key is rejected, logging each attempt', async () => {
    const { attempts } = renderConnectorSettings(value => value === 'Bearer abc123');
    const dialog = await openConnectModal();
    submit(dialog, 'abc123');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(attempts).toEqual(['abc123', 'Bearer abc123']);
  });

  it('falls back to Basic when both the raw key and Bearer are rejected', async () => {
    const { attempts } = renderConnectorSettings(value => value === 'Basic abc123');
    const dialog = await openConnectModal();
    submit(dialog, 'abc123');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(attempts).toEqual(['abc123', 'Bearer abc123', 'Basic abc123']);
  });

  it('shows a final error, keeps the dialog open, and logs every failed attempt when all candidates fail', async () => {
    const { attempts } = renderConnectorSettings(() => false);
    const dialog = await openConnectModal();
    submit(dialog, 'abc123');

    expect(await dialog.findByText(/Could not connect with the provided key/)).toBeInTheDocument();
    expect(attempts).toEqual(['abc123', 'Bearer abc123', 'Basic abc123']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(dialog.getByText(/Testing key… failed/)).toBeInTheDocument();
    expect(dialog.getByText(/Trying with prefix "Bearer"… failed/)).toBeInTheDocument();
    expect(dialog.getByText(/Trying with prefix "Basic"… failed/)).toBeInTheDocument();
  });

  it('does not double-prefix a key already typed with "Bearer "', async () => {
    const { attempts } = renderConnectorSettings(value => value === 'Basic Bearer abc123');
    const dialog = await openConnectModal();
    submit(dialog, 'Bearer abc123');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // No separate "Bearer Bearer abc123" attempt — the raw try already carried the prefix.
    expect(attempts).toEqual(['Bearer abc123', 'Basic Bearer abc123']);
  });
});
