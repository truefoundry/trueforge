import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import type { RemoteMcpHeaders } from '@truefoundry/trueforge-core/core';
import type {
  AuthorizeMcpServerInput,
  CreateMcpServerInput,
  DeleteMcpAuthorizationInput,
  GetMcpServerInput,
  IMcpServerWithAuthStore,
  ListMcpServersInput,
  McpServerRecord,
  ResolveMcpAuthStatusesInput,
  UpsertMcpServerInput,
} from '../db/mcpServerStore';
import type { OAuthClientRecord } from '../mcp/auth/types';
import { resolveConfiguredMcpRequestHeaders, resolveMcpAuthStatus, type McpAuthStatus } from '../schemas/mcpServer';
import type { InlineMcpServers } from './inlineResources';

/**
 * Serves the MCP servers a request brought with it, and delegates everything else.
 *
 * Only the resolve paths are overlaid — by-name lookup, name-filtered list, invoke headers and
 * auth status. An unfiltered list passes straight through, so a request-scoped server never shows
 * up in the tenant's settings. Writes and OAuth delegate too: there is no row to write or
 * authorize against.
 */
export class InlineMcpServerStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #inner: IMcpServerWithAuthStore<TTransaction>;
  readonly #inline: InlineMcpServers;

  constructor(input: { inner: IMcpServerWithAuthStore<TTransaction>; inline: InlineMcpServers }) {
    this.#inner = input.inner;
    this.#inline = input.inline;
  }

  /**
   * The manifest carries its own credentials, so they go to the upstream as written — no caller
   * bearer is added and nothing is stripped. That is what lets a token rotate per request.
   */
  resolveInvokeHeaders(input: { record: McpServerRecord; userRef: string }): RemoteMcpHeaders {
    const manifest = this.#inline[input.record.name];
    if (manifest === undefined) {
      return this.#inner.resolveInvokeHeaders(input);
    }
    return resolveConfiguredMcpRequestHeaders(manifest);
  }

  async getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    const record = this.#toRecord(input.tenant_id, input.name);
    return record ?? (await this.#inner.getServer(input, transaction));
  }

  async listServers(
    input: ListMcpServersInput,
    transaction?: TTransaction,
  ): Promise<{ data: McpServerRecord[]; pagination: TokenPagination }> {
    if (input.names === undefined) {
      return this.#inner.listServers(input, transaction);
    }

    const inlineRecords = input.names
      .map(name => this.#toRecord(input.tenant_id, name))
      .filter((record): record is McpServerRecord => record !== undefined);
    const registryNames = input.names.filter(name => this.#inline[name] === undefined);

    // An `IN (...)` filter cannot return more rows than names asked for, so one unpaged read
    // gives the whole match set and the merged result can be paginated here.
    const registryRecords =
      registryNames.length > 0
        ? (
            await this.#inner.listServers(
              { ...input, names: registryNames, limit: registryNames.length, page_token: undefined },
              transaction,
            )
          ).data
        : [];

    const offset = decodeOffsetPageToken(input.page_token);
    const merged = [...inlineRecords, ...registryRecords];
    return paginateOffsetRows(merged.slice(offset, offset + input.limit + 1), input.limit, offset);
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    const inlineRecords = input.records.filter(record => this.#inline[record.name] !== undefined);
    const registryRecords = input.records.filter(record => this.#inline[record.name] === undefined);

    const statuses = new Map<string, McpAuthStatus>(
      registryRecords.length > 0 ? await this.#inner.resolveAuthStatuses({ ...input, records: registryRecords }) : [],
    );
    for (const record of inlineRecords) {
      statuses.set(record.name, resolveMcpAuthStatus({ manifest: record.manifest }));
    }
    return statuses;
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    return this.#inner.getServerForUpdate(input, transaction);
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#inner.createServer(input, transaction);
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#inner.upsertServer(input, transaction);
  }

  authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    return this.#inner.authorize(input);
  }

  deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    return this.#inner.deleteAuthorization(input);
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    return this.#inner.saveClient(params, transaction);
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    return this.#inner.getClient(params, transaction);
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    return this.#inner.deleteClient(params, transaction);
  }

  /** `id` is the name: nothing is persisted, and the name is what identifies these downstream. */
  #toRecord(tenant_id: string, name: string): McpServerRecord | undefined {
    const manifest = this.#inline[name];
    if (manifest === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    return { id: name, tenant_id, name, manifest, created_at: now, updated_at: now };
  }
}
