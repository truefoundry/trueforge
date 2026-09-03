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

function managed(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

/** Absolute post-consent redirect for SFY authorize; prefers explicit URL, else PUBLIC_BASE_URL + return_to. */
function resolveAuthorizeRedirectURL(input: { redirectURL?: string; returnTo?: string }): string {
  if (input.redirectURL !== undefined && input.redirectURL.length > 0) {
    return input.redirectURL;
  }
  return new URL(safeReturnTo(input.returnTo), getPublicBaseUrl()).href;
}

/**
 * Read-only MCP registry backed by ServiceFoundry + the tenant AI Gateway.
 * Writes and local OAuth client columns are not supported — configure servers in TrueFoundry.
 * Authorize / revoke call SFY; list auth_status stays stubbed (no N× status calls).
 */
export class TrueFoundryMcpServerStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;

  constructor(input: { client: TrueFoundryServiceFoundryServerClient; accessToken: string }) {
    this.#client = input.client;
    this.#accessToken = input.accessToken;
  }

  resolveInvokeHeaders(record: McpServerRecord): Record<string, string> {
    void record;
    return { Authorization: `Bearer ${this.#accessToken}` };
  }

  async listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]> {
    void transaction;
    if (input.names?.length === 0) {
      return [];
    }
    const records = await this.#records(input.tenant_id);
    if (input.names === undefined) {
      return records;
    }
    const wanted = new Set(input.names);
    return records.filter(record => wanted.has(record.name));
  }

  async getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    void transaction;
    const row = await this.#client.getMcpServerByName({ accessToken: this.#accessToken, name: input.name });
    if (row === undefined) {
      return undefined;
    }
    const server = parseSfyMcpServerSummary(row);
    const gatewayUrl = resolveDefaultGatewayUrl(await this.#client.listGatewayInstallations(this.#accessToken));
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

  async #records(tenant_id: string): Promise<McpServerRecord[]> {
    const [rows, installations] = await Promise.all([
      this.#client.listMcpServers(this.#accessToken),
      this.#client.listGatewayInstallations(this.#accessToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return mapSfyMcpServers({ rows }).map(server => toRecord({ tenant_id, server, gatewayUrl }));
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
