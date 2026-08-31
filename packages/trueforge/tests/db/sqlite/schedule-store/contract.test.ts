import { SqliteAgentStore } from '../../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { SqliteScheduleStore } from '../../../../src/db/sqlite/schedule-store/SqliteScheduleStore';
import { runScheduleStoreContractSuite } from '../../scheduleStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteScheduleStore (pending-run sync contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runScheduleStoreContractSuite({
    getAgentStore: () => new SqliteAgentStore(env.db),
    getScheduleStore: () => new SqliteScheduleStore(env.db),
  });
});
