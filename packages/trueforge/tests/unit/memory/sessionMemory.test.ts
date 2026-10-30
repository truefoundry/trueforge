import { AgentSpecSchema, type SessionRecord } from '@truefoundry/trueforge-core/agent-session';
import {
  InstructionBuilder,
  MEMORY_ADD_TOOL_NAME,
  MEMORY_SEARCH_TOOL_NAME,
  NOOP_AGENT_TRACING,
  type AgentCapability,
} from '@truefoundry/trueforge-core/core';
import type { AgentRecord, IAgentStore } from '../../../src/db/agentStore';
import { memoryScopeKey } from '../../../src/memory/scope';
import { resolveSessionMemory } from '../../../src/memory/sessionMemory';
import { fakeMemoryProvider } from './fakeMemoryProvider';

type SessionMemoryRecord = Parameters<typeof resolveSessionMemory>[0]['record'];

const SPEC = AgentSpecSchema.parse({ model: { name: 'p/m' }, instructions: 'x' });
const SUBJECT = { subject_id: 'priya', subject_type: 'user', subject_display_name: 'Priya' } as const;

function record(overrides: Partial<SessionMemoryRecord> = {}): SessionMemoryRecord {
  return {
    agent: { type: 'inline', spec: SPEC },
    created_by_subject: SUBJECT,
    metadata: { 'tfg.source': 'ui' },
    source: null,
    last_turn_details: null,
    ...overrides,
  };
}

const LATER_TURN: SessionRecord['last_turn_details'] = { id: 'turn-1', state: { status: 'done' } };

function agentStore(memoryEnabled: boolean | undefined): Pick<IAgentStore, 'getAgent'> {
  return {
    async getAgent(input) {
      if (memoryEnabled === undefined || !('id' in input)) {
        return undefined;
      }
      const agent: AgentRecord = {
        id: input.id,
        tenant_id: 'acme',
        name: 'chef',
        description: '',
        manifest: AgentSpecSchema.parse({
          model: { name: 'p/m' },
          instructions: 'x',
          config: { memory: { enabled: memoryEnabled } },
        }),
        external_id: null,
        created_by_subject: SUBJECT,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      };
      return agent;
    },
  };
}

function logger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

async function resolve(input: {
  record?: SessionMemoryRecord;
  tenantEnabled?: boolean;
  agentMemory?: boolean | undefined;
  configured?: boolean;
  provider?: ReturnType<typeof fakeMemoryProvider>;
  summaryTimeoutMs?: number;
}) {
  const provider = input.provider ?? fakeMemoryProvider();
  const log = logger();
  const capability = await resolveSessionMemory({
    sessionId: 'session-1',
    tenantId: 'acme',
    record: input.record ?? record(),
    memory:
      input.configured === false
        ? undefined
        : { provider, settings: { isTenantMemoryEnabled: async () => input.tenantEnabled ?? true } },
    agentStore: agentStore(input.agentMemory),
    logger: log as never,
    ...(input.summaryTimeoutMs === undefined ? {} : { summaryTimeoutMs: input.summaryTimeoutMs }),
  });
  return { capability, provider, log };
}

function render(capability: AgentCapability): string {
  const builder = new InstructionBuilder('agent-capabilities');
  for (const build of capability.instructionBuilders ?? []) {
    build(builder);
  }
  return builder.build();
}

function build(factory: NonNullable<Awaited<ReturnType<typeof resolve>>['capability']>): AgentCapability {
  return factory({ tracing: NOOP_AGENT_TRACING });
}

describe('resolveSessionMemory', () => {
  it('gives a UI chat without an agent the default scope and loads the summary on its first turn', async () => {
    const provider = fakeMemoryProvider();
    provider.getUserSummary.mockResolvedValue('Priya is vegetarian.');
    const { capability } = await resolve({ provider });

    expect(capability).toBeDefined();
    const defaultKey = memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'priya' });
    expect(provider.getUserSummary).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ type: 'default', key: defaultKey }) }),
    );
    expect(capability !== undefined && render(build(capability))).toContain('Priya is vegetarian.');
  });

  it('does not call the provider for the summary after the first turn', async () => {
    const provider = fakeMemoryProvider();
    const { capability } = await resolve({ provider, record: record({ last_turn_details: LATER_TURN }) });

    expect(capability).toBeDefined();
    expect(provider.getUserSummary).not.toHaveBeenCalled();
  });

  it.each([
    ['memory is off for the deployment', { configured: false }],
    ['memory is off for the tenant', { tenantEnabled: false }],
    ['the session is scheduled', { record: record({ source: { type: 'schedule', id: 's', run_id: 'r' } }) }],
    ['the session is not a UI chat and has no agent', { record: record({ metadata: {} }) }],
    [
      "the agent's spec has memory off, even for a UI chat",
      { record: record({ agent: { type: 'reference', id: 'chef', name: 'Chef' } }), agentMemory: false },
    ],
    [
      'the bound agent no longer exists',
      { record: record({ agent: { type: 'reference', id: 'gone', name: 'Gone' } }), agentMemory: undefined },
    ],
  ])('returns no memory when %s', async (_label, input) => {
    const provider = fakeMemoryProvider();
    const { capability } = await resolve({ ...input, provider });

    expect(capability).toBeUndefined();
    expect(provider.getUserSummary).not.toHaveBeenCalled();
  });

  it("uses the agent's own scope, separate from the default scope, when its spec has memory on", async () => {
    const provider = fakeMemoryProvider();
    const { capability } = await resolve({
      provider,
      record: record({ agent: { type: 'reference', id: 'chef', name: 'Chef' }, metadata: {} }),
      agentMemory: true,
    });
    if (capability === undefined) {
      throw new Error('expected memory');
    }
    const tools = build(capability).systemToolSets?.[0];
    await tools?.callTool({ name: MEMORY_SEARCH_TOOL_NAME, arguments: { query: 'diet' } });
    await tools?.callTool({ name: MEMORY_ADD_TOOL_NAME, arguments: { content: 'I am allergic to peanuts' } });

    const agentKey = memoryScopeKey({ tenantId: 'acme', agentKey: 'chef', subjectId: 'priya' });
    const defaultKey = memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'priya' });
    expect(agentKey).not.toBe(defaultKey);
    expect(provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ key: agentKey }) }),
    );
    expect(provider.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ type: 'agent', key: agentKey }),
        content: 'I am allergic to peanuts',
        sessionId: 'session-1',
      }),
    );
  });

  it('gives different users different scopes', async () => {
    const providerA = fakeMemoryProvider();
    const providerB = fakeMemoryProvider();
    await resolve({ provider: providerA });
    await resolve({
      provider: providerB,
      record: record({ created_by_subject: { ...SUBJECT, subject_id: 'arjun', subject_display_name: 'Arjun' } }),
    });

    const keyA = providerA.getUserSummary.mock.calls[0]?.[0].scope.key;
    const keyB = providerB.getUserSummary.mock.calls[0]?.[0].scope.key;
    expect(keyA).toBeDefined();
    expect(keyA).not.toBe(keyB);
  });

  it('starts without a summary when loading it fails', async () => {
    const provider = fakeMemoryProvider();
    provider.getUserSummary.mockRejectedValue(new Error('zep down'));
    const { capability, log } = await resolve({ provider });

    expect(capability).toBeDefined();
    expect(capability !== undefined && render(build(capability))).not.toContain('<summary>');
    expect(log.warn).toHaveBeenCalledWith(
      'Memory summary unavailable; starting the session without it',
      expect.objectContaining({ timed_out: false, error: 'zep down' }),
    );
  });

  it('gives up on a slow summary after the timeout', async () => {
    const provider = fakeMemoryProvider();
    provider.getUserSummary.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { capability, log } = await resolve({ provider, summaryTimeoutMs: 10 });

    expect(capability).toBeDefined();
    expect(log.warn).toHaveBeenCalledWith(
      'Memory summary unavailable; starting the session without it',
      expect.objectContaining({ timed_out: true }),
    );
  });
});
