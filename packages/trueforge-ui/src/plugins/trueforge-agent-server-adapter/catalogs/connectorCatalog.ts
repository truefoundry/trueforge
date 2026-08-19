/**
 * Maps trueforge-ui connector-settings calls onto Harness
 *
 * UI: `dcr` / `header` / `none`, connector `id`.
 * Harness: `dcr` / `header` / omitted auth, resource `name`.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  ConnectorAuth,
  ConnectorAuthPublic,
  ConnectorBase,
  ConnectorCatalogEntry,
  ConnectorCatalogServer,
  CreateConnectorRequest,
  ToolBase,
  UpdateConnectorRequest,
} from '../../../server/types.js';

export type UiConnectorAuth = ConnectorAuth;
export type UiConnectorAuthPublic = ConnectorAuthPublic;
export type UiConnector = ConnectorBase;
export type UiConnectorCatalogEntry = ConnectorCatalogEntry;

const DEFAULT_API_KEY_HEADER = 'Authorization';

export function toUiAuthPublic(auth: TrueForgeApi.McpServerManifestAuth | undefined): UiConnectorAuthPublic {
  if (auth === undefined) {
    return { type: 'none' };
  }
  if (auth.type === 'dcr') {
    return { type: 'dcr' };
  }
  const headerName = Object.keys(auth.headers)[0];
  return {
    type: 'header',
    ...(headerName === undefined ? {} : { headerName }),
  };
}

export function toHarnessAuth(auth: ConnectorAuth): TrueForgeApi.McpServerManifestAuth | undefined {
  if (auth.type === 'none') {
    return undefined;
  }
  if (auth.type === 'dcr') {
    return { type: 'dcr' };
  }
  const apiKey = auth.apiKey?.trim();
  if (apiKey === undefined || apiKey === '') {
    throw new Error('API key is required for header-authenticated MCP servers');
  }
  const trimmedHeader = auth.headerName?.trim();
  const headerName = trimmedHeader !== undefined && trimmedHeader !== '' ? trimmedHeader : DEFAULT_API_KEY_HEADER;
  return { type: 'header', headers: { [headerName]: apiKey } };
}

export function toUiCatalogEntry(server: TrueForgeApi.CatalogMcpServer): UiConnectorCatalogEntry {
  return {
    id: server.name,
    name: server.name,
    url: server.url,
    description: server.description,
    ...(server.logo === undefined ? {} : { logo: server.logo }),
    auth: toUiAuthPublic(server.auth),
  };
}

export function toUiTool(tool: Record<string, unknown>): ToolBase {
  const name = typeof tool.name === 'string' && tool.name !== '' ? tool.name : 'tool';
  const description = typeof tool.description === 'string' ? tool.description : '';
  return { id: name, name, description };
}

export function toUiConnector(server: TrueForgeApi.ConfiguredMcpServer): UiConnector {
  const auth = toUiAuthPublic(server.manifest.auth);
  return {
    id: server.name,
    name: server.name,
    description: server.manifest.description,
    url: server.manifest.url,
    auth,
    requiresAuth: server.authStatus.status === 'auth_required',
    authenticated: server.authStatus.status !== 'auth_required',
  };
}

export function toUiConnectorFromReadEntry(server: TrueForgeApi.AvailableMcpServer): UiConnector {
  const auth: UiConnectorAuthPublic = server.auth?.type ? { type: server.auth.type } : { type: 'none' };
  return {
    id: server.name,
    name: server.name,
    description: server.url,
    url: server.url,
    auth,
    requiresAuth: server.authStatus.status === 'auth_required',
    authenticated: server.authStatus.status !== 'auth_required',
  };
}

export function toHarnessManifest(req: {
  name: string;
  url: string;
  auth: ConnectorAuth;
  description?: string;
}): TrueForgeApi.McpServerManifest {
  const auth = toHarnessAuth(req.auth);
  const trimmed = req.description?.trim();
  return {
    type: 'remote',
    name: req.name,
    url: req.url,
    description: trimmed !== undefined && trimmed !== '' ? trimmed : `${req.name} MCP server`,
    ...(auth === undefined ? {} : { auth }),
  };
}

/** Settings connector port for `createTrueFoundryServer`. Delete omitted; disconnect unsupported. */
export function createConnectorCatalog(
  client: TrueForge,
): ConnectorCatalogServer<
  ToolBase,
  UiConnectorAuth,
  UiConnectorAuthPublic,
  UiConnector,
  UiConnectorCatalogEntry,
  CreateConnectorRequest,
  UpdateConnectorRequest
> {
  async function getConfigured(name: string): Promise<TrueForgeApi.ConfiguredMcpServer> {
    const listed = await client.settings.mcpServers.list();
    const existing = listed.data.find(server => server.name === name);
    if (existing === undefined) {
      throw new Error(`MCP server "${name}" not found`);
    }
    return existing;
  }

  async function resolveWriteAuth(req: { id?: string; auth: ConnectorAuth }): Promise<ConnectorAuth> {
    if (req.auth.type !== 'header') {
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
    if (existing.manifest.auth?.type !== 'header') {
      throw new Error(`MCP server "${req.id}" has no stored header credentials to reuse`);
    }
    const preferredHeader = req.auth.headerName?.trim();
    const storedHeaderName = Object.keys(existing.manifest.auth.headers)[0];
    const headerName =
      preferredHeader !== undefined && preferredHeader !== ''
        ? preferredHeader
        : (storedHeaderName ?? DEFAULT_API_KEY_HEADER);
    const stored = existing.manifest.auth.headers[headerName] ?? Object.values(existing.manifest.auth.headers)[0];
    if (stored === undefined) {
      throw new Error(`MCP server "${req.id}" has no stored header credentials to reuse`);
    }
    return { type: 'header', apiKey: stored, headerName };
  }

  return {
    getConnectorCatalog: async () => {
      const body = await client.catalogs.mcpServers.list();
      return body.data.map(toUiCatalogEntry);
    },
    getConnector: async req => {
      const body = await client.settings.mcpServers.get(req.id);
      return toUiConnector(body.data);
    },
    listConnectors: async req => {
      const body = await client.settings.mcpServers.list();
      const connectors = body.data.map(toUiConnector);
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
    getToolsByConnectorId: async ({ id }) => {
      const body = await client.mcpServers.listTools(id);
      return body.data.map(toUiTool);
    },
    createConnector: async req => {
      const auth = await resolveWriteAuth({ auth: req.auth });
      const body = await client.settings.mcpServers.create({
        manifest: toHarnessManifest({
          name: req.name,
          url: req.url,
          auth,
          description: req.description,
        }),
      });
      return toUiConnector(body.data);
    },
    updateConnector: async req => {
      const auth = await resolveWriteAuth({ id: req.id, auth: req.auth });
      const body = await client.settings.mcpServers.createOrUpdate({
        manifest: toHarnessManifest({
          name: req.id,
          url: req.url,
          auth,
          description: req.description,
        }),
      });
      return toUiConnector(body.data);
    },
    authenticateConnector: async req => {
      const result = await client.mcpServers.authorize(
        req.id,
        req.returnTo === undefined ? {} : { returnTo: req.returnTo },
      );
      return { status: result.status, authorization_endpoint: result.authorizationUrl };
    },
    disconnectConnector: async req => {
      const existing = await getConfigured(req.id);
      if (existing.manifest.auth?.type !== 'dcr') {
        throw new Error(`Disconnect is only supported for OAuth MCP servers`);
      }
      const body = await client.mcpServers.deleteAuthorization(req.id);
      return toUiConnector(body.data);
    },
  };
}
