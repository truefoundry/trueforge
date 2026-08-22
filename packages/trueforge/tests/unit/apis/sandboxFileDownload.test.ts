import { OpenAPIHono } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import type { SandboxProvider } from '@truefoundry/trueforge-core/core';
import { SandboxFileNotFoundError } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { makeCreateTurnInput } from '../../../../trueforge-core/tests/agent-session/testHelpers';
import { TENANT_ID } from '../../../src/apis/sessions';
import { createTurnsRouter, toContentDisposition } from '../../../src/apis/turns';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
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
import { resolveSandboxProvider } from '../../../src/runtime/sessionResources';

jest.mock('../../../src/runtime/sessionResources', () => ({
  ...jest.requireActual('../../../src/runtime/sessionResources'),
  resolveSandboxProvider: jest.fn(),
}));

const mockedResolveSandboxProvider = jest.mocked(resolveSandboxProvider);

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
  const app = new OpenAPIHono();

  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore,
      activeTurns: new ActiveTurnRegistry(),
      modelProviderStore: new SqliteModelProviderStore(db),
      mcpServerStore: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      skillStore: new SqliteSkillStore(db),
      agentStore: new SqliteAgentStore(db),
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      logger: createLogger({ silent: true }),
      resolveUserContext: () => LOCAL_USER_CONTEXT,
    }),
  );

  return { app, sessions, sessionStore };
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
      tenant_id: TENANT_ID,
      session_id: 'no-turn',
      created_by: LOCAL_USER_CONTEXT.userRef,
      agent: { type: 'inline', spec: agentSpec() },
    });

    const response = await app.request(downloadUrl({ sessionId: session.session_id, path: '/workspace/report.pdf' }));

    expect(response.status).toBe(404);
  });
});

describe('download-sandbox-file streaming', () => {
  const RAW_SANDBOX_ID = 'raw-sbx-id';

  /** Session with one turn whose snapshot carries a sandbox id, so the route reaches the provider. */
  async function buildSessionWithSandboxTurn(): Promise<{ app: OpenAPIHono; sessionId: string }> {
    const { app, sessions, sessionStore } = await buildApp();
    const session = await sessions.create({
      tenant_id: TENANT_ID,
      session_id: 'with-sbx-turn',
      created_by: LOCAL_USER_CONTEXT.userRef,
      agent: { type: 'inline', spec: agentSpec() },
    });
    await sessionStore.createTurn(makeCreateTurnInput({ sessionId: session.session_id, turnId: 'turn-1' }));
    await sessionStore.patchSandboxInfo({
      session_id: session.session_id,
      turn_id: 'turn-1',
      sandbox_info: { sandbox_id: RAW_SANDBOX_ID },
    });
    return { app, sessionId: session.session_id };
  }

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('streams bytes to the client progressively with exact headers', async () => {
    const encoder = new TextEncoder();
    let releaseSecondChunk: (() => void) | undefined;
    const secondChunkGated = new Promise<void>(resolve => {
      releaseSecondChunk = resolve;
    });
    const downloadFile = jest.fn(async () => ({
      size: 11,
      stream: new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('part-one-'));
          await secondChunkGated;
          controller.enqueue(encoder.encode('tail'));
          controller.close();
        },
      }),
    }));
    mockedResolveSandboxProvider.mockResolvedValue({ type: 'test', downloadFile } as unknown as SandboxProvider);

    const { app, sessionId } = await buildSessionWithSandboxTurn();
    // The handler returns as soon as headers exist; the body keeps streaming after this resolves.
    const response = await app.request(downloadUrl({ sessionId, path: '/workspace/report.pdf' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Length')).toBe('11');
    expect(response.headers.get('Content-Disposition')).toBe(toContentDisposition('/workspace/report.pdf'));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(downloadFile).toHaveBeenCalledWith({
      sandboxId: RAW_SANDBOX_ID,
      path: '/workspace/report.pdf',
      signal: expect.anything(),
    });

    const body = response.body;
    if (!body) {
      throw new Error('response has no body');
    }
    const reader = body.getReader();
    // The producer is parked on secondChunkGated: receiving the first chunk here proves
    // bytes reach the client before the whole file has been produced.
    const first = await reader.read();
    expect(Buffer.from(first.value).toString()).toBe('part-one-');

    releaseSecondChunk?.();
    const second = await reader.read();
    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(Buffer.from(first.value).toString() + Buffer.from(second.value).toString()).toBe('part-one-tail');
  });

  it('maps provider SandboxError rejections to their status before any body starts', async () => {
    mockedResolveSandboxProvider.mockResolvedValue({
      type: 'test',
      downloadFile: jest.fn(async () => {
        throw new SandboxFileNotFoundError('/workspace/gone.txt');
      }),
    } as unknown as SandboxProvider);

    const { app, sessionId } = await buildSessionWithSandboxTurn();
    const response = await app.request(downloadUrl({ sessionId, path: '/workspace/gone.txt' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: 'File not found: /workspace/gone.txt' } });
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
