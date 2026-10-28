import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import type { IAgentStore } from '../../../src/db/agentStore';
import type { IScheduleStore } from '../../../src/db/scheduleStore';

const ALICE: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'alice', type: 'user', display_name: 'alice' },
  roles: [],
  user_credential: null,
};
const BOB: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'bob', type: 'user', display_name: 'bob' },
  roles: [],
  user_credential: null,
};

describe('TrueForgeAuthorizer.getPermissions', () => {
  const authorizer = new TrueForgeAuthorizer();

  it('grants USE to everyone on agents and MANAGE/DELETE only to the owner', async () => {
    const agentStore = {
      getOwnedIds: jest.fn(async ({ subject_id }: { subject_id: string }) =>
        subject_id === 'alice' ? ['agent-1'] : [],
      ),
    } as unknown as IAgentStore;

    expect(
      await authorizer.getPermissions({
        resourceType: 'agent',
        requestContext: ALICE,
        resourceIds: ['agent-1', 'agent-2'],
        store: agentStore,
      }),
    ).toEqual({
      type: 'agent',
      permissions: {
        'agent-1': ['USE', 'MANAGE', 'DELETE'],
        'agent-2': ['USE'],
      },
    });

    expect(
      await authorizer.getPermissions({
        resourceType: 'agent',
        requestContext: BOB,
        resourceIds: ['agent-1'],
        store: agentStore,
      }),
    ).toEqual({
      type: 'agent',
      permissions: {
        'agent-1': ['USE'],
      },
    });
  });

  it('grants MANAGE/DELETE via canEditSchedule (owner or admin)', async () => {
    const scheduleStore = {
      getSchedulesByIds: jest.fn(async ({ ids }: { ids: readonly string[] }) =>
        ids.flatMap(id => {
          if (id === 'sched-1') {
            return [{ id: 'sched-1', created_by_subject: { subject_id: 'alice' } }];
          }
          if (id === 'sched-2') {
            return [{ id: 'sched-2', created_by_subject: { subject_id: 'carol' } }];
          }
          return [];
        }),
      ),
    } as unknown as IScheduleStore;

    expect(
      await authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: ALICE,
        resourceIds: ['sched-1', 'sched-2'],
        store: scheduleStore,
      }),
    ).toEqual({
      type: 'schedule',
      permissions: {
        'sched-1': ['MANAGE', 'DELETE'],
        'sched-2': [],
      },
    });

    expect(
      await authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: BOB,
        resourceIds: ['sched-1'],
        store: scheduleStore,
      }),
    ).toEqual({
      type: 'schedule',
      permissions: {
        'sched-1': [],
      },
    });

    const admin: RequestContext = { ...BOB, roles: ['admin'] };
    expect(
      await authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: admin,
        resourceIds: ['sched-1', 'sched-2'],
        store: scheduleStore,
      }),
    ).toEqual({
      type: 'schedule',
      permissions: {
        'sched-1': ['MANAGE', 'DELETE'],
        'sched-2': ['MANAGE', 'DELETE'],
      },
    });
  });

  it('batches schedule ownership with deduped ids (no per-id getSchedule)', async () => {
    const scheduleStore = {
      getSchedule: jest.fn(),
      getSchedulesByIds: jest.fn(async ({ ids }: { ids: readonly string[] }) => {
        expect(ids).toEqual(['sched-1']);
        return [{ id: 'sched-1', created_by_subject: { subject_id: 'alice' } }];
      }),
    } as unknown as IScheduleStore;

    await expect(
      authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: ALICE,
        resourceIds: Array.from({ length: 100 }, () => 'sched-1'),
        store: scheduleStore,
      }),
    ).resolves.toEqual({
      type: 'schedule',
      permissions: { 'sched-1': ['MANAGE', 'DELETE'] },
    });
    expect(scheduleStore.getSchedulesByIds).toHaveBeenCalledTimes(1);
    expect(scheduleStore.getSchedule).not.toHaveBeenCalled();
  });

  it('always grants tenant agent CREATE in standalone mode; sandbox env CREATE follows canCreateOrEdit', async () => {
    expect(
      await authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: ALICE,
        resourceIds: [],
      }),
    ).toEqual({
      type: 'tenant',
      permissions: { agent: ['CREATE'], sandbox_environment: [] },
    });

    const admin: RequestContext = { ...ALICE, roles: ['admin'] };
    expect(
      await authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: admin,
        resourceIds: [],
      }),
    ).toEqual({
      type: 'tenant',
      permissions: { agent: ['CREATE'], sandbox_environment: ['CREATE'] },
    });
  });

  it('grants MANAGE/DELETE via canCreateOrEdit (owner or admin)', async () => {
    const sandboxEnvironmentStore = {
      getEnvironmentsByIds: jest.fn(async () => [
        { id: 'env-1', name: 'alice-env', created_by_subject: { subject_id: 'alice' } },
        { id: 'env-2', name: 'carol-env', created_by_subject: { subject_id: 'carol' } },
      ]),
    };

    expect(
      await authorizer.getPermissions({
        resourceType: 'sandbox_environment',
        requestContext: ALICE,
        resourceIds: ['env-1', 'env-2'],
        store: sandboxEnvironmentStore as never,
      }),
    ).toEqual({
      type: 'sandbox_environment',
      permissions: {
        'env-1': ['MANAGE', 'DELETE'],
        'env-2': [],
      },
    });

    const admin: RequestContext = { ...BOB, roles: ['admin'] };
    expect(
      await authorizer.getPermissions({
        resourceType: 'sandbox_environment',
        requestContext: admin,
        resourceIds: ['env-1', 'env-2'],
        store: sandboxEnvironmentStore as never,
      }),
    ).toEqual({
      type: 'sandbox_environment',
      permissions: {
        'env-1': ['MANAGE', 'DELETE'],
        'env-2': ['MANAGE', 'DELETE'],
      },
    });
  });
});
