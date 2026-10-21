/**
 * Backend-agnostic checks for the `session.shared` → `tenant` grant backfill migration.
 * Each binding migrates to latest, then re-runs this migration's `up` / `down` directly.
 */
import { AgentSpecSchema, type CreatedBySubject, type ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { IAccessControlEntryStore } from '../../src/db/accessControlEntryStore';

const TENANT = 'default';
const OWNER: CreatedBySubject = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' };
const SPEC = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' });

export interface TenantBackfillEnv {
  sessionStore: ISessionStore;
  accessStore: IAccessControlEntryStore;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

async function seedSession(sessionStore: ISessionStore, input: { session_id: string; shared: boolean }) {
  await sessionStore.createSession({
    tenant_id: TENANT,
    session_id: input.session_id,
    created_by_subject: OWNER,
    agent: { type: 'inline', spec: SPEC },
    custom: null,
    metadata: {},
    external_id: null,
    source: null,
  });
  if (input.shared) {
    await sessionStore.updateSession({
      tenant_id: TENANT,
      session_id: input.session_id,
      agent: undefined,
      title: undefined,
      metadata: undefined,
      shared: true,
    });
  }
}

export function runTenantBackfillMigrationSuite(getEnv: () => TenantBackfillEnv): void {
  it('turns shared sessions into tenant grants granted by the session creator', async () => {
    const { sessionStore, accessStore, up } = getEnv();
    await seedSession(sessionStore, { session_id: 'shared', shared: true });
    await seedSession(sessionStore, { session_id: 'private', shared: false });

    await up();
    await up();

    expect(
      await accessStore.listTenantSharedSessionIds({ tenant_id: TENANT, session_ids: ['shared', 'private'] }),
    ).toEqual(['shared']);
    const grants = await accessStore.listSessionAccess({ tenant_id: TENANT, session_id: 'shared' });
    expect(grants).toEqual([
      expect.objectContaining({ subject_type: 'tenant', subject_id: TENANT, granted_by_subject: OWNER }),
    ]);
  });

  it('down copies tenant grants back onto the column and removes them', async () => {
    const { sessionStore, accessStore, down } = getEnv();
    await seedSession(sessionStore, { session_id: 'stale-flag', shared: true });
    await seedSession(sessionStore, { session_id: 'granted', shared: false });
    await accessStore.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 'granted',
      subjects: [{ subject_type: 'tenant', subject_id: TENANT }],
      granted_by_subject: OWNER,
    });

    await down();

    expect((await sessionStore.getSession({ tenant_id: TENANT, session_id: 'granted' }))?.shared).toBe(true);
    expect((await sessionStore.getSession({ tenant_id: TENANT, session_id: 'stale-flag' }))?.shared).toBe(false);
    expect(await accessStore.listSessionAccess({ tenant_id: TENANT, session_id: 'granted' })).toEqual([]);
  });
}
