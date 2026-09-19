import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import configuration, { isTrueFoundryModeEnabled } from '../config';
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
  type: z.string().optional(),
  manifest: z.object({
    type: z.string().optional(),
    model_types: z.array(z.string()).optional(),
    base_url: z.string().optional(),
    baseUrl: z.string().optional(),
    url: z.string().optional(),
  }),
  providerAccount: z.object({
    name: z.string().min(1),
    manifest: z.object({ type: z.string().optional() }).optional(),
  }),
  metadata: MetadataSchema.optional(),
});

type Integration = z.infer<typeof IntegrationSchema>;
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
  endpointKind: 'provider' | 'custom-endpoint';
  upstreamBaseUrl: string | undefined;
}

function integrationTypes(integration: Integration): string[] {
  return [integration.type, integration.manifest.type, integration.providerAccount.manifest?.type].flatMap(type =>
    type === undefined ? [] : [type],
  );
}

function isCustomEndpoint(integration: Integration): boolean {
  return integrationTypes(integration).some(type => type.includes('custom-endpoint'));
}

function upstreamBaseUrl(integration: Integration): string | undefined {
  const { base_url: snake, baseUrl: camel, url } = integration.manifest;
  const value = snake ?? camel ?? url;
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pathnameOf(raw: string): string | undefined {
  try {
    return new URL(raw).pathname.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function isOpenAiApiRoot(pathname: string): boolean {
  return /(?:^|\/)v\d+(?:beta)?$/.test(pathname);
}

function isTypeSafeHost(raw: string): boolean {
  const host = (() => {
    try {
      return new URL(raw).hostname;
    } catch {
      return undefined;
    }
  })();
  return host === 'typesafe.ai' || host?.endsWith('.typesafe.ai') === true;
}

/** Joins path segments onto a gateway base, keeping an existing prefix such as `/api/llm`. */
export function joinGatewayPath(input: { base: string; segments: readonly string[] }): string {
  const url = new URL(input.base);
  const prefix = url.pathname.replace(/\/+$/, '');
  const suffix = input.segments
    .map(segment => segment.replace(/^\/+|\/+$/g, ''))
    .filter(segment => segment.length > 0)
    .join('/');
  url.pathname = suffix.length > 0 ? `${prefix}/${suffix}` : prefix || '/';
  url.search = '';
  url.hash = '';
  const href = url.toString();
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

export type CustomEndpointCall =
  { kind: 'chat'; baseUrl: string; chatCompletionsPath: string } | { kind: 'unsupported'; message: string };

/**
 * Custom endpoints are transparent proxies at `{gateway}/proxy-api/{account}/{endpoint}/{path}`.
 * `/chat/completions` is only correct when the upstream base is an OpenAI `/vN` root.
 * Jev's upstream is `POST /v1/systemone`, which 404s if that suffix is appended.
 */
export function resolveCustomEndpointCall(input: {
  gatewayUrl: string;
  accountName: string;
  endpointName: string;
  upstreamBaseUrl: string | undefined;
  modelFqn: string;
}): CustomEndpointCall {
  const baseUrl = joinGatewayPath({
    base: input.gatewayUrl,
    segments: ['proxy-api', input.accountName, input.endpointName],
  });
  const upstream = input.upstreamBaseUrl;
  if (upstream !== undefined && isTypeSafeHost(upstream)) {
    return {
      kind: 'unsupported',
      message:
        `Model "${input.modelFqn}" cannot run an agent turn. It is a TrueFoundry custom endpoint for TypeSafe Jev (${upstream}). ` +
        'Jev answers typed questions at POST /v1/systemone and does not implement OpenAI chat completions, tools, or streaming. Pick a chat model instead.',
    };
  }
  const path = upstream === undefined ? undefined : pathnameOf(upstream);
  if (path !== undefined && isOpenAiApiRoot(path)) {
    return { kind: 'chat', baseUrl, chatCompletionsPath: '/chat/completions' };
  }
  if (
    upstream !== undefined &&
    path !== undefined &&
    path !== '' &&
    !path.endsWith('/chat/completions') &&
    !isOpenAiApiRoot(path)
  ) {
    return {
      kind: 'unsupported',
      message:
        `Model "${input.modelFqn}" cannot run an agent turn. Its TrueFoundry custom endpoint (${upstream}) is not an OpenAI-compatible chat completions API. ` +
        'Point the endpoint base URL at an OpenAI-compatible /v1 root, or pick a chat model.',
    };
  }
  // Missing upstream, or a base URL that already includes `/chat/completions`: post to the proxy root.
  return { kind: 'chat', baseUrl, chatCompletionsPath: '' };
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
      endpointKind: isCustomEndpoint(integration) ? 'custom-endpoint' : 'provider',
      upstreamBaseUrl: upstreamBaseUrl(integration),
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
