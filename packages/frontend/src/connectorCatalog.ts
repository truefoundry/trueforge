/**
 * Maps agent-ui-sdk connector-settings calls onto Harness
 * `/api/v1/settings/mcp-servers` (name-keyed upsert, authorize; no delete/disconnect).
 *
 * UI: `oauth` / `apiKey` / `none`, connector `id`.
 * Harness: `dcr` / `header` / omitted auth, resource `name`.
 */
import type {
  ConnectorAuth,
  ConnectorAuthPublic,
  ConnectorBase,
  ConnectorCatalogEntry,
  ConnectorCatalogServer,
  CreateConnectorRequest,
  ToolBase,
  UpdateConnectorRequest,
} from '@truefoundry/agent-ui-sdk';
import type { TrueHarness as Harness } from 'trueharness';
import { TrueHarnessClient } from 'trueharness';

export type UiConnectorAuth = ConnectorAuth<'none' | 'oauth' | 'apiKey'>;
export type UiConnectorAuthPublic = ConnectorAuthPublic<'none' | 'oauth' | 'apiKey'>;
export type UiConnector = ConnectorBase<ToolBase, UiConnectorAuthPublic>;
export type UiConnectorCatalogEntry = ConnectorCatalogEntry<UiConnectorAuthPublic>;

const DEFAULT_API_KEY_HEADER = 'Authorization';

const client = new TrueHarnessClient({ environment: '/' });

export function toUiAuthPublic(auth: Harness.ConfiguredMcpServerAuth | undefined): UiConnectorAuthPublic {
  if (auth === undefined) {
    return { type: 'none' };
  }
  if (auth.type === 'dcr') {
    return { type: 'oauth' };
  }
  const headerName = Object.keys(auth.headers)[0];
  return {
    type: 'apiKey',
    ...(headerName === undefined ? {} : { headerName }),
  };
}

export function toHarnessAuth(auth: ConnectorAuth): Harness.ConfiguredMcpServerAuth | undefined {
  if (auth.type === 'none') {
    return undefined;
  }
  if (auth.type === 'oauth') {
    return { type: 'dcr' };
  }
  if (auth.type === 'apiKey') {
    const apiKey = auth.apiKey?.trim();
    if (apiKey === undefined || apiKey === '') {
      throw new Error('API key is required for header-authenticated MCP servers');
    }
    const trimmedHeader = auth.headerName?.trim();
    const headerName = trimmedHeader !== undefined && trimmedHeader !== '' ? trimmedHeader : DEFAULT_API_KEY_HEADER;
    return { type: 'header', headers: { [headerName]: apiKey } };
  }
  throw new Error(`Unsupported connector auth type: ${auth.type}`);
}

export function toUiCatalogEntry(server: Harness.CatalogMcpServer): UiConnectorCatalogEntry {
  return {
    id: server.name,
    name: server.name,
    url: server.url,
    auth: toUiAuthPublic(server.auth),
  };
}

export function toUiTool(tool: Record<string, unknown>): ToolBase {
  const name = typeof tool.name === 'string' && tool.name !== '' ? tool.name : 'tool';
  return { id: name, name };
}

export function toUiConnector(server: Harness.ConfiguredMcpServer, tools: ToolBase[]): UiConnector {
  return {
    id: server.name,
    name: server.name,
    description: server.url,
    url: server.url,
    auth: toUiAuthPublic(server.auth),
    authenticated: server.authStatus.status === 'authenticated',
    tools,
  };
}

export interface HarnessMcpUpsert {
  name: string;
  url: string;
  auth?: Harness.ConfiguredMcpServerAuth;
}

export function toHarnessManifest(req: { name: string; url: string; auth: ConnectorAuth }): HarnessMcpUpsert {
  const auth = toHarnessAuth(req.auth);
  return {
    name: req.name,
    url: req.url,
    ...(auth === undefined ? {} : { auth }),
  };
}

async function listToolsSafe(name: string): Promise<ToolBase[]> {
  try {
    const body = await client.settings.mcpServers.listTools(name);
    return body.data.map(toUiTool);
  } catch {
    return [];
  }
}

async function getConfigured(name: string): Promise<Harness.ConfiguredMcpServer> {
  const listed = await client.settings.mcpServers.list();
  const existing = listed.data.find(server => server.name === name);
  if (existing === undefined) {
    throw new Error(`MCP server "${name}" not found`);
  }
  return existing;
}

async function toUiConnectorWithTools(server: Harness.ConfiguredMcpServer): Promise<UiConnector> {
  const tools = await listToolsSafe(server.name);
  return toUiConnector(server, tools);
}

async function resolveWriteAuth(req: { id?: string; auth: ConnectorAuth }): Promise<ConnectorAuth> {
  if (req.auth.type !== 'apiKey') {
    return req.auth;
  }
  const apiKey = req.auth.apiKey?.trim();
  if (apiKey !== undefined && apiKey !== '') {
    return req.auth;
  }
  if (req.id === undefined) {
    throw new Error('API key is required for header-authenticated MCP servers');
  }
  const existing = await getConfigured(req.id);
  if (existing.auth?.type !== 'header') {
    throw new Error(`MCP server "${req.id}" has no stored header credentials to reuse`);
  }
  const preferredHeader = req.auth.headerName?.trim();
  const storedHeaderName = Object.keys(existing.auth.headers)[0];
  const headerName =
    preferredHeader !== undefined && preferredHeader !== ''
      ? preferredHeader
      : (storedHeaderName ?? DEFAULT_API_KEY_HEADER);
  const stored = existing.auth.headers[headerName] ?? Object.values(existing.auth.headers)[0];
  if (stored === undefined) {
    throw new Error(`MCP server "${req.id}" has no stored header credentials to reuse`);
  }
  return { type: 'apiKey', apiKey: stored, headerName };
}

function openAuthorizationUrl(url: string): void {
  if (typeof globalThis.open === 'function') {
    globalThis.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Settings connector port for `createTrueFoundryServer`. Delete omitted; disconnect unsupported. */
export function createConnectorCatalog(): ConnectorCatalogServer<
  ToolBase,
  UiConnectorAuth,
  UiConnectorAuthPublic,
  UiConnector,
  UiConnectorCatalogEntry,
  CreateConnectorRequest<UiConnectorAuth>,
  UpdateConnectorRequest<UiConnectorAuth>
> {
  return {
    getConnectorCatalog: async () => {
      const body = await client.settings.mcpServers.catalog();
      return body.data.map(toUiCatalogEntry);
    },
    listConnectors: async req => {
      const body = await client.settings.mcpServers.list();
      const connectors = await Promise.all(body.data.map(server => toUiConnectorWithTools(server)));
      const query = req?.query?.trim().toLowerCase();
      if (query === undefined || query === '') {
        return connectors;
      }
      return connectors.filter(
        connector =>
          connector.name.toLowerCase().includes(query) ||
          connector.description.toLowerCase().includes(query) ||
          connector.url.toLowerCase().includes(query),
      );
    },
    createConnector: async req => {
      const auth = await resolveWriteAuth({ auth: req.auth });
      const body = await client.settings.mcpServers.upsert(toHarnessManifest({ name: req.name, url: req.url, auth }));
      return toUiConnectorWithTools(body.data);
    },
    updateConnector: async req => {
      const auth = await resolveWriteAuth({ id: req.id, auth: req.auth });
      const body = await client.settings.mcpServers.upsert(toHarnessManifest({ name: req.id, url: req.url, auth }));
      return toUiConnectorWithTools(body.data);
    },
    authenticateConnector: async req => {
      const redirectUrl = `${globalThis.location.origin}${globalThis.location.pathname}`;
      const result = await client.settings.mcpServers.authorize(req.id, { redirectUrl });
      if (result.status === 'auth_required') {
        if (result.authorizationUrl === undefined) {
          throw new Error(`Authorization URL missing for MCP server "${req.id}"`);
        }
        openAuthorizationUrl(result.authorizationUrl);
      }
      const server = await getConfigured(req.id);
      return toUiConnectorWithTools(server);
    },
    disconnectConnector: () => Promise.reject(new Error('Disconnect is not supported by Harness yet')),
  };
}
