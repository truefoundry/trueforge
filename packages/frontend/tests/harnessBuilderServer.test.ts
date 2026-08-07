import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHarnessBuilderServer, providerOf, toModelSelection } from '../src/harnessBuilderServer';

describe('harnessBuilderServer', () => {
  it('providerOf takes the segment before the first slash', () => {
    assert.equal(providerOf('openai/gpt-4o'), 'openai');
    assert.equal(providerOf('anthropic/claude-sonnet-4'), 'anthropic');
  });

  it('providerOf falls back to the full name when there is no slash', () => {
    assert.equal(providerOf('gpt-4o'), 'gpt-4o');
  });

  it('toModelSelection forwards reasoningEfforts when present', () => {
    assert.deepEqual(
      toModelSelection({
        name: 'openai/o3',
        properties: { reasoningEfforts: ['low', 'medium', 'high'] },
      }),
      {
        name: 'openai/o3',
        provider: 'openai',
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    );
    assert.deepEqual(toModelSelection({ name: 'openai/gpt-4o', properties: {} }), {
      name: 'openai/gpt-4o',
      provider: 'openai',
    });
  });

  it('searchAgents maps registry rows to library entries with agentId + agentSpec', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/agents')) {
        return Response.json({
          data: [
            {
              id: 'agt_1',
              name: 'reviewer',
              model: { name: 'test/model' },
              instructions: 'Review carefully.',
              skills: [{ name: 'review' }],
              mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
            },
            { id: 'agt_2', name: 'writer', model: { name: 'test/model' } },
          ],
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    const all = await builder.searchAgents();
    assert.equal(all.length, 2);
    assert.deepEqual(all[0], {
      name: 'reviewer',
      agentId: 'agt_1',
      agentSpec: {
        model: { name: 'test/model' },
        instructions: 'Review carefully.',
        skills: [{ id: 'review', name: 'review' }],
        mcpServers: [{ id: 'github', name: 'github', enableTools: ['@all'] }],
      },
    });

    const filtered = await builder.searchAgents({ query: 'write' });
    assert.deepEqual(
      filtered.map(row => row.name),
      ['writer'],
    );
  });

  it('saveAgent creates when the name is new', async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/agents') && method === 'GET') {
        return Response.json({ data: [] });
      }
      if (url.endsWith('/api/v1/agents') && method === 'POST' && typeof init?.body === 'string') {
        requests.push({ method, url, body: JSON.parse(init.body) });
        return Response.json({
          data: { id: 'agt_new', name: 'saved-agent', model: { name: 'test/model' } },
        });
      }
      return new Response(`Unexpected request: ${method} ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    const result = await builder.saveAgent({
      agentName: 'saved-agent',
      agentSpec: {
        model: { name: 'test/model' },
        skills: [{ id: 'review', name: 'review' }],
      },
    });

    assert.deepEqual(result, { ok: true, updated: false, agentId: 'agt_new' });
    assert.deepEqual(requests.at(-1)?.body, {
      name: 'saved-agent',
      model: { name: 'test/model' },
      skills: [{ name: 'review' }],
    });
  });

  it('saveAgent updates when the name already exists', async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/agents') && method === 'GET') {
        return Response.json({
          data: [{ id: 'agt_1', name: 'writer', model: { name: 'test/model' } }],
        });
      }
      if (url.endsWith('/api/v1/agents/writer') && method === 'PUT' && typeof init?.body === 'string') {
        requests.push({ method, url, body: JSON.parse(init.body) });
        return Response.json({
          data: {
            id: 'agt_1',
            name: 'writer',
            model: { name: 'test/model' },
            instructions: 'Write release notes.',
          },
        });
      }
      return new Response(`Unexpected request: ${method} ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    const result = await builder.saveAgent({
      agentName: 'writer',
      agentSpec: {
        model: { name: 'test/model' },
        instructions: 'Write release notes.',
      },
    });

    assert.deepEqual(result, { ok: true, updated: true, agentId: 'agt_1' });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, {
      model: { name: 'test/model' },
      instructions: 'Write release notes.',
    });
  });
});
