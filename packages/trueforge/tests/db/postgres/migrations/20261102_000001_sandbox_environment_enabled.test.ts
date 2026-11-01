import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261102_000001_sandbox_environment_enabled';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261030_000001_configuration';

describePg('Postgres sandbox environment enabled migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('turns environments that predate the switch on, and rolls back without touching them', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }

    const subject = JSON.stringify({
      subject_id: 'user-1',
      subject_type: 'user',
      subject_display_name: 'User One',
    });
    await sql`
      INSERT INTO sandbox_environment (
        id,
        tenant_id,
        name,
        description,
        active_version,
        lifecycle_stage,
        created_by_subject,
        created_at,
        updated_at
      )
      VALUES ('legacy-env', 'tenant-1', 'legacy', '', 1, 'active', ${subject}::jsonb, now(), now())
    `.execute(env.db);

    await env.db.transaction().execute(async transaction => {
      await up(transaction);
    });

    const upgraded = await sql<{
      enabled: boolean;
      disabled_at: Date | null;
    }>`SELECT enabled, disabled_at FROM sandbox_environment WHERE id = 'legacy-env'`.execute(env.db);
    expect(upgraded.rows).toEqual([{ enabled: true, disabled_at: null }]);

    await env.db.transaction().execute(async transaction => {
      await down(transaction);
    });

    const rolledBack = await sql<{
      name: string;
    }>`SELECT name FROM sandbox_environment WHERE id = 'legacy-env'`.execute(env.db);
    expect(rolledBack.rows).toEqual([{ name: 'legacy' }]);
  });
});
