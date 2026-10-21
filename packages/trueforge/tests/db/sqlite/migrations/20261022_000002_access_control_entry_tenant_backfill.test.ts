import { SqliteAccessControlEntryStore } from '../../../../src/db/sqlite/access-control-entry-store/SqliteAccessControlEntryStore';
import { down, up } from '../../../../src/db/sqlite/migrations/20261022_000002_access_control_entry_tenant_backfill';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runTenantBackfillMigrationSuite } from '../../accessControlEntryTenantBackfillSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SQLite access_control_entry tenant backfill migration', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runTenantBackfillMigrationSuite(() => ({
    sessionStore: new SqliteSessionStore(env.db),
    accessStore: new SqliteAccessControlEntryStore(env.db),
    up: () => up(env.db),
    down: () => down(env.db),
  }));
});
