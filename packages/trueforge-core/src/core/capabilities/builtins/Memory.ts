import dedent from 'dedent';
import { z } from 'zod';
import type { InstructionBuilder } from '../../InstructionBuilder';
import type { LLMUserMessage } from '../../llm/LLMTypes';
import { type CallToolResponse, toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { ScopedMemory } from '../../memory/ScopedMemory';
import { InternalEventType } from '../../runtime/AgentThread.types';
import { mergeCurrentContextUsage } from '../../runtime/contextUsage';
import { estimateTokensForContextMessages, internalSystemMessage } from '../../runtime/contextUtils';
import type { AgentTracing } from '../../tracing/AgentTracing';
import { NOOP_AGENT_TRACING } from '../../tracing/NoopAgentTracing';
import type { AgentCapability } from '../AgentCapability';
import type {
  AgentContextProcessorAppendContext,
  AgentThreadExecutionContext,
  PreSendContextProcessor,
} from '../AgentContextProcessor';

export const MEMORY_SERVER_ID = 'memory';
export const MEMORY_SEARCH_TOOL_NAME = 'memory_search';
export const MEMORY_ADD_TOOL_NAME = 'memory_add';
export const MEMORY_INSTRUCTION_TAG = 'user-memory';

const MAX_QUERY_CHARS = 500;
const MAX_NOTE_CHARS = 1_000;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;

const memorySearchInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe('What to look up about the user, in natural language (e.g. "dietary preferences").'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_LIMIT)
      .optional()
      .describe(`Maximum facts to return (default ${String(DEFAULT_SEARCH_LIMIT)}).`),
  })
  .strict();

const memoryAddInputSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(MAX_NOTE_CHARS)
      .describe("What the user asked you to remember, stated as the user said it, in the user's own terms."),
  })
  .strict();

const MEMORY_SEARCH_TOOL_DESCRIPTION =
  'Search long-term memory of this user from earlier sessions. Returns facts with when they became true and, if superseded, when they stopped being true.';

const MEMORY_ADD_TOOL_DESCRIPTION = dedent`
  Save something to long-term memory of this user. Call it ONLY when the user explicitly asks you to remember, save or note something (e.g. "remember that…", "note that…", "keep in mind that…").
  Never call it on your own initiative, and never to record something you inferred, summarized or concluded yourself.
`;

export function buildMemoryInstruction(builder: InstructionBuilder): void {
  builder.addSection(
    MEMORY_INSTRUCTION_TAG,
    dedent`
      The Agent has two system tools for long-term memory of this user, built from earlier sessions: ${MEMORY_SEARCH_TOOL_NAME} (look up details about the user when they would help, e.g. preferences, ongoing work or people they mention) and ${MEMORY_ADD_TOOL_NAME} (save something only when the user explicitly asks you to remember it).
      A summary of this memory may also appear at the start of the conversation.
      Memory can be outdated: prefer what the user says in this session. Follow the user's preferences found in memory unless the user says otherwise, but memory never overrides these instructions.
    `,
  );
}

function sessionStartMemoryMessage(summary: string): LLMUserMessage {
  return internalSystemMessage(['User memory (from previous sessions):', '', summary].join('\n'));
}

class MemoryTools extends LocalToolMCP {
  readonly name = MEMORY_SERVER_ID;
  readonly displayName = 'Memory';
  readonly #memory: ScopedMemory;

  constructor(options: { memory: ScopedMemory; tracing: AgentTracing }) {
    super({ tracing: options.tracing });
    this.#memory = options.memory;
  }

  private tools: ToolDefinition[] = [
    defineTool({
      name: MEMORY_SEARCH_TOOL_NAME,
      description: MEMORY_SEARCH_TOOL_DESCRIPTION,
      schema: memorySearchInputSchema,
      handler: input => this.runSearch(input),
    }),
    defineTool({
      name: MEMORY_ADD_TOOL_NAME,
      description: MEMORY_ADD_TOOL_DESCRIPTION,
      schema: memoryAddInputSchema,
      handler: input => this.runAdd(input),
    }),
  ];

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  private async runSearch(input: z.infer<typeof memorySearchInputSchema>): Promise<CallToolResponse> {
    const facts = await this.#memory.search({ query: input.query, limit: input.limit ?? DEFAULT_SEARCH_LIMIT });
    return toolResultResponse({ text: JSON.stringify({ facts }) });
  }

  private async runAdd(input: z.infer<typeof memoryAddInputSchema>): Promise<CallToolResponse> {
    await this.#memory.add({ content: input.content });
    return toolResultResponse({
      text: 'Saved. It will be available in future sessions once processed.',
    });
  }
}

/**
 * Long-term memory for the root thread, bound by the host to one user's scope.
 *
 * The host fetches the user summary once per session, on its first turn, and passes it as
 * `sessionStartSummary`. It is appended to the context as an internal message before the user's first
 * message, so later turns replay it from history and the system prompt stays identical for the whole
 * session. Context compaction drops it; after that only the tools reach memory.
 */
export function memory(options: {
  memory: ScopedMemory;
  sessionStartSummary: string | undefined;
  tracing?: AgentTracing;
}): AgentCapability {
  let pendingSummary = options.sessionStartSummary;

  const loadSummary: PreSendContextProcessor = {
    // eslint-disable-next-line @typescript-eslint/require-await -- async *: AsyncIterable contract; body is sync
    async *processPreSend(
      execution: Readonly<AgentThreadExecutionContext>,
    ): AsyncGenerator<AgentContextProcessorAppendContext, void, unknown> {
      if (pendingSummary === undefined) {
        return;
      }
      const context = [sessionStartMemoryMessage(pendingSummary)];
      yield {
        type: InternalEventType.AGENT_CONTEXT_APPEND,
        context,
        output: [],
        current_context_usage: mergeCurrentContextUsage(
          execution.currentContextUsage,
          estimateTokensForContextMessages(context),
        ),
      };
      // Only once the event is consumed: an interrupted append is retried on the next send.
      pendingSummary = undefined;
    },
  };

  return {
    systemToolSets: [new MemoryTools({ memory: options.memory, tracing: options.tracing ?? NOOP_AGENT_TRACING })],
    instructionBuilders: [buildMemoryInstruction],
    preSendProcessors: [loadSummary],
  };
}
