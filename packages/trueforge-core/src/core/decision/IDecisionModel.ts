import type { Decision, DecisionCreateParams, DecisionInputMessage } from 'openai/resources/decisions';
import type { LLMRequestOptions } from '../llm/ILLM';

export type { Decision, DecisionInputMessage };

/** `model` comes from the bound client's provider config. */
export type DecisionModelCreateParams = Omit<DecisionCreateParams, 'model'>;

/** A model that answers typed questions about an input (yes/no, choice, score) with probabilities instead of generated text. */
export interface IDecisionModel {
  create(body: DecisionModelCreateParams, options?: LLMRequestOptions): Promise<Decision>;
}

export interface DecisionModel {
  client: IDecisionModel;
  properties: { contextLength: number | undefined };
}
