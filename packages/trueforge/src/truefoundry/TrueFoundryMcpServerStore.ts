import { HTTPException } from 'hono/http-exception';
import {
  type CreateMcpServerInput,
  type GetMcpServerInput,
  type IMcpServerStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type UpsertMcpServerInput,
} from '../db/mcpServerStore';
import type { OAuthClientRecord } from '../mcp/auth/types';
import type { McpServerManifest } from '../schemas/mcpServer';
import { resolveDefaultGatewayUrl } from './mapEnabledModels';
import {
  mapSfyMcpServers,
  parseSfyMcpServerSummary,
  resolveMcpProxyUrl,
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
 */
export class TrueFoundryMcpServerStore<TTransaction = never> implements IMcpServerStore<TTransaction> {
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;

  constructor(input: { client: TrueFoundryServiceFoundryServerClient; accessToken: string }) {
    this.#client = input.client;
    this.#accessToken = input.accessToken;
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
    if (server.name !== input.name) {
      return undefined;
    }
    const gatewayUrl = resolveDefaultGatewayUrl(await this.#client.listGatewayInstallations(this.#accessToken));
    return toRecord({
      tenant_id: input.tenant_id,
      server,
      gatewayUrl,
      accessToken: this.#accessToken,
    });
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

  async #records(tenant_id: string): Promise<McpServerRecord[]> {
    const [rows, installations] = await Promise.all([
      this.#client.listMcpServers(this.#accessToken),
      this.#client.listGatewayInstallations(this.#accessToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return mapSfyMcpServers({ rows })
      .map(server => toRecord({ tenant_id, server, gatewayUrl, accessToken: this.#accessToken }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function toRecord(input: {
  tenant_id: string;
  server: SfyMcpServerSummary;
  gatewayUrl: string;
  accessToken: string;
}): McpServerRecord {
  return {
    id: input.server.id,
    tenant_id: input.tenant_id,
    name: input.server.name,
    manifest: toManifest({
      server: input.server,
      gatewayUrl: input.gatewayUrl,
      accessToken: input.accessToken,
    }),
    created_at: input.server.createdAt,
    updated_at: input.server.updatedAt,
  };
}

/**
 * Gateway proxy as `url`. Caller Bearer is attached as header auth on the in-memory
 * manifest (same pattern as TrueFoundry model providers' `auth.api_key`) so invoke
 * paths stay token-free. Never local DCR — SFY Connect UX is stubbed via auth_status.
 */
function toManifest(input: {
  server: SfyMcpServerSummary;
  gatewayUrl: string;
  accessToken: string;
}): McpServerManifest {
  return {
    type: 'truefoundry',
    name: input.server.name,
    url: resolveMcpProxyUrl({ proxyUrl: input.server.proxyUrl, gatewayBaseURL: input.gatewayUrl }),
    description: input.server.description,
    auth: {
      type: 'header',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  };
}
