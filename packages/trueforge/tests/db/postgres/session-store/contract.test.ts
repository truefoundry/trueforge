import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import { sql } from 'kysely';

import { runStoreContractSuite } from '../../../../../trueforge-core/tests/agent-session/store/storeContractSuite';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresSessionStore (ISessionStore contract)', () => {
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

  // One database per file; truncate between tests because CREATE DATABASE is slow.
  beforeEach(async () => {
    if (env !== undefined) {
      await sql`
        TRUNCATE TABLE
          thread_capability_state,
          session_event,
          thread_context_log,
          turn_thread,
          turn,
          session
        RESTART IDENTITY CASCADE
      `.execute(env.db);
    }
  });

  runStoreContractSuite((): ISessionStore => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return new PostgresSessionStore(env.db);
  });
});
