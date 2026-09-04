import { OpenAPIHono } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import { createTurnsRouter, toContentDisposition } from '../../../src/apis/turns';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription';

/** Parsed rather than built literally, so config defaults match what the create route stores. */
function agentSpec(): AgentSpec {
  return AgentSpecSchema.parse({
    model: { name: 'openai/gpt-4o' },
    config: { sandbox: { enabled: true } },
  });
}

async function buildApp() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sessionStore = new SqliteSessionStore(db);
  const sessions = new Sessions({ sessionStore });
  const tokenStore = new SqliteOAuthTokenStore(db);
  const app = new OpenAPIHono();

  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore,
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => new SqliteModelProviderStore(db),
      resolveMcpServerStore: () =>
        new McpServerWithAuthStore({
          store: new SqliteMcpServerStore(db),
          tokenStore,
          clientName: 'test-client',
        }),
      resolveSkillStore: () => new SqliteSkillStore(db),
      resolveAgentStore: () => new SqliteAgentStore(db),
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      logger: createLogger({ silent: true }),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    }),
  );

  return { app, sessions };
}

function downloadUrl({
  sessionId,
  turnId = 'turn-1',
  path,
}: {
  sessionId: string;
  turnId?: string;
  path: string;
}): string {
  return `http://localhost/${sessionId}/turns/${turnId}/download-sandbox-file?path=${encodeURIComponent(path)}`;
}

describe('GET /{session_id}/turns/{turn_id}/download-sandbox-file', () => {
  it('rejects a malformed path before touching the session', async () => {
    const { app } = await buildApp();

    for (const path of [
      'report.pdf',
      '/a/../../etc/passwd',
      '/tmp/nul\0.txt',
      `/tmp/${'a'.repeat(300)}`,
      `/${'a/'.repeat(3000)}b`,
    ]) {
      const response = await app.request(downloadUrl({ sessionId: 'missing', path }));

      expect(response.status).toBe(400);
    }
  });

  // PATH_MAX counts the terminating NUL, so 4096 is already too long for the kernel and must be
  // rejected here rather than reaching the provider as an opaque backend failure.
  it('rejects a path at PATH_MAX but allows one byte shorter', async () => {
    const { app } = await buildApp();
    // Short segments so the length that trips is the whole path, not NAME_MAX.
    const pathOfLength = (length: number) => {
      let path = '/tmp';
      while (path.length < length) path += `/${'a'.repeat(Math.min(50, length - path.length - 1))}`;
      return path.slice(0, length);
    };

    expect((await app.request(downloadUrl({ sessionId: 'missing', path: pathOfLength(4096) }))).status).toBe(400);
    // Not 400: the shape is fine, so it fails later on the session lookup instead.
    expect((await app.request(downloadUrl({ sessionId: 'missing', path: pathOfLength(4095) }))).status).toBe(404);
  });

  it('returns 404 for an unknown session', async () => {
    const { app } = await buildApp();

    const response = await app.request(downloadUrl({ sessionId: 'missing', path: '/workspace/report.pdf' }));

    expect(response.status).toBe(404);
  });

  it('returns 404 for a turn that does not exist in the session', async () => {
    const { app, sessions } = await buildApp();
    const session = await sessions.create({
      tenant_id: 'default',
      session_id: 'no-turn',
      created_by_subject: {
        subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
        subject_type: STANDALONE_REQUEST_CONTEXT.subject.type,
        subject_display_name: STANDALONE_REQUEST_CONTEXT.subject.display_name,
      },
      agent: { type: 'inline', spec: agentSpec() },
      external_id: null,
    });

    const response = await app.request(downloadUrl({ sessionId: session.session_id, path: '/workspace/report.pdf' }));

    expect(response.status).toBe(404);
  });
});

describe('toContentDisposition', () => {
  it('names the file after the last path segment', () => {
    expect(toContentDisposition('/workspace/out/report.pdf')).toBe(`attachment; filename*=UTF-8''report.pdf`);
  });

  it('falls back when the path has no usable segment', () => {
    expect(toContentDisposition('/')).toBe(`attachment; filename*=UTF-8''download`);
  });

  it('percent-encodes a name that cannot be written into a header directly', () => {
    expect(toContentDisposition('/w/中文.csv')).toBe(`attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.csv`);
  });

  it('encodes the characters RFC 5987 disallows but encodeURIComponent keeps', () => {
    expect(toContentDisposition(`/w/quote'(1)*.txt`)).toBe(`attachment; filename*=UTF-8''quote%27%281%29%2A.txt`);
  });

  it('produces a header the Response constructor accepts for any name', () => {
    for (const path of ['/w/中文报告.csv', '/w/emoji-🎉.txt', '/w/a\r\nX-Injected: 1.txt', '/w/a"b\\c.txt']) {
      const header = toContentDisposition(path);

      expect(new Response('x', { headers: { 'Content-Disposition': header } }).headers.get('content-disposition')).toBe(
        header,
      );
    }
  });
});
