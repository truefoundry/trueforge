import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { sql, type Transaction } from 'kysely';
import {
  type AgentRecord,
  type CreateAgentInput,
  type DeleteAgentInput,
  type GetAgentInput,
  type IAgentStore,
  type ListAgentsInput,
  type UpdateAgentInput,
} from '../db/agentStore';
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

type TrueFoundryAgentInner<TTransaction> = IAgentStore<TTransaction> & {
  withTransaction<T>(fn: (transaction: TTransaction) => Promise<T>): Promise<T>;
};

/**
 *   create:  createDB(null) → putRemote → updateDB(external_id) | on put/update fail → deleteDB (+ deleteRemote if put ok)
 *   update:  lock → get → putRemote(new) → updateDB | on DB fail → putRemote(old) | both fail → AggregateError
 *   delete:  lock → get → deleteRemote(404 ok) → deleteDB
 */
export class TrueFoundryAgentStore<
  TTransaction extends Transaction<Database> = Transaction<Database>,
> implements IAgentStore<TTransaction> {
  readonly #inner: TrueFoundryAgentInner<TTransaction>;
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;

  constructor(input: {
    inner: TrueFoundryAgentInner<TTransaction>;
    client: TrueFoundryServiceFoundryServerClient;
    accessToken: string;
  }) {
    this.#inner = input.inner;
    this.#client = input.client;
    this.#accessToken = input.accessToken;
  }

  listAgents(input: ListAgentsInput, transaction?: TTransaction): Promise<AgentRecord[]> {
    return this.#inner.listAgents(input, transaction);
  }

  getAgent(input: GetAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined> {
    return this.#inner.getAgent(input, transaction);
  }

  // Serializes updates for this tenant ID and agent id.
  // Prevents concurrent MCP writes from desyncing the remote agent.
  #withUpdateLock<T>(
    input: { tenant_id: string; id: string },
    transaction: TTransaction | undefined,
    fn: (transaction: TTransaction) => Promise<T>,
  ): Promise<T> {
    const run = async (txn: TTransaction) => {
      const key = `tf:agent:${input.tenant_id}:${input.id}`;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(txn);
      return fn(txn);
    };
    return transaction !== undefined ? run(transaction) : this.#inner.withTransaction(run);
  }

  async createAgent(input: CreateAgentInput, transaction?: TTransaction): Promise<AgentRecord> {
    // Lets the DB unique constraint pick one winner for this tenant ID and name.
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

  async updateAgent(input: UpdateAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined> {
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

  async deleteAgent(input: DeleteAgentInput, transaction?: TTransaction): Promise<void> {
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
