import { McpConnectionError, type RemoteMcpHeaders, type ResolveHeadersResult } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { RequestContext, RequestSubject } from '../auth/identity';
import { safeReturnTo } from '../auth/safeReturnTo';
import { getPublicUiBasePath } from '../config';
import type { AgentRecord } from '../db/agentStore';
import {
  McpServerNotFoundError,
  type AuthorizeMcpServerInput,
  type CreateMcpServerInput,
  type DeleteMcpAuthorizationInput,
  type DeleteMcpServerInput,
  type GetMcpServerInput,
  type IMcpServerWithAuthStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type ResolveMcpAuthStatusesInput,
  type UpsertMcpServerInput,
} from '../db/mcpServerStore';
import type { TurnMetadata } from '../db/turnMetadata';
import type { OAuthClientRecord } from '../mcp/auth/types';
import { hasAuthorizationHeader, withoutAuthorization, type PerServerMcpHeaders } from '../mcp/perServerMcpHeaders';
import { resolveMcpAuthStatus, type McpAuthStatus } from '../schemas/mcpServer';
import {
  accessTokenForRequest,
  asTrueFoundryRequestContext,
  gatewayHeaders,
  type ResolveGatewayAuthorization,
  type ResolveServiceFoundryAuthorization,
} from './accessToken';
import { trueFoundryManaged } from './errors';
import { gatewayMetadataHeadersForTurn } from './gatewayMetadata';
import { resolveDefaultGatewayUrl } from './mapEnabledModels';
import {
  mapSfyMcpServers,
  parseSfyMcpServerSummary,
  toTrueFoundryMcpManifest,
  type SfyMcpServerSummary,
} from './mapSfyMcpServers';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export type TrueFoundryMcpApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  | 'getMcpServerByName'
  | 'listMcpServers'
  | 'listGatewayInstallations'
  | 'getMcpAuthorize'
  | 'getMcpAuthStatus'
  | 'deleteMcpAuth'
  | 'vendToken'
  | 'getTenantControlPlaneUrl'
>;

/** Per-server upstream headers the TrueFoundry gateway applies after its own caller auth. */
const X_TFY_MCP_HEADERS = 'x-tfy-mcp-headers';

/**
 * Absolute FE landing for the upstream authorize `redirectURL`.
 * Origin from the tenant control-plane URL; UI path prefix from process
 * `PUBLIC_BASE_URL` via {@link getPublicUiBasePath}. `return_to` is a browser path.
 *
 * TODO: add an env var for the public UI path prefix (do not keep deriving mount path from
 * `PUBLIC_BASE_URL`) so tenant origin and path are independently configurable.
 */
export function resolveAuthorizeRedirectURL(input: { returnTo: string; publicBaseUrl: string }): string {
  try {
    const origin = new URL(input.publicBaseUrl).origin;
    const publicBase = new URL(getPublicUiBasePath(), `${origin}/`);
    return new URL(safeReturnTo(input.returnTo), publicBase).href;
  } catch (error) {
    throw new McpConnectionError('Tenant control-plane URL is required for TrueFoundry MCP OAuth', 500, {
      cause: error,
    });
  }
}

/** Read-only MCP registry for TrueFoundry mode (writes managed elsewhere). */
export class TrueFoundryMcpServerStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #client: TrueFoundryMcpApiClient;
  readonly #resolveServiceFoundryAuthorization: ResolveServiceFoundryAuthorization;
  readonly #resolveGatewayAuthorization: ResolveGatewayAuthorization;
  readonly #subject: RequestSubject;
  readonly #perServerHeaders: PerServerMcpHeaders;
  #gatewayUrl: string | undefined;

  constructor(input: {
    client: TrueFoundryMcpApiClient;
    requestContext: RequestContext;
    agent: AgentRecord | undefined;
    perServerHeaders?: PerServerMcpHeaders;
    logger: Logger;
  }) {
    this.#client = input.client;
    const requestContext = asTrueFoundryRequestContext(input.requestContext);
    const tokens = accessTokenForRequest({
      client: input.client,
      requestContext,
      agent: input.agent,
      logger: input.logger,
    });
    this.#resolveServiceFoundryAuthorization = tokens.resolveServiceFoundryAuthorization;
    this.#resolveGatewayAuthorization = tokens.resolveGatewayAuthorization;
    this.#subject = requestContext.subject;
    this.#perServerHeaders = input.perServerHeaders ?? {};
  }

  /**
   * Gateway Bearer (+ per-server overrides); the gateway's 401 carries any consent URL.
   * A caller entry with Authorization goes in `x-tfy-mcp-headers`, falling back to the gateway's auth on a 401.
   */
  resolveInvokeHeaders(input: {
    record: McpServerRecord;
    userRef: string;
    turnMetadata?: TurnMetadata;
  }): RemoteMcpHeaders {
    const { record, turnMetadata } = input;
    const callerHeaders = this.#perServerHeaders[record.name];
    const gatewayBase = async (): Promise<Record<string, string>> => ({
      ...gatewayHeaders(await this.#resolveGatewayAuthorization()),
      ...gatewayMetadataHeadersForTurn(turnMetadata),
    });
    const viaGateway = async (): Promise<ResolveHeadersResult> => ({
      headers: { ...withoutAuthorization(callerHeaders), ...(await gatewayBase()) },
    });
    if (!hasAuthorizationHeader(callerHeaders)) {
      return viaGateway;
    }
    // Each connection targets one server's gateway proxy, which takes a flat header map for it.
    return async () => ({
      headers: { ...(await gatewayBase()), [X_TFY_MCP_HEADERS]: JSON.stringify(callerHeaders) },
      onUnauthorized: viaGateway,
    });
  }

  async listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]> {
    void transaction;
    if (input.names?.length === 0) {
      return [];
    }

    const accessToken = await this.#resolveServiceFoundryAuthorization();
    const [rows, gatewayUrl] = await Promise.all([
      this.#client.listMcpServers({
        accessToken,
        ...(input.names !== undefined ? { names: input.names } : {}),
      }),
      this.#resolveGatewayUrl(),
    ]);
    return mapSfyMcpServers({ rows }).map(server => toRecord({ tenant_id: input.tenant_id, server, gatewayUrl }));
  }

  async getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    void transaction;
    const accessToken = await this.#resolveServiceFoundryAuthorization();
    const [row, gatewayUrl] = await Promise.all([
      this.#client.getMcpServerByName({ accessToken, name: input.name }),
      this.#resolveGatewayUrl(),
    ]);
    if (row === undefined) {
      return undefined;
    }
    const server = parseSfyMcpServerSummary(row);
    return toRecord({ tenant_id: input.tenant_id, server, gatewayUrl });
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  deleteServer(input: DeleteMcpServerInput, transaction?: TTransaction): Promise<boolean> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return trueFoundryManaged();
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    void params;
    void transaction;
    return trueFoundryManaged();
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return trueFoundryManaged();
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    void input.userRef;
    const out = new Map<string, McpAuthStatus>();

    // List responses stay stubbed; single-server GET (e.g. GET /mcp-servers/{name}) hits SFY live status
    // for every auth mode (oauth2, header/env per-user, …).
    const [record] = input.records;
    if (record === undefined || input.records.length !== 1) {
      for (const item of input.records) {
        out.set(item.name, resolveMcpAuthStatus({ manifest: item.manifest }));
      }
      return out;
    }

    const gatewayAuthorization = await this.#resolveGatewayAuthorization();
    out.set(
      record.name,
      await this.#client.getMcpAuthStatus({
        accessToken: gatewayAuthorization.subjectToken,
        mcpServerId: record.id,
        subjectId: this.#subject.id,
        subjectType: this.#subject.type,
      }),
    );
    return out;
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    const returnTo = input.returnTo;
    const redirectURL =
      returnTo === undefined
        ? undefined
        : resolveAuthorizeRedirectURL({
            returnTo: returnTo,
            publicBaseUrl: await this.#client.getTenantControlPlaneUrl({ tenantName: input.tenant_id }),
          });
    const gatewayAuthorization = await this.#resolveGatewayAuthorization();
    return this.#client.getMcpAuthorize({
      accessToken: gatewayAuthorization.subjectToken,
      mcpServerId: record.id,
      ...(redirectURL !== undefined ? { redirectURL } : {}),
    });
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    const gatewayAuthorization = await this.#resolveGatewayAuthorization();
    await this.#client.deleteMcpAuth({
      accessToken: gatewayAuthorization.subjectToken,
      mcpServerId: record.id,
      subjectId: this.#subject.id,
      subjectType: this.#subject.type,
      authSource: 'oauth',
    });
  }

  async #resolveGatewayUrl(): Promise<string> {
    if (this.#gatewayUrl === undefined) {
      const accessToken = await this.#resolveServiceFoundryAuthorization();
      const installations = await this.#client.listGatewayInstallations(accessToken);
      this.#gatewayUrl = resolveDefaultGatewayUrl(installations);
    }
    return this.#gatewayUrl;
  }
}

function toRecord(input: { tenant_id: string; server: SfyMcpServerSummary; gatewayUrl: string }): McpServerRecord {
  return {
    id: input.server.id,
    tenant_id: input.tenant_id,
    name: input.server.name,
    manifest: toTrueFoundryMcpManifest({ server: input.server, gatewayUrl: input.gatewayUrl }),
    created_at: input.server.createdAt,
    updated_at: input.server.updatedAt,
  };
}
