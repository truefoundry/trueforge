import { sql } from 'kysely';

import { PostgresAccessControlStore } from '../../../../src/db/postgres/access-control-store/PostgresAccessControlStore';
import { down, up } from '../../../../src/db/postgres/migrations/20261028_000003_access_control_tenant_backfill';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runTenantBackfillMigrationSuite } from '../../accessControlTenantBackfillSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('Postgres access_control tenant backfill migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase();
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(async () => {
    if (env !== undefined) {
      await sql`TRUNCATE TABLE access_control, session RESTART IDENTITY CASCADE`.execute(env.db);
    }
  });

  runTenantBackfillMigrationSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const { db } = env;
    return {
      sessionStore: new PostgresSessionStore(db),
      accessControlStore: new PostgresAccessControlStore(db),
      setLegacyShared: async session_id => {
        await sql`UPDATE session SET shared = true WHERE session_id = ${session_id}`.execute(db);
      },
      readLegacyShared: async session_id => {
        const { rows } = await sql<{
          shared: boolean;
        }>`SELECT shared FROM session WHERE session_id = ${session_id}`.execute(db);
        return rows[0]?.shared === true;
      },
      // Migrations use SET LOCAL, which only applies inside a transaction.
      up: () => db.transaction().execute(trx => up(trx)),
      down: () => db.transaction().execute(trx => down(trx)),
    };
  });
});
