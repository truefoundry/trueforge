import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { ModelProperties, ReasoningEffort } from '../schemas/modelProvider';

const ModelParamSchema = z.object({
  key: z.string(),
  supportedValues: z.array(z.string()).optional(),
});

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

export interface TrueFoundryEnabledModel {
  accountName: string;
  modelName: string;
  properties: ModelProperties;
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
    });
  }
  return models;
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
