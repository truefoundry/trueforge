import { sql } from 'kysely';

import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261110_000001_trueforge_sandbox_name';

describe('SQLite reserved sandbox environment rename migration', () => {
  it('renames the environment, version manifests, and persisted agent references without changing external refs', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE sandbox_environment (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE sandbox_environment_version (
          id TEXT PRIMARY KEY,
          environment_id TEXT NOT NULL,
          manifest BLOB NOT NULL,
          external_ref TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE agent (
          id TEXT PRIMARY KEY,
          manifest BLOB NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE session (
          session_id TEXT PRIMARY KEY,
          agent_spec BLOB
        ) STRICT
      `.execute(db);

      await sql`
        INSERT INTO sandbox_environment (id, name)
        VALUES ('reserved', 'default'), ('custom', 'python')
      `.execute(db);
      await sql`
        INSERT INTO sandbox_environment_version (id, environment_id, manifest, external_ref)
        VALUES
          ('reserved-v1', 'reserved', jsonb('{"name":"default","resources":{"cpu":1}}'), 'snapshot-existing'),
          ('custom-v1', 'custom', jsonb('{"name":"python","resources":{"cpu":2}}'), 'snapshot-custom')
      `.execute(db);
      await sql`
        INSERT INTO agent (id, manifest)
        VALUES
          ('reserved-agent', jsonb('{"config":{"sandbox":{"enabled":true,"environment_name":"default"}}}')),
          ('custom-agent', jsonb('{"config":{"sandbox":{"enabled":true,"environment_name":"python"}}}'))
      `.execute(db);
      await sql`
        INSERT INTO session (session_id, agent_spec)
        VALUES
          ('reserved-session', jsonb('{"config":{"sandbox":{"enabled":true,"environment_name":"default"}}}')),
          ('reference-session', NULL)
      `.execute(db);

      await up(db);

      const renamedResult = await sql<{
        environment_name: string;
        manifest_name: string;
        external_ref: string;
        agent_environment_name: string;
        session_environment_name: string;
      }>`
        SELECT
          environment.name AS environment_name,
          json_extract(version.manifest, '$.name') AS manifest_name,
          version.external_ref,
          json_extract(agent.manifest, '$.config.sandbox.environment_name') AS agent_environment_name,
          json_extract(session.agent_spec, '$.config.sandbox.environment_name') AS session_environment_name
        FROM sandbox_environment AS environment
        JOIN sandbox_environment_version AS version ON version.environment_id = environment.id
        JOIN agent ON agent.id = 'reserved-agent'
        JOIN session ON session.session_id = 'reserved-session'
        WHERE environment.id = 'reserved'
      `.execute(db);
      const renamed = renamedResult.rows[0];
      expect(renamed).toEqual({
        environment_name: 'trueforge-sandbox',
        manifest_name: 'trueforge-sandbox',
        external_ref: 'snapshot-existing',
        agent_environment_name: 'trueforge-sandbox',
        session_environment_name: 'trueforge-sandbox',
      });

      await down(db);

      const restoredResult = await sql<{ environment_name: string; manifest_name: string }>`
        SELECT
          environment.name AS environment_name,
          json_extract(version.manifest, '$.name') AS manifest_name
        FROM sandbox_environment AS environment
        JOIN sandbox_environment_version AS version ON version.environment_id = environment.id
        WHERE environment.id = 'reserved'
      `.execute(db);
      const restored = restoredResult.rows[0];
      expect(restored).toEqual({ environment_name: 'default', manifest_name: 'default' });
    } finally {
      await db.destroy();
    }
  });
});
