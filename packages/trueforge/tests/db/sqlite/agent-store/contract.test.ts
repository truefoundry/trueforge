import { SqliteAgentStore } from '../../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { runAgentStoreContractSuite } from '../../agentStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteAgentStore (IAgentStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runAgentStoreContractSuite(() => new SqliteAgentStore(env.db));
});
