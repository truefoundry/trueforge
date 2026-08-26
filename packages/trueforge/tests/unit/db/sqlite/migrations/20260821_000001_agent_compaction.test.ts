import { sql } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20260821_000001_agent_compaction';

describe('SQLite agent compaction migration', () => {
  it('upgrades named and inline Agent Specs to the trigger shape and rolls them back', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`CREATE TABLE agent (manifest BLOB NOT NULL) STRICT`.execute(db);
      await sql`CREATE TABLE session (agent_spec BLOB) STRICT`.execute(db);

      const namedSpec = JSON.stringify({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            compaction: { enabled: false, compaction_threshold_tokens: 80_000 },
            large_tool_response: { enabled: true },
          },
        },
      });
      const inlineSpec = JSON.stringify({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            compaction: { enabled: true, compaction_threshold_tokens: 60_000 },
            large_tool_response: { enabled: false },
          },
        },
      });
      await sql`INSERT INTO agent (manifest) VALUES (jsonb(${namedSpec}))`.execute(db);
      await sql`INSERT INTO session (agent_spec) VALUES (jsonb(${inlineSpec}))`.execute(db);

      await up(db);

      const migratedAgent = await sql<{ manifest: unknown }>`SELECT json(manifest) AS manifest FROM agent`.execute(db);
      const migratedSession = await sql<{ agent_spec: unknown }>`
        SELECT json(agent_spec) AS agent_spec FROM session
      `.execute(db);
      expect(migratedAgent.rows[0]?.manifest).toEqual({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            compaction: {
              enabled: false,
              trigger: { type: 'input_tokens', value: 80_000 },
            },
            large_tool_response: { enabled: true },
          },
        },
      });
      expect(migratedSession.rows[0]?.agent_spec).toEqual({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            compaction: {
              enabled: true,
              trigger: { type: 'input_tokens', value: 60_000 },
            },
            large_tool_response: { enabled: false },
          },
        },
      });

      await down(db);

      const rolledBackAgent = await sql<{ manifest: unknown }>`SELECT json(manifest) AS manifest FROM agent`.execute(
        db,
      );
      const rolledBackSession = await sql<{ agent_spec: unknown }>`
        SELECT json(agent_spec) AS agent_spec FROM session
      `.execute(db);
      expect(rolledBackAgent.rows[0]?.manifest).toEqual({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            large_tool_response: { enabled: true },
            compaction: { enabled: false, compaction_threshold_tokens: 80_000 },
          },
        },
      });
      expect(rolledBackSession.rows[0]?.agent_spec).toEqual({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            large_tool_response: { enabled: false },
            compaction: { enabled: true, compaction_threshold_tokens: 60_000 },
          },
        },
      });
    } finally {
      await db.destroy();
    }
  });
});
