import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261123_000002_artifact_name_latest_entry_point';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261123_000001_drop_artifact_slug';
const SUBJECT = JSON.stringify({ subject_id: 'u', subject_type: 'user', subject_display_name: 'U' });

describePg('Postgres artifact name and latest_entry_point migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeEach(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
    for (const [id, latestVersion] of [
      ['with-versions', 2],
      ['no-versions', 0],
    ] as const) {
      await sql`
        INSERT INTO artifact (
          id, tenant_id, title, latest_version, created_by_subject, created_by_session_id, created_at, updated_at
        ) VALUES (${id}, 't', ${id}, ${latestVersion}, ${SUBJECT}::jsonb, 's', now(), now())
      `.execute(env.db);
    }
    for (const [version, entryPoint] of [
      [1, 'old.html'],
      [2, 'index.html'],
    ] as const) {
      await sql`
        INSERT INTO artifact_version (artifact_id, version, entry_point, total_bytes, created_at)
        VALUES ('with-versions', ${version}, ${entryPoint}, 1, now())
      `.execute(env.db);
    }
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  function db(): PostgresTestDatabase['db'] {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env.db;
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    await db()
      .transaction()
      .execute(async transaction => {
        await (direction === 'up' ? up(transaction) : down(transaction));
      });
  }

  it("renames title to name and backfills the latest version's entry point", async () => {
    await migrate('up');
    const { rows } = await sql<{ id: string; name: string; latest_entry_point: string | null }>`
      SELECT id, name, latest_entry_point FROM artifact ORDER BY id
    `.execute(db());
    expect(rows).toEqual([
      { id: 'no-versions', name: 'no-versions', latest_entry_point: null },
      { id: 'with-versions', name: 'with-versions', latest_entry_point: 'index.html' },
    ]);

    await migrate('down');
    const restored = await sql<{ id: string; title: string }>`SELECT id, title FROM artifact ORDER BY id`.execute(db());
    expect(restored.rows).toEqual([
      { id: 'no-versions', title: 'no-versions' },
      { id: 'with-versions', title: 'with-versions' },
    ]);
  });
});
