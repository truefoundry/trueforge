import type { InstructionBuilder } from '../InstructionBuilder';
import type { IToolSet } from '../mcp/IMCPServer';
import type {
  PostToolCallAgentContextProcessor,
  PreLLMAgentContextProcessor,
  PreLLMEphemeralAgentContextProcessor,
  PreSendContextProcessor,
} from './AgentContextProcessor';
import type { ToolResponseProcessor } from './ToolResponseProcessor';

/**
 * JSON-serializable value. Excludes `undefined` — durability is jsonb/JSON, so
 * clears use `null` and absent data omits the key or the map.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Cross-turn capability KV map. Keys: capability.state.key; `tfy.` reserved for builtins. */
export type CapabilityState = Record<string, JsonValue>;

/**
 * Wraps a toolset at tool-initialization time. Applied to every toolset on the
 * thread — system meta tools, the sandbox, the deferred-tool proxy's underlying
 * servers, and user MCP servers — in capability registration order (first
 * decorator innermost), and to the toolsets Code Mode dispatches against.
 * Decorators must preserve `name`/`id` (thread bookkeeping keys toolsets by
 * name) and must expose the wrapped set via `IToolSet.unwrapped` so
 * identity-based checks (`unwrapToolSet`) see through the wrapper.
 */
export type ToolSetDecorator = (toolSet: IToolSet) => IToolSet;

/** Flattens the decorators of `capabilities` in registration order. */
export function collectToolSetDecorators(capabilities: readonly AgentCapability[]): ToolSetDecorator[] {
  return capabilities.flatMap(c => c.toolSetDecorators ?? []);
}

/**
 * Applies decorators in order (first innermost) — the single fold shared by
 * thread tool wiring and Code Mode dispatch, so their wrapping order can
 * never drift apart.
 */
export function applyToolSetDecorators(toolSet: IToolSet, decorators: readonly ToolSetDecorator[]): IToolSet {
  return decorators.reduce((wrapped, decorator) => decorator(wrapped), toolSet);
}

export interface AgentCapability {
  readonly systemToolSets?: readonly IToolSet[] | undefined;
  readonly preSendProcessors?: readonly PreSendContextProcessor[] | undefined;
  readonly preLLMProcessors?: readonly PreLLMAgentContextProcessor[] | undefined;
  readonly preLLMEphemeralProcessors?: readonly PreLLMEphemeralAgentContextProcessor[] | undefined;
  readonly postToolCallProcessors?: readonly PostToolCallAgentContextProcessor[] | undefined;
  readonly toolResponseProcessors?: readonly ToolResponseProcessor[] | undefined;
  readonly toolSetDecorators?: readonly ToolSetDecorator[] | undefined;
  readonly instructionBuilders?: readonly ((builder: InstructionBuilder) => void)[] | undefined;
  /**
   * Cross-turn durable state. `key` must be unique across capabilities on a
   * thread (`tfy.` reserved for builtins). `load` hydrates from the previous
   * turn's capability_state; writes go through CAPABILITY_STATE events.
   */
  readonly state?: { key: string; load(state: JsonValue): void };
}
