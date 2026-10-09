import type { ILLM } from '../llm/ILLM';
import type { LLMUserMessage } from '../llm/LLMTypes';
import type { ResponseFormat } from '../llm/responseFormat';
import type { IToolSet } from '../mcp/IMCPServer';

/** Call params merged onto the LLM request body (AgentSpec.model.params + defaults). */
export type ModelParams = Record<string, unknown>;

/**
 * Static definition of an agent. Represents the authored configuration,
 * not the execution state. Inherited by sub-agent definitions.
 */
export interface AgentDefinition {
  modelClient: ILLM;
  modelName: string;
  modelProperties?:
    | {
        /** Maximum combined input/output context for the resolved model, when known. */
        contextLength: number | undefined;
      }
    | undefined;
  instruction?: string | undefined;
  messages?: readonly LLMUserMessage[] | undefined;
  modelParams?: ModelParams | undefined;
  /** Same wire shape as AgentSpec.response_format (Zod ResponseFormat). */
  responseFormat?: ResponseFormat | undefined;
  iterationLimit?: number | undefined;

  toolSets?: readonly IToolSet[] | undefined;
}
