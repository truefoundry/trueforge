import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createHarnessChatServer, type HarnessAgentSpec } from '@/plugins/trueforge-agent-server-adapter/chatServer.js';

const session = {
  id: 'ses_1',
  agent: {
    type: 'inline',
    spec: {
      model: { name: 'test/model' },
      mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
      skills: [{ name: 'review' }],
    },
  },
  title: null,
  created_by: 'trueforge-default',
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-03T00:00:00.000Z',
};

const turnRequests: unknown[] = [];
const sessionRequests: unknown[] = [];
const deletedSessions: string[] = [];
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
  if (url.endsWith('/api/v1/sessions/ses_1') && method === 'DELETE') {
    deletedSessions.push('ses_1');
    return new Response(null, { status: 204 });
  }
  if (url.includes('/api/v1/sessions?') || url.endsWith('/api/v1/sessions')) {
    return Response.json({ data: [session], pagination: { limit: 20, next_page_token: 'tok_2' } });
  }
  if (url.endsWith('/api/v1/agents')) {
    return Response.json({ data: [] });
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
  it('forwards gateway-shaped mounts without synthesizing ids', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });
    const spec: HarnessAgentSpec = { model: { name: 'test/model' } };

    const created = await server.createSession({ agentSpec: spec });

    assert.equal(created.isMutable, true);
    assert.equal(created.title, undefined);
    assert.deepEqual(created.agentSpec?.mcpServers?.[0], { name: 'github', enableTools: ['@all'] });
    assert.deepEqual(created.agentSpec?.skills?.[0], { name: 'review' });
  });

  it('sends skill name refs and strips UI-only mount ids before admission', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    await server.createSession({
      agentSpec: {
        model: { name: 'test/model' },
        // Draft picker may round-trip a mount as `{ id, name }`.
        skills: [{ name: 'review' }],
        mcpServers: [{ name: 'github', enableTools: ['@all'] }],
      },
    });

    const sent = sessionRequests.at(-1);
    assert.ok(sent !== null && typeof sent === 'object' && 'agent' in sent);
    assert.deepEqual(sent.agent, {
      spec: {
        model: { name: 'test/model' },
        mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
        skills: [{ name: 'review' }],
      },
    });
  });

  it('reports pages under the ListResult pagination contract', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    const page = await server.listSessions({ limit: 20 });

    assert.equal(page.data[0]?.id, 'ses_1');
    assert.equal(page.nextPageToken, 'tok_2');
  });

  it('preserves SSE sequence numbers and roots chains Harness-style', async () => {
    const server = createHarnessChatServer({ fetch: fetchMock });

    const events = [];
    for await (const event of server.createTurn({
      sessionId: 'ses_1',
      input: [{ type: 'user.message', content: 'hello' }],
      previousTurnId: 'none',
    })) {
      events.push(event);
    }

    const sent = turnRequests.at(-1);
    assert.ok(sent !== null && typeof sent === 'object' && 'previous_turn_id' in sent && 'stream' in sent);
    assert.equal(sent.previous_turn_id, 'none');
    assert.equal(sent.stream, true);

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

  it('creates a named session from agentName and reports it immutable', async () => {
    const requests: { url: string; body?: unknown }[] = [];
    const fetchNamed: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/sessions') && init?.method === 'POST' && typeof init.body === 'string') {
        requests.push({ url, body: JSON.parse(init.body) });
        return Response.json({ data: { ...session, agent: { type: 'reference', id: 'agt_1', name: 'reviewer' } } });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const server = createHarnessChatServer({ fetch: fetchNamed });
    const created = await server.createSession({ agentName: 'reviewer' });

    assert.deepEqual(requests.at(-1)?.body, { agent: { name: 'reviewer' } });
    assert.equal(created.isMutable, false);
    assert.equal(created.agentName, 'reviewer');
    assert.equal(created.agentSpec, undefined);
  });

  it('filters listSessions by registry agentId and stamps the wire name on ref rows', async () => {
    let listUrl: string | undefined;
    let listedAgents = false;
    const fetchNamed: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/agents')) {
        listedAgents = true;
        return Response.json({ data: [] });
      }
      if (url.includes('/api/v1/sessions?')) {
        listUrl = url;
        return Response.json({
          data: [{ ...session, agent: { type: 'reference', id: 'agt_1', name: 'reviewer' } }],
          pagination: { limit: 20 },
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const server = createHarnessChatServer({ fetch: fetchNamed });
    const page = await server.listSessions({ agentId: 'agt_1' });

    assert.equal(listedAgents, false);
    assert.ok(listUrl !== undefined);
    assert.equal(new URL(listUrl, 'http://test.local').searchParams.get('agent_id'), 'agt_1');
    assert.equal(page.data[0]?.agentName, 'reviewer');
    assert.equal(page.data[0]?.isMutable, false);
  });

  it('listSessions forwards an unknown agentId to the API (empty page from the server)', async () => {
    let listUrl: string | undefined;
    const fetchNamed: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/api/v1/sessions?')) {
        listUrl = url;
        return Response.json({ data: [], pagination: { limit: 10 } });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const server = createHarnessChatServer({ fetch: fetchNamed });
    const page = await server.listSessions({ agentId: 'ghost', limit: 10 });

    assert.ok(listUrl !== undefined);
    assert.equal(new URL(listUrl, 'http://test.local').searchParams.get('agent_id'), 'ghost');
    assert.deepEqual(page.data, []);
    assert.equal(page.nextPageToken, undefined);
  });

  it('getSession takes the agentName of a ref session from the wire, without a registry lookup', async () => {
    let listedAgents = false;
    const fetchNamed: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/agents')) {
        listedAgents = true;
        return Response.json({ data: [] });
      }
      if (url.endsWith('/api/v1/sessions/ses_1')) {
        return Response.json({ data: { ...session, agent: { type: 'reference', id: 'agt_1', name: 'reviewer' } } });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const server = createHarnessChatServer({ fetch: fetchNamed });
    const found = await server.getSession({ sessionId: 'ses_1' });

    assert.equal(listedAgents, false);
    assert.equal(found.agentName, 'reviewer');
    assert.equal(found.isMutable, false);
  });

  it('getSession leaves a ref session unlabelled when it carries no name snapshot', async () => {
    const fetchNamed: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/sessions/ses_1')) {
        return Response.json({ data: { ...session, agent: { type: 'reference', id: 'agt_deleted', name: null } } });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const server = createHarnessChatServer({ fetch: fetchNamed });
    const found = await server.getSession({ sessionId: 'ses_1' });

    assert.equal(found.isMutable, false);
    assert.equal(found.agentName, undefined);
  });

  it('deletes sessions through the Harness SDK client', async () => {
    deletedSessions.length = 0;
    const server = createHarnessChatServer({ fetch: fetchMock });
    if (server.deleteSession === undefined) {
      throw new Error('Expected deleteSession to be implemented');
    }

    await server.deleteSession({ sessionId: 'ses_1' });

    assert.deepEqual(deletedSessions, ['ses_1']);
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
