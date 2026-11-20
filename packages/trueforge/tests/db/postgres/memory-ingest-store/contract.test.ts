import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { sql } from 'kysely';

import { PostgresMemoryIngestStore } from '../../../../src/db/postgres/memory-ingest-store/PostgresMemoryIngestStore';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { json, jsonUnknown, now } from '../../../../src/db/postgres/sqlExpressions';
import { runMemoryIngestStoreContractSuite } from '../../memoryIngestStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresMemoryIngestStore (IMemoryIngestStore contract)', () => {
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
      await sql`TRUNCATE TABLE memory_ingest_cursor, agent, session RESTART IDENTITY CASCADE`.execute(env.db);
    }
  });

  runMemoryIngestStoreContractSuite(() => {
    const current = env;
    if (current === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return {
      store: new PostgresMemoryIngestStore(current.db),
      sessionStore: new PostgresSessionStore(current.db),
      async seedAgent({ tenant_id, agent_id, memory_enabled }) {
        await current.db
          .insertInto('agent')
          .values({
            id: agent_id,
            tenant_id,
            name: agent_id,
            description: '',
            manifest: jsonUnknown<AgentSpec>({
              model: { name: 'test-provider/test-model' },
              instructions: 'test',
              config: { memory: { enabled: memory_enabled } },
            }),
            external_id: null,
            created_by_subject: json({ subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' }),
            created_at: now(),
            updated_at: now(),
          })
          .execute();
      },
    };
  });
});
