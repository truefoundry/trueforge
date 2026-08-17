import { createAlibaba } from '@ai-sdk/alibaba';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import type { MoonshotAIProviderOptions } from '@ai-sdk/moonshotai';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';
import type { OpenAICompatibleProviderOptions } from '@ai-sdk/openai-compatible';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { JSONObject } from '@ai-sdk/provider';
import type { ProviderOptions, ReasoningPart } from '@ai-sdk/provider-utils';
import type {
  AssistantContent,
  CallWarning,
  FilePart,
  FinishReason,
  JSONValue,
  LanguageModel,
  LanguageModelCallOptions,
  ModelMessage,
  ProviderMetadata,
  TextPart,
  TextStreamPart,
  ToolCallPart,
  ToolContent,
  ToolSet,
  UserContent,
} from 'ai';
import { APICallError, jsonSchema, Output, streamText } from 'ai';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat';
import type { Logger } from 'winston';
import { describeUnknownError, extractErrorLogFields } from '../util/errorLogFields';
import type { ILLM, LLMCreateParams, LLMCreateParamsStreaming } from './ILLM';
import {
  type CompletionUsage,
  type ExtendedChatCompletionChunk,
  getEmptyUsage,
  type RawAssistantMessage,
  type RawAssistantMessageWithUsage,
  type ThinkingBlock,
} from './LLMTypes';

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

/**
 * Providers with a case in {@link buildLanguageModel}. Canonical: the server derives the provider
 * types it will configure from this, so anything it accepts has an adapter behind it.
 */
export const VERCEL_AI_PROVIDER_NAMES = [
  'openai',
  'anthropic',
  'google-gemini',
  'fireworks',
  'zai',
  'moonshot',
  'alibaba',
  'together',
  'custom',
] as const;

export type VercelAIProviderName = (typeof VERCEL_AI_PROVIDER_NAMES)[number];

/**
 * Adapter-facing config, camelCase throughout. Callers translate from the snake_case wire and
 * storage shapes, which stay as they are because they are the published contract.
 */
export interface VercelAIProviderConfig {
  /** Adapter discriminator plus configured resource name (source `type/name/...`). */
  provider: {
    type: VercelAIProviderName;
    name: string;
  };
  /** Provider-facing model identifier and configured model name. */
  model: {
    id: string;
    name: string;
  };
  /** Display name / alias, used for logs and chunk labels. */
  name: string;
  /** Optional base URL override. Explicitly includes `undefined` for Zod-derived type compat. */
  baseUrl?: string | undefined;
  apiKey: string;
  headers: Record<string, string>;
}

export interface VercelAILLMConfig {
  providerConfig: VercelAIProviderConfig;
  logger: Logger;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

/** Narrows to an indexable record. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** OpenAI SDK v7 unions function + custom tools; harness only emits function tools. */
function isFunctionTool(tool: ChatCompletionTool): tool is Extract<ChatCompletionTool, { type: 'function' }> {
  return tool.type === 'function';
}

/** OpenAI SDK v7 unions function + custom tool calls; harness only consumes function calls. */
function isFunctionToolCall<T extends { type: string }>(toolCall: T): toolCall is Extract<T, { type: 'function' }> {
  return toolCall.type === 'function';
}

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

/**
 * Shared by every OpenAI-compatible provider, which differ only by endpoint. The provider type
 * doubles as the `providerOptions` key. Fireworks, Together and Z AI stay here rather than on their
 * own packages: those drop `json_schema`, and Fireworks also clamps efforts its models do accept.
 * TODO: move Z AI to @ai-sdk/zai once https://github.com/vercel/ai/pull/17340 ships.
 */
function compatibleModel(config: VercelAIProviderConfig): LanguageModel {
  const { provider, model, apiKey, headers, baseUrl } = config;
  if (baseUrl === undefined) {
    throw new Error(`Provider "${provider.type}" requires a baseUrl`);
  }
  const client = createOpenAICompatible({
    name: provider.type,
    baseURL: baseUrl,
    apiKey,
    // Without this the adapter silently downgrades json_schema to a schema-less json_object.
    supportsStructuredOutputs: true,
    // These endpoints omit token counts from streamed responses unless asked.
    includeUsage: true,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
  return client(model.id);
}

export function buildLanguageModel(config: VercelAIProviderConfig): LanguageModel {
  const { provider, model, baseUrl, apiKey, headers } = config;
  const extraHeaders = Object.keys(headers).length > 0 ? headers : undefined;

  switch (provider.type) {
    case 'openai': {
      const client = createOpenAI({
        apiKey,
        ...(baseUrl !== undefined ? { baseURL: baseUrl } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client.responses(model.id);
    }
    case 'anthropic': {
      const client = createAnthropic({
        apiKey,
        ...(baseUrl !== undefined ? { baseURL: baseUrl } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(model.id);
    }
    case 'google-gemini': {
      const client = createGoogle({
        apiKey,
        ...(baseUrl !== undefined ? { baseURL: baseUrl } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(model.id);
    }
    case 'moonshot': {
      const client = createMoonshotAI({
        apiKey,
        ...(baseUrl !== undefined ? { baseURL: baseUrl } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(model.id);
    }
    case 'alibaba': {
      // Endpoints are workspace-scoped, so the package default would address the wrong tenant.
      if (baseUrl === undefined) {
        throw new Error(`Provider "alibaba" requires a baseUrl`);
      }
      const client = createAlibaba({
        apiKey,
        baseURL: baseUrl,
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(model.id);
    }
    case 'fireworks':
    case 'zai':
    case 'together':
    case 'custom': {
      return compatibleModel(config);
    }
    default: {
      const _exhaustive: never = provider.type;
      throw new Error(`Unknown provider "${String(_exhaustive)}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Reasoning effort
// ---------------------------------------------------------------------------

/**
 * The cross-provider `streamText({ reasoning })` setting, distinct from `providerOptions`. Derived
 * from the SDK's own type rather than mirrored by hand.
 */
type ReasoningLevel = NonNullable<LanguageModelCallOptions['reasoning']>;

const COMMON_REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningLevel[];

const VERCEL_AI_REASONING_LEVELS = [
  'provider-default',
  ...COMMON_REASONING_LEVELS,
] as const satisfies readonly ReasoningLevel[];

// Fails if any union member is missing.
true satisfies Exclude<ReasoningLevel, (typeof VERCEL_AI_REASONING_LEVELS)[number]> extends never ? true : never;

function isReasoningLevel(v: string): v is ReasoningLevel {
  return VERCEL_AI_REASONING_LEVELS.some(level => level === v);
}

/**
 * Efforts the SDK's union cannot express. `xhigh` is its ceiling, so `max` rides in as `xhigh`;
 * Anthropic's adapter raises that back, and {@link maxEffortOption} covers the rest.
 * Keys here must also appear in {@link SUPPORTED_REASONING_EFFORTS}.
 */
const EFFORT_ALIASES: Readonly<Record<string, ReasoningLevel>> = { max: 'xhigh' };

/** What a model may advertise in `reasoning_efforts`; anything else resolves to the provider default. */
export const SUPPORTED_REASONING_EFFORTS = [...COMMON_REASONING_LEVELS, 'max'] as const;

/**
 * The effort travels on the top-level `reasoning` setting, which each adapter translates per model:
 * an effort string for OpenAI-shaped APIs, a thinking shape for Anthropic, a level or budget for
 * Gemini. A reasoning `providerOptions` entry replaces that path rather than merging with it.
 */
export function toReasoningLevel(reasoningEffort: string | undefined): ReasoningLevel | undefined {
  if (reasoningEffort === undefined) {
    return undefined;
  }
  const aliased = EFFORT_ALIASES[reasoningEffort];
  if (aliased !== undefined) {
    return aliased;
  }
  return isReasoningLevel(reasoningEffort) ? reasoningEffort : undefined;
}

/**
 * `max` needs each adapter's own option, which wins over the top-level setting; the callers below
 * say why. The intersection resolves to `'max'`, so a package dropping it breaks the build.
 */
type MaxEffortOption = Pick<OpenAIResponsesProviderOptions, 'reasoningEffort'> &
  Pick<OpenAICompatibleProviderOptions, 'reasoningEffort'> &
  Pick<MoonshotAIProviderOptions, 'reasoningEffort'>;

function maxEffortOption(reasoningEffort: string | undefined): MaxEffortOption {
  return reasoningEffort === 'max' ? { reasoningEffort: 'max' } : {};
}

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

/**
 * Kept as plain data rather than an SDK `Output` instance, since `Output` isn't a nameable
 * exported type from `ai` — see `buildOutput`.
 */
export type StructuredOutputSpec =
  | { mode: 'text' }
  | { mode: 'json' }
  | {
      mode: 'json_schema';
      schema: Record<string, unknown>;
      name: string;
      description: string | undefined;
      /** Mirrors `response_format.json_schema.strict`; consumed by `buildProviderOptions`. */
      strict: boolean | undefined;
    };

/** Converts an OpenAI-format `response_format` into a normalized `StructuredOutputSpec`. */
export function toStructuredOutputSpec(
  responseFormat: ChatCompletionCreateParamsStreaming['response_format'],
): StructuredOutputSpec {
  if (responseFormat === undefined || responseFormat.type === 'text') {
    return { mode: 'text' };
  }
  if (responseFormat.type === 'json_object') {
    return { mode: 'json' };
  }
  const { json_schema } = responseFormat;
  return {
    mode: 'json_schema',
    schema: json_schema.schema ?? { type: 'object', properties: {} },
    name: json_schema.name,
    description: json_schema.description,
    strict: json_schema.strict ?? undefined,
  };
}

/** Not exported: `Output`'s type isn't nameable outside `ai`, so a return type can't be declared. */
function buildOutput(spec: StructuredOutputSpec) {
  switch (spec.mode) {
    case 'text':
      return undefined;
    case 'json':
      return Output.json();
    case 'json_schema':
      return Output.object({
        schema: jsonSchema(spec.schema),
        name: spec.name,
        ...(spec.description !== undefined ? { description: spec.description } : {}),
      });
    default: {
      const _exhaustive: never = spec;
      throw new Error(`Unknown structured output mode: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider options
// ---------------------------------------------------------------------------

/** `rawBody` is a parsed JSON request body, so any value present is a valid JSONValue. */
function readBodyField({ rawBody, key }: { rawBody: unknown; key: string }): JSONValue | undefined {
  const val: unknown = Reflect.get(Object(rawBody), key);
  return val !== undefined ? (val as JSONValue) : undefined;
}

function openaiProviderOptions({
  rawBody,
  strictJsonSchema,
  reasoningEffort,
}: {
  rawBody: unknown;
  strictJsonSchema: boolean | undefined;
  reasoningEffort: string | undefined;
}): JSONObject {
  const serviceTier = readBodyField({ rawBody, key: 'service_tier' });
  const user = readBodyField({ rawBody, key: 'user' });
  const promptCacheKey = readBodyField({ rawBody, key: 'prompt_cache_key' });
  const parallelToolCalls = readBodyField({ rawBody, key: 'parallel_tool_calls' });
  const reasoningSummary = readBodyField({ rawBody, key: 'reasoning_summary' });
  // No server-side storage, and request the encrypted reasoning token so replay stays stateless.
  return {
    store: false,
    include: ['reasoning.encrypted_content'],
    reasoningSummary: 'auto',
    // gpt-5.6 serves both xhigh and max, so the aliased top-level level asks for one rung less.
    ...maxEffortOption(reasoningEffort),
    ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    ...(strictJsonSchema !== undefined ? { strictJsonSchema } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(promptCacheKey !== undefined ? { promptCacheKey } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
  };
}

/**
 * Forwards but never pins `thinking` and `effort`: both replace the adapter's per-model resolution
 * and no single value fits every model. This is the caller's only route to disabling thinking, or to
 * the `display: 'summarized'` that makes Claude 5 return reasoning text instead of an empty block.
 *
 * Prompt caching defaults on: Anthropic bills a write once, then cheaper reads on stable prefixes
 * (system / tools / early messages). Callers can override via `cache_control` in the request body.
 */
function anthropicProviderOptions(rawBody: unknown): JSONObject | undefined {
  const cacheControl = readBodyField({ rawBody, key: 'cache_control' }) ?? { type: 'ephemeral' };
  const disableParallelToolUse = readBodyField({ rawBody, key: 'disable_parallel_tool_use' });
  const thinking = readBodyField({ rawBody, key: 'thinking' });
  const effort = readBodyField({ rawBody, key: 'effort' });
  const opts: JSONObject = {
    cacheControl,
    ...(disableParallelToolUse !== undefined ? { disableParallelToolUse } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
  return opts;
}

/**
 * Gemini returns thought summaries only when `includeThoughts` is set, and `@ai-sdk/google` omits it
 * — without this the model bills reasoning tokens and returns none. The effort itself rides in the
 * top-level `reasoning` setting. An explicit `thinking_config` in the request body wins.
 */
function googleGeminiThinkingConfig({
  rawBody,
  reasoningRequested,
}: {
  rawBody: unknown;
  reasoningRequested: boolean;
}): JSONValue | undefined {
  const fromBody = readBodyField({ rawBody, key: 'thinking_config' });
  if (!reasoningRequested) {
    return fromBody;
  }
  if (typeof fromBody === 'object' && fromBody !== null && !Array.isArray(fromBody)) {
    return { includeThoughts: true, ...fromBody };
  }
  return { includeThoughts: true };
}

function googleGeminiProviderOptions({
  rawBody,
  reasoningRequested,
}: {
  rawBody: unknown;
  reasoningRequested: boolean;
}): JSONObject | undefined {
  const safetySettings = readBodyField({ rawBody, key: 'safety_settings' });
  const thinkingConfig = googleGeminiThinkingConfig({ rawBody, reasoningRequested });
  const cachedContent = readBodyField({ rawBody, key: 'cached_content' });
  const opts: JSONObject = {
    ...(safetySettings !== undefined ? { safetySettings } : {}),
    ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
    ...(cachedContent !== undefined ? { cachedContent } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * `thinking` and `reasoning_history` are forwarded but never pinned: they are the caller's route to
 * turning thinking off, or to replaying it verbatim.
 */
function moonshotProviderOptions({
  rawBody,
  reasoningEffort,
}: {
  rawBody: unknown;
  reasoningEffort: string | undefined;
}): JSONObject | undefined {
  const thinking = readBodyField({ rawBody, key: 'thinking' });
  const reasoningHistory = readBodyField({ rawBody, key: 'reasoning_history' });
  const opts: JSONObject = {
    // Moonshot's own ceiling is `max`; the aliased `xhigh` is not one of its levels.
    ...maxEffortOption(reasoningEffort),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(reasoningHistory !== undefined ? { reasoningHistory } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/** Qwen resolves the top-level effort into a thinking budget; these override that resolution. */
function alibabaProviderOptions(rawBody: unknown): JSONObject | undefined {
  const enableThinking = readBodyField({ rawBody, key: 'enable_thinking' });
  const thinkingBudget = readBodyField({ rawBody, key: 'thinking_budget' });
  const parallelToolCalls = readBodyField({ rawBody, key: 'parallel_tool_calls' });
  const opts: JSONObject = {
    ...(enableThinking !== undefined ? { enableThinking } : {}),
    ...(thinkingBudget !== undefined ? { thinkingBudget } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * The adapter copies options outside its own schema into the body under the same key, so these are
 * wire names, not camelCase. Unvalidated: a field the endpoint rejects fails loudly.
 */
const COMPATIBLE_BODY_FIELDS = [
  'service_tier',
  'user',
  'prompt_cache_key',
  'parallel_tool_calls',
  'thinking',
  'thinking_budget',
  'enable_thinking',
  'reasoning_history',
] as const;

function compatibleProviderOptions({
  strictJsonSchema,
  reasoningEffort,
  rawBody,
}: {
  strictJsonSchema: boolean | undefined;
  reasoningEffort: string | undefined;
  rawBody: unknown;
}): JSONObject | undefined {
  const forwarded: JSONObject = Object.fromEntries(
    COMPATIBLE_BODY_FIELDS.flatMap(key => {
      const value = readBodyField({ rawBody, key });
      return value === undefined ? [] : [[key, value] as const];
    }),
  );
  const opts: JSONObject = {
    // These endpoints discard an effort they do not recognise, and `xhigh` is one of those.
    ...maxEffortOption(reasoningEffort),
    ...forwarded,
    ...(strictJsonSchema !== undefined ? { strictJsonSchema } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Provider-specific fields in `rawBody` (`cache_control`, `service_tier`, `safety_settings`, …)
 * are forwarded by snake_case key with no validation.
 */
export function buildProviderOptions({
  config,
  reasoningEffort,
  structuredOutputSpec,
  rawBody,
}: {
  config: VercelAIProviderConfig;
  /** The requested effort, which rides in the top-level `reasoning` setting for every provider. */
  reasoningEffort: string | undefined;
  structuredOutputSpec: StructuredOutputSpec;
  rawBody: unknown;
}): ProviderOptions {
  const strictJsonSchema = structuredOutputSpec.mode === 'json_schema' ? structuredOutputSpec.strict : undefined;
  if (config.provider.type === 'openai') {
    return { openai: openaiProviderOptions({ rawBody, strictJsonSchema, reasoningEffort }) };
  } else if (config.provider.type === 'anthropic') {
    const anthropic = anthropicProviderOptions(rawBody);
    return anthropic !== undefined ? { anthropic } : {};
  } else if (config.provider.type === 'google-gemini') {
    const google = googleGeminiProviderOptions({ rawBody, reasoningRequested: reasoningEffort !== undefined });
    return google !== undefined ? { google } : {};
  } else if (config.provider.type === 'moonshot') {
    // The package names its options key after itself, not after the provider.
    const moonshotai = moonshotProviderOptions({ rawBody, reasoningEffort });
    return moonshotai !== undefined ? { moonshotai } : {};
  } else if (config.provider.type === 'alibaba') {
    const alibaba = alibabaProviderOptions(rawBody);
    return alibaba !== undefined ? { alibaba } : {};
  } else {
    // The remaining providers all share the compatible adapter, which reads its options from a key
    // matching the `name` it was built with — the provider type itself.
    const compatible = compatibleProviderOptions({ strictJsonSchema, reasoningEffort, rawBody });
    return compatible !== undefined ? { [config.provider.type]: compatible } : {};
  }
}

// ---------------------------------------------------------------------------
// Request conversion (OpenAI → SDK)
// ---------------------------------------------------------------------------

/** Prefers `max_completion_tokens`, falling back to the deprecated `max_tokens`. */
export function resolveMaxOutputTokens(
  body: Pick<ChatCompletionCreateParamsStreaming, 'max_completion_tokens'>,
): number | undefined {
  const limit: unknown = body.max_completion_tokens ?? Reflect.get(body, 'max_tokens');
  return typeof limit === 'number' ? limit : undefined;
}

/** Parses the MIME type from a data URI (`data:<mime>;base64,...`). */
export function parseMimeFromDataUri(uri: string): string | undefined {
  const match = /^data:([^;,]+)/.exec(uri);
  return match?.[1];
}

/** Returns `undefined` for parts with no inline data, e.g. `file_id` only. */
export function toFilePart(file: {
  file_data?: string | undefined;
  filename?: string | undefined;
}): FilePart | undefined {
  const { file_data, filename } = file;
  if (!file_data) {
    return undefined;
  }
  const mediaType = parseMimeFromDataUri(file_data) ?? 'application/octet-stream';
  return {
    type: 'file',
    data: file_data,
    mediaType,
    ...(filename !== undefined ? { filename } : {}),
  };
}

/** Converts a user content array from OpenAI format to Vercel AI SDK UserContent. */
export function toUserContent(content: string | ChatCompletionContentPart[]): UserContent {
  if (typeof content === 'string') {
    return content;
  }
  const parts: UserContent = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image_url') {
      // ImagePart is deprecated in favour of FilePart.
      const url = part.image_url.url;
      const mediaType = parseMimeFromDataUri(url) ?? 'image/*';
      parts.push({ type: 'file', data: url, mediaType });
      continue;
    }
    if (part.type === 'file') {
      const filePart = toFilePart(part.file);
      if (filePart !== undefined) {
        parts.push(filePart);
      }
      // file_id-only parts are unsupported (require server-side lookup); skip.
      continue;
    }
    // input_audio — not universally supported across providers; omit.
  }
  return parts;
}

/**
 * Converts an assistant message to the SDK shape for multi-turn replay.
 *
 * Each adapter reads its reasoning-replay token from a different key, and a mismatch fails
 * silently: the adapter drops the reasoning part and the model loses its chain.
 * - `'openai'`        → `openai.reasoningEncryptedContent`
 * - `'anthropic'`     → `anthropic.signature`
 * - `'google-gemini'` → per-tool-call `google.thoughtSignature`, no standalone reasoning block
 * - `'custom'`        → OpenAI-compatible ignores providerOptions, so the token has nowhere to go
 *
 * Signatures attach when `source` (`type/name/model`) matches both provider type and
 * provider name. Missing/foreign source → reasoning text only.
 */
export function toAssistantModelMessage({
  msg,
  provider,
  providerName,
  logger,
}: {
  msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }>;
  provider: VercelAIProviderName;
  /** Configured provider resource name. */
  providerName: string;
  logger?: Logger | undefined;
}): ModelMessage {
  const parts: AssistantContent = [];

  // `thinking_blocks` / `source` are attached at runtime by AgentThread and absent from the OpenAI SDK type.
  const rawThinking: unknown = Reflect.get(msg, 'thinking_blocks');
  const attachSignature = shouldAttachReasoningSignature({
    source: Reflect.get(msg, 'source'),
    provider,
    providerName,
    logger,
  });
  // Alibaba appends replayed thinking to the visible answer, and Qwen signs nothing to preserve.
  if (Array.isArray(rawThinking) && provider !== 'alibaba') {
    // Widen any[] → unknown[] so the in-guards below narrow safely.
    const blocks: unknown[] = rawThinking;
    for (const tb of blocks) {
      if (
        typeof tb === 'object' &&
        tb !== null &&
        'type' in tb &&
        'thinking' in tb &&
        tb.type === 'thinking' &&
        typeof tb.thinking === 'string'
      ) {
        const signature = 'signature' in tb && typeof tb.signature === 'string' ? tb.signature : undefined;
        let reasoningProviderOptions: ProviderOptions | undefined;
        if (signature !== undefined && attachSignature) {
          if (provider === 'openai') {
            reasoningProviderOptions = { openai: { reasoningEncryptedContent: signature } };
          } else if (provider === 'anthropic') {
            reasoningProviderOptions = { anthropic: { signature } };
          }
        }
        const reasoningPart: ReasoningPart = {
          type: 'reasoning',
          text: tb.thinking,
          ...(reasoningProviderOptions !== undefined ? { providerOptions: reasoningProviderOptions } : {}),
        };
        parts.push(reasoningPart);
      }
    }
  }

  const rawContent = msg.content;
  if (rawContent) {
    const text =
      typeof rawContent === 'string'
        ? rawContent
        : rawContent
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('');
    if (text) {
      const textPart: TextPart = { type: 'text', text };
      parts.push(textPart);
    }
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      if (!isFunctionToolCall(tc)) {
        continue;
      }
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments);
        if (isPlainObject(parsed)) {
          input = parsed;
        }
      } catch {
        // malformed arguments — leave empty record
      }
      const rawProviderFields: unknown = Reflect.get(tc, 'provider_specific_fields');
      const thoughtSignature =
        isPlainObject(rawProviderFields) && typeof rawProviderFields['thought_signature'] === 'string'
          ? rawProviderFields['thought_signature']
          : undefined;
      const toolCallPart: ToolCallPart = {
        type: 'tool-call',
        toolCallId: tc.id,
        toolName: tc.function.name,
        input,
        ...(thoughtSignature !== undefined
          ? { providerOptions: { google: { thoughtSignature } } satisfies ProviderOptions }
          : {}),
      };
      parts.push(toolCallPart);
    }
  }

  return {
    role: 'assistant',
    content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
  };
}

/** Parse `provider_type/provider_name/model_name`. */
function parseAssistantMessageSource(
  source: string,
): { providerType: string; providerName: string; modelName: string } | undefined {
  const [providerType, providerName, modelName, ...rest] = source.split('/');
  if (rest.length > 0 || !providerType || !providerName || !modelName) {
    return undefined;
  }
  return { providerType, providerName, modelName };
}

/** Attach when both provider type and configured provider name match `source`. */
export function shouldAttachReasoningSignature({
  source,
  provider,
  providerName,
  logger,
}: {
  source: unknown;
  provider: VercelAIProviderName;
  providerName: string;
  logger?: Logger | undefined;
}): boolean {
  if (source === undefined) {
    return false;
  }
  if (typeof source !== 'string') {
    logger?.warn('Ignoring non-string assistant message source; skipping reasoning signature replay', { source });
    return false;
  }
  const parsed = parseAssistantMessageSource(source);
  if (parsed === undefined) {
    logger?.warn('Ignoring malformed assistant message source; skipping reasoning signature replay', { source });
    return false;
  }
  return parsed.providerType === provider && parsed.providerName === providerName;
}

export interface ConvertedMessages {
  instructions: string | undefined;
  messages: ModelMessage[];
}

/**
 * System messages are extracted into `instructions`, since SDK v7 no longer accepts
 * `{ role: 'system' }` in the messages array. The toolCallId → toolName lookup is built first
 * because tool result messages carry only the id.
 */
export function convertMessages({
  messages,
  provider,
  providerName,
  logger,
}: {
  messages: ChatCompletionMessageParam[];
  provider: VercelAIProviderName;
  providerName: string;
  logger?: Logger | undefined;
}): ConvertedMessages {
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (!isFunctionToolCall(tc)) {
          continue;
        }
        toolNameById.set(tc.id, tc.function.name);
      }
    }
  }

  const systemParts: string[] = [];
  const result: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.text).join('');
      systemParts.push(content);
      continue;
    }
    if (msg.role === 'user') {
      result.push({ role: 'user', content: toUserContent(msg.content) });
      continue;
    }
    if (msg.role === 'assistant') {
      result.push(toAssistantModelMessage({ msg, provider, providerName, logger }));
      continue;
    }
    if (msg.role === 'tool') {
      const toolName = toolNameById.get(msg.tool_call_id) ?? '';
      const toolContent: ToolContent = [
        {
          type: 'tool-result',
          toolCallId: msg.tool_call_id,
          toolName,
          output: {
            type: 'text',
            value: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          },
        },
      ];
      result.push({ role: 'tool', content: toolContent });
      continue;
    }
    // 'developer' / 'function' roles — not used in the harness pipeline; skip.
  }
  return { instructions: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, messages: result };
}

/** Converts OpenAI tool definitions to the Vercel AI SDK ToolSet. */
export function convertTools(tools: ChatCompletionTool[] | undefined): ToolSet | undefined {
  if (!tools?.length) {
    return undefined;
  }
  const toolSet: ToolSet = {};
  for (const t of tools) {
    if (!isFunctionTool(t)) {
      continue;
    }
    toolSet[t.function.name] = {
      inputSchema: jsonSchema(t.function.parameters ?? { type: 'object', properties: {} }),
      ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    };
  }
  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}

// ---------------------------------------------------------------------------
// streamText args
// ---------------------------------------------------------------------------

/**
 * Pure-data subset of `streamText(...)`'s call args. Uses `?` rather than this file's usual
 * explicit `| undefined`, to match `streamText`'s own signature under `exactOptionalPropertyTypes`.
 */
export type StreamTextArgs = LanguageModelCallOptions & {
  model: LanguageModel;
  instructions?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  providerOptions?: ProviderOptions;
  abortSignal?: AbortSignal;
  maxRetries: number;
};

/**
 * Exported so the final wiring is unit-testable: a value computed correctly but never spread into
 * this object would pass every sub-function test. `output` is excluded and spread by the caller,
 * since its unnameable type would make this function's return type unnameable too.
 */
export function buildStreamTextArgs(input: {
  model: LanguageModel;
  instructions: string | undefined;
  messages: ModelMessage[];
  tools: ToolSet | undefined;
  reasoning: ReasoningLevel | undefined;
  providerOptions: ProviderOptions;
  maxOutputTokens: number | undefined;
  temperature: number | null | undefined;
  topP: number | null | undefined;
  topK: number | null | undefined;
  presencePenalty: number | null | undefined;
  frequencyPenalty: number | null | undefined;
  stopSequences: string[] | null | undefined;
  seed: number | null | undefined;
  abortSignal: AbortSignal | undefined;
}): StreamTextArgs {
  const {
    model,
    instructions,
    messages,
    tools,
    reasoning,
    providerOptions,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    stopSequences,
    seed,
    abortSignal,
  } = input;
  return {
    model,
    ...(instructions !== undefined ? { instructions } : {}),
    messages,
    ...(tools !== undefined ? { tools } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
    ...(topK != null ? { topK } : {}),
    ...(presencePenalty != null ? { presencePenalty } : {}),
    ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
    ...(stopSequences != null ? { stopSequences } : {}),
    ...(seed != null ? { seed } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
    maxRetries: 0,
  };
}

// ---------------------------------------------------------------------------
// Stream mapping (SDK → harness chunks)
// ---------------------------------------------------------------------------

/** Maps Vercel AI SDK LanguageModelUsage → harness CompletionUsage. */
export function normalizeUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails: {
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
    noCacheTokens: number | undefined;
  };
  outputTokenDetails: {
    reasoningTokens: number | undefined;
    textTokens: number | undefined;
  };
  // LanguageModelUsage.raw: AI SDK has no cost field; extras like gateway costInUSD live here.
  raw?: JSONObject;
}): CompletionUsage {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const costInUsd = usage.raw?.['costInUSD'];
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cache_read_tokens: usage.inputTokenDetails.cacheReadTokens ?? undefined,
    cache_write_tokens: usage.inputTokenDetails.cacheWriteTokens ?? undefined,
    reasoning_tokens: usage.outputTokenDetails.reasoningTokens ?? undefined,
    cost_in_usd: typeof costInUsd === 'number' && costInUsd >= 0 ? costInUsd : undefined,
  };
}

/**
 * Prefer AI SDK `APICallError` (`message` / `statusCode`):
 * https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-api-call-error#properties
 * Fallback is required because stream `error` parts are typed `unknown` (not only
 * `APICallError`) — plain objects would otherwise stringify to "[object Object]".
 */
export function describeStreamError(raw: unknown): string {
  if (APICallError.isInstance(raw)) {
    if (raw.statusCode != null) {
      return `Request failed (${String(raw.statusCode)}): ${raw.message}`;
    }
    return raw.message;
  }
  return describeUnknownError(raw);
}

export function toStreamError(raw: unknown): Error {
  if (raw instanceof Error) {
    return raw;
  }
  return new Error(describeStreamError(raw), { cause: raw });
}

export function mapFinishReason(reason: FinishReason): RawAssistantMessageWithUsage['finish_reason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    // No harness equivalent for these — fall back to 'stop'.
    case 'error':
    case 'other':
      return 'stop';
    default: {
      const _exhaustive: never = reason;
      throw new Error(`Unknown finish reason: ${String(_exhaustive)}`);
    }
  }
}

interface ToolCallState {
  index: number;
  id: string;
  name: string;
  arguments: string;
  /** Gemini `thoughtSignature` from `providerMetadata.google` on the `tool-input-start` part. */
  thoughtSignature: string | undefined;
}

/**
 * Copies the reasoning-replay token onto the block, scanning every provider namespace since only
 * the active one is populated. Providers disagree on where it arrives: OpenAI attaches it to
 * `reasoning-end`, Anthropic to a text-less `reasoning-delta`. Missing either silently loses the
 * chain, since unsigned thinking blocks are dropped on replay.
 */
function applyReasoningSignature({
  block,
  providerMetadata,
}: {
  block: ThinkingBlock;
  providerMetadata: ProviderMetadata | undefined;
}): void {
  if (providerMetadata === undefined) {
    return;
  }
  for (const meta of Object.values(providerMetadata)) {
    if ('reasoningEncryptedContent' in meta && typeof meta['reasoningEncryptedContent'] === 'string') {
      block.signature = meta['reasoningEncryptedContent'];
      return;
    }
    if ('signature' in meta && typeof meta['signature'] === 'string') {
      block.signature = meta['signature'];
      return;
    }
  }
}

/**
 * Which reasoning item a stream part belongs to. OpenAI is alone in splitting one item across
 * several parts, so elsewhere this is absent and every part stands on its own.
 */
function reasoningItemId(providerMetadata: ProviderMetadata | undefined): string | undefined {
  if (providerMetadata === undefined) {
    return undefined;
  }
  for (const meta of Object.values(providerMetadata)) {
    if ('itemId' in meta && typeof meta['itemId'] === 'string') {
      return meta['itemId'];
    }
  }
  return undefined;
}

/**
 * Where the SDK reports what it changed about our request: an effort a model cannot honour and so
 * was coerced, a setting the provider ignored. Nothing else surfaces these.
 */
export function describeCallWarning(warning: CallWarning): string {
  switch (warning.type) {
    case 'unsupported':
    case 'compatibility':
      return warning.details !== undefined
        ? `${warning.type}: ${warning.feature} (${warning.details})`
        : `${warning.type}: ${warning.feature}`;
    case 'deprecated':
      return `deprecated: ${warning.setting} - ${warning.message}`;
    case 'other':
      return `other: ${warning.message}`;
    default: {
      const _exhaustive: never = warning;
      throw new Error(`Unknown call warning: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Synthetic chunk fields shared by every chunk emitted for a single stream. */
interface ChunkMeta {
  id: string;
  created: number;
  model: string;
}

/**
 * Converts an SDK stream into harness chunks, returning the aggregated assistant message.
 * Takes a plain `AsyncIterable` so hand-built fixtures work in tests.
 */
export async function* mapStreamToChunks({
  stream,
  chunkMeta,
}: {
  stream: AsyncIterable<TextStreamPart<ToolSet>>;
  chunkMeta: ChunkMeta;
}): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  const makeBase = (): Omit<ExtendedChatCompletionChunk, 'choices' | 'usage'> => ({
    id: chunkMeta.id,
    object: 'chat.completion.chunk' as const,
    created: chunkMeta.created,
    model: chunkMeta.model,
  });

  const toolCallStates = new Map<string, ToolCallState>();
  let nextToolIndex = 0;
  let accumulatedText = '';
  const accumulatedThinking: ThinkingBlock[] = [];
  const thinkingByReasoningItem = new Map<string, ThinkingBlock>();
  let currentThinkingBlock: ThinkingBlock | null = null;

  /**
   * The block this reasoning part belongs to: the one already open for its item, or a new one.
   *
   * OpenAI streams a single reasoning item as several summary parts, and hands every part the one
   * token that identifies the item. A block per part would therefore replay that item once per
   * part, every copy presenting the same token with a different piece of the reasoning. Grouping by
   * item keeps one block per token, which is the only shape the provider can be replayed.
   */
  const openThinkingBlock = (providerMetadata: ProviderMetadata | undefined): ThinkingBlock => {
    const itemId = reasoningItemId(providerMetadata);
    const started = itemId !== undefined ? thinkingByReasoningItem.get(itemId) : undefined;
    if (started !== undefined) {
      // Each part is its own titled paragraph, and a part can be empty.
      if (started.thinking.length > 0) {
        started.thinking += '\n\n';
      }
      return started;
    }
    const block: ThinkingBlock = { type: 'thinking', thinking: '' };
    accumulatedThinking.push(block);
    if (itemId !== undefined) {
      thinkingByReasoningItem.set(itemId, block);
    }
    return block;
  };
  let finalUsage: CompletionUsage = getEmptyUsage();
  let finalFinishReason: RawAssistantMessageWithUsage['finish_reason'] = 'stop';

  for await (const part of stream) {
    switch (part.type) {
      case 'text-delta': {
        accumulatedText += part.text;
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: { content: part.text, role: 'assistant' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        };
        break;
      }

      case 'reasoning-start': {
        currentThinkingBlock = openThinkingBlock(part.providerMetadata);
        break;
      }

      case 'reasoning-delta': {
        // A delta with no preceding `reasoning-start` would otherwise drop the block and its
        // signature, breaking replay while the text still streams out.
        currentThinkingBlock ??= openThinkingBlock(part.providerMetadata);
        currentThinkingBlock.thinking += part.text;
        applyReasoningSignature({ block: currentThinkingBlock, providerMetadata: part.providerMetadata });
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: {
                thinking_blocks: [{ type: 'thinking', thinking: part.text }],
                reasoning_content: part.text,
              } satisfies ExtendedChatCompletionChunk['choices'][0]['delta'],
              finish_reason: null,
              logprobs: null,
            },
          ],
        };
        break;
      }

      case 'reasoning-end': {
        if (currentThinkingBlock !== null) {
          applyReasoningSignature({ block: currentThinkingBlock, providerMetadata: part.providerMetadata });
        }
        currentThinkingBlock = null;
        break;
      }

      case 'tool-input-start': {
        const idx = nextToolIndex++;
        // Gemini's replay token arrives here, and only here, for thinking models.
        const googleMeta = part.providerMetadata?.['google'];
        const thoughtSignature =
          googleMeta !== undefined && typeof googleMeta['thoughtSignature'] === 'string'
            ? googleMeta['thoughtSignature']
            : undefined;
        toolCallStates.set(part.id, {
          index: idx,
          id: part.id,
          name: part.toolName,
          arguments: '',
          thoughtSignature,
        });
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: part.id,
                    type: 'function',
                    function: { name: part.toolName, arguments: '' },
                  },
                ],
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        };
        break;
      }

      case 'tool-input-delta': {
        const state = toolCallStates.get(part.id);
        // With no matching `tool-input-start` there is no index to attribute this to; emitting it
        // anyway would append the arguments to an unrelated tool call.
        if (state === undefined) {
          break;
        }
        state.arguments += part.delta;
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: state.index, function: { arguments: part.delta } }],
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        };
        break;
      }

      case 'finish-step': {
        finalUsage = normalizeUsage(part.usage);
        finalFinishReason = mapFinishReason(part.finishReason);
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finalFinishReason,
              logprobs: null,
            },
          ],
          usage: finalUsage,
        };
        break;
      }

      case 'error': {
        const raw = part.error;
        const message = describeStreamError(raw);
        // Preserve the original stream error as cause; toast/turn use .message only.
        const cause = raw instanceof Error ? raw : new Error(message);
        throw new Error(message, { cause });
      }

      case 'abort': {
        const aborted = new Error('LLM stream aborted');
        aborted.name = 'AbortError';
        throw aborted;
      }

      case 'start':
      case 'text-start':
      case 'text-end':
      case 'custom':
      case 'tool-input-end':
      case 'source':
      case 'file':
      case 'reasoning-file':
      case 'tool-call':
      case 'tool-result':
      case 'tool-error':
      case 'tool-output-denied':
      case 'tool-approval-request':
      case 'tool-approval-response':
      case 'start-step':
      case 'finish':
      case 'raw':
        // Structural/bookkeeping events — no harness chunk is emitted for these.
        break;

      default: {
        const _exhaustive: never = part;
        throw new Error(`Unknown stream part type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  const toolCalls = [...toolCallStates.values()]
    .sort((a, b) => a.index - b.index)
    .map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
      ...(tc.thoughtSignature !== undefined
        ? { provider_specific_fields: { thought_signature: tc.thoughtSignature } }
        : {}),
    }));

  const output: RawAssistantMessage = {
    role: 'assistant',
    content: accumulatedText || null,
    ...(accumulatedThinking.length > 0 ? { thinking_blocks: accumulatedThinking } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return { usage: finalUsage, output, finish_reason: finalFinishReason };
}

// ---------------------------------------------------------------------------
// VercelAILLM
// ---------------------------------------------------------------------------

/** ILLM implementation backed by Vercel AI SDK, supporting multiple LLM providers. */
export class VercelAILLM implements ILLM {
  private readonly config: VercelAILLMConfig;
  private readonly logger: Logger;
  private readonly signal: AbortSignal | undefined;

  constructor(config: VercelAILLMConfig) {
    this.config = config;
    this.logger = config.logger;
    this.signal = config.signal;
  }

  async *create(
    body: LLMCreateParamsStreaming,
  ): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
    const { providerConfig } = this.config;
    const languageModel = buildLanguageModel(providerConfig);
    const { provider, model } = providerConfig;

    const { instructions, messages } = convertMessages({
      messages: body.messages,
      provider: provider.type,
      providerName: provider.name,
      logger: this.logger,
    });
    const tools = convertTools(body.tools ?? undefined);
    const structuredOutputSpec = toStructuredOutputSpec(body.response_format);
    const output = buildOutput(structuredOutputSpec);

    // reasoning_effort is injected by AgentThread via Object.assign; not in the SDK type.
    const rawReasoningEffort: unknown = Reflect.get(body, 'reasoning_effort');
    const reasoningEffort = typeof rawReasoningEffort === 'string' ? rawReasoningEffort : undefined;
    const providerOptions = buildProviderOptions({
      config: providerConfig,
      reasoningEffort,
      structuredOutputSpec,
      rawBody: body,
    });
    const reasoning = toReasoningLevel(reasoningEffort);

    // top_k is injected by AgentThread via Object.assign; not in the SDK type.
    const rawTopK: unknown = Reflect.get(body, 'top_k');
    // seed is still accepted by providers but marked @deprecated on the OpenAI request type.
    const rawSeed: unknown = Reflect.get(body, 'seed');
    const streamTextArgs = buildStreamTextArgs({
      model: languageModel,
      instructions,
      messages,
      tools,
      reasoning,
      providerOptions,
      maxOutputTokens: resolveMaxOutputTokens(body),
      temperature: body.temperature,
      topP: body.top_p,
      topK: typeof rawTopK === 'number' ? rawTopK : null,
      presencePenalty: body.presence_penalty,
      frequencyPenalty: body.frequency_penalty,
      stopSequences: typeof body.stop === 'string' ? [body.stop] : (body.stop ?? null),
      seed: typeof rawSeed === 'number' ? rawSeed : null,
      abortSignal: this.signal,
    });

    let streamResult;
    try {
      streamResult = streamText({
        ...streamTextArgs,
        ...(output !== undefined ? { output } : {}),
      });
    } catch (error) {
      if (this.signal?.aborted) {
        this.logger.debug('LLM call aborted', extractErrorLogFields(error));
      } else {
        this.logger.error('Error creating streaming chat completion', extractErrorLogFields(error));
      }
      throw toStreamError(error);
    }

    // Detached: warnings resolve at stream start, and a pending or rejected promise must never
    // stall the stream. Stream failures are reported by the error paths below.
    void streamResult.warnings.then(
      warnings => {
        if (warnings !== undefined && warnings.length > 0) {
          this.logger.warn('Provider adjusted the request', {
            model: providerConfig.name,
            warnings: warnings.map(describeCallWarning),
          });
        }
      },
      (reason: unknown) => {
        // Rejects with the same failure the stream throws, which the error paths below already log.
        this.logger.debug('Provider warnings unavailable', extractErrorLogFields(reason));
      },
    );

    // Synthetic chunk fields; id is unique per stream instance.
    // Label chunks with the display name — model.id is the wire id.
    const chunkMeta: ChunkMeta = {
      id: `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      created: Math.floor(Date.now() / 1000),
      model: providerConfig.name,
    };

    try {
      const result = yield* mapStreamToChunks({ stream: streamResult.stream, chunkMeta });
      result.output.source = `${provider.type}/${provider.name}/${model.name}`;
      return result;
    } catch (error) {
      if (this.signal?.aborted) {
        this.logger.debug('LLM stream aborted', extractErrorLogFields(error));
      } else {
        this.logger.error('Error reading LLM stream', extractErrorLogFields(error));
      }
      throw toStreamError(error);
    }
  }

  async createNonStream(body: LLMCreateParams): Promise<RawAssistantMessageWithUsage> {
    // Drain the streaming generator — reuses the same accumulation and error handling path.
    const llmStream = this.create({ ...body, stream: true });
    let result = await llmStream.next();
    while (!result.done) {
      result = await llmStream.next();
    }
    return result.value;
  }
}
