import { modelSsrfFetch, type VercelAIProviderConfig } from '@truefoundry/trueforge-core/core';
import { z } from 'zod';
import type { DecisionClient } from '../modelRouting/types';
import { gatewayMetadataHeaders, headerValue, parseGatewayMetadataHeader, X_TFY_METADATA } from './gatewayMetadata';

const SystemOneResponseSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().nullish() })),
});

/**
 * Yes/no questions to a TrueFoundry decision model (Jev) through the gateway's `/v1/systemone`.
 * `resolveProviderConfig` is the decision model's provider config, resolved on first use.
 */
export function createJevDecisionClient(input: {
  resolveProviderConfig: () => Promise<VercelAIProviderConfig>;
}): DecisionClient {
  return {
    async ask({ threadId, state, questions, signal }) {
      const config = await input.resolveProviderConfig();
      if (config.provider.type !== 'truefoundry' || config.baseUrl === undefined) {
        throw new Error(`Decision model "${config.name}" is not served by the TrueFoundry gateway`);
      }
      const turnMetadataHeader = headerValue(config.headers, X_TFY_METADATA);
      const headers = {
        ...Object.fromEntries(Object.entries(config.headers).filter(([key]) => key.toLowerCase() !== X_TFY_METADATA)),
        ...gatewayMetadataHeaders({
          ...(turnMetadataHeader === undefined ? {} : parseGatewayMetadataHeader(turnMetadataHeader)),
          'tfg.thread_id': threadId,
        }),
        Authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      };
      const root = config.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const response = await modelSsrfFetch(`${root}/v1/systemone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model.id,
          state,
          questions: Object.fromEntries(
            Object.entries(questions).map(([key, question]) => [key, { type: 'noul', ...question }]),
          ),
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Decision model "${config.name}" returned HTTP ${String(response.status)}`);
      }
      const { answers } = SystemOneResponseSchema.parse(await response.json());
      return Object.fromEntries(
        Object.entries(answers).flatMap(([key, answer]) =>
          typeof answer.noul === 'number' ? [[key, answer.noul]] : [],
        ),
      );
    },
  };
}
