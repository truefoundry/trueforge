import { SqliteAgentStore } from '../../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { SqliteScheduleStore } from '../../../../src/db/sqlite/schedule-store/SqliteScheduleStore';
import { runScheduleDispatchContractSuite } from '../../scheduleDispatchContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('dispatchScheduledRuns (sqlite contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runScheduleDispatchContractSuite({
    getAgentStore: () => new SqliteAgentStore(env.db),
    getScheduleStore: () => new SqliteScheduleStore(env.db),
    withTransaction: callback => env.db.transaction().execute(callback),
  });
});
