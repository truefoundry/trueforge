/**
 * Regression: Code Mode dispatches tool calls outside the threads' toolset
 * wiring, so SessionHandle must hand configureCodeMode the hook-DECORATED
 * toolsets — otherwise sandbox code could call MCP tools around a blocking
 * pre_tool_use hook.
 */
import type { ITurnResourceResolver } from '../../src/agent-session/ITurnResourceResolver';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { lifecycleHooks } from '../../src/core/capabilities/builtins/LifecycleHooks';
import { unwrapToolSet } from '../../src/core/mcp/IMCPServer';
import { makeMockIMCPServer, makeStubPublicSandbox } from '../core/harnessMocks';
import { makeAgentSpec, makeTestResolver, mintTestTurnId } from './testHelpers';

describe('Code Mode hook decoration', () => {
  it('configureCodeMode receives the decorated toolsets, not the raw ones', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec({ config: { sandbox: { enabled: true } } }) },
    });

    const sandbox = makeStubPublicSandbox();
    const configureCodeModeSpy = jest.spyOn(sandbox, 'configureCodeMode');
    const rawToolSet = makeMockIMCPServer({ name: 'srv', preload: true });

    const base = makeTestResolver({ sandbox });
    const resolver: ITurnResourceResolver = {
      get logger() {
        return base.logger;
      },
      createTracing: () => base.createTracing(),
      resolveAgentSpec: input => base.resolveAgentSpec(input),
      resolveSandbox: input => base.resolveSandbox(input),
      resolveAgentDefinition: async input => {
        const resolved = await base.resolveAgentDefinition(input);
        return {
          definition: { ...resolved.definition, toolSets: [rawToolSet] },
          extraCapabilities: [
            lifecycleHooks({
              runner: {
                preToolUse: () => Promise.resolve({ status: 'allow' }),
                postToolUse: () => Promise.resolve(),
              },
              events: { preToolUse: true, postToolUse: false },
            }),
          ],
        };
      },
      close: () => base.close(),
    };

    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver,
    });
    for await (const event of turn.stream()) {
      void event;
    }

    expect(configureCodeModeSpy).toHaveBeenCalledTimes(1);
    const passed = configureCodeModeSpy.mock.calls[0]?.[0] ?? [];
    expect(passed).toHaveLength(1);
    const wrapped = passed[0];
    if (!wrapped) throw new Error('expected a toolset');
    expect(wrapped).not.toBe(rawToolSet);
    expect(unwrapToolSet(wrapped)).toBe(rawToolSet);
  });
});
