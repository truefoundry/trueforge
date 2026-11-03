import { sql, type Kysely, type RawBuilder } from 'kysely';
import {
  OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX,
  SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX,
  SESSION_AGENT_LIST_IDX,
} from '../../../../../src/db/indexes';
import { migrateSqliteToLatest } from '../../../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261103_000001_query_path_indexes';

const NEW_INDEXES = [
  SESSION_AGENT_LIST_IDX,
  SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX,
  OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX,
] as const;

async function indexNames<TDatabase>(db: Kysely<TDatabase>): Promise<string[]> {
  const result = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name
  `.execute(db);
  return result.rows.map(row => row.name);
}

async function plan<TDatabase>({ db, query }: { db: Kysely<TDatabase>; query: RawBuilder<unknown> }): Promise<string> {
  const result = await sql<{ detail: string }>`EXPLAIN QUERY PLAN ${query}`.execute(db);
  return result.rows.map(row => row.detail).join('\n');
}

describe('SQLite query path indexes migration', () => {
  it('creates indexes the planner uses for the targeted queries, and rolls back', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await migrateSqliteToLatest(db);
      expect(await indexNames(db)).toEqual(expect.arrayContaining([...NEW_INDEXES]));

      const agentList = await plan({
        db,
        query: sql`SELECT session_id FROM session
            WHERE tenant_id = 't' AND agent_id = 'a'
            ORDER BY updated_at DESC, session_id DESC LIMIT 21`,
      });
      expect(agentList).toContain(SESSION_AGENT_LIST_IDX);
      expect(agentList).not.toContain('USE TEMP B-TREE FOR ORDER BY');

      const pendingTip = await plan({
        db,
        query: sql`SELECT environment_id, MAX(version) FROM sandbox_environment_version
            WHERE status = 'pending' GROUP BY environment_id`,
      });
      expect(pendingTip).toContain(SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX);

      const pendingByServer = await plan({
        db,
        query: sql`DELETE FROM oauth_pending_authorization WHERE oauth_server_id = 's'`,
      });
      expect(pendingByServer).toContain(OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX);

      await down(db);
      const afterDown = await indexNames(db);
      for (const name of NEW_INDEXES) {
        expect(afterDown).not.toContain(name);
      }

      await up(db);
      expect(await indexNames(db)).toEqual(expect.arrayContaining([...NEW_INDEXES]));
    } finally {
      await db.destroy();
    }
  });
});
