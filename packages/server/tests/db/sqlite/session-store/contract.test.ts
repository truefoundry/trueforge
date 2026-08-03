import type { ISessionStore } from '@truefoundry/utils/agent-session/store/ISessionStore';

import { runStoreContractSuite } from '../../../../../harness/tests/agent-session/store/storeContractSuite';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteSessionStore (ISessionStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runStoreContractSuite((): ISessionStore => new SqliteSessionStore(env.db));
});
