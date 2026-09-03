import type { TrueForge } from '@truefoundry/trueforge-sdk';
import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { createHarnessAgentSessionsServer } from '@/plugins/trueforge-agent-server-adapter/agentSessionsServer.js';

describe('createHarnessAgentSessionsServer', () => {
  it('maps agent details and code snippets to the UI contract', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'agent-1',
        name: 'writer',
        manifest: { model: { name: 'openai/gpt-5' }, instructions: 'Write.' },
      },
    }));
    const getCodeSnippets = vi.fn(async () => ({
      data: {
        baseUrl: 'https://trueforge.example',
        snippets: [
          {
            labelName: 'TypeScript',
            language: 'typescript',
            icon: 'https://assets.example/typescript.svg',
            sampleCode: { stream: 'stream()', nonStream: 'run()' },
          },
        ],
      },
    }));
    const server = createHarnessAgentSessionsServer({
      client: {
        agents: { get },
        internal: { agents: { getCodeSnippets } },
      } as unknown as TrueForge,
    });

    assert.deepEqual(await server.getAgent({ agentId: 'agent-1' }), {
      agentId: 'agent-1',
      name: 'writer',
      agentSpec: { model: { name: 'openai/gpt-5' }, instructions: 'Write.' },
    });
    assert.deepEqual(await server.getCodeSnippets({ agentId: 'agent-1' }), [
      {
        labelName: 'TypeScript',
        language: 'typescript',
        icon: 'https://assets.example/typescript.svg',
        sampleCode: { stream: 'stream()', nonStream: 'run()' },
      },
    ]);
    assert.deepEqual(get.mock.calls[0], ['agent-1']);
    assert.deepEqual(getCodeSnippets.mock.calls[0], ['agent-1']);
  });

  it('maps listSessions and listSessionEvents onto the UI contract', async () => {
    const list = vi.fn(async () => ({
      data: [
        {
          id: 'sess-1',
          title: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          agent: {
            type: 'reference',
            id: 'agent-1',
            name: 'writer',
          },
          createdBy: 'user-1',
          metrics: {
            totalTurns: 3,
            totalCostInUsd: 0.25,
            totalDurationMs: 29_711,
          },
        },
      ],
      response: { pagination: { nextPageToken: 'next-1' } },
    }));
    const listEvents = vi.fn(async () => ({
      data: [{ turnId: 'turn-1', event: { type: 'turn.created', id: 'evt-1', turnId: 'turn-1' } }],
      response: { pagination: {} },
    }));
    const server = createHarnessAgentSessionsServer({
      baseUrl: 'https://trueforge.example',
      client: {
        agents: {
          get: vi.fn(async () => ({
            data: { id: 'agent-1', name: 'writer', manifest: { model: { name: 'openai/gpt-5' } } },
          })),
        },
        sessions: { list, listEvents },
      } as unknown as TrueForge,
    });

    assert.deepEqual(await server.listSessions({ agentId: 'agent-1', limit: 10 }), {
      data: [
        {
          id: 'sess-1',
          title: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          lastActivityAt: '2026-01-02T00:00:00.000Z',
          isCreateAgent: false,
          isMutable: false,
          metrics: { totalTurns: 3, totalCostInUsd: 0.25, totalDurationMs: 29_711 },
          agentName: 'writer',
        },
      ],
      nextPageToken: 'next-1',
    });
    assert.deepEqual(await server.listSessionEvents({ sessionId: 'sess-1', limit: 25 }), {
      data: [{ turnId: 'turn-1', event: { type: 'turn.created', id: 'evt-1', turnId: 'turn-1' } }],
    });
    await assert.rejects(
      () => server.listSessions({ startTimestamp: 'not-a-timestamp' }),
      /Invalid ISO timestamp: not-a-timestamp/,
    );
  });
});
