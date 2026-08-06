import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHarnessChatServer, type HarnessAgentSpec } from '../src/harnessServer';

const session = {
  id: 'ses_1',
  agent: {
    type: 'value',
    agent_spec: {
      model: { name: 'test/model' },
      mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
      skills: [{ name: 'review' }],
    },
  },
  title: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-03T00:00:00.000Z',
};

const turnRequests: unknown[] = [];
const sessionRequests: unknown[] = [];
const subscribeRequests: (string | null)[] = [];

const fetchMock: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = init?.method ?? 'GET';
  if (url.endsWith('/api/v1/sessions/ses_1/turns') && typeof init?.body === 'string') {
    const body: unknown = JSON.parse(init.body);
    turnRequests.push(body);
  }
  if (url.endsWith('/api/v1/sessions') && method === 'POST') {
    if (typeof init?.body === 'string') {
      sessionRequests.push(JSON.parse(init.body));
    }
    return Response.json({ data: session });
  }
  if (url.includes('/api/v1/sessions?') || url.endsWith('/api/v1/sessions')) {
    return Response.json({ data: [session], pagination: { limit: 20, next_page_token: 'tok_2' } });
  }
  if (url.endsWith('/api/v1/sessions/ses_1/turns')) {
    return new Response(
      'id: 7\ndata: {"type":"model.message.delta","id":"evt_1","thread_id":"main","content":"hello"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  if (url.includes('/api/v1/sessions/ses_1/turns/trn_1/subscribe')) {
    // SDK join can yield a relative path; base is only for URL parsing.
    const after = new URL(url, 'http://test.local').searchParams.get('after_sequence_number');
    subscribeRequests.push(after);
    return new Response(
      'id: 8\ndata: {"type":"model.message.delta","id":"evt_2","thread_id":"main","content":"world"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  return new Response(`Unexpected request: ${method} ${url}`, { status: 500 });
};

describe('createHarnessChatServer', () => {
  it('derives mount ids Harness does not store', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });
    const spec: HarnessAgentSpec = { model: { name: 'test/model' } };

    const created = await server.createSession({ agentSpec: spec });

    assert.equal(created.isMutable, true);
    assert.equal(created.title, undefined);
    assert.deepEqual(created.agentSpec?.mcpServers?.[0]?.id, 'github');
    assert.deepEqual(created.agentSpec?.skills?.[0], { id: 'review', name: 'review' });
  });

  it('sends skill name refs and strips UI-only mount ids before admission', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    await server.createSession({
      agentSpec: {
        model: { name: 'test/model' },
        // The picker round-trips a mount as `{ id, name }`.
        skills: [{ id: 'review', name: 'review' }],
        mcpServers: [{ id: 'github', name: 'github', enableTools: ['@all'] }],
      },
    });

    const sent = sessionRequests.at(-1);
    assert.ok(sent !== null && typeof sent === 'object' && 'agent' in sent);
    assert.deepEqual(sent.agent, {
      type: 'value',
      agent_spec: {
        model: { name: 'test/model' },
        mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
        skills: [{ name: 'review' }],
      },
    });
  });

  it('reports pages under both the SDK and runtime pagination contracts', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    const page = await server.listSessions({ limit: 20 });

    assert.equal(page.data[0]?.id, 'ses_1');
    assert.equal(page.hasNextPage(), true);
    assert.equal(page.response.pagination.nextPageToken, 'tok_2');
  });

  it('preserves SSE sequence numbers and roots chains Harness-style', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    const events = [];
    for await (const event of server.createTurn({
      sessionId: 'ses_1',
      input: [{ type: 'user.message', content: 'hello' }],
      // The runtime's root sentinel; Harness 404s unless it becomes `null`.
      previousTurnId: 'none',
    })) {
      events.push(event);
    }

    const sent = turnRequests.at(-1);
    assert.ok(sent !== null && typeof sent === 'object' && 'previous_turn_id' in sent);
    assert.equal(sent.previous_turn_id, null);

    assert.deepEqual(events, [
      {
        sequenceNumber: 7,
        event: {
          type: 'model.message.delta',
          id: 'evt_1',
          threadId: 'main',
          content: 'hello',
        },
      },
    ]);
  });

  it('subscribes to a turn and forwards afterSequenceNumber', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });
    assert.ok(server.subscribeToTurn);

    const events = [];
    for await (const event of server.subscribeToTurn({
      sessionId: 'ses_1',
      turnId: 'trn_1',
      afterSequenceNumber: 7,
    })) {
      events.push(event);
    }

    assert.equal(subscribeRequests.at(-1), '7');
    assert.deepEqual(events, [
      {
        sequenceNumber: 8,
        event: {
          type: 'model.message.delta',
          id: 'evt_2',
          threadId: 'main',
          content: 'world',
        },
      },
    ]);
  });
});
