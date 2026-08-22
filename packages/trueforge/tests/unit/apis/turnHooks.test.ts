/**
 * Lifecycle hooks at the turns API boundary: user_prompt_submit gating before
 * createTurn and turn_done dispatch from the event drain. Hook commands are
 * real node scripts (the spawn contract is covered in hooks/commandHookRunner);
 * Sessions is stubbed the same way as the neighboring turns tests.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Sessions, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from 'winston';
import { createTurnsRouter } from '../../../src/apis/turns';
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
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';
import { HooksFileSchema, type HooksFile } from '../../../src/schemas/hooks';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-turn-hooks-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scriptCommand(script: string): string {
  const file = path.join(tempDir(), 'hook.js');
  fs.writeFileSync(file, script);
  return `"${process.execPath}" "${file}"`;
}

const TURN_CREATED_EVENT = {
  type: 'turn.created',
  id: 'evt_created',
  turn_id: 'turn-hooked',
  previous_turn_id: null,
  state: { status: 'running' },
  created_at: '2026-01-01T00:00:00.000Z',
  thread_id: null,
};

const TURN_DONE_EVENT = {
  type: 'turn.done',
  id: 'evt_done',
  state: { status: 'done', output: [] },
  created_at: '2026-01-01T00:00:01.000Z',
  thread_id: null,
};

async function makeApp(input: { hooks: HooksFile; onCreateTurn?: () => void }) {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const sessions = {
    get: () =>
      Promise.resolve({
        record: { last_turn_id: 'earlier-turn', created_by: LOCAL_USER_CONTEXT.userRef },
        createTurn: () => {
          input.onCreateTurn?.();
          return Promise.resolve({
            id: 'turn-hooked',
            record: {
              turn_id: 'turn-hooked',
              session_id: 's1',
              previous_turn_id: null,
              input: [],
              state: { status: 'running' },
              created_at: new Date('2026-01-01T00:00:00.000Z'),
            },
            stream: async function* stream(): AsyncGenerator<unknown> {
              yield TURN_CREATED_EVENT;
              yield TURN_DONE_EVENT;
            },
          });
        },
      }),
  } as unknown as Sessions;

  const app = new OpenAPIHono();
  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore: new SqliteSessionStore(db),
      activeTurns: new ActiveTurnRegistry(),
      modelProviderStore: new SqliteModelProviderStore(db),
      mcpServerStore: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      skillStore: new SqliteSkillStore(db),
      agentStore: new SqliteAgentStore(db),
      eventSubscriptions: new EventSubscriptionRegistry<TurnStreamingEvent>(undefined),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      hooks: input.hooks,
      logger: createLogger({ silent: true }),
      resolveUserContext: () => LOCAL_USER_CONTEXT,
    }),
  );
  return app;
}

function postTurn(app: OpenAPIHono, body: Record<string, unknown>) {
  return app.request('/s1/turns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const USER_MESSAGE_INPUT = [{ type: 'user.message', content: 'please do the thing' }];

describe('turn lifecycle hooks', () => {
  it('user_prompt_submit deny returns 403 with the reason and never creates the turn', async () => {
    let created = false;
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: {
          user_prompt_submit: [
            {
              type: 'command',
              command: scriptCommand(`console.log(JSON.stringify({ status: 'deny', reason: 'prompt rejected' }));`),
            },
          ],
        },
      }),
      onCreateTurn: () => {
        created = true;
      },
    });

    const response = await postTurn(app, { stream: false, input: USER_MESSAGE_INPUT });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: 'Prompt blocked by user_prompt_submit hook: prompt rejected' },
    });
    expect(created).toBe(false);
  });

  it('user_prompt_submit allow proceeds to create the turn', async () => {
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: { user_prompt_submit: [{ type: 'command', command: scriptCommand('process.exit(0);') }] },
      }),
    });

    const response = await postTurn(app, { stream: false, input: USER_MESSAGE_INPUT });
    expect(response.status).toBe(200);
  });

  it('user_prompt_submit fires for a file-only user message (empty prompt text is not a bypass)', async () => {
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: {
          user_prompt_submit: [
            {
              type: 'command',
              command: scriptCommand(`console.log(JSON.stringify({ status: 'deny', reason: 'image blocked' }));`),
            },
          ],
        },
      }),
    });

    const response = await postTurn(app, {
      stream: false,
      input: [
        {
          type: 'user.message',
          content: [{ type: 'file', name: 'instructions.png', data: 'data:image/png;base64,AAAA' }],
        },
      ],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: 'Prompt blocked by user_prompt_submit hook: image blocked' },
    });
  });

  it('user_prompt_submit fires for a client-side tool answer (tool_response-only turns are gated)', async () => {
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: {
          user_prompt_submit: [
            {
              type: 'command',
              command: scriptCommand(`console.log(JSON.stringify({ status: 'deny', reason: 'answer blocked' }));`),
            },
          ],
        },
      }),
    });

    const response = await postTurn(app, {
      stream: false,
      input: [
        { type: 'user.tool_response', thread_id: 'thread-1', tool_call_id: 'call-1', content: 'do the bad thing' },
      ],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: 'Prompt blocked by user_prompt_submit hook: answer blocked' },
    });
  });

  it('user_prompt_submit is skipped for input without user text (approval-only turns)', async () => {
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: { user_prompt_submit: [{ type: 'command', command: scriptCommand('process.exit(2);') }] },
      }),
    });

    const response = await postTurn(app, {
      stream: false,
      input: [
        { type: 'user.tool_approval', thread_id: 'thread-1', tool_call_id: 'call-1', approval: { status: 'allow' } },
      ],
    });
    expect(response.status).toBe(200);
  });

  it('turn_done fires after the terminal event with the turn identity and status', async () => {
    const marker = path.join(tempDir(), 'turn-done-payload.json');
    const app = await makeApp({
      hooks: HooksFileSchema.parse({
        version: 1,
        hooks: {
          turn_done: [
            {
              type: 'command',
              command: scriptCommand(
                `let data = '';
                 process.stdin.on('data', chunk => { data += chunk; });
                 process.stdin.on('end', () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, data); });`,
              ),
            },
          ],
        },
      }),
    });

    const response = await postTurn(app, { stream: true, input: USER_MESSAGE_INPUT });
    expect(response.status).toBe(200);
    await response.text();

    // turn_done is dispatched off the response path (unawaited), so the marker
    // lands shortly after the stream closes — poll briefly.
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    expect(JSON.parse(fs.readFileSync(marker, 'utf8'))).toEqual({
      hook_event_name: 'turn_done',
      session_id: 's1',
      // The handler mints the turn id before createTurn; the stub session
      // returns its own id, so only the minted `.local` peering shape is stable.
      turn_id: expect.stringMatching(/\.local$/),
      status: 'done',
    });
  });
});
