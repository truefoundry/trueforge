import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  type AgentExternalIdRow,
  type AgentRecord,
  type CreateAgentInput,
  type DeleteAgentInput,
  type GetAgentInput,
  type GetExternalIdsByIdsInput,
  type GetOwnedIdsInput,
  type IAgentStore,
  type ListAgentsInput,
  type UpdateAgentInput,
} from '../db/agentStore';
import { PostgresAgentStore } from '../db/postgres/agent-store/PostgresAgentStore';
import type { Database } from '../db/postgres/types';
import {
  TrueFoundryServiceFoundryServerClient,
  type PutRemoteAgentInput,
} from './TrueFoundryServiceFoundryServerClient';

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function toPutRemoteAgentPayload({
  name,
  manifest,
}: {
  name: string;
  manifest: AgentSpec;
}): Omit<PutRemoteAgentInput, 'accessToken'> {
  return {
    name,
    description: manifest.instructions ?? name,
    model: manifest.model.name,
    mcp_servers: (manifest.mcp_servers ?? []).map(server => server.name),
  };
}

/**
 * Postgres agent store that keeps a matching ServiceFoundry remote agent in sync.
 *
 * DB and ServiceFoundry are not one atomic transaction. Cleanup on failure is
 * best-effort: a delete/restore step can itself fail, leaving temporary SF↔DB skew
 * (orphan remote, orphan local row, or mismatched manifest). create / update /
 * delete stay retryable — a later successful call is expected to recover.
 *
 * create
 *   Happy path: insert local row (external_id null) → put remote → set external_id.
 *   Name clash on insert: throw; no remote call.
 *   putRemote fails: delete local row; rethrow.
 *   update(external_id) fails after put: delete remote (if put returned an id), then
 *   delete local; if cleanup also fails, AggregateError (primary + cleanup errors).
 *
 * update (manifest)
 *   Happy path: lock → load row → put remote (new manifest) → write local.
 *   Missing row: return undefined (no remote call).
 *   putRemote fails: leave local unchanged; rethrow.
 *   local write fails after put: best-effort putRemote(old manifest); if restore fails,
 *   AggregateError; if restore ok, rethrow the DB error (local still old, remote restored).
 *   external_id-only patches skip ServiceFoundry and go straight to the inner store.
 *
 * delete
 *   Happy path: lock → load row → delete remote when external_id is set → delete local.
 *   Missing row or null external_id: skip remote; still delete local (idempotent).
 *   remote delete fails: do not delete local; rethrow (local kept so retry can finish).
 */
export class TrueFoundryAgentStore implements IAgentStore<Transaction<Database>> {
  readonly #inner: PostgresAgentStore;
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;
  readonly #db: Kysely<Database>;

  constructor(input: {
    inner: PostgresAgentStore;
    client: TrueFoundryServiceFoundryServerClient;
    accessToken: string;
    db: Kysely<Database>;
  }) {
    this.#inner = input.inner;
    this.#client = input.client;
    this.#accessToken = input.accessToken;
    this.#db = input.db;
  }

  listAgents(input: ListAgentsInput, transaction?: Transaction<Database>): Promise<AgentRecord[]> {
    return this.#inner.listAgents(input, transaction);
  }

  getOwnedIds(input: GetOwnedIdsInput, transaction?: Transaction<Database>): Promise<readonly string[]> {
    return this.#inner.getOwnedIds(input, transaction);
  }

  getExternalIdsByIds(
    input: GetExternalIdsByIdsInput,
    transaction?: Transaction<Database>,
  ): Promise<readonly AgentExternalIdRow[]> {
    return this.#inner.getExternalIdsByIds(input, transaction);
  }

  getAgent(input: GetAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    return this.#inner.getAgent(input, transaction);
  }

  // Takes a Postgres transaction advisory lock for this tenant + agent id so concurrent
  // update/delete cannot desync ServiceFoundry MCP grants. The lock only lasts for the
  // lifetime of a DB transaction: if the caller passed one, use it; otherwise open a
  // short transaction on db just for this critical section.
  #withUpdateLock<T>(
    input: { tenant_id: string; id: string },
    transaction: Transaction<Database> | undefined,
    fn: (transaction: Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    const run = async (txn: Transaction<Database>) => {
      const key = `tf:agent:${input.tenant_id}:${input.id}`;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(txn);
      return fn(txn);
    };
    return transaction !== undefined ? run(transaction) : this.#db.transaction().execute(run);
  }

  async createAgent(input: CreateAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord> {
    // Unique (tenant_id, name) picks one winner even when transaction is omitted (auto-commit inserts).
    // Prevents concurrent requests from both creating the same remote agent.
    const created = await this.#inner.createAgent({ ...input, external_id: null }, transaction);

    let externalId: string | undefined;
    try {
      ({ externalId } = await this.#client.putRemoteAgent({
        accessToken: this.#accessToken,
        ...toPutRemoteAgentPayload({ name: input.name, manifest: input.manifest }),
      }));
      const updated = await this.#inner.updateAgent(
        { tenant_id: input.tenant_id, id: created.id, external_id: externalId },
        transaction,
      );
      if (updated === undefined) {
        throw new Error(`Internal error: createAgent lost the row after insert: ${created.id}`);
      }
      return updated;
    } catch (error) {
      const failures = [asError(error)];
      if (externalId !== undefined) {
        try {
          await this.#client.deleteRemoteAgent({ accessToken: this.#accessToken, externalId });
        } catch (cleanupError) {
          failures.push(asError(cleanupError));
        }
      }
      try {
        await this.#inner.deleteAgent({ tenant_id: input.tenant_id, id: created.id }, transaction);
      } catch (cleanupError) {
        failures.push(asError(cleanupError));
      }
      if (failures.length > 1) {
        throw new AggregateError(failures, 'createAgent failed and cleanup also failed', { cause: error });
      }
      throw error;
    }
  }

  async updateAgent(input: UpdateAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    const nextManifest = input.manifest;
    if (nextManifest === undefined) {
      // No manifest means only `external_id` changed; pass through to the inner store.
      return this.#inner.updateAgent(input, transaction);
    }

    return this.#withUpdateLock(input, transaction, async txn => {
      const previous = await this.#inner.getAgent({ tenant_id: input.tenant_id, id: input.id }, txn);
      if (previous === undefined) {
        return undefined;
      }

      const { externalId } = await this.#client.putRemoteAgent({
        accessToken: this.#accessToken,
        ...toPutRemoteAgentPayload({ name: previous.name, manifest: nextManifest }),
      });

      try {
        return await this.#inner.updateAgent(
          {
            tenant_id: input.tenant_id,
            id: input.id,
            manifest: nextManifest,
            ...(externalId === previous.external_id ? {} : { external_id: externalId }),
          },
          txn,
        );
      } catch (error) {
        try {
          await this.#client.putRemoteAgent({
            accessToken: this.#accessToken,
            ...toPutRemoteAgentPayload({ name: previous.name, manifest: previous.manifest }),
          });
        } catch (restoreError) {
          throw new AggregateError(
            [asError(error), asError(restoreError)],
            'updateAgent failed and ServiceFoundry restore also failed',
            { cause: restoreError },
          );
        }
        throw error;
      }
    });
  }

  async deleteAgent(input: DeleteAgentInput, transaction?: Transaction<Database>): Promise<void> {
    return this.#withUpdateLock(input, transaction, async txn => {
      const previous = await this.#inner.getAgent({ tenant_id: input.tenant_id, id: input.id }, txn);
      if (previous?.external_id) {
        await this.#client.deleteRemoteAgent({
          accessToken: this.#accessToken,
          externalId: previous.external_id,
        });
      }
      await this.#inner.deleteAgent(input, txn);
    });
  }
}
