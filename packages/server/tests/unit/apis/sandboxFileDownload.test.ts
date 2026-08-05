import { OpenAPIHono } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import { AgentSpecSchema, Sessions } from '@truefoundry/utils-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import { createLogger } from 'winston';
import { createSessionsRouter, TENANT_ID } from '../../../src/apis/sessions';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

/** Parsed rather than built literally, so config defaults match what the create route stores. */
function agentSpec(fileDownloads: boolean): AgentSpec {
  return AgentSpecSchema.parse({
    model: { name: 'openai/gpt-4o' },
    config: { sandbox: { enabled: true, file_downloads: fileDownloads } },
  });
}

async function buildApp() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sessionStore = new SqliteSessionStore(db);
  const sessions = new Sessions({ sessionStore });
  const app = new OpenAPIHono();

  app.route(
    '/',
    createSessionsRouter({
      sessions,
      sessionStore,
      activeTurns: new ActiveTurnRegistry(),
      modelProviderStore: new SqliteModelProviderStore(db),
      mcpServerStore: new SqliteMcpServerStore(db),
      skillStore: new SqliteSkillStore(db),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      requestReplyRouter: new RequestReplyRouter(),
      logger: createLogger({ silent: true }),
    }),
  );

  return { app, sessions };
}

function downloadUrl(sessionId: string, path: string): string {
  return `http://localhost/${sessionId}/sandbox/file?path=${encodeURIComponent(path)}`;
}

describe('GET /{session_id}/sandbox/file', () => {
  it('rejects a malformed path before touching the session', async () => {
    const { app } = await buildApp();

    for (const path of ['report.pdf', '/a/../../etc/passwd']) {
      const response = await app.request(downloadUrl('missing', path));

      expect(response.status).toBe(400);
    }
  });

  it('returns 404 for an unknown session', async () => {
    const { app } = await buildApp();

    const response = await app.request(downloadUrl('missing', '/workspace/report.pdf'));

    expect(response.status).toBe(404);
  });

  it('returns 422 when the session did not enable file downloads', async () => {
    const { app, sessions } = await buildApp();
    const session = await sessions.create({
      tenant_id: TENANT_ID,
      session_id: 'no-downloads',
      agent_spec: agentSpec(false),
    });

    const response = await app.request(downloadUrl(session.session_id, '/workspace/report.pdf'));

    expect(response.status).toBe(422);
  });

  it('returns 404 when the session has no sandbox yet', async () => {
    const { app, sessions } = await buildApp();
    const session = await sessions.create({
      tenant_id: TENANT_ID,
      session_id: 'no-sandbox',
      agent_spec: agentSpec(true),
    });

    const response = await app.request(downloadUrl(session.session_id, '/workspace/report.pdf'));

    expect(response.status).toBe(404);
  });
});
