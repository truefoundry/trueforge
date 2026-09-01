import { SqliteSessionMetricsStore } from '../../../../src/db/sqlite/session-metrics/SqliteSessionMetricsStore';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runSessionMetricsStoreContractSuite } from '../../session-metrics/metricsContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteSessionMetricsStore (metrics contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runSessionMetricsStoreContractSuite(() => {
    const sessionStore = new SqliteSessionStore(env.db);
    return {
      sessionStore,
      metricsStore: new SqliteSessionMetricsStore(env.db),
    };
  });
});
