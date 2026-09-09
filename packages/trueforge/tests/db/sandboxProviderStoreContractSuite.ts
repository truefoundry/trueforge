/**
 * Backend-agnostic behavioural contract for ISandboxProviderStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { ISandboxProviderStore, UpsertSandboxProviderInput } from '../../src/db/sandboxProviderStore';
import type { SandboxBuildMetadata, SandboxProviderManifest } from '../../src/schemas/sandboxProvider';

const TENANT = 'default';

const BUILD_METADATA: SandboxBuildMetadata = {
  build_ref: 'trueforge-build-029ea5ff',
  image_uri: 'tfy.jfrog.io/tfy-images/sandbox:029ea5ff',
};

function manifest(overrides: Partial<SandboxProviderManifest> = {}): SandboxProviderManifest {
  return {
    type: 'daytona',
    auth: { api_key: 'dtn-test' },
    exec_timeout_ms: 60000,
    auto_stop_interval_in_minutes: 5,
    auto_archive_interval_in_minutes: 60,
    auto_delete_interval_in_minutes: 7200,
    ...overrides,
  };
}

function upsertInput(overrides: Partial<UpsertSandboxProviderInput> = {}): UpsertSandboxProviderInput {
  return {
    tenant_id: TENANT,
    manifest: manifest(),
    status: 'pending',
    status_reason: 'Sandbox image build started.',
    build_metadata: BUILD_METADATA,
    ...overrides,
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runSandboxProviderStoreContractSuite(getStore: () => ISandboxProviderStore): void {
  it('upsert creates a provider and round-trips the manifest + build status', async () => {
    const store = getStore();
    const created = await store.upsertSandboxProvider(upsertInput());

    expect(created.tenant_id).toBe(TENANT);
    expect(created.manifest).toEqual(manifest());
    expect(created.status).toBe('pending');
    expect(created.status_reason).toBe('Sandbox image build started.');
    expect(created.build_metadata).toEqual(BUILD_METADATA);
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
    const created = await store.upsertSandboxProvider(upsertInput());

    const replacement = manifest({
      exec_timeout_ms: 120000,
    });
    const updated = await store.upsertSandboxProvider(upsertInput({ manifest: replacement }));

    expect(updated.manifest).toEqual(replacement);
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
  });

  it('upsert is scoped to a single tenant', async () => {
    const store = getStore();
    await store.upsertSandboxProvider(upsertInput());
    await store.upsertSandboxProvider(
      upsertInput({ tenant_id: 'other-tenant', manifest: manifest({ exec_timeout_ms: 120000 }) }),
    );

    const forDefault = await store.getSandboxProvider(TENANT);
    const forOther = await store.getSandboxProvider('other-tenant');
    expect(forDefault?.manifest.exec_timeout_ms).toBe(60000);
    expect(forOther?.manifest.exec_timeout_ms).toBe(120000);
  });

  it('updateSandboxStatus refreshes only the build status, keeping the manifest', async () => {
    const store = getStore();
    const created = await store.upsertSandboxProvider(upsertInput());

    const updated = await store.updateSandboxStatus({
      tenant_id: TENANT,
      status: 'ready',
      status_reason: null,
      build_metadata: BUILD_METADATA,
    });

    expect(updated?.status).toBe('ready');
    expect(updated?.status_reason).toBeNull();
    expect(updated?.manifest).toEqual(created.manifest);
  });

  it('updateSandboxStatus returns undefined when no provider exists', async () => {
    const store = getStore();
    expect(
      await store.updateSandboxStatus({
        tenant_id: TENANT,
        status: 'ready',
        status_reason: null,
        build_metadata: BUILD_METADATA,
      }),
    ).toBeUndefined();
  });
}
