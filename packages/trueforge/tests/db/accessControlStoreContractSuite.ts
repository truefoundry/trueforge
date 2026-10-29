/**
 * Backend-agnostic behavioural contract for IAccessControlStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { AgentSpecSchema, type CreatedBySubject, type ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { IAccessControlStore } from '../../src/db/accessControlStore';

const TENANT = 'default';
const OTHER_TENANT = 'other-tenant';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const OWNER: CreatedBySubject = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' };
const OTHER_GRANTER: CreatedBySubject = { subject_id: 'other', subject_type: 'user', subject_display_name: 'Other' };
const SPEC = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' });

export interface AccessControlStoreContractEnv {
  store: IAccessControlStore;
  seedSession: (input: { tenant_id: string; session_id: string }) => Promise<void>;
  deleteSession: (input: { tenant_id: string; session_id: string }) => Promise<void>;
}

/** Session seeding through the backend's real session store. */
export function sessionSeeding<TTransaction>(
  sessionStore: ISessionStore<TTransaction>,
): Pick<AccessControlStoreContractEnv, 'seedSession' | 'deleteSession'> {
  return {
    async seedSession({ tenant_id, session_id }) {
      await sessionStore.createSession({
        tenant_id,
        session_id,
        created_by_subject: OWNER,
        agent: { type: 'inline', spec: SPEC },
        custom: null,
        metadata: {},
        external_id: null,
        source: null,
      });
    },
    async deleteSession({ tenant_id, session_id }) {
      await sessionStore.deleteSession({ tenant_id, session_id });
    },
  };
}

function user(subject_id: string) {
  return { subject_type: 'user' as const, subject_id };
}

export function runAccessControlStoreContractSuite(getEnv: () => AccessControlStoreContractEnv): void {
  it('grants users and lists them with the granter and an ISO-UTC timestamp', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });

    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('bob')],
      granted_by_subject: OWNER,
    });

    const listed = await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' });
    expect(listed.map(record => record.subject_id)).toEqual(['alice', 'bob']);
    for (const record of listed) {
      expect(record).toMatchObject({ tenant_id: TENANT, session_id: 's1', subject_type: 'user' });
      expect(record.granted_by_subject).toEqual(OWNER);
      expect(record.created_at).toMatch(ISO_UTC);
    }
  });

  it('re-granting an existing user keeps the original grant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice')],
      granted_by_subject: OWNER,
    });
    const [original] = await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' });

    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice')],
      granted_by_subject: OTHER_GRANTER,
    });

    const listed = await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' });
    expect(listed).toEqual([original]);
  });

  it('revoke deletes the listed subjects in one call and ignores ones without an entry', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('bob'), user('carol')],
      granted_by_subject: OWNER,
    });

    await store.revokeSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('carol'), user('nobody')],
    });

    const listed = await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' });
    expect(listed.map(record => record.subject_id)).toEqual(['bob']);
  });

  it('deleting the session removes its grants', async () => {
    const { store, seedSession, deleteSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice')],
      granted_by_subject: OWNER,
    });

    await deleteSession({ tenant_id: TENANT, session_id: 's1' });

    expect(await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' })).toEqual([]);
  });

  it('scopes grants to the tenant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice')],
      granted_by_subject: OWNER,
    });

    expect(await store.listSessionAccess({ tenant_id: OTHER_TENANT, session_id: 's1' })).toEqual([]);
    await store.revokeSessionAccess({ tenant_id: OTHER_TENANT, session_id: 's1', subjects: [user('alice')] });
    expect(await store.listSessionAccess({ tenant_id: TENANT, session_id: 's1' })).toHaveLength(1);
  });

  it('rejects grants on a session that does not exist', async () => {
    const { store } = getEnv();
    await expect(
      store.grantSessionAccess({
        tenant_id: TENANT,
        session_id: 'missing',
        subjects: [user('alice')],
        granted_by_subject: OWNER,
      }),
    ).rejects.toThrow();
  });
}
