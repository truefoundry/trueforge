import { SqliteMemoryIngestStore } from '../../../../src/db/sqlite/memory-ingest-store/SqliteMemoryIngestStore';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { jsonbBind, nowIso } from '../../../../src/db/sqlite/sqlExpressions';
import { runMemoryIngestStoreContractSuite } from '../../memoryIngestStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteMemoryIngestStore (IMemoryIngestStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runMemoryIngestStoreContractSuite(() => ({
    store: new SqliteMemoryIngestStore(env.db),
    sessionStore: new SqliteSessionStore(env.db),
    async seedAgent({ tenant_id, agent_id, memory_enabled }) {
      const timestamp = nowIso();
      await env.db
        .insertInto('agent')
        .values({
          id: agent_id,
          tenant_id,
          name: agent_id,
          description: '',
          manifest: jsonbBind({
            model: { name: 'test-provider/test-model' },
            instructions: 'test',
            runtime: { memory: { enabled: memory_enabled } },
          }),
          external_id: null,
          created_by_subject: jsonbBind({ subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' }),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute();
    },
  }));
});
