import { sql } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { up } from '../../../../../src/db/sqlite/migrations/20261009_000001_model_message_model_backfill';

describe('SQLite model.message model backfill migration', () => {
  it('stamps model from inline agent_spec model FQN', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE session (
          session_id TEXT NOT NULL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent_id TEXT,
          agent_spec BLOB
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE agent (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          manifest BLOB NOT NULL,
          PRIMARY KEY (tenant_id, id)
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE session_event (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          event BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id, event_id)
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE turn (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          state BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id)
        ) STRICT
      `.execute(db);

      const agentSpec = JSON.stringify({ model: { name: 'acme/gpt-test' } });
      await sql`
        INSERT INTO session (session_id, tenant_id, agent_id, agent_spec)
        VALUES ('sess-1', 'tenant-1', NULL, jsonb(${agentSpec}))
      `.execute(db);
      await sql`
        INSERT INTO session_event (session_id, turn_id, event_id, event)
        VALUES (
          'sess-1',
          'turn-1',
          'evt-1',
          jsonb(${JSON.stringify({ type: 'model.message', id: 'evt-1', thread_id: 'main', content: 'hi' })})
        )
      `.execute(db);
      await sql`
        INSERT INTO turn (session_id, turn_id, state)
        VALUES (
          'sess-1',
          'turn-1',
          jsonb(${JSON.stringify({
            status: 'done',
            output: { type: 'model.message', id: 'evt-1', thread_id: 'main', content: 'hi' },
            required_actions: [],
            completed_at: '2026-10-09T00:00:00.000Z',
          })})
        )
      `.execute(db);

      await up(db);

      const event = await sql<{ event: unknown }>`
        SELECT json(event) AS event FROM session_event WHERE event_id = 'evt-1'
      `.execute(db);
      expect(event.rows[0]?.event).toEqual(expect.objectContaining({ model: { name: 'acme/gpt-test' } }));

      const turn = await sql<{ state: unknown }>`
        SELECT json(state) AS state FROM turn WHERE turn_id = 'turn-1'
      `.execute(db);
      expect(turn.rows[0]?.state).toEqual(
        expect.objectContaining({
          output: expect.objectContaining({ model: { name: 'acme/gpt-test' } }),
        }),
      );
    } finally {
      await db.destroy();
    }
  });

  it('skips rows when model FQN is missing', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE session (
          session_id TEXT NOT NULL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent_id TEXT,
          agent_spec BLOB
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE agent (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          manifest BLOB NOT NULL,
          PRIMARY KEY (tenant_id, id)
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE session_event (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          event BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id, event_id)
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE turn (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          state BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id)
        ) STRICT
      `.execute(db);

      await sql`
        INSERT INTO session (session_id, tenant_id, agent_id, agent_spec)
        VALUES ('sess-2', 'tenant-1', NULL, jsonb(${JSON.stringify({})}))
      `.execute(db);
      await sql`
        INSERT INTO session_event (session_id, turn_id, event_id, event)
        VALUES (
          'sess-2',
          'turn-1',
          'evt-2',
          jsonb(${JSON.stringify({ type: 'model.message', id: 'evt-2', thread_id: 'main' })})
        )
      `.execute(db);

      await up(db);

      const event = await sql<{ event: unknown }>`
        SELECT json(event) AS event FROM session_event WHERE event_id = 'evt-2'
      `.execute(db);
      expect(event.rows[0]?.event).not.toHaveProperty('model');
    } finally {
      await db.destroy();
    }
  });
});
