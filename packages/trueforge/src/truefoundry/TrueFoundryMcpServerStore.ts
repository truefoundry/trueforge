import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { McpConnectionError, type RemoteMcpHeaders } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { safeReturnTo } from '../auth/safeReturnTo';
import { getPublicBaseUrl } from '../config';
import {
  McpServerNotFoundError,
  type AuthorizeMcpServerInput,
  type CreateMcpServerInput,
  type DeleteMcpAuthorizationInput,
  type GetMcpServerInput,
  type IMcpServerWithAuthStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type ResolveMcpAuthStatusesInput,
  type UpsertMcpServerInput,
} from '../db/mcpServerStore';
import type { OAuthClientRecord } from '../mcp/auth/types';
import { resolveMcpAuthStatus, type McpAuthStatus } from '../schemas/mcpServer';
import { resolveDefaultGatewayUrl } from './mapEnabledModels';
import {
  mapSfyMcpServers,
  parseSfyMcpServerSummary,
  toTrueFoundryMcpManifest,
  type SfyMcpServerSummary,
} from './mapSfyMcpServers';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from './trueFoundryManaged';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';
import { getEffectiveUserIdFromAccessTokenSubject, parseAccessTokenSubject } from './utils';

export type TrueFoundryMcpApiClient = Pick<
  TrueFoundryServiceFoundryServerClient,
  'getMcpServerByName' | 'listMcpServers' | 'listGatewayInstallations' | 'getMcpAuthorize' | 'deleteMcpAuth'
>;

function managed(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

/**
 * Absolute FE landing for SFY `redirectURL`. Prefer explicit `redirectURL`; otherwise
 * `PUBLIC_BASE_URL` + safe `return_to` (same path the Connect popup opens with).
 * SFY appends `code`/`error` — no harness callback.
 */
export function resolveAuthorizeRedirectURL(input: { redirectURL?: string; returnTo?: string }): string {
  if (input.redirectURL !== undefined && input.redirectURL.length > 0) {
    return input.redirectURL;
  }
  try {
    return new URL(safeReturnTo(input.returnTo), `${getPublicBaseUrl()}/`).href;
  } catch (error) {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for TrueFoundry MCP OAuth but was empty', 500, {
      cause: error,
    });
  }
}

/**
 * Read-only MCP registry backed by ServiceFoundry + the tenant AI Gateway.
 * Writes and local OAuth client columns are not supported — configure servers in TrueFoundry.
 * Authorize / revoke call SFY; list auth_status stays stubbed (no N× status calls).
 */
export class TrueFoundryMcpServerStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #client: TrueFoundryMcpApiClient;
  readonly #accessToken: string;
  #gatewayUrl: string | undefined;

  constructor(input: { client: TrueFoundryMcpApiClient; accessToken: string }) {
    this.#client = input.client;
    this.#accessToken = input.accessToken;
  }

  resolveInvokeHeaders(input: { record: McpServerRecord; userRef: string }): RemoteMcpHeaders {
    const bearer = { Authorization: `Bearer ${this.#accessToken}` };
    if (input.record.manifest.auth?.type !== 'dcr') {
      return bearer;
    }
    const { record, userRef } = input;
    return async () => {
      const status = await this.authorize({
        tenant_id: record.tenant_id,
        name: record.name,
        userRef,
      });
      if (status.status === 'auth_required') {
        const authUrl = status.authorization_url;
        if (authUrl === undefined || authUrl.length === 0) {
          throw new HTTPException(422, {
            message: `MCP server "${record.name}" requires authentication but returned no authorization URL`,
          });
        }
        return {
          authRequired: {
            servers: [{ id: record.name, name: record.name, auth_url: authUrl }],
          },
        };
      }
      return { headers: bearer };
    };
  }

  async listServers(
    input: ListMcpServersInput,
    transaction?: TTransaction,
  ): Promise<{ data: McpServerRecord[]; pagination: TokenPagination }> {
    void transaction;
    const offset = decodeOffsetPageToken(input.page_token);
    if (input.names?.length === 0) {
      return paginateOffsetRows([], input.limit, offset);
    }

    const rows = await this.#client.listMcpServers({
      accessToken: this.#accessToken,
      limit: input.limit + 1,
      offset,
      ...(input.names !== undefined ? { names: input.names } : {}),
    });
    const gatewayUrl = await this.#resolveGatewayUrl();
    const records = mapSfyMcpServers({ rows }).map(server =>
      toRecord({ tenant_id: input.tenant_id, server, gatewayUrl }),
    );
    return paginateOffsetRows(records, input.limit, offset);
  }

  async getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    void transaction;
    const row = await this.#client.getMcpServerByName({ accessToken: this.#accessToken, name: input.name });
    if (row === undefined) {
      return undefined;
    }
    const server = parseSfyMcpServerSummary(row);
    const gatewayUrl = await this.#resolveGatewayUrl();
    return toRecord({ tenant_id: input.tenant_id, server, gatewayUrl });
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    void input;
    void transaction;
    return managed();
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return managed();
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    void input;
    void transaction;
    return managed();
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return managed();
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    void params;
    void transaction;
    return managed();
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    void params;
    void transaction;
    return managed();
  }

  resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    // List stays stubbed — avoid N× SFY auth/status calls. Live status is via authorize / getAuthStatus.
    const out = new Map<string, McpAuthStatus>();
    for (const record of input.records) {
      out.set(record.name, resolveMcpAuthStatus({ manifest: record.manifest }));
    }
    return Promise.resolve(out);
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    return this.#client.getMcpAuthorize({
      accessToken: this.#accessToken,
      mcpServerId: record.id,
      redirectURL: resolveAuthorizeRedirectURL({
        ...(input.redirectURL !== undefined ? { redirectURL: input.redirectURL } : {}),
        ...(input.returnTo !== undefined ? { returnTo: input.returnTo } : {}),
      }),
    });
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    const subject = parseAccessTokenSubject(this.#accessToken);
    await this.#client.deleteMcpAuth({
      accessToken: this.#accessToken,
      mcpServerId: record.id,
      subjectId: getEffectiveUserIdFromAccessTokenSubject(subject),
      subjectType: subject.subjectType,
      authSource: 'oauth',
    });
  }

  async #resolveGatewayUrl(): Promise<string> {
    if (this.#gatewayUrl === undefined) {
      this.#gatewayUrl = resolveDefaultGatewayUrl(await this.#client.listGatewayInstallations(this.#accessToken));
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
