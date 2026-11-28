import type { CatalogServer, ConnectorAuth, ConnectorBase, ConnectorCatalogEntry } from '../../server/types.js';

/** Auth for a catalog entry that needs no user-supplied secret; header entries get their key separately. */
function defaultAuthForCatalogEntry(entry: ConnectorCatalogEntry): ConnectorAuth {
  if (entry.auth.type === 'header') {
    return { type: 'header', ...(entry.auth.headerName ? { headerName: entry.auth.headerName } : {}) };
  }
  if (entry.auth.type === 'dcr') return { type: 'dcr' };
  return { type: 'none' };
}

export function createConnectorFromCatalog({
  connectorCatalog,
  entry,
  auth,
}: {
  connectorCatalog: CatalogServer['connectorCatalog'];
  entry: ConnectorCatalogEntry;
  auth?: ConnectorAuth;
}): Promise<ConnectorBase> {
  return connectorCatalog.createConnector({
    name: entry.name,
    description: entry.description ?? entry.url,
    url: entry.url,
    auth: auth ?? defaultAuthForCatalogEntry(entry),
  });
}

/** Header auth built from the key a user typed, keeping the catalog's custom header name. */
export function headerAuthForCatalogEntry({
  entry,
  apiKey,
}: {
  entry: ConnectorCatalogEntry;
  apiKey: string;
}): ConnectorAuth {
  return {
    type: 'header',
    apiKey,
    ...(entry.auth.type === 'header' && entry.auth.headerName ? { headerName: entry.auth.headerName } : {}),
  };
}
