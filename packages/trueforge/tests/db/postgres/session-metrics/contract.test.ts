import { sql } from 'kysely';

import { PostgresSessionMetricsStore } from '../../../../src/db/postgres/session-metrics/PostgresSessionMetricsStore';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runSessionMetricsStoreContractSuite } from '../../session-metrics/metricsContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresSessionMetricsStore (metrics contract)', () => {
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
      await sql`TRUNCATE TABLE session CASCADE`.execute(env.db);
    }
  });

  runSessionMetricsStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const sessionStore = new PostgresSessionStore(env.db);
    return {
      sessionStore,
      metricsStore: new PostgresSessionMetricsStore(env.db),
    };
  });
});
