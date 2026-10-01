import type {
  CreateModelProviderInput,
  GetModelProviderForUpdateInput,
  GetModelProviderInput,
  IModelProviderStore,
  ListModelProvidersInput,
  ModelProviderRecord,
  UpsertModelProviderInput,
} from '../db/modelProviderStore';
import type { TurnMetadata } from '../db/turnMetadata';
import type { AvailableModel } from '../schemas/modelProvider';
import { gatewayMetadataHeadersForTurn } from './gatewayMetadata';
import type { InlineModelProviders } from './inlineResources';

/**
 * Serves the model providers a request brought with it, and delegates everything else.
 *
 * Only the by-name lookup a `provider/model` reference goes through is overlaid, plus its invoke
 * headers. Unfiltered lists pass straight through, so a request-scoped provider never shows up in
 * the tenant's settings or model picker. Writes delegate: there is no row to write.
 */
export class InlineModelProviderStore<TTransaction = never> implements IModelProviderStore<TTransaction> {
  readonly #inner: IModelProviderStore<TTransaction>;
  readonly #inline: InlineModelProviders;

  constructor(input: { inner: IModelProviderStore<TTransaction>; inline: InlineModelProviders }) {
    this.#inner = input.inner;
    this.#inline = input.inline;
  }

  listProviders(input: ListModelProvidersInput, transaction?: TTransaction): Promise<ModelProviderRecord[]> {
    return this.#inner.listProviders(input, transaction);
  }

  async getProvider(
    input: GetModelProviderInput,
    transaction?: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    const record = this.#toRecord({ tenant_id: input.tenant_id, name: input.name });
    return record ?? (await this.#inner.getProvider(input, transaction));
  }

  getProviderForUpdate(
    input: GetModelProviderForUpdateInput,
    transaction: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    return this.#inner.getProviderForUpdate(input, transaction);
  }

  createProvider(input: CreateModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    return this.#inner.createProvider(input, transaction);
  }

  upsertProvider(input: UpsertModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord> {
    return this.#inner.upsertProvider(input, transaction);
  }

  listModels(input: ListModelProvidersInput, transaction?: TTransaction): Promise<AvailableModel[]> {
    return this.#inner.listModels(input, transaction);
  }

  /**
   * The manifest carries its own `api_key`, which the adapter sends as the bearer, so no caller
   * token is resolved here. Mid-turn, still stamp `x-tfy-metadata` the same way registry
   * TrueFoundry invokes do.
   */
  resolveInvokeHeaders(input: {
    record: ModelProviderRecord;
    turnMetadata?: TurnMetadata;
  }): Promise<Record<string, string>> {
    if (this.#inline[input.record.name] === undefined) {
      return this.#inner.resolveInvokeHeaders(input);
    }
    return Promise.resolve(gatewayMetadataHeadersForTurn(input.turnMetadata));
  }

  #toRecord(input: { tenant_id: string; name: string }): ModelProviderRecord | undefined {
    const manifest = this.#inline[input.name];
    if (manifest === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    return {
      tenant_id: input.tenant_id,
      name: input.name,
      manifest,
      created_at: now,
      updated_at: now,
    };
  }
}
