import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import {
  McpServerNotFoundError,
  McpServerStoreNotImplementedError,
  type AuthorizeMcpServerInput,
  type CreateMcpServerInput,
  type DeleteMcpAuthorizationInput,
  type GetMcpServerInput,
  type IMcpServerStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type ResolveMcpAuthStatusesInput,
  type UpsertMcpServerInput,
} from '../db/mcpServerStore';
import type { OAuthClientRecord } from '../mcp/auth/types';
import type { ResourceName } from '../schemas/common';
import { resolveMcpAuthStatus, type McpAuthStatus, type McpServerManifest } from '../schemas/mcpServer';
import type { InternalTlsOptions } from './internalTls';
import { resolveDefaultGatewayUrl } from './mapEnabledModels';
import { mapSfyMcpAuthStatus } from './mapMcpAuth';
import {
  resolveMcpProxyUrl,
  TrueFoundryServiceFoundryServerClient,
  type SfyMcpServerSummary,
} from './TrueFoundryServiceFoundryServerClient';

function requireAccessToken(accessToken: string | undefined): string {
  if (accessToken === undefined || accessToken.length === 0) {
    throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry MCP servers' });
  }
  return accessToken;
}

function notImplemented(operation: string): never {
  throw new McpServerStoreNotImplementedError(operation);
}

/**
 * Read-only MCP registry backed by ServiceFoundry + the tenant AI Gateway.
 * Writes and local OAuth client columns are not supported — configure servers in TrueFoundry.
 */
export class TrueFoundryMcpServerStore<TTransaction = never> implements IMcpServerStore<TTransaction> {
  readonly #client: TrueFoundryServiceFoundryServerClient;

  constructor(input: { serviceFoundryServerUrl: string; logger?: Logger; tls?: InternalTlsOptions }) {
    this.#client = new TrueFoundryServiceFoundryServerClient({
      serviceFoundryServerUrl: input.serviceFoundryServerUrl,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.tls === undefined ? {} : { tls: input.tls }),
    });
  }

  async listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]> {
    void transaction;
    if (input.names !== undefined && input.names.length === 0) {
      return [];
    }
    const accessToken = requireAccessToken(input.accessToken);
    const [servers, installations] = await Promise.all([
      this.#client.listMcpServers(accessToken),
      this.#client.listGatewayInstallations(accessToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    const records = servers.map(server => toRecord({ tenant_id: input.tenant_id, server, gatewayUrl }));
    if (input.names === undefined) {
      return records;
    }
    const wanted = new Set(input.names);
    return records.filter(record => wanted.has(record.name));
  }

  async getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    void transaction;
    const accessToken = requireAccessToken(input.accessToken);
    const [server, installations] = await Promise.all([
      this.#client.getMcpServerByName(accessToken, input.name),
      this.#client.listGatewayInstallations(accessToken),
    ]);
    if (server === undefined) {
      return undefined;
    }
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return toRecord({ tenant_id: input.tenant_id, server, gatewayUrl });
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    void input;
    void transaction;
    return notImplemented('getServerForUpdate');
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return notImplemented('createServer');
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return notImplemented('upsertServer');
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return notImplemented('saveClient');
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    void params;
    void transaction;
    return notImplemented('getClient');
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return notImplemented('deleteClient');
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    const accessToken = requireAccessToken(input.accessToken);
    const entries = await Promise.all(
      input.records.map(async record => {
        if (record.manifest.auth?.type !== 'dcr') {
          return [record.name, resolveMcpAuthStatus({ manifest: record.manifest })] as const;
        }
        const response = await this.#client.getMcpAuthStatus(accessToken, record.id, {
          subjectId: input.userRef,
          subjectType: 'user',
        });
        return [record.name, mapSfyMcpAuthStatus(response)] as const;
      }),
    );
    return new Map(entries);
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    const accessToken = requireAccessToken(input.accessToken);
    const server = await this.#client.getMcpServerByName(accessToken, input.name);
    if (server === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    const gatewayBaseURL = resolveDefaultGatewayUrl(await this.#client.listGatewayInstallations(accessToken));
    const response = await this.#client.authorizeMcpServer(accessToken, server.id, {
      gatewayBaseURL,
      ...(input.redirectURL !== undefined ? { redirectURL: input.redirectURL } : {}),
    });
    return mapSfyMcpAuthStatus(response);
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    const accessToken = requireAccessToken(input.accessToken);
    const server = await this.#client.getMcpServerByName(accessToken, input.name);
    if (server === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    if (server.authType === 'oauth2') {
      await this.#client.deleteMcpAuth(accessToken, server.id, {
        authSource: 'oauth',
        subjectId: input.userRef,
        subjectType: 'user',
      });
    }
  }
}

function toRecord(input: { tenant_id: string; server: SfyMcpServerSummary; gatewayUrl: string }): McpServerRecord {
  return {
    id: input.server.id,
    tenant_id: input.tenant_id,
    name: input.server.name as ResourceName,
    manifest: toManifest(input.server, input.gatewayUrl),
    created_at: input.server.createdAt,
    updated_at: input.server.updatedAt,
  };
}

/**
 * Gateway proxy URL as `url`. Upstream per-user OAuth is modelled as `dcr` so existing
 * auth_status / Connect UX treats the server as needing user authorization; inbound
 * gateway auth is the caller's Bearer token (not stored on the manifest).
 */
function toManifest(server: SfyMcpServerSummary, gatewayUrl: string): McpServerManifest {
  const url = resolveMcpProxyUrl(server.proxyUrl, gatewayUrl);
  const needsPerUserAuth = server.authType === 'oauth2';
  return {
    type: 'remote',
    name: server.name as ResourceName,
    url,
    description: server.description,
    ...(needsPerUserAuth ? { auth: { type: 'dcr' as const } } : {}),
  };
}
