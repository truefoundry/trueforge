/**
 * Backend-agnostic behavioural contract for ISandboxProviderStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { ISandboxProviderStore } from '../../src/db/sandboxProviderStore';
import type { SandboxProviderManifest } from '../../src/schemas/sandboxProvider';

const TENANT = 'default';

function manifest(overrides: Partial<SandboxProviderManifest> = {}): SandboxProviderManifest {
  return {
    type: 'daytona',
    snapshot_name: 'trueforge-sandbox-image',
    auth: { api_key: 'dtn-test' },
    exec_timeout_ms: 60000,
    auto_stop_interval_in_minutes: 5,
    auto_archive_interval_in_minutes: 60,
    auto_delete_interval_in_minutes: 7200,
    ...overrides,
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runSandboxProviderStoreContractSuite(getStore: () => ISandboxProviderStore): void {
  it('upsert creates a provider and round-trips the manifest', async () => {
    const store = getStore();
    const created = await store.upsertSandboxProvider({
      tenant_id: TENANT,
      manifest: manifest(),
    });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.manifest).toEqual(manifest());
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const fetched = await store.getSandboxProvider(TENANT);
    expect(fetched).toEqual(created);
  });

  it('getSandboxProvider returns undefined when none configured', async () => {
    const store = getStore();
    expect(await store.getSandboxProvider(TENANT)).toBeUndefined();
  });

  it('upsert replaces the whole manifest and preserves created_at', async () => {
    const store = getStore();
    const created = await store.upsertSandboxProvider({
      tenant_id: TENANT,
      manifest: manifest(),
    });

    const replacement = manifest({
      snapshot_name: 'other-snapshot',
      exec_timeout_ms: 120000,
    });
    const updated = await store.upsertSandboxProvider({
      tenant_id: TENANT,
      manifest: replacement,
    });

    expect(updated.manifest).toEqual(replacement);
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
  });

  it('upsert is scoped to a single tenant', async () => {
    const store = getStore();
    await store.upsertSandboxProvider({ tenant_id: TENANT, manifest: manifest() });
    await store.upsertSandboxProvider({
      tenant_id: 'other-tenant',
      manifest: manifest({ snapshot_name: 'other-tenant-snapshot' }),
    });

    const forDefault = await store.getSandboxProvider(TENANT);
    const forOther = await store.getSandboxProvider('other-tenant');
    expect(forDefault?.manifest.snapshot_name).toBe('trueforge-sandbox-image');
    expect(forOther?.manifest.snapshot_name).toBe('other-tenant-snapshot');
  });
}
