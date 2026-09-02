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

  async #records(tenant_id: string): Promise<McpServerRecord[]> {
    const [rows, installations] = await Promise.all([
      this.#client.listMcpServers(this.#accessToken),
      this.#client.listGatewayInstallations(this.#accessToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return mapSfyMcpServers({ rows })
      .map(server => toRecord({ tenant_id, server, gatewayUrl }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function toRecord(input: { tenant_id: string; server: SfyMcpServerSummary; gatewayUrl: string }): McpServerRecord {
  return {
    id: input.server.id,
    tenant_id: input.tenant_id,
    name: input.server.name,
    manifest: toManifest(input.server, input.gatewayUrl),
    created_at: input.server.createdAt,
    updated_at: input.server.updatedAt,
  };
}

/**
 * Gateway proxy as `url`. SFY `oauth2` → wire `dcr` for Connect UX only (UI keys off auth type).
 * Invoke Bearer is intentionally not embedded as `header` auth — that breaks the UI and is a follow-up PR.
 */
function toManifest(server: SfyMcpServerSummary, gatewayUrl: string): McpServerManifest {
  return {
    type: 'truefoundry',
    name: server.name,
    url: resolveMcpProxyUrl({ proxyUrl: server.proxyUrl, gatewayBaseURL: gatewayUrl }),
    description: server.description,
    ...(server.authType === 'oauth2' ? { auth: { type: 'dcr' as const } } : {}),
  };
}
