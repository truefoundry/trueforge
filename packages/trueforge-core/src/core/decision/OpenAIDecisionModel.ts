import OpenAI from 'openai';
import type { Decision } from 'openai/resources/decisions';
import type { LLMRequestOptions } from '../llm/ILLM';
import { buildOutboundRequestHeaders, type VercelAIProviderConfig } from '../llm/VercelAILLM';
import { modelSsrfFetch } from '../util/outboundFetch';
import type { DecisionModelCreateParams, IDecisionModel } from './IDecisionModel';

/** IDecisionModel over the OpenAI Decisions API, for OpenAI or the TrueFoundry gateway. */
export class OpenAIDecisionModel implements IDecisionModel {
  readonly #config: VercelAIProviderConfig;
  readonly #client: OpenAI;

  constructor(config: VercelAIProviderConfig) {
    if (config.provider.type !== 'truefoundry' && config.provider.type !== 'openai') {
      throw new Error(
        `Decision model "${config.name}" needs an OpenAI or TrueFoundry provider, not "${config.provider.type}"`,
      );
    }
    this.#config = config;
    // A failed decision leaves the thread on its own model, so the client doesn't retry.
    this.#client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, fetch: modelSsrfFetch, maxRetries: 0 });
  }

  create(body: DecisionModelCreateParams, options?: LLMRequestOptions): Promise<Decision> {
    return this.#client.decisions.create(
      { ...body, model: this.#config.model.id },
      {
        headers: buildOutboundRequestHeaders({
          providerType: this.#config.provider.type,
          clientHeaders: this.#config.headers,
          options,
        }),
      },
    );
  }
}
