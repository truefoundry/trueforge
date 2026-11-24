import type { Logger } from 'winston';
import configuration, { isTrueFoundryModeEnabled, trueFoundryModelRouting } from '../config';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { createTrueFoundryRequestContext } from './accessToken';
import { TrueFoundryModelProviderStore } from './TrueFoundryModelProviderStore';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

let decisionModelProviderStore: IModelProviderStore | undefined;

/**
 * Model routing's decision model is shared by every tenant: one virtual account per environment calls it, so
 * classification never depends on the caller's own model access.
 */
export function initDecisionModelProviderStore(input: {
  client: TrueFoundryServiceFoundryServerClient;
  logger: Logger;
}) {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return;
  }
  const routing = trueFoundryModelRouting();
  const apiKey = configuration.TRUEFOUNDRY_MODEL_ROUTING_API_KEY;
  if (routing === undefined || apiKey === undefined) {
    return;
  }
  decisionModelProviderStore = new TrueFoundryModelProviderStore({
    client: input.client,
    requestContext: createTrueFoundryRequestContext({
      tenant_id: routing.decision_model.tenant_id,
      subject: { id: 'model-routing', type: 'virtualaccount', display_name: 'model-routing' },
      roles: [],
      user_credential: apiKey,
    }),
    agent: undefined,
    logger: input.logger,
  });
}

export function getDecisionModelProviderStore(): IModelProviderStore {
  if (decisionModelProviderStore === undefined) {
    throw new Error('Model routing is configured, but its decision model store was not initialised');
  }
  return decisionModelProviderStore;
}
