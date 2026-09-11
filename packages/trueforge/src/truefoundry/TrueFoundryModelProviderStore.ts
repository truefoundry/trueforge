import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import {
  flattenProviderModels,
  type CreateModelProviderInput,
  type GetModelProviderForUpdateInput,
  type GetModelProviderInput,
  type IModelProviderStore,
  type ListModelProvidersInput,
  type ModelProviderRecord,
  type UpsertModelProviderInput,
} from '../db/modelProviderStore';
import type { AvailableModel, ModelProviderManifest } from '../schemas/modelProvider';
import { accessTokenForRequest, asTrueFoundryRequestContext, type ResolveAccessToken } from './accessToken';
import { trueFoundryManaged } from './errors';
import { mapEnabledModels, resolveDefaultGatewayUrl, type TrueFoundryEnabledModel } from './mapEnabledModels';
import { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

export class TrueFoundryModelProviderStore<TTransaction = never> implements IModelProviderStore<TTransaction> {
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #forServiceFoundry: ResolveAccessToken;
  readonly #forGateway: ResolveAccessToken;

  constructor(input: {
    client: TrueFoundryServiceFoundryServerClient;
    requestContext: RequestContext;
    agent: AgentRecord | undefined;
    logger: Logger;
  }) {
    this.#client = input.client;
    const tokens = accessTokenForRequest({
      client: input.client,
      requestContext: asTrueFoundryRequestContext(input.requestContext),
      agent: input.agent,
      logger: input.logger,
    });
    this.#forServiceFoundry = tokens.forServiceFoundry;
    this.#forGateway = tokens.forGateway;
  }

  async listProviders(input: ListModelProvidersInput, transaction?: TTransaction): Promise<ModelProviderRecord[]> {
    void transaction;
    return this.#records(input);
  }

  async getProvider(
    input: GetModelProviderInput,
    transaction?: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    void transaction;
    const records = await this.#records({
      tenant_id: input.tenant_id,
      filter: { provider_account_name: input.name, name: input.model_name },
    });
    return records.find(record => record.name === input.name);
  }

  getProviderForUpdate(
    input: GetModelProviderForUpdateInput,
    transaction: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  createProvider(input: CreateModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  upsertProvider(input: UpsertModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  async listModels(input: ListModelProvidersInput, transaction?: TTransaction): Promise<AvailableModel[]> {
    return flattenProviderModels(await this.listProviders(input, transaction));
  }

  async #records(input: {
    tenant_id: string;
    filter?: { provider_account_name: string; name: string };
  }): Promise<ModelProviderRecord[]> {
    const [sfyToken, gatewayToken] = await Promise.all([this.#forServiceFoundry(), this.#forGateway()]);
    const [integrations, installations] = await Promise.all([
      this.#client.listProviderIntegrations({
        accessToken: sfyToken,
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
      }),
      this.#client.listGatewayInstallations(sfyToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return toRecords({
      tenant_id: input.tenant_id,
      gatewayUrl,
      accessToken: gatewayToken,
      models: mapEnabledModels({ integrations }),
    });
  }
}

function toRecords(input: {
  tenant_id: string;
  gatewayUrl: string;
  accessToken: string;
  models: TrueFoundryEnabledModel[];
}): ModelProviderRecord[] {
  const byAccount = new Map<string, TrueFoundryEnabledModel[]>();
  for (const model of input.models) {
    const existing = byAccount.get(model.accountName);
    if (existing === undefined) {
      byAccount.set(model.accountName, [model]);
    } else {
      existing.push(model);
    }
  }
  const now = new Date().toISOString();
  return [...byAccount.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([accountName, models]) => ({
      tenant_id: input.tenant_id,
      name: accountName,
      manifest: toManifest({ models, gatewayUrl: input.gatewayUrl, accessToken: input.accessToken }),
      created_at: now,
      updated_at: now,
    }));
}

function toManifest(input: {
  models: TrueFoundryEnabledModel[];
  gatewayUrl: string;
  accessToken: string;
}): ModelProviderManifest {
  return {
    type: 'truefoundry',
    base_url: input.gatewayUrl,
    auth: { api_key: input.accessToken },
    models: input.models.map(model => ({
      name: model.modelName,
      model_id: `${model.accountName}/${model.modelName}`,
      properties: model.properties,
    })),
  };
}
