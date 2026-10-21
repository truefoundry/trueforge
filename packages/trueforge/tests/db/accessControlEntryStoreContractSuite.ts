/**
 * Backend-agnostic behavioural contract for IAccessControlEntryStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { AgentSpecSchema, type CreatedBySubject, type ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { IAccessControlEntryStore } from '../../src/db/accessControlEntryStore';

const TENANT = 'default';
const OTHER_TENANT = 'other-tenant';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const OWNER: CreatedBySubject = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' };
const OTHER_GRANTER: CreatedBySubject = { subject_id: 'other', subject_type: 'user', subject_display_name: 'Other' };
const SPEC = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' });

export interface AccessControlEntryStoreContractEnv {
  store: IAccessControlEntryStore;
  seedSession: (input: { tenant_id: string; session_id: string }) => Promise<void>;
  deleteSession: (input: { tenant_id: string; session_id: string }) => Promise<void>;
}

/** Session seeding through the backend's real session store. */
export function sessionSeeding(
  sessionStore: ISessionStore,
): Pick<AccessControlEntryStoreContractEnv, 'seedSession' | 'deleteSession'> {
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

function tenant(subject_id: string) {
  return { subject_type: 'tenant' as const, subject_id };
}

export function runAccessControlEntryStoreContractSuite(getEnv: () => AccessControlEntryStoreContractEnv): void {
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

  it('revoke deletes an existing grant and reports a missing one', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('bob')],
      granted_by_subject: OWNER,
    });

    expect(await store.revokeSessionAccess({ tenant_id: TENANT, session_id: 's1', subject: user('alice') })).toBe(true);
    expect(await store.revokeSessionAccess({ tenant_id: TENANT, session_id: 's1', subject: user('alice') })).toBe(
      false,
    );
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
    expect(await store.revokeSessionAccess({ tenant_id: OTHER_TENANT, session_id: 's1', subject: user('alice') })).toBe(
      false,
    );
  });

  it('hasAccess is true only for a live user grant on that session and tenant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await seedSession({ tenant_id: TENANT, session_id: 's2' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('bob')],
      granted_by_subject: OWNER,
    });
    await store.revokeSessionAccess({ tenant_id: TENANT, session_id: 's1', subject: user('bob') });

    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's1', subject_id: 'alice' })).toBe(true);
    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's2', subject_id: 'alice' })).toBe(false);
    expect(await store.hasAccess({ tenant_id: OTHER_TENANT, session_id: 's1', subject_id: 'alice' })).toBe(false);
    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's1', subject_id: 'bob' })).toBe(false);
  });

  it('hasAccess lets anyone in the tenant in when the session has a tenant grant for that tenant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await seedSession({ tenant_id: TENANT, session_id: 's2' });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [tenant(TENANT)],
      granted_by_subject: OWNER,
    });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's2',
      subjects: [tenant(OTHER_TENANT)],
      granted_by_subject: OWNER,
    });

    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's1', subject_id: 'anyone' })).toBe(true);
    expect(await store.hasAccess({ tenant_id: OTHER_TENANT, session_id: 's1', subject_id: 'anyone' })).toBe(false);
    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's2', subject_id: 'anyone' })).toBe(false);

    await store.revokeSessionAccess({ tenant_id: TENANT, session_id: 's1', subject: tenant(TENANT) });
    expect(await store.hasAccess({ tenant_id: TENANT, session_id: 's1', subject_id: 'anyone' })).toBe(false);
  });

  it('listTenantSharedSessionIds returns only sessions shared with that tenant', async () => {
    const { store, seedSession } = getEnv();
    for (const session_id of ['s1', 's2', 's3']) {
      await seedSession({ tenant_id: TENANT, session_id });
    }
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [tenant(TENANT)],
      granted_by_subject: OWNER,
    });
    await store.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 's2',
      subjects: [user('alice')],
      granted_by_subject: OWNER,
    });

    expect(
      await store.listTenantSharedSessionIds({ tenant_id: TENANT, session_ids: ['s1', 's2', 's3', 'missing'] }),
    ).toEqual(['s1']);
    expect(await store.listTenantSharedSessionIds({ tenant_id: OTHER_TENANT, session_ids: ['s1'] })).toEqual([]);
    expect(await store.listTenantSharedSessionIds({ tenant_id: TENANT, session_ids: [] })).toEqual([]);
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
