import type { LLMUserMessage } from '../llm/LLMTypes';
import type { ResponseFormat } from '../llm/responseFormat';
import type { IToolSet } from '../mcp/IMCPServer';

/**
 * Static definition of an agent. Represents the authored configuration,
 * not the execution state or the model it runs on. Inherited by sub-agent definitions.
 */
export interface AgentDefinition {
  instruction?: string | undefined;
  messages?: readonly LLMUserMessage[] | undefined;
  /** Same wire shape as AgentSpec.response_format (Zod ResponseFormat). */
  responseFormat?: ResponseFormat | undefined;
  iterationLimit?: number | undefined;

  toolSets?: readonly IToolSet[] | undefined;
}
