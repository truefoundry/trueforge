/**
 * Backend-agnostic checks for the `session.shared` → `tenant` grant backfill migration.
 * Each binding migrates to latest, then re-runs this migration's `up` / `down` directly.
 * The legacy column is reached with raw SQL because the stores no longer map it.
 */
import { AgentSpecSchema, type CreatedBySubject, type ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { IAccessControlStore } from '../../src/db/accessControlStore';

const TENANT = 'default';
const OWNER: CreatedBySubject = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' };
const SPEC = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' });

export interface TenantBackfillEnv {
  sessionStore: ISessionStore;
  accessControlStore: IAccessControlStore;
  setLegacyShared: (session_id: string) => Promise<void>;
  readLegacyShared: (session_id: string) => Promise<boolean>;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

async function seedSession(env: TenantBackfillEnv, input: { session_id: string; shared: boolean }) {
  await env.sessionStore.createSession({
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
    await env.setLegacyShared(input.session_id);
  }
}

export function runTenantBackfillMigrationSuite(getEnv: () => TenantBackfillEnv): void {
  it('turns shared sessions into tenant grants granted by the session creator', async () => {
    const env = getEnv();
    await seedSession(env, { session_id: 'shared', shared: true });
    await seedSession(env, { session_id: 'private', shared: false });

    await env.up();
    await env.up();

    expect(
      await env.accessControlStore.listTenantSharedSessionIds({
        tenant_id: TENANT,
        session_ids: ['shared', 'private'],
      }),
    ).toEqual(['shared']);
    const grants = await env.accessControlStore.listSessionAccess({ tenant_id: TENANT, session_id: 'shared' });
    expect(grants).toEqual([
      expect.objectContaining({ subject_type: 'tenant', subject_id: TENANT, granted_by_subject: OWNER }),
    ]);
  });

  it('down copies tenant grants back onto the column and removes them', async () => {
    const env = getEnv();
    await seedSession(env, { session_id: 'stale-flag', shared: true });
    await seedSession(env, { session_id: 'granted', shared: false });
    await env.accessControlStore.grantSessionAccess({
      tenant_id: TENANT,
      session_id: 'granted',
      subjects: [{ subject_type: 'tenant', subject_id: TENANT }],
      granted_by_subject: OWNER,
    });

    await env.down();

    expect(await env.readLegacyShared('granted')).toBe(true);
    expect(await env.readLegacyShared('stale-flag')).toBe(false);
    expect(await env.accessControlStore.listSessionAccess({ tenant_id: TENANT, session_id: 'granted' })).toEqual([]);
  });
}
