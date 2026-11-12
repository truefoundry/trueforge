import { SqliteSandboxEnvironmentStore } from '../../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { runSandboxEnvironmentStoreContractSuite } from '../../sandboxEnvironmentStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteSandboxEnvironmentStore (ISandboxEnvironmentStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runSandboxEnvironmentStoreContractSuite(() => new SqliteSandboxEnvironmentStore(env.db));
});
