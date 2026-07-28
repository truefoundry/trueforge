import type { InstructionBuilder } from '../InstructionBuilder';
import type { IToolSet } from '../mcp/IMCPServer';
import type { CapabilityStateValue } from '../runtime/AgentThread.types';
import type {
  PostToolCallAgentContextProcessor,
  PreLLMAgentContextProcessor,
  PreLLMEphemeralAgentContextProcessor,
  PreSendContextProcessor,
} from './AgentContextProcessor';
import type { ToolResponseProcessor } from './ToolResponseProcessor';

export interface AgentCapability {
  readonly systemToolSets?: readonly IToolSet[] | undefined;
  readonly preSendProcessors?: readonly PreSendContextProcessor[] | undefined;
  readonly preLLMProcessors?: readonly PreLLMAgentContextProcessor[] | undefined;
  readonly preLLMEphemeralProcessors?: readonly PreLLMEphemeralAgentContextProcessor[] | undefined;
  readonly postToolCallProcessors?: readonly PostToolCallAgentContextProcessor[] | undefined;
  readonly toolResponseProcessors?: readonly ToolResponseProcessor[] | undefined;
  readonly instructionBuilders?: readonly ((builder: InstructionBuilder) => void)[] | undefined;
  /**
   * Cross-turn durable state. `key` must be unique across capabilities on a
   * thread (`tfy.` reserved for builtins). `load` hydrates from the previous
   * turn's capability_state; writes go through CAPABILITY_STATE events.
   */
  readonly state?: { key: string; load(state: CapabilityStateValue): void };
}
