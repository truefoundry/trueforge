import { TRUEFOUNDRY_TENANT_ADMIN_ROLE, type RequestContext } from '../../../src/auth/identity';
import { getTrueForgeAuthMode, TrueForgeAuthMode } from '../../../src/config';
import type { IScheduleStore } from '../../../src/db/scheduleStore';
import { TrueFoundryAuthorizer } from '../../../src/truefoundry/TrueFoundryAuthorizer';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getTrueForgeAuthMode: jest.fn(() => actual.TrueForgeAuthMode.TrueFoundry),
  };
});

const ALICE: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'alice', type: 'user', display_name: 'alice' },
  roles: [],
  user_credential: 'user-jwt',
};

describe('TrueFoundryAuthorizer.getPermissions tenant', () => {
  it('maps CREATE_AGENT to tenant agent CREATE', async () => {
    const client = {
      getTenantPermissions: jest.fn(async () => ['CREATE_AGENT', 'CREATE_WORKSPACE']),
    } as unknown as TrueFoundryServiceFoundryServerClient;
    const authorizer = new TrueFoundryAuthorizer(client);

    await expect(
      authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: ALICE,
        resourceIds: [],
      }),
    ).resolves.toEqual({
      type: 'tenant',
      permissions: { agent: ['CREATE'], sandbox_environment: [] },
    });
    expect(client.getTenantPermissions).toHaveBeenCalledWith({ accessToken: 'user-jwt' });
  });

  it('returns empty agent grants when CREATE_AGENT is absent', async () => {
    const client = {
      getTenantPermissions: jest.fn(async () => ['CREATE_WORKSPACE']),
    } as unknown as TrueFoundryServiceFoundryServerClient;
    const authorizer = new TrueFoundryAuthorizer(client);

    await expect(
      authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: ALICE,
        resourceIds: [],
      }),
    ).resolves.toEqual({
      type: 'tenant',
      permissions: { agent: [], sandbox_environment: [] },
    });
  });

  it('grants sandbox_environment CREATE for tenant-admin', async () => {
    const client = {
      getTenantPermissions: jest.fn(async () => []),
    } as unknown as TrueFoundryServiceFoundryServerClient;
    const authorizer = new TrueFoundryAuthorizer(client);
    const admin: RequestContext = { ...ALICE, roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE] };

    await expect(
      authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: admin,
        resourceIds: [],
      }),
    ).resolves.toEqual({
      type: 'tenant',
      permissions: { agent: [], sandbox_environment: ['CREATE'] },
    });
  });
});

describe('TrueFoundryAuthorizer.getPermissions schedule', () => {
  afterEach(() => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
  });

  it('grants MANAGE/DELETE via canEditSchedule for tenant-admin', async () => {
    const scheduleStore = {
      getSchedulesByIds: jest.fn(async ({ ids }: { ids: readonly string[] }) =>
        ids.map(id => ({ id, created_by_subject: { subject_id: 'other' } })),
      ),
    } as unknown as IScheduleStore;
    const authorizer = new TrueFoundryAuthorizer({} as TrueFoundryServiceFoundryServerClient);
    const admin: RequestContext = { ...ALICE, roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE] };

    await expect(
      authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: admin,
        resourceIds: ['sched-1', 'sched-2'],
        store: scheduleStore,
      }),
    ).resolves.toEqual({
      type: 'schedule',
      permissions: {
        'sched-1': ['MANAGE', 'DELETE'],
        'sched-2': ['MANAGE', 'DELETE'],
      },
    });
    expect(scheduleStore.getSchedulesByIds).toHaveBeenCalledTimes(1);
  });
});
