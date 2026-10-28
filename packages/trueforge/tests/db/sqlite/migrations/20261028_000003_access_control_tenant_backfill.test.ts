import { sql } from 'kysely';

import { SqliteAccessControlStore } from '../../../../src/db/sqlite/access-control-store/SqliteAccessControlStore';
import { down, up } from '../../../../src/db/sqlite/migrations/20261028_000003_access_control_tenant_backfill';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runTenantBackfillMigrationSuite } from '../../accessControlTenantBackfillSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SQLite access_control tenant backfill migration', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runTenantBackfillMigrationSuite(() => ({
    sessionStore: new SqliteSessionStore(env.db),
    accessControlStore: new SqliteAccessControlStore(env.db),
    setLegacyShared: async session_id => {
      await sql`UPDATE session SET shared = 1 WHERE session_id = ${session_id}`.execute(env.db);
    },
    readLegacyShared: async session_id => {
      const { rows } = await sql<{
        shared: number;
      }>`SELECT shared FROM session WHERE session_id = ${session_id}`.execute(env.db);
      return rows[0]?.shared === 1;
    },
    up: () => up(env.db),
    down: () => down(env.db),
  }));
});
