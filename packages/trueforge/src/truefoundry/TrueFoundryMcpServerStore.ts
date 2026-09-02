import { HTTPException } from 'hono/http-exception';
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

function managed(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

/**
 * Read-only MCP registry backed by ServiceFoundry + the tenant AI Gateway.
 * Writes and local OAuth client columns are not supported — configure servers in TrueFoundry.
 * Connect UX auth methods are stubbed for v1 (live SFY authorize is a follow-up).
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
    const out = new Map<string, McpAuthStatus>();
    for (const record of input.records) {
      out.set(record.name, resolveMcpAuthStatus({ manifest: record.manifest }));
    }
    return Promise.resolve(out);
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    void input.redirectURL;
    void input.returnTo;
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    // TODO: Replace stub with live ServiceFoundry authorize / Connect when wired.
    return resolveMcpAuthStatus({ manifest: record.manifest });
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    void input.userRef;
    const record = await this.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    // No local token store for TrueFoundry-managed MCP (v1).
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
