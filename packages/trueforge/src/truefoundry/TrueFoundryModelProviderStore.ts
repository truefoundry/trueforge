import { HTTPException } from 'hono/http-exception';
import {
  flattenProviderModels,
  type CreateModelProviderInput,
  type GetModelProviderInput,
  type IModelProviderStore,
  type ListModelProvidersInput,
  type ModelProviderRecord,
  type UpsertModelProviderInput,
} from '../db/modelProviderStore';
import type { AvailableModel, ModelProviderManifest } from '../schemas/modelProvider';
import { mapEnabledModels, resolveDefaultGatewayUrl, type TrueFoundryEnabledModel } from './mapEnabledModels';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from './trueFoundryManaged';
import { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

function managed(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

export class TrueFoundryModelProviderStore<TTransaction = never> implements IModelProviderStore<TTransaction> {
  readonly #client: TrueFoundryServiceFoundryServerClient;
  readonly #accessToken: string;

  constructor(input: { client: TrueFoundryServiceFoundryServerClient; accessToken: string }) {
    this.#client = input.client;
    this.#accessToken = input.accessToken;
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
    const records = await this.#records(input);
    return records.find(record => record.name === input.name);
  }

  getProviderForUpdate(
    input: GetModelProviderInput,
    transaction: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    void input;
    void transaction;
    return managed();
  }

  createProvider(input: CreateModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    void input;
    void transaction;
    return managed();
  }

  upsertProvider(input: UpsertModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    void input;
    void transaction;
    return managed();
  }

  async listModels(input: ListModelProvidersInput, transaction?: TTransaction): Promise<AvailableModel[]> {
    return flattenProviderModels(await this.listProviders(input, transaction));
  }

  async #records(input: { tenant_id: string }): Promise<ModelProviderRecord[]> {
    const [integrations, installations] = await Promise.all([
      this.#client.listProviderIntegrations(this.#accessToken),
      this.#client.listGatewayInstallations(this.#accessToken),
    ]);
    const gatewayUrl = resolveDefaultGatewayUrl(installations);
    return toRecords({
      tenant_id: input.tenant_id,
      gatewayUrl,
      accessToken: this.#accessToken,
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
