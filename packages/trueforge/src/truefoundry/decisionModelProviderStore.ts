import type { Logger } from 'winston';
import configuration, { isTrueFoundryModeEnabled, trueFoundryModelRouting } from '../config';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { createTrueFoundryRequestContext } from './accessToken';
import { TrueFoundryModelProviderStore } from './TrueFoundryModelProviderStore';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/**
 * Model routing's decision model is shared by every tenant: one virtual account per environment calls it, so
 * classification never depends on the caller's own model access. Undefined when routing is not configured.
 */
export function createDecisionModelProviderStore(input: {
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): IModelProviderStore | undefined {
  if (!isTrueFoundryModeEnabled(configuration) || input.client === undefined) {
    return undefined;
  }
  const routing = trueFoundryModelRouting();
  const apiKey = configuration.TRUEFOUNDRY_MODEL_ROUTING_API_KEY;
  if (routing === undefined || apiKey === undefined) {
    return undefined;
  }
  return new TrueFoundryModelProviderStore({
    client: input.client,
    requestContext: createTrueFoundryRequestContext({
      tenant_id: routing.decision_model.tenant_id,
      subject: {
        id: 'trueforge-auto-model-router',
        type: 'virtualaccount',
        display_name: 'trueforge-auto-model-router',
      },
      roles: [],
      user_credential: apiKey,
    }),
    agent: undefined,
    logger: input.logger,
  });
}
