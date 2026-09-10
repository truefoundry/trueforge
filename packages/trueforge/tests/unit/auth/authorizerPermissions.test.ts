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
      'agent-1': ['USE', 'MANAGE', 'DELETE'],
      'agent-2': ['USE'],
    });

    expect(
      await authorizer.getPermissions({
        resourceType: 'agent',
        requestContext: BOB,
        resourceIds: ['agent-1'],
        store: agentStore,
      }),
    ).toEqual({
      'agent-1': ['USE'],
    });
  });

  it('grants MANAGE/DELETE only to schedule owners', async () => {
    const scheduleStore = {
      getOwnedIds: jest.fn(async ({ subject_id }: { subject_id: string }) =>
        subject_id === 'alice' ? ['sched-1'] : [],
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
      'sched-1': ['MANAGE', 'DELETE'],
      'sched-2': [],
    });

    expect(
      await authorizer.getPermissions({
        resourceType: 'schedule',
        requestContext: BOB,
        resourceIds: ['sched-1'],
        store: scheduleStore,
      }),
    ).toEqual({
      'sched-1': [],
    });
  });
});
