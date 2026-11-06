/**
 * Backend-agnostic behavioural contract for the ISandboxEnvironmentStore default slot.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import {
  SandboxEnvironmentDefaultConflictError,
  SandboxEnvironmentDisabledError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentWithVersion,
} from '../../src/db/sandboxEnvironmentStore';
import { NameSchema } from '../../src/schemas/common';
import { StoredSandboxEnvironmentManifestSchema } from '../../src/schemas/sandboxEnvironment';

const TENANT = 'default';

const SUBJECT: CreatedBySubject = {
  subject_id: 'alice',
  subject_type: 'user',
  subject_display_name: 'Alice',
};

function createEnvironment<TTransaction>(
  store: ISandboxEnvironmentStore<TTransaction>,
  name: string,
): Promise<SandboxEnvironmentWithVersion> {
  return store.createEnvironment({
    tenant_id: TENANT,
    name: NameSchema.parse(name),
    description: `${name} description`,
    created_by_subject: SUBJECT,
    synced_secrets: [],
    buildVersion: ({ existing_version }) =>
      Promise.resolve({
        version: (existing_version ?? 0) + 1,
        manifest: StoredSandboxEnvironmentManifestSchema.parse({
          name,
          type: 'daytona',
          sandbox_provider: 'daytona',
        }),
        status: 'pending',
        status_reason: null,
        external_ref: `ref-${name}`,
        created_by_subject: SUBJECT,
      }),
  });
}

export function runSandboxEnvironmentStoreContractSuite<TTransaction>(
  getStore: () => ISandboxEnvironmentStore<TTransaction>,
): void {
  it('setDefaultEnvironment moves the flag and leaves the environment definition untouched', async () => {
    const store = getStore();
    const created = await createEnvironment(store, 'first-env');
    await createEnvironment(store, 'second-env');

    const first = await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'first-env' });
    expect(first?.environment).toMatchObject({ name: 'first-env', is_default: true, enabled: true });
    expect(first?.environment.updated_at).toBe(created.environment.updated_at);

    const second = await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'second-env' });
    expect(second?.environment.is_default).toBe(true);
    expect((await store.getEnvironment({ tenant_id: TENANT, name: 'first-env' }))?.environment.is_default).toBe(false);
    expect((await store.getDefaultEnvironment({ tenant_id: TENANT }))?.environment.name).toBe('second-env');
  });

  it('setDefaultEnvironment returns undefined for an unknown name', async () => {
    const store = getStore();
    await expect(store.setDefaultEnvironment({ tenant_id: TENANT, name: 'missing-env' })).resolves.toBeUndefined();
  });

  it('disabling the default releases the slot', async () => {
    const store = getStore();
    await createEnvironment(store, 'first-env');
    await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'first-env' });

    const disabled = await store.setEnvironmentEnabled({ tenant_id: TENANT, name: 'first-env', enabled: false });
    expect(disabled?.environment).toMatchObject({ enabled: false, is_default: false });
    await expect(store.getDefaultEnvironment({ tenant_id: TENANT })).resolves.toBeUndefined();
  });

  it('setDefaultEnvironment rejects a disabled target and keeps the previous default', async () => {
    const store = getStore();
    await createEnvironment(store, 'first-env');
    await createEnvironment(store, 'second-env');
    await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'first-env' });
    await store.setEnvironmentEnabled({ tenant_id: TENANT, name: 'second-env', enabled: false });

    await expect(store.setDefaultEnvironment({ tenant_id: TENANT, name: 'second-env' })).rejects.toBeInstanceOf(
      SandboxEnvironmentDisabledError,
    );

    expect((await store.getDefaultEnvironment({ tenant_id: TENANT }))?.environment.name).toBe('first-env');
    expect((await store.getEnvironment({ tenant_id: TENANT, name: 'second-env' }))?.environment.is_default).toBe(false);
  });

  // The flag is read under the delete's own lock, so a set-default that commits after a caller's
  // pre-check cannot have its slot soft-deleted away.
  it('deleteEnvironment refuses the row holding the default slot', async () => {
    const store = getStore();
    await createEnvironment(store, 'first-env');
    await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'first-env' });

    await expect(store.deleteEnvironment({ tenant_id: TENANT, name: 'first-env' })).rejects.toBeInstanceOf(
      SandboxEnvironmentDefaultConflictError,
    );

    const kept = await store.getEnvironment({ tenant_id: TENANT, name: 'first-env' });
    expect(kept?.environment).toMatchObject({ lifecycle_stage: 'active', is_default: true });
    expect((await store.getDefaultEnvironment({ tenant_id: TENANT }))?.environment.name).toBe('first-env');
  });

  it('deleteEnvironment soft-deletes a non-default environment and leaves the default alone', async () => {
    const store = getStore();
    await createEnvironment(store, 'first-env');
    await createEnvironment(store, 'second-env');
    await store.setDefaultEnvironment({ tenant_id: TENANT, name: 'first-env' });

    await store.deleteEnvironment({ tenant_id: TENANT, name: 'second-env' });

    await expect(store.getEnvironment({ tenant_id: TENANT, name: 'second-env' })).resolves.toBeUndefined();
    expect((await store.getDefaultEnvironment({ tenant_id: TENANT }))?.environment.name).toBe('first-env');
  });
}
