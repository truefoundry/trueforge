import { sql } from 'kysely';
import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { up } from '../../../../../src/db/sqlite/migrations/20260911_000001_name_hyphen_only';

describe('SQLite name hyphen-only migration', () => {
  it('rewrites dotted names without destroying JSONB manifests', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE model_provider (
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE skill (
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE mcp_server (
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE schedule (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          agent_name TEXT,
          updated_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE agent (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE session (
          session_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          agent_name TEXT,
          agent_spec BLOB
        ) STRICT
      `.execute(db);

      const now = '2026-09-11T00:00:00.000Z';
      await sql`
        INSERT INTO model_provider (tenant_id, name, manifest, updated_at)
        VALUES (
          't',
          'my.prov',
          jsonb(${JSON.stringify({
            type: 'custom',
            name: 'my.prov',
            models: [{ name: 'my.model', model_id: 'upstream' }],
          })}),
          ${now}
        )
      `.execute(db);
      await sql`
        INSERT INTO skill (tenant_id, name, manifest, updated_at)
        VALUES (
          't',
          'my.skill',
          jsonb(${JSON.stringify({ type: 'git', name: 'my.skill', url: 'https://example.com/s.git' })}),
          ${now}
        )
      `.execute(db);
      await sql`
        INSERT INTO mcp_server (tenant_id, name, manifest, updated_at)
        VALUES (
          't',
          'my.mcp',
          jsonb(${JSON.stringify({ type: 'http', name: 'my.mcp', url: 'https://example.com/mcp' })}),
          ${now}
        )
      `.execute(db);
      await sql`
        INSERT INTO agent (id, tenant_id, name, manifest, updated_at)
        VALUES (
          'a1',
          't',
          'my.agent',
          jsonb(${JSON.stringify({
            model: { name: 'my.prov/my.model' },
            mcp_servers: [{ name: 'my.mcp' }],
            skills: [{ name: 'my.skill' }],
          })}),
          ${now}
        )
      `.execute(db);
      await sql`
        INSERT INTO session (session_id, tenant_id, agent_name, agent_spec)
        VALUES (
          's1',
          't',
          'my.agent',
          jsonb(${JSON.stringify({
            model: { name: 'my.prov/my.model' },
            mcp_servers: [{ name: 'my.mcp' }],
            skills: [{ name: 'my.skill' }],
          })})
        )
      `.execute(db);

      await up(db);

      const skill = await sql<{ name: string; manifest: unknown }>`
        SELECT name, json(manifest) AS manifest FROM skill
      `.execute(db);
      expect(skill.rows).toHaveLength(1);
      expect(skill.rows[0]?.name).toMatch(/^my-skill-[0-9a-f]{4}$/);
      expect(skill.rows[0]?.manifest).toMatchObject({
        type: 'git',
        name: skill.rows[0]?.name,
        url: 'https://example.com/s.git',
      });
      expect(Object.keys(skill.rows[0]?.manifest ?? {})).not.toContain('0');

      const mcp = await sql<{ name: string; manifest: unknown }>`
        SELECT name, json(manifest) AS manifest FROM mcp_server
      `.execute(db);
      expect(mcp.rows[0]?.name).toMatch(/^my-mcp-[0-9a-f]{4}$/);
      expect(mcp.rows[0]?.manifest).toMatchObject({
        type: 'http',
        name: mcp.rows[0]?.name,
        url: 'https://example.com/mcp',
      });

      const provider = await sql<{ name: string; manifest: unknown }>`
        SELECT name, json(manifest) AS manifest FROM model_provider
      `.execute(db);
      expect(provider.rows[0]?.name).toMatch(/^my-prov-[0-9a-f]{4}$/);
      expect(provider.rows[0]?.manifest).toMatchObject({
        type: 'custom',
        name: provider.rows[0]?.name,
        models: [{ model_id: 'upstream' }],
      });
      const providerManifest = provider.rows[0]?.manifest;
      expect(providerManifest !== null && typeof providerManifest === 'object').toBe(true);
      if (providerManifest !== null && typeof providerManifest === 'object' && 'models' in providerManifest) {
        const models = providerManifest.models;
        expect(Array.isArray(models)).toBe(true);
        if (Array.isArray(models) && models[0] !== null && typeof models[0] === 'object' && 'name' in models[0]) {
          expect(models[0].name).toMatch(/^my-model-[0-9a-f]{4}$/);
        }
      }

      const agent = await sql<{ name: string; manifest: unknown }>`
        SELECT name, json(manifest) AS manifest FROM agent
      `.execute(db);
      expect(agent.rows[0]?.name).toMatch(/^my-agent-[0-9a-f]{4}$/);
      const agentManifest = agent.rows[0]?.manifest;
      expect(agentManifest).toMatchObject({
        mcp_servers: [{ name: mcp.rows[0]?.name }],
        skills: [{ name: skill.rows[0]?.name }],
      });
      expect(
        agentManifest !== null &&
          typeof agentManifest === 'object' &&
          'model' in agentManifest &&
          agentManifest.model !== null &&
          typeof agentManifest.model === 'object' &&
          'name' in agentManifest.model &&
          typeof agentManifest.model.name === 'string' &&
          agentManifest.model.name.startsWith(`${provider.rows[0]?.name}/`) &&
          /\/my-model-[0-9a-f]{4}$/.test(agentManifest.model.name),
      ).toBe(true);

      const session = await sql<{ agent_name: string; agent_spec: unknown }>`
        SELECT agent_name, json(agent_spec) AS agent_spec FROM session
      `.execute(db);
      expect(session.rows[0]?.agent_name).toBe(agent.rows[0]?.name);
      expect(session.rows[0]?.agent_spec).toEqual(agent.rows[0]?.manifest);
    } finally {
      await db.destroy();
    }
  });
});
