import type { ISandboxEnvironmentStore } from '../../../src/db/sandboxEnvironmentStore';
import { ensureDefaultSandboxEnvironment } from '../../../src/sandbox/ensureDefaultSandboxEnvironment';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../../../src/schemas/sandboxEnvironment';

const SUBJECT = {
  subject_id: 'user-1',
  subject_type: 'user' as const,
  subject_display_name: 'User',
};

describe('ensureDefaultSandboxEnvironment', () => {
  it('returns existing default when present and resetPending is false', async () => {
    const existing = {
      environment: { id: 'env-1', name: DEFAULT_SANDBOX_ENVIRONMENT_NAME },
      version: { id: 'v1', status: 'ready' },
    };
    const store = {
      getEnvironment: jest.fn().mockResolvedValue(existing),
      upsertEnvironment: jest.fn(),
    };

    const result = await ensureDefaultSandboxEnvironment({
      store: store as unknown as ISandboxEnvironmentStore,
      tenant_id: 'tenant-1',
      created_by_subject: SUBJECT,
      provider_type: 'daytona',
      resetPending: false,
    });

    expect(result).toBe(existing);
    expect(store.upsertEnvironment).not.toHaveBeenCalled();
  });

  it('upserts a pending default version when missing', async () => {
    const created = {
      environment: { id: 'env-new', name: DEFAULT_SANDBOX_ENVIRONMENT_NAME },
      version: { id: 'v2', status: 'pending' },
    };
    const store = {
      getEnvironment: jest.fn().mockResolvedValue(undefined),
      upsertEnvironment: jest.fn().mockResolvedValue(created),
    };

    const result = await ensureDefaultSandboxEnvironment({
      store: store as unknown as ISandboxEnvironmentStore,
      tenant_id: 'tenant-1',
      created_by_subject: SUBJECT,
      provider_type: 'daytona',
      resetPending: false,
    });

    expect(result).toBe(created);
    expect(store.upsertEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        name: DEFAULT_SANDBOX_ENVIRONMENT_NAME,
        created_by_subject: SUBJECT,
        buildVersion: expect.any(Function),
      }),
      undefined,
    );
    const buildVersion = store.upsertEnvironment.mock.calls[0]?.[0].buildVersion as (previous?: {
      latest_version: number;
    }) => { status: string; version: number };
    expect(buildVersion(undefined)).toMatchObject({ status: 'pending', version: 1 });
    expect(buildVersion({ latest_version: 3 })).toMatchObject({ status: 'pending', version: 4 });
  });

  it('upserts again when resetPending is true even if default exists', async () => {
    const store = {
      getEnvironment: jest.fn().mockResolvedValue({
        environment: { id: 'env-1' },
        version: { id: 'v1', status: 'ready' },
      }),
      upsertEnvironment: jest.fn().mockResolvedValue({ environment: { id: 'env-1' }, version: { id: 'v2' } }),
    };

    await ensureDefaultSandboxEnvironment({
      store: store as unknown as ISandboxEnvironmentStore,
      tenant_id: 'tenant-1',
      created_by_subject: SUBJECT,
      provider_type: 'daytona',
      resetPending: true,
    });

    expect(store.upsertEnvironment).toHaveBeenCalled();
  });
});
