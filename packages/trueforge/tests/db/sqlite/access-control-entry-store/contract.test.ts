import { SqliteAccessControlEntryStore } from '../../../../src/db/sqlite/access-control-entry-store/SqliteAccessControlEntryStore';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runAccessControlEntryStoreContractSuite, sessionSeeding } from '../../accessControlEntryStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteAccessControlEntryStore (IAccessControlEntryStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runAccessControlEntryStoreContractSuite(() => ({
    store: new SqliteAccessControlEntryStore(env.db),
    ...sessionSeeding(new SqliteSessionStore(env.db)),
  }));
});
