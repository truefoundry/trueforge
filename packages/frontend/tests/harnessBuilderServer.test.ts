import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHarnessBuilderServer, providerOf } from '../src/harnessBuilderServer';
import type { HarnessAgentSpec } from '../src/harnessServer';

const sampleSpec: HarnessAgentSpec = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'Be helpful.',
  mcpServers: [{ id: 'github', name: 'github', enableTools: ['@all'] }],
  skills: [{ id: 'review', name: 'review' }],
};

describe('harnessBuilderServer', () => {
  it('providerOf takes the segment before the first slash', () => {
    assert.equal(providerOf('openai/gpt-4o'), 'openai');
    assert.equal(providerOf('anthropic/claude-sonnet-4'), 'anthropic');
  });

  it('providerOf falls back to the full name when there is no slash', () => {
    assert.equal(providerOf('gpt-4o'), 'gpt-4o');
  });

  it('searchAgents lists names and filters by query', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      assert.match(url, /\/api\/v1\/agents$/);
      return Response.json({
        data: [
          { id: 'a1', name: 'alpha', model: { name: 'anthropic/claude-sonnet-4-6' } },
          { id: 'a2', name: 'beta-writer', model: { name: 'anthropic/claude-sonnet-4-6' } },
        ],
      });
    };

    const server = createHarnessBuilderServer({ fetch: fetchMock });
    assert.deepEqual(await server.searchAgents({ limit: 50 }), [{ name: 'alpha' }, { name: 'beta-writer' }]);
    assert.deepEqual(await server.searchAgents({ query: 'WRITE', limit: 50 }), [{ name: 'beta-writer' }]);
  });

  it('saveAgent creates with flattened AgentSpec and strips UI mount ids', async () => {
    let posted: unknown;
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      assert.equal(init?.method, 'POST');
      assert.match(url, /\/api\/v1\/agents$/);
      assert.ok(typeof init?.body === 'string');
      posted = JSON.parse(init.body);
      return Response.json({
        data: {
          id: 'ag_1',
          name: 'research',
          model: { name: 'anthropic/claude-sonnet-4-6' },
          instructions: 'Be helpful.',
        },
      });
    };

    const server = createHarnessBuilderServer({ fetch: fetchMock });
    const saved = await server.saveAgent({ agentName: 'research', agentSpec: sampleSpec });
    assert.deepEqual(saved, { name: 'research' });
    assert.deepEqual(posted, {
      name: 'research',
      model: { name: 'anthropic/claude-sonnet-4-6' },
      instructions: 'Be helpful.',
      mcp_servers: [{ name: 'github', enable_tools: ['@all'] }],
      skills: [{ name: 'review' }],
    });
  });

  it('saveAgent surfaces a conflict when the agent name already exists', async () => {
    const fetchMock: typeof fetch = async () => Response.json({ error: { message: 'name taken' } }, { status: 409 });

    const server = createHarnessBuilderServer({ fetch: fetchMock });
    await assert.rejects(
      () => server.saveAgent({ agentName: 'research', agentSpec: sampleSpec }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /already exists/);
        assert.match(error.message, /research/);
        return true;
      },
    );
  });
});
