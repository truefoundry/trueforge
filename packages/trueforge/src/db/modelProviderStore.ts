/**
 * Configured model providers: identity columns plus the Zod-validated
 * `ModelProviderManifest` document. Implementations: Postgres, Sqlite, and
 * TrueFoundry (read-only ServiceFoundry server listing).
 */
import type { ResourceName } from '../schemas/common';
import type { AvailableModel, ModelProviderManifest } from '../schemas/modelProvider';

export interface ModelProviderRecord {
  tenant_id: string;
  name: ResourceName;
  manifest: ModelProviderManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ListModelProvidersInput {
  tenant_id: string;
}

export interface GetModelProviderInput {
  tenant_id: string;
  name: string;
}

export interface CreateModelProviderInput {
  tenant_id: string;
  /** Derived from the document by `modelProviderName`, never chosen by the caller. */
  name: ResourceName;
  manifest: ModelProviderManifest;
}

/** Same shape as create for now; kept as a distinct name for the upsert path. */
export type UpsertModelProviderInput = CreateModelProviderInput;

/** Unique `(tenant_id, name)` violation on create. */
export class ModelProviderNameConflictError extends Error {
  readonly tenant_id: string;
  readonly provider_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Model provider name already exists: ${name}`, options);
    this.name = 'ModelProviderNameConflictError';
    this.tenant_id = tenant_id;
    this.provider_name = name;
  }
}

export interface IModelProviderStore<TTransaction = never> {
  listProviders(input: ListModelProvidersInput, transaction?: TTransaction): Promise<ModelProviderRecord[]>;
  getProvider(input: GetModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord | undefined>;
  /**
   * Load one provider while holding a row lock for the lifetime of `transaction`.
   * Postgres: `SELECT … FOR UPDATE`. SQLite: plain read under a write txn (BEGIN IMMEDIATE).
   * Required before read-modify-write of secrets so concurrent keep/rotate cannot interleave.
   */
  getProviderForUpdate(
    input: GetModelProviderInput,
    transaction: TTransaction,
  ): Promise<ModelProviderRecord | undefined>;
  /** Inserts a new provider. Throws ModelProviderNameConflictError on name clash. */
  createProvider(input: CreateModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord>;
  /** Single-row write: creates the provider or replaces the whole manifest (models included). */
  upsertProvider(input: UpsertModelProviderInput, transaction?: TTransaction): Promise<ModelProviderRecord>;
  /** Flattens manifests into the FQN read view for GET /models. */
  listModels(input: ListModelProvidersInput, transaction?: TTransaction): Promise<AvailableModel[]>;
}

/** Application-side flatten shared by both store implementations. */
export function flattenProviderModels(records: ModelProviderRecord[]): AvailableModel[] {
  return records.flatMap(record =>
    record.manifest.models.map(model => ({
      name: `${record.name}/${model.name}`,
      model_id: model.model_id,
      provider: { name: record.name },
      properties: model.properties,
    })),
  );
}
