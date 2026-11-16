import { modelSsrfFetch } from '@truefoundry/trueforge-core/core';
import { z } from 'zod';
import type { DecisionClient } from '../modelRouting/types';
import { gatewayMetadataHeaders, headerValue, parseGatewayMetadataHeader, X_TFY_METADATA } from './gatewayMetadata';

const SystemOneResponseSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().nullish() })),
});

/** Gateway base URL and invoke headers (auth plus the turn's `x-tfy-metadata`) for a model. */
export type ResolveGateway = (model: string) => Promise<{ baseUrl: string; headers: Record<string, string> }>;

/** Yes/no questions to a TrueFoundry decision model (Jev) through the gateway's `/v1/systemone`. */
export function createJevDecisionClient(input: { model: string; resolveGateway: ResolveGateway }): DecisionClient {
  return {
    async ask({ fallbackModel, threadId, state, questions, signal }) {
      const gateway = await input.resolveGateway(fallbackModel);
      const turnMetadataHeader = headerValue(gateway.headers, X_TFY_METADATA);
      const headers = {
        ...Object.fromEntries(Object.entries(gateway.headers).filter(([key]) => key.toLowerCase() !== X_TFY_METADATA)),
        ...gatewayMetadataHeaders({
          ...(turnMetadataHeader === undefined ? {} : parseGatewayMetadataHeader(turnMetadataHeader)),
          'tfg.thread_id': threadId,
          'tfg.model_routing': 'true',
        }),
        'content-type': 'application/json',
      };
      const root = gateway.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const response = await modelSsrfFetch(`${root}/v1/systemone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model,
          state,
          questions: Object.fromEntries(
            Object.entries(questions).map(([key, question]) => [key, { type: 'noul', ...question }]),
          ),
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Decision model ${input.model} returned HTTP ${String(response.status)}`);
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
