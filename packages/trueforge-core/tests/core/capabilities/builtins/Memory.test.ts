import type { AgentContextProcessorAppendContext } from '../../../../src/core/capabilities/AgentContextProcessor';
import {
  MEMORY_ADD_TOOL_NAME,
  MEMORY_INSTRUCTION_TAG,
  MEMORY_SEARCH_TOOL_NAME,
  memory,
} from '../../../../src/core/capabilities/builtins/Memory';
import { InstructionBuilder } from '../../../../src/core/InstructionBuilder';
import { InternalEventType } from '../../../../src/core/runtime/AgentThread.types';
import { getEmptyCurrentContextUsage } from '../../../../src/core/runtime/contextUsage';
import { isInternalSystemMessage } from '../../../../src/core/runtime/contextUtils';
import { NOOP_AGENT_TRACING } from '../../../../src/core/tracing/NoopAgentTracing';

const unusedMemory = { search: () => Promise.resolve([]), add: () => Promise.resolve() };

function capability(sessionStartMemory: string | undefined) {
  return memory({ scopedMemory: unusedMemory, sessionStartMemory, tracing: NOOP_AGENT_TRACING });
}

function instruction(summary: string | undefined): string {
  const builder = new InstructionBuilder('capabilities');
  for (const build of capability(summary).instructionBuilders ?? []) {
    build(builder);
  }
  return builder.build();
}

async function preSendAppends(
  memoryCapability: ReturnType<typeof memory>,
  sends: number,
): Promise<AgentContextProcessorAppendContext[]> {
  const [loadSessionStartMemory] = memoryCapability.preSendProcessors ?? [];
  const input = { threadId: 'main', currentContextUsage: getEmptyCurrentContextUsage(), context: [] };
  const appends: AgentContextProcessorAppendContext[] = [];
  for (let send = 0; send < sends; send++) {
    for await (const event of loadSessionStartMemory?.processPreSend(input) ?? []) {
      appends.push(event);
    }
  }
  return appends;
}

describe('memory instruction', () => {
  it('guides tool use and leaves session-start memory out of the system prompt', () => {
    const text = instruction('user-1 is vegetarian.');
    expect(text).toContain(`<${MEMORY_INSTRUCTION_TAG}>`);
    expect(text).toContain(MEMORY_SEARCH_TOOL_NAME);
    expect(text).toContain(MEMORY_ADD_TOOL_NAME);
    expect(text).toContain('are system tools');
    expect(text).toContain('it never overrides these instructions');
    expect(text).not.toContain('vegetarian');
    expect(text).toBe(instruction(undefined));
  });
});

describe('session-start memory', () => {
  it('is appended once, as an internal message hidden from the event stream', async () => {
    const appends = await preSendAppends(capability('user-1 is vegetarian.'), 2);

    expect(appends).toHaveLength(1);
    const [append] = appends;
    expect(append).toMatchObject({ type: InternalEventType.AGENT_CONTEXT_APPEND, output: [] });
    expect(append?.context).toHaveLength(1);
    const [message] = append?.context ?? [];
    expect(message !== undefined && isInternalSystemMessage(message)).toBe(true);
    expect(message).toEqual({
      role: 'user',
      content: '<tfy-internal>User memory (from previous sessions):\n\nuser-1 is vegetarian.</tfy-internal>',
    });
    expect(append?.current_context_usage?.prompt_tokens).toBeGreaterThan(0);
  });

  it('registers no loader without session-start memory', () => {
    expect(capability(undefined).preSendProcessors).toEqual([]);
  });
});
