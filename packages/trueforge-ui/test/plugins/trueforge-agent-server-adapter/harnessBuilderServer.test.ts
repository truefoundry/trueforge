import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  createHarnessBuilderServer,
  modelProviderLogosByName,
  toModelSelection,
} from '@/plugins/trueforge-agent-server-adapter/builderServer.js';

describe('harnessBuilderServer', () => {
  it('modelProviderLogosByName maps well-known catalog logos by type', () => {
    const logos = modelProviderLogosByName([
      {
        type: 'openai',
        logo: 'https://assets.example/openai.svg',
        models: [{ modelId: 'gpt', name: 'gpt', properties: {} }],
      },
      {
        type: 'anthropic',
        models: [{ modelId: 'claude', name: 'claude', properties: {} }],
      },
      { type: 'custom', supportedReasoningEfforts: ['low'] },
    ]);
    assert.equal(logos.get('openai'), 'https://assets.example/openai.svg');
    assert.equal(logos.has('anthropic'), false);
    assert.equal(logos.has('custom'), false);
  });

  it('toModelSelection maps nested provider + properties and optional logo', () => {
    assert.deepEqual(
      toModelSelection({
        model: {
          modelId: 'o3',
          name: 'openai/o3',
          provider: { name: 'openai' },
          properties: {
            contextLength: 200_000,
            maxOutputTokens: 100_000,
            reasoningEfforts: ['low', 'medium', 'high'],
          },
        },
        logo: 'https://assets.example/openai.svg',
      }),
      {
        id: 'o3',
        name: 'openai/o3',
        provider: { name: 'openai', logo: 'https://assets.example/openai.svg' },
        properties: {
          contextLength: 200_000,
          maxOutputTokens: 100_000,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      },
    );
    assert.deepEqual(
      toModelSelection({
        model: {
          modelId: 'gpt-4o',
          name: 'openai/gpt-4o',
          provider: { name: 'openai' },
          properties: {},
        },
      }),
      {
        id: 'gpt-4o',
        name: 'openai/gpt-4o',
        provider: { name: 'openai' },
        properties: {},
      },
    );
  });

  it('getModels joins catalog logos onto provider', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/models')) {
        return Response.json({
          data: [
            {
              model_id: 'gpt-5-6-sol',
              name: 'openai/gpt-5-6-sol',
              provider: { name: 'openai' },
              properties: {},
            },
            {
              model_id: 'local-llama',
              name: 'internal/local-llama',
              provider: { name: 'internal' },
              properties: {},
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/catalogs/model-providers')) {
        return Response.json({
          data: [
            {
              type: 'openai',
              logo: 'https://assets.example/openai.svg',
              models: [{ model_id: 'gpt-5.6-sol', name: 'gpt-5-6-sol', properties: {} }],
            },
            { type: 'custom', supported_reasoning_efforts: ['low'] },
          ],
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    assert.deepEqual(await builder.getModels(), [
      {
        id: 'gpt-5-6-sol',
        name: 'openai/gpt-5-6-sol',
        provider: { name: 'openai', logo: 'https://assets.example/openai.svg' },
        properties: {},
      },
      {
        id: 'local-llama',
        name: 'internal/local-llama',
        provider: { name: 'internal' },
        properties: {},
      },
    ]);
  });

  it('getModels still returns models when the catalog request fails', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/models')) {
        return Response.json({
          data: [
            {
              model_id: 'gpt-5-6-sol',
              name: 'openai/gpt-5-6-sol',
              provider: { name: 'openai' },
              properties: {},
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/catalogs/model-providers')) {
        return new Response('catalog unavailable', { status: 500 });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    assert.deepEqual(await builder.getModels(), [
      {
        id: 'gpt-5-6-sol',
        name: 'openai/gpt-5-6-sol',
        provider: { name: 'openai' },
        properties: {},
      },
    ]);
  });

  it('getMcpTools loads connector tools and normalizes untrusted rows', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/mcp-servers/github/tools')) {
        return Response.json({
          data: [
            { id: 'ignored', name: 'search', description: 'Search repositories' },
            { name: 'read_file', description: 42 },
            { id: 'missing-name', description: null },
          ],
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    if (builder.getMcpTools === undefined) throw new Error('expected getMcpTools');

    assert.deepEqual(await builder.getMcpTools({ connectorId: 'github' }), [
      { id: 'search', name: 'search', description: 'Search repositories' },
      { id: 'read_file', name: 'read_file', description: '' },
    ]);
  });

  it('gets capabilities through the configured harness client', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/capabilities')) {
        return Response.json({
          data: {
            sandbox: { enabled: false },
            skill: { enabled: false, reason: 'Configure a sandbox provider' },
            settings: { enabled: true },
          },
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });

    assert.deepEqual(await builder.getCapabilities(), {
      data: {
        sandbox: { enabled: false },
        skill: { enabled: false, reason: 'Configure a sandbox provider' },
        settings: { enabled: true },
      },
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
              manifest: {
                model: { name: 'test/model' },
                instructions: 'Review carefully.',
                skills: [{ name: 'review' }],
                mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
              },
            },
            { id: 'agt_2', name: 'writer', manifest: { model: { name: 'test/model' } } },
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
        skills: [{ name: 'review' }],
        mcpServers: [{ name: 'github', enableTools: ['@all'] }],
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
      if (url.endsWith('/api/v1/agents') && method === 'POST' && typeof init?.body === 'string') {
        requests.push({ method, url, body: JSON.parse(init.body) });
        return Response.json({
          data: {
            id: 'agt_new',
            name: 'saved-agent',
            manifest: { model: { name: 'test/model' } },
          },
        });
      }
      return new Response(`Unexpected request: ${method} ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    const result = await builder.saveAgent({
      agentName: 'saved-agent',
      agentSpec: {
        model: { name: 'test/model' },
        skills: [{ name: 'review' }],
      },
      intent: 'create',
    });

    assert.deepEqual(result, { agentId: 'agt_new' });
    assert.deepEqual(requests.at(-1)?.body, {
      name: 'saved-agent',
      manifest: {
        model: { name: 'test/model' },
        skills: [{ name: 'review' }],
      },
    });
  });

  it('saveAgent updates when the name already exists', async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/agents') && method === 'GET') {
        return Response.json({
          data: [{ id: 'agt_1', name: 'writer', manifest: { model: { name: 'test/model' } } }],
        });
      }
      if (url.endsWith('/api/v1/agents/agt_1') && method === 'PUT' && typeof init?.body === 'string') {
        requests.push({ method, url, body: JSON.parse(init.body) });
        return Response.json({
          data: {
            id: 'agt_1',
            name: 'writer',
            manifest: {
              model: { name: 'test/model' },
              instructions: 'Write release notes.',
            },
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
      intent: 'update',
    });

    assert.deepEqual(result, { agentId: 'agt_1' });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, {
      manifest: {
        model: { name: 'test/model' },
        instructions: 'Write release notes.',
      },
    });
  });
});
