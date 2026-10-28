import { SqliteAccessControlStore } from '../../../../src/db/sqlite/access-control-store/SqliteAccessControlStore';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runAccessControlStoreContractSuite, sessionSeeding } from '../../accessControlStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteAccessControlStore (IAccessControlStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runAccessControlStoreContractSuite(() => ({
    store: new SqliteAccessControlStore(env.db),
    ...sessionSeeding(new SqliteSessionStore(env.db)),
  }));
});
