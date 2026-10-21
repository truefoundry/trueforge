import { sql } from 'kysely';

import { PostgresAccessControlEntryStore } from '../../../../src/db/postgres/access-control-entry-store/PostgresAccessControlEntryStore';
import { down, up } from '../../../../src/db/postgres/migrations/20261022_000002_access_control_entry_tenant_backfill';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runTenantBackfillMigrationSuite } from '../../accessControlEntryTenantBackfillSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('Postgres access_control_entry tenant backfill migration', () => {
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
      await sql`TRUNCATE TABLE access_control_entry, session RESTART IDENTITY CASCADE`.execute(env.db);
    }
  });

  runTenantBackfillMigrationSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const { db } = env;
    return {
      sessionStore: new PostgresSessionStore(db),
      accessStore: new PostgresAccessControlEntryStore(db),
      // Migrations use SET LOCAL, which only applies inside a transaction.
      up: () => db.transaction().execute(trx => up(trx)),
      down: () => db.transaction().execute(trx => down(trx)),
    };
  });
});
