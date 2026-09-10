import { sql } from 'kysely';

import { PostgresAgentStore } from '../../../../src/db/postgres/agent-store/PostgresAgentStore';
import { PostgresScheduleStore } from '../../../../src/db/postgres/schedule-store/PostgresScheduleStore';
import { runScheduleDispatchContractSuite } from '../../scheduleDispatchContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('dispatchScheduledRuns (postgres contract)', () => {
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
      await sql`TRUNCATE TABLE agent CASCADE`.execute(env.db);
    }
  });

  runScheduleDispatchContractSuite({
    getAgentStore: () => {
      if (env === undefined) {
        throw new Error('Postgres test environment not initialized');
      }
      return new PostgresAgentStore(env.db);
    },
    getScheduleStore: () => {
      if (env === undefined) {
        throw new Error('Postgres test environment not initialized');
      }
      return new PostgresScheduleStore(env.db);
    },
    withTransaction: callback => {
      if (env === undefined) {
        throw new Error('Postgres test environment not initialized');
      }
      return env.db.transaction().execute(callback);
    },
  });
});
