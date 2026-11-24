import type { DecisionModel } from '@truefoundry/trueforge-core/core';
import { OpenAIDecisionModel } from '@truefoundry/trueforge-core/core';
import configuration, { isTrueFoundryModeEnabled, trueFoundryModelRouting } from '../config';
import { parseModelFqn } from '../runtime/sessionResources';
import { mapEnabledModels, resolveDefaultGatewayUrl } from './mapEnabledModels';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/**
 * Loads the shared decision model once. Undefined when routing is not configured.
 * A bad key, an unknown `decision_model.name`, or a missing gateway fails startup.
 */
export async function loadDecisionModel(input: {
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): Promise<DecisionModel | undefined> {
  if (!isTrueFoundryModeEnabled(configuration) || input.client === undefined) {
    return undefined;
  }
  const routing = trueFoundryModelRouting();
  if (routing === undefined) {
    return undefined;
  }
  const { name, api_key: apiKey } = routing.decision_model;
  const parsed = parseModelFqn(name);
  if (parsed === undefined) {
    throw new Error(`Model routing decision_model.name must be "account/model": ${name}`);
  }
  let integrations: unknown[];
  let installations: unknown;
  try {
    [integrations, installations] = await Promise.all([
      input.client.listProviderIntegrations({
        accessToken: apiKey,
        filter: { provider_account_name: parsed.providerName, name: parsed.modelName },
      }),
      input.client.listGatewayInstallations(apiKey),
    ]);
  } catch (error) {
    throw new Error(`Model routing could not load decision model "${name}" from the ServiceFoundry server`, {
      cause: error,
    });
  }
  const model = mapEnabledModels({ integrations, modelTypes: ['chat', 'decision'] }).find(
    candidate => candidate.accountName === parsed.providerName && candidate.modelName === parsed.modelName,
  );
  if (model === undefined) {
    throw new Error(`Model routing decision model "${name}" is not available to its api_key`);
  }
  let baseUrl: string;
  try {
    baseUrl = resolveDefaultGatewayUrl(installations);
  } catch (error) {
    throw new Error('Model routing could not resolve the default TrueFoundry AI gateway', { cause: error });
  }
  return {
    client: new OpenAIDecisionModel({
      provider: { type: 'truefoundry', name: model.accountName },
      model: { id: `${model.accountName}/${model.modelName}`, name: model.modelName },
      name,
      baseUrl,
      apiKey,
      headers: {},
    }),
    properties: { contextLength: model.properties.context_length },
  };
}
