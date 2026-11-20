import configuration, { isTrueFoundryModeEnabled, type DistributedServerConfiguration } from '../config';
import type { IMemoryProviderStore, MemoryProviderRecord, UpsertMemoryProviderInput } from '../db/memoryProviderStore';
import type { MemoryProviderManifest } from '../schemas/memoryProvider';
import { trueFoundryManaged } from './errors';
import { resolveTrueFoundryMemoryProviderConfig } from './resolveTrueFoundryMemoryProviderConfig';

export type TrueFoundryMemoryEnv = Pick<
  DistributedServerConfiguration,
  | 'TRUEFOUNDRY_MEMORY_ENABLED'
  | 'TRUEFOUNDRY_MEMORY_PROVIDER'
  | 'TRUEFOUNDRY_MEMORY_API_KEY'
  | 'TRUEFOUNDRY_MEMORY_SERVER_URL'
  | 'TRUEFOUNDRY_MEMORY_SETTINGS'
  | 'TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST'
>;

/** The platform's provider, for tenants `TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST` admits (all when it is empty). */
export class TrueFoundryMemoryProviderStore<TTransaction = never> implements IMemoryProviderStore<TTransaction> {
  readonly #manifest: MemoryProviderManifest | undefined;
  readonly #allowlist: ReadonlySet<string>;

  constructor(
    env: TrueFoundryMemoryEnv | undefined = isTrueFoundryModeEnabled(configuration) ? configuration : undefined,
  ) {
    const resolved = env === undefined ? undefined : resolveTrueFoundryMemoryProviderConfig(env);
    this.#manifest =
      resolved === undefined
        ? undefined
        : { type: resolved.type, server_url: resolved.serverUrl, auth: { api_key: resolved.apiKey } };
    this.#allowlist = new Set(env?.TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST);
  }

  getProvider(tenantId: string, transaction?: TTransaction): Promise<MemoryProviderRecord | undefined> {
    void transaction;
    if (this.#manifest === undefined || (this.#allowlist.size > 0 && !this.#allowlist.has(tenantId))) {
      return Promise.resolve(undefined);
    }
    const now = new Date().toISOString();
    return Promise.resolve({ tenant_id: tenantId, manifest: this.#manifest, created_at: now, updated_at: now });
  }

  upsertProvider(input: UpsertMemoryProviderInput, transaction?: TTransaction): Promise<MemoryProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }
}
