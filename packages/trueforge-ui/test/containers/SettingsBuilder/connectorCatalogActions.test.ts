import { describe, expect, it, vi } from 'vitest';

import {
  createConnectorFromCatalog,
  headerAuthForCatalogEntry,
} from '@/containers/SettingsBuilder/connectorCatalogActions.js';
import type { ConnectorCatalogEntry } from '@/server/types.js';
import { createMockCatalog } from '../../server/mockServer.js';

const headerEntry: ConnectorCatalogEntry = {
  id: 'exa',
  name: 'Exa',
  url: 'https://mcp.exa.example',
  auth: { type: 'header', headerName: 'x-api-key' },
};

function catalogWithCreate() {
  const createConnector = vi.fn();
  const { connectorCatalog } = createMockCatalog({
    connectorCatalog: { ...createMockCatalog().connectorCatalog, createConnector },
  });
  return { connectorCatalog, createConnector };
}

describe('connectorCatalogActions', () => {
  it('builds header auth that keeps the catalog header name', () => {
    expect(headerAuthForCatalogEntry({ entry: headerEntry, apiKey: 'secret' })).toEqual({
      type: 'header',
      apiKey: 'secret',
      headerName: 'x-api-key',
    });
  });

  it('creates an OAuth connector with dcr auth and the url as fallback description', async () => {
    const { connectorCatalog, createConnector } = catalogWithCreate();
    await createConnectorFromCatalog({
      connectorCatalog,
      entry: { id: 'n', name: 'Notion', url: 'https://mcp.notion.example', auth: { type: 'dcr' } },
    });
    expect(createConnector).toHaveBeenCalledWith({
      name: 'Notion',
      description: 'https://mcp.notion.example',
      url: 'https://mcp.notion.example',
      auth: { type: 'dcr' },
    });
  });

  it('uses the supplied auth over the catalog default', async () => {
    const { connectorCatalog, createConnector } = catalogWithCreate();
    const auth = headerAuthForCatalogEntry({ entry: headerEntry, apiKey: 'secret' });
    await createConnectorFromCatalog({ connectorCatalog, entry: headerEntry, auth });
    expect(createConnector).toHaveBeenCalledWith(expect.objectContaining({ auth }));
  });
});
