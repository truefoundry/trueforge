import {
  AgentNameConflictError,
  type AgentRecord,
  type CreateAgentInput,
  type DeleteAgentInput,
  type GetAgentInput,
  type IAgentStore,
  type UpdateAgentInput,
} from '../db/agentStore';
import { toPutRemoteAgentPayload } from './toPutRemoteAgentPayload';
import { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 *   create:  getByName → putRemote → createDB(external_id) | on non-conflict DB fail → deleteRemote
 *   update:  putRemote(new) → updateDB | on DB fail → putRemote(old) | both fail → AggregateError
 *   delete:  deleteRemote(404 ok) → deleteDB
 */
export class TrueFoundryAgentStore<TTransaction = never> implements IAgentStore<TTransaction> {
  readonly #inner: IAgentStore<TTransaction>;
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;

  constructor(input: {
    inner: IAgentStore<TTransaction>;
    client: TrueFoundryServiceFoundryServerClient;
    accessToken: string;
  }) {
    this.#inner = input.inner;
    this.#client = input.client;
    this.#accessToken = input.accessToken;
  }

  listAgents(tenantId: string, transaction?: TTransaction): Promise<AgentRecord[]> {
    return this.#inner.listAgents(tenantId, transaction);
  }

  getAgent(input: GetAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined> {
    return this.#inner.getAgent(input, transaction);
  }

  async createAgent(input: CreateAgentInput, transaction?: TTransaction): Promise<AgentRecord> {
    // SF PUT upserts by name — skip if local name exists (avoids overwrite/delete of e.g. research→sf-1).
    const existing = await this.#inner.getAgent({ tenant_id: input.tenant_id, name: input.name }, transaction);
    if (existing !== undefined) {
      throw new AgentNameConflictError({ tenant_id: input.tenant_id, name: input.name });
    }

    const { remoteAgentId } = await this.#client.putRemoteAgent({
      accessToken: this.#accessToken,
      ...toPutRemoteAgentPayload({ name: input.name, manifest: input.manifest }),
    });
    try {
      return await this.#inner.createAgent({ ...input, external_id: remoteAgentId }, transaction);
    } catch (error) {
      // Race: peer create won the name and owns this remote (1:1) — do not delete it.
      if (!(error instanceof AgentNameConflictError)) {
        try {
          await this.#client.deleteRemoteAgent({ accessToken: this.#accessToken, remoteAgentId });
        } catch (cleanupError) {
          throw new AggregateError(
            [asError(error), asError(cleanupError)],
            'createAgent failed and ServiceFoundry cleanup also failed',
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
  }

  async updateAgent(input: UpdateAgentInput, transaction?: TTransaction): Promise<AgentRecord | undefined> {
    if (input.manifest === undefined) {
      return this.#inner.updateAgent(input, transaction);
    }

    const previous = await this.#inner.getAgent({ tenant_id: input.tenant_id, id: input.id }, transaction);
    if (previous === undefined) {
      return undefined;
    }

    const { remoteAgentId } = await this.#client.putRemoteAgent({
      accessToken: this.#accessToken,
      ...toPutRemoteAgentPayload({ name: previous.name, manifest: input.manifest }),
    });

    try {
      return await this.#inner.updateAgent(
        {
          tenant_id: input.tenant_id,
          id: input.id,
          manifest: input.manifest,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          ...(remoteAgentId === previous.external_id ? {} : { external_id: remoteAgentId }),
        },
        transaction,
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
  }

  async deleteAgent(input: DeleteAgentInput, transaction?: TTransaction): Promise<void> {
    const previous = await this.#inner.getAgent({ tenant_id: input.tenant_id, id: input.id }, transaction);
    if (previous?.external_id) {
      await this.#client.deleteRemoteAgent({
        accessToken: this.#accessToken,
        remoteAgentId: previous.external_id,
      });
    }
    await this.#inner.deleteAgent(input, transaction);
  }
}
