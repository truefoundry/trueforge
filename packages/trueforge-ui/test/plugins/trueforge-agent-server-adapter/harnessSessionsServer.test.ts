import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  createHarnessSessionsServer,
  toUiAgentDetail,
  toUiCodeSnippets,
  toUiSessionListEntry,
} from '@/plugins/trueforge-agent-server-adapter/sessionsServer.js';

const agent = {
  id: 'agt_1',
  name: 'release-notes-writer',
  manifest: {
    model: { name: 'test/model' },
    mcpServers: [{ name: 'github', enableTools: ['@all'] }],
    skills: [{ name: 'review' }],
  },
};

const wireAgent = {
  id: 'agt_1',
  name: 'release-notes-writer',
  manifest: {
    model: { name: 'test/model' },
    mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
    skills: [{ name: 'review' }],
  },
};

const referenceSession = {
  id: 'ses_1',
  agent: { type: 'reference' as const, id: 'agt_1', name: 'release-notes-writer' },
  title: 'Ship notes',
  createdBy: 'trueforge-default',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const inlineSession = {
  id: 'ses_2',
  agent: {
    type: 'inline' as const,
    spec: {
      model: { name: 'test/model' },
      skills: [{ name: 'review' }],
    },
  },
  title: null,
  createdBy: 'trueforge-default',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T12:00:00.000Z',
};

const wireReferenceSession = {
  id: 'ses_1',
  agent: { type: 'reference', id: 'agt_1', name: 'release-notes-writer' },
  title: 'Ship notes',
  created_by: 'trueforge-default',
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-04T00:00:00.000Z',
};

const wireInlineSession = {
  id: 'ses_2',
  agent: {
    type: 'inline',
    spec: {
      model: { name: 'test/model' },
      skills: [{ name: 'review' }],
    },
  },
  title: null,
  created_by: 'trueforge-default',
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-03T12:00:00.000Z',
};

const listSessionQueries: URLSearchParams[] = [];
const listEventQueries: URLSearchParams[] = [];

const fetchMock: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const parsed = new URL(url, 'http://test.local');

  if (parsed.pathname === '/api/v1/agents/agt_1' && method === 'GET') {
    return Response.json({ data: wireAgent });
  }
  if (parsed.pathname === '/api/v1/agents/agt_1/code-snippets' && method === 'GET') {
    return Response.json({
      data: {
        base_url: 'https://example.test',
        snippets: [
          {
            label_name: 'TypeScript',
            language: 'typescript',
            icon: 'https://assets.example/typescript.svg',
            sample_code: { stream: 'stream()', non_stream: 'await()' },
          },
        ],
      },
    });
  }
  if (parsed.pathname === '/api/v1/sessions' && method === 'GET') {
    listSessionQueries.push(parsed.searchParams);
    return Response.json({
      data: [wireReferenceSession, wireInlineSession],
      pagination: { limit: 20, next_page_token: 'tok_next' },
    });
  }
  if (parsed.pathname === '/api/v1/sessions/ses_1/events' && method === 'GET') {
    listEventQueries.push(parsed.searchParams);
    return Response.json({
      data: [
        {
          turn_id: 'trn_1',
          event: {
            type: 'turn.done',
            id: 'evt_1',
            created_at: '2026-08-03T00:00:01.000Z',
            thread_id: null,
            state: {
              status: 'done',
              completed_at: '2026-08-03T00:00:01.000Z',
              output: null,
              required_actions: [],
            },
          },
        },
      ],
      pagination: { limit: 50 },
    });
  }
  return new Response(`Unexpected request: ${method} ${url}`, { status: 500 });
};

describe('toUiAgentDetail / toUiSessionListEntry / toUiCodeSnippets', () => {
  it('maps agent detail and session list rows onto the UI contract', () => {
    assert.deepEqual(toUiAgentDetail(agent), {
      agentId: 'agt_1',
      name: 'release-notes-writer',
      agentSpec: {
        model: { name: 'test/model' },
        mcpServers: [{ name: 'github', enableTools: ['@all'] }],
        skills: [{ name: 'review' }],
      },
    });

    assert.deepEqual(toUiSessionListEntry(referenceSession), {
      id: 'ses_1',
      title: 'Ship notes',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      lastActivityAt: '2026-08-04T00:00:00.000Z',
      metrics: { totalTurns: 0, totalCostInUsd: 0, totalDurationMs: 0 },
      agentName: 'release-notes-writer',
    });

    assert.deepEqual(toUiSessionListEntry(inlineSession), {
      id: 'ses_2',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
      lastActivityAt: '2026-08-03T12:00:00.000Z',
      metrics: { totalTurns: 0, totalCostInUsd: 0, totalDurationMs: 0 },
      agentSpec: {
        model: { name: 'test/model' },
        skills: [{ name: 'review' }],
      },
    });
  });

  it('maps fern-excluded code-snippets wire snake_case to UI camelCase', () => {
    assert.deepEqual(
      toUiCodeSnippets({
        data: {
          base_url: 'https://example.test',
          snippets: [
            {
              label_name: 'TypeScript',
              language: 'typescript',
              icon: 'https://assets.example/typescript.svg',
              sample_code: { stream: 'a', non_stream: 'b' },
            },
          ],
        },
      }),
      [
        {
          labelName: 'TypeScript',
          language: 'typescript',
          icon: 'https://assets.example/typescript.svg',
          sampleCode: { stream: 'a', nonStream: 'b' },
        },
      ],
    );
  });
});

describe('createHarnessSessionsServer', () => {
  it('loads agent detail and code snippets', async () => {
    const server = createHarnessSessionsServer({ fetch: fetchMock });

    assert.equal((await server.getAgent({ agentId: 'agt_1' })).agentId, 'agt_1');
    assert.deepEqual(await server.getCodeSnippets({ agentId: 'agt_1' }), [
      {
        labelName: 'TypeScript',
        language: 'typescript',
        icon: 'https://assets.example/typescript.svg',
        sampleCode: { stream: 'stream()', nonStream: 'await()' },
      },
    ]);
  });

  it('lists sessions with agent and timestamp filters under ListResult', async () => {
    const server = createHarnessSessionsServer({ fetch: fetchMock });

    const page = await server.listSessions({
      agentId: 'agt_1',
      limit: 20,
      startTimestamp: '2026-08-01T00:00:00.000Z',
      endTimestamp: '2026-08-31T00:00:00.000Z',
    });

    assert.equal(page.nextPageToken, 'tok_next');
    assert.equal(page.data[0]?.id, 'ses_1');
    assert.equal(page.data[0]?.agentName, 'release-notes-writer');
    assert.equal(page.data[1]?.agentSpec?.skills?.[0]?.name, 'review');

    const query = listSessionQueries.at(-1);
    assert.ok(query);
    assert.equal(query.get('agent_id'), 'agt_1');
    assert.equal(query.get('limit'), '20');
    assert.equal(query.get('start_timestamp'), '2026-08-01T00:00:00.000Z');
    assert.equal(query.get('end_timestamp'), '2026-08-31T00:00:00.000Z');
  });

  it('lists session events and maps turn.done onto the UI terminal state', async () => {
    const server = createHarnessSessionsServer({ fetch: fetchMock });

    const page = await server.listSessionEvents({ sessionId: 'ses_1', limit: 50, pageToken: 'evt_tok' });

    assert.equal(page.data[0]?.turnId, 'trn_1');
    assert.equal(page.data[0]?.event.type, 'turn.done');
    if (page.data[0]?.event.type === 'turn.done') {
      assert.equal(page.data[0].event.state.status, 'done');
    }

    const query = listEventQueries.at(-1);
    assert.ok(query);
    assert.equal(query.get('limit'), '50');
    assert.equal(query.get('page_token'), 'evt_tok');
  });
});
