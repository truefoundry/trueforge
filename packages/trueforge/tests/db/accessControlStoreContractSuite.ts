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
export function sessionSeeding(
  sessionStore: ISessionStore,
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

function tenant(subject_id: string) {
  return { subject_type: 'tenant' as const, subject_id };
}

export function runAccessControlStoreContractSuite(getEnv: () => AccessControlStoreContractEnv): void {
  async function grant(session_id: string, subjects: ReturnType<typeof user | typeof tenant>[]) {
    await getEnv().store.createAccessGrants({ tenant_id: TENANT, session_id, subjects, granted_by_subject: OWNER });
  }

  async function subjectIds(session_id: string): Promise<string[]> {
    const grants = await getEnv().store.listAccessGrants({ tenant_id: TENANT, session_ids: [session_id] });
    return grants.map(record => record.subject_id);
  }

  it('creates grants and lists them with the granter and an ISO-UTC timestamp', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });

    await grant('s1', [user('alice'), user('bob')]);

    const listed = await store.listAccessGrants({ tenant_id: TENANT, session_ids: ['s1'] });
    expect(listed.map(record => record.subject_id)).toEqual(['alice', 'bob']);
    for (const record of listed) {
      expect(record).toMatchObject({ tenant_id: TENANT, session_id: 's1', subject_type: 'user' });
      expect(record.granted_by_subject).toEqual(OWNER);
      expect(record.created_at).toMatch(ISO_UTC);
    }
  });

  it('creating an existing grant keeps the original', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await grant('s1', [user('alice')]);
    const original = await store.listAccessGrants({ tenant_id: TENANT, session_ids: ['s1'] });

    await store.createAccessGrants({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice')],
      granted_by_subject: OTHER_GRANTER,
    });

    expect(await store.listAccessGrants({ tenant_id: TENANT, session_ids: ['s1'] })).toEqual(original);
  });

  it('deletes the listed subjects in one call and ignores ones without a grant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await grant('s1', [user('alice'), user('bob'), user('carol')]);

    await store.deleteAccessGrants({
      tenant_id: TENANT,
      session_id: 's1',
      subjects: [user('alice'), user('carol'), user('nobody')],
    });

    expect(await subjectIds('s1')).toEqual(['bob']);
  });

  it('deleting the session removes its grants', async () => {
    const { seedSession, deleteSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await grant('s1', [user('alice')]);

    await deleteSession({ tenant_id: TENANT, session_id: 's1' });

    expect(await subjectIds('s1')).toEqual([]);
  });

  it('scopes grants to the tenant', async () => {
    const { store, seedSession } = getEnv();
    await seedSession({ tenant_id: TENANT, session_id: 's1' });
    await grant('s1', [user('alice')]);

    expect(await store.listAccessGrants({ tenant_id: OTHER_TENANT, session_ids: ['s1'] })).toEqual([]);
    await store.deleteAccessGrants({ tenant_id: OTHER_TENANT, session_id: 's1', subjects: [user('alice')] });
    expect(await subjectIds('s1')).toEqual(['alice']);
  });

  it('rejects grants on a session that does not exist', async () => {
    await expect(grant('missing', [user('alice')])).rejects.toThrow();
  });

  describe('listAccessGrants filters', () => {
    beforeEach(async () => {
      const { seedSession } = getEnv();
      for (const session_id of ['s1', 's2', 's3']) {
        await seedSession({ tenant_id: TENANT, session_id });
      }
      await grant('s1', [user('alice'), tenant(TENANT)]);
      await grant('s2', [user('bob')]);
      await grant('s3', [tenant(TENANT)]);
    });

    it('returns grants for every requested session, ordered by session', async () => {
      const grants = await getEnv().store.listAccessGrants({ tenant_id: TENANT, session_ids: ['s2', 's1'] });

      expect(grants.map(record => [record.session_id, record.subject_type, record.subject_id])).toEqual([
        ['s1', 'user', 'alice'],
        ['s1', 'tenant', TENANT],
        ['s2', 'user', 'bob'],
      ]);
    });

    it('keeps only the requested subjects, matching type and id together', async () => {
      const grants = await getEnv().store.listAccessGrants({
        tenant_id: TENANT,
        session_ids: ['s1', 's2', 's3'],
        subjects: [tenant(TENANT), user('bob'), tenant('alice')],
      });

      expect(grants.map(record => [record.session_id, record.subject_type, record.subject_id])).toEqual([
        ['s1', 'tenant', TENANT],
        ['s2', 'user', 'bob'],
        ['s3', 'tenant', TENANT],
      ]);
    });

    it('returns nothing for no sessions or no subjects', async () => {
      const { store } = getEnv();
      expect(await store.listAccessGrants({ tenant_id: TENANT, session_ids: [] })).toEqual([]);
      expect(await store.listAccessGrants({ tenant_id: TENANT, session_ids: ['s1'], subjects: [] })).toEqual([]);
    });
  });
}
