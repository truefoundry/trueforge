import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import configuration, { isTrueFoundryModeEnabled } from '../config';
import type { RoutingCandidate } from '../modelRouting/types';
import type { ModelProperties, ReasoningEffort } from '../schemas/modelProvider';

const ModelParamSchema = z.object({
  key: z.string(),
  supportedValues: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
});

const TokenCostSchema = z.object({
  input_cost_per_token: z.number().nullish(),
  output_cost_per_token: z.number().nullish(),
});

// Routing-only fields fall back to undefined on an unexpected shape, so they can never break listing.
const MetadataSchema = z.object({
  limits: z
    .object({
      context_window: z.number().optional(),
      max_input_tokens: z.number().optional(),
      max_output_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .optional(),
  params: z.array(ModelParamSchema).optional(),
  external_ids: z.object({ artificial_analysis_slug: z.string().nullish() }).optional().catch(undefined),
  public_cost: TokenCostSchema.optional().catch(undefined),
  costs: z
    .array(TokenCostSchema.extend({ region: z.string().nullish() }))
    .optional()
    .catch(undefined),
  modalities: z
    .object({ input: z.array(z.string()).optional() })
    .optional()
    .catch(undefined),
});

const IntegrationSchema = z.object({
  name: z.string().min(1),
  manifest: z.object({ model_types: z.array(z.string()).optional() }),
  providerAccount: z.object({ name: z.string().min(1) }),
  metadata: MetadataSchema.optional(),
});

type IntegrationMetadata = z.infer<typeof MetadataSchema>;

function toReasoningEfforts(params: IntegrationMetadata['params']): ReasoningEffort[] | undefined {
  if (!params) {
    return undefined;
  }
  const matched: ReasoningEffort[] = [];
  for (const param of params) {
    if (param.key !== 'reasoning_effort') {
      continue;
    }
    for (const value of param.supportedValues ?? []) {
      const effort = SUPPORTED_REASONING_EFFORTS.find(item => item === value);
      if (effort && !matched.includes(effort)) {
        matched.push(effort);
      }
    }
  }
  return matched.length > 0 ? matched : undefined;
}

function toProperties(metadata: IntegrationMetadata | undefined): ModelProperties {
  const limits = metadata?.limits;
  const contextLength = limits?.context_window ?? limits?.max_input_tokens;
  const maxOutputTokens = limits?.max_output_tokens ?? limits?.max_tokens;
  const reasoningEfforts = toReasoningEfforts(metadata?.params);
  return {
    ...(contextLength ? { context_length: contextLength } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...(reasoningEfforts ? { reasoning_efforts: reasoningEfforts } : {}),
  };
}

/**
 * Blended USD per million tokens, weighted 0.8 × input + 0.2 × output since agent loops read far more than
 * they write. Uses the public price if set, else the global-region price, else the first region with a price.
 */
function toBlendedPrice(metadata: IntegrationMetadata | undefined): number | undefined {
  const regionCosts = metadata?.costs ?? [];
  const globalCosts = regionCosts.filter(cost => cost.region === '*');
  const inPreferenceOrder = [metadata?.public_cost, ...globalCosts, ...regionCosts];
  for (const cost of inPreferenceOrder) {
    if (typeof cost?.input_cost_per_token === 'number' && typeof cost.output_cost_per_token === 'number') {
      return (0.8 * cost.input_cost_per_token + 0.2 * cost.output_cost_per_token) * 1e6;
    }
  }
  return undefined;
}

function toRoutingMetadata(metadata: IntegrationMetadata | undefined): TrueFoundryEnabledModel['routing'] {
  const defaultEffort = metadata?.params?.find(param => param.key === 'reasoning_effort')?.defaultValue;
  return {
    slug: metadata?.external_ids?.artificial_analysis_slug ?? undefined,
    defaultEffort: typeof defaultEffort === 'string' ? defaultEffort : undefined,
    price: toBlendedPrice(metadata),
    imageInput: metadata?.modalities?.input?.includes('image'),
  };
}

export interface TrueFoundryEnabledModel {
  accountName: string;
  modelName: string;
  properties: ModelProperties;
  /** Catalog fields the model router reads; never part of the public model listing. */
  routing: Omit<RoutingCandidate, 'model'>;
}

export function mapEnabledModels(input: { integrations: readonly unknown[] }): TrueFoundryEnabledModel[] {
  const models: TrueFoundryEnabledModel[] = [];
  for (const row of input.integrations) {
    const integration = IntegrationSchema.parse(row);
    if (!integration.manifest.model_types?.includes('chat')) {
      continue;
    }
    models.push({
      accountName: integration.providerAccount.name,
      modelName: integration.name,
      properties: toProperties(integration.metadata),
      routing: toRoutingMetadata(integration.metadata),
    });
  }
  return models;
}

/**
 * Applies `TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS` when TrueFoundry mode is on.
 * Tenants omitted from the map are unfiltered; listed tenants keep only matching `accountName`s.
 */
export function filterEnvModels(input: {
  tenant_id: string;
  models: readonly TrueFoundryEnabledModel[];
}): TrueFoundryEnabledModel[] {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return [...input.models];
  }
  const allowedAccounts = configuration.TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS[input.tenant_id];
  if (allowedAccounts === undefined) {
    return [...input.models];
  }
  const allowed = new Set(allowedAccounts);
  return input.models.filter(model => allowed.has(model.accountName));
}

const InstallationSchema = z.object({
  isDefault: z.boolean().optional(),
  manifest: z.object({ url: z.string().min(1) }),
});

const InstallationsEnvelopeSchema = z.union([z.array(z.unknown()), z.object({ data: z.array(z.unknown()) })]);

export function resolveDefaultGatewayUrl(payload: unknown): string {
  const envelope = InstallationsEnvelopeSchema.parse(payload);
  const rows = Array.isArray(envelope) ? envelope : envelope.data;
  for (const row of rows) {
    const installation = InstallationSchema.parse(row);
    if (installation.isDefault === true) {
      return installation.manifest.url;
    }
  }
  throw new HTTPException(502, { message: 'No default TrueFoundry AI gateway installation is configured' });
}
