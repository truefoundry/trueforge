import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  AssistantContent,
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
import { jsonSchema, Output, streamText } from 'ai';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../util/errorLogFields';
import type { ILLM } from './ILLM';
import {
  type CompletionUsage,
  type ExtendedChatCompletionChunk,
  getEmptyUsage,
  type RawAssistantMessage,
  type RawAssistantMessageWithUsage,
  type ThinkingBlock,
} from './LLMTypes';

/** Structurally identical to ProviderOptions from @ai-sdk/provider-utils, not re-exported by `ai`. */
type ProviderOptions = ProviderMetadata;

/** Returns true for any non-null, non-array object — narrows to an indexable record. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structurally matches ReasoningPart from @ai-sdk/provider-utils. */
interface ReasoningPart {
  type: 'reasoning';
  text: string;
  providerOptions?: ProviderOptions;
}

/** Providers with a dedicated code path in {@link buildLanguageModel}. */
export type VercelAIProviderName = 'openai' | 'anthropic' | 'google-gemini' | 'generic';

/** Structural config accepted by VercelAILLM; compatible with server's ProviderConfig. */
export interface VercelAIProviderConfig {
  provider: VercelAIProviderName;
  /** Display name / alias. Also used as the provider model identifier when `model_id` is absent. */
  name: string;
  /** Provider-facing model identifier, sent instead of `name` when present. */
  model_id?: string | undefined;
  /** Optional base URL override. Explicitly includes `undefined` for Zod-derived type compat. */
  base_url?: string | undefined;
  apiKey: string;
  headers: Record<string, string>;
  /** API format for the `generic` provider. Only option today; defaults when absent. */
  api_format?: 'openai-chat-completions' | undefined;
}

export interface VercelAILLMConfig {
  providerConfig: VercelAIProviderConfig;
  logger: Logger;
  signal?: AbortSignal;
}

export function buildLanguageModel(config: VercelAIProviderConfig): LanguageModel {
  const { provider, name, model_id, base_url, apiKey, headers } = config;
  const modelId = model_id ?? name;
  const extraHeaders = Object.keys(headers).length > 0 ? headers : undefined;

  switch (provider) {
    case 'openai': {
      const client = createOpenAI({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client.responses(modelId);
    }
    case 'anthropic': {
      const client = createAnthropic({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    case 'google-gemini': {
      const client = createGoogle({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    case 'generic': {
      if (base_url === undefined) {
        throw new Error('Provider "generic" requires a base_url in models.yaml');
      }
      const client = createOpenAICompatible({
        name: 'generic',
        baseURL: base_url,
        apiKey,
        // Without this, @ai-sdk/openai-compatible silently downgrades json_schema requests
        // to a schema-less json_object, dropping the schema and strictJsonSchema.
        supportsStructuredOutputs: true,
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider "${String(_exhaustive)}"`);
    }
  }
}

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
}): CompletionUsage {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cache_read_tokens: usage.inputTokenDetails.cacheReadTokens ?? undefined,
    cache_write_tokens: usage.inputTokenDetails.cacheWriteTokens ?? undefined,
    reasoning_tokens: usage.outputTokenDetails.reasoningTokens ?? undefined,
  };
}

/**
 * The SDK's standardized cross-provider `streamText({ reasoning })` setting, distinct from the
 * `providerOptions` bucket. Derived from `LanguageModelCallOptions` so it stays in sync with the
 * SDK's own definition rather than being a hand-maintained mirror.
 */
type ReasoningLevel = NonNullable<LanguageModelCallOptions['reasoning']>;

const REASONING_LEVELS: readonly ReasoningLevel[] = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

function isReasoningLevel(v: string): v is ReasoningLevel {
  return (REASONING_LEVELS as readonly string[]).includes(v);
}

/**
 * Maps a harness `reasoning_effort` to the SDK's standardized `reasoning` setting. Only
 * `google-gemini` needs this — `@ai-sdk/google` derives its `thinkingConfig` from it, since it has
 * no `providerOptions.google.reasoningEffort` lever like openai/anthropic/generic do.
 */
export function toReasoningLevel({
  provider,
  reasoningEffort,
}: {
  provider: VercelAIProviderName;
  reasoningEffort: string | undefined;
}): ReasoningLevel | undefined {
  if (provider !== 'google-gemini' || reasoningEffort === undefined || !isReasoningLevel(reasoningEffort)) {
    return undefined;
  }
  return reasoningEffort;
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

/** Opaque alias — each provider bucket is an arbitrary JSON object from the request body. */
type JSONObject = Record<string, JSONValue | undefined>;

/**
 * Reads a single top-level field from rawBody by snake_case key and returns it as-is.
 * rawBody originates from a parsed JSON request body, so any value present is a valid JSONValue.
 */
function readBodyField(rawBody: unknown, key: string): JSONValue | undefined {
  const val: unknown = Reflect.get(Object(rawBody), key);
  return val !== undefined ? (val as JSONValue) : undefined;
}

const ANTHROPIC_BUDGET_BY_EFFORT: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };

function openaiProviderOptions(
  rawBody: unknown,
  reasoningEffort: string | undefined,
  strictJsonSchema: boolean | undefined,
): JSONObject {
  const serviceTier = readBodyField(rawBody, 'service_tier');
  const user = readBodyField(rawBody, 'user');
  const promptCacheKey = readBodyField(rawBody, 'prompt_cache_key');
  const parallelToolCalls = readBodyField(rawBody, 'parallel_tool_calls');
  // Disables server-side storage and requests the encrypted reasoning token so multi-turn
  // conversations can replay reasoning statelessly; harmless no-op for non-reasoning models.
  return {
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(strictJsonSchema !== undefined ? { strictJsonSchema } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(promptCacheKey !== undefined ? { promptCacheKey } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
  };
}

function anthropicProviderOptions(rawBody: unknown, reasoningEffort: string | undefined): JSONObject | undefined {
  const cacheControl = readBodyField(rawBody, 'cache_control');
  const disableParallelToolUse = readBodyField(rawBody, 'disable_parallel_tool_use');
  const opts: JSONObject = {
    ...(reasoningEffort !== undefined
      ? { thinking: { type: 'enabled', budgetTokens: ANTHROPIC_BUDGET_BY_EFFORT[reasoningEffort] ?? 8192 } }
      : {}),
    ...(cacheControl !== undefined ? { cacheControl } : {}),
    ...(disableParallelToolUse !== undefined ? { disableParallelToolUse } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

function googleProviderOptions(rawBody: unknown): JSONObject | undefined {
  const safetySettings = readBodyField(rawBody, 'safety_settings');
  const thinkingConfig = readBodyField(rawBody, 'thinking_config');
  const cachedContent = readBodyField(rawBody, 'cached_content');
  const opts: JSONObject = {
    ...(safetySettings !== undefined ? { safetySettings } : {}),
    ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
    ...(cachedContent !== undefined ? { cachedContent } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

function genericProviderOptions(
  rawBody: unknown,
  reasoningEffort: string | undefined,
  strictJsonSchema: boolean | undefined,
): JSONObject | undefined {
  const parallelToolCalls = readBodyField(rawBody, 'parallel_tool_calls');
  const opts: JSONObject = {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(strictJsonSchema !== undefined ? { strictJsonSchema } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
  };
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Builds provider-specific options for reasoning/thinking budget, structured-output strictness,
 * and any extra fields passed through from the request body via `rawBody`.
 *
 * `rawBody` is the raw request body; provider-specific fields (e.g. `cache_control`,
 * `service_tier`, `safety_settings`) are forwarded by snake_case key with no further validation.
 */
export function buildProviderOptions({
  config,
  reasoningEffort,
  structuredOutputSpec,
  rawBody,
}: {
  config: VercelAIProviderConfig;
  reasoningEffort: string | undefined;
  structuredOutputSpec: StructuredOutputSpec;
  rawBody: unknown;
}): ProviderOptions {
  const strictJsonSchema = structuredOutputSpec.mode === 'json_schema' ? structuredOutputSpec.strict : undefined;
  if (config.provider === 'openai') {
    return { openai: openaiProviderOptions(rawBody, reasoningEffort, strictJsonSchema) };
  } else if (config.provider === 'anthropic') {
    const anthropic = anthropicProviderOptions(rawBody, reasoningEffort);
    return anthropic !== undefined ? { anthropic } : {};
  } else if (config.provider === 'google-gemini') {
    const google = googleProviderOptions(rawBody);
    return google !== undefined ? { google } : {};
  } else {
    // 'generic' — @ai-sdk/openai-compatible registers under the name 'generic'.
    // this will have to become api_format specific in the future.
    const generic = genericProviderOptions(rawBody, reasoningEffort, strictJsonSchema);
    return generic !== undefined ? { generic } : {};
  }
}

/**
 * Prefers `max_completion_tokens`, falling back to the deprecated `max_tokens` (not part of the
 * OpenAI SDK type, read via `Reflect.get` to avoid an unsafe-member-access lint error).
 */
export function resolveMaxOutputTokens(
  body: Pick<ChatCompletionCreateParamsStreaming, 'max_completion_tokens'>,
): number | undefined {
  const limit: unknown = body.max_completion_tokens ?? Reflect.get(body, 'max_tokens');
  return typeof limit === 'number' ? limit : undefined;
}

/**
 * Parses the MIME type from a data URI (`data:<mime>;base64,...`).
 * Returns `undefined` when the URI is not a data URI or has no MIME segment.
 */
export function parseMimeFromDataUri(uri: string): string | undefined {
  const match = /^data:([^;,]+)/.exec(uri);
  return match?.[1];
}

/**
 * Builds a Vercel AI SDK FilePart from an OpenAI-format file content part.
 * Returns `undefined` when the part carries no usable data (e.g. file_id only,
 * which requires a server-side lookup we don't support here).
 */
export function toFilePart(file: {
  file_data?: string | undefined;
  filename?: string | undefined;
}): FilePart | undefined {
  const { file_data, filename } = file;
  if (!file_data) return undefined;
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
      // Map image URLs/data-URIs as FilePart with image/* mediaType.
      // ImagePart ({ type: 'image' }) is deprecated in favour of FilePart.
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
 * Converts an assistant ChatCompletionMessageParam → AssistantModelMessage for multi-turn replay.
 *
 * The harness attaches `thinking_blocks` to assistant messages at runtime (via Object.assign in
 * AgentThread) for reasoning replay. Since `ChatCompletionMessageParam` does not declare this
 * field in its TypeScript type, we read it via Reflect.get so no assertion is needed.
 *
 * `provider` is used to place the opaque reasoning-replay token under the correct providerOptions key:
 * - `'openai'` / `'generic'` → `providerOptions[provider].encryptedContent` (Responses API)
 * - `'anthropic'`            → `providerOptions.anthropic.signature`
 * - `'google-gemini'`        → no standalone reasoning block; replay token is per-tool-call (see below)
 *
 * Independently of `provider`, a tool call's own `provider_specific_fields.thought_signature`
 * (Gemini attaches its thinking signature to the function-call part itself, not a separate
 * reasoning block) is placed at `providerOptions.google.thoughtSignature` on the `ToolCallPart` —
 * the convention `@ai-sdk/google` reads back out when replaying a tool call. Harmless no-op for
 * other providers, since this field is never populated for them.
 */
export function toAssistantModelMessage({
  msg,
  provider,
}: {
  msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }>;
  provider: VercelAIProviderName;
}): ModelMessage {
  const parts: AssistantContent = [];

  const rawThinking: unknown = Reflect.get(msg, 'thinking_blocks');
  if (Array.isArray(rawThinking)) {
    // Widen any[] → unknown[] so TypeScript's in-guards can narrow safely
    // without triggering no-unsafe-member-access on every property access.
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
        if (signature !== undefined && provider !== 'google-gemini') {
          if (provider === 'openai' || provider === 'generic') {
            reasoningProviderOptions = { [provider]: { encryptedContent: signature } };
          } else {
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

/**
 * Converts OpenAI-format messages to Vercel AI SDK ModelMessage[].
 *
 * Builds a toolCallId → toolName lookup from assistant messages first so that
 * tool result messages (which only carry toolCallId) can include the name
 * required by ToolResultPart.
 *
 * `provider` is threaded into assistant message conversion so that reasoning
 * replay tokens are placed under the correct providerOptions key.
 */
export interface ConvertedMessages {
  instructions: string | undefined;
  messages: ModelMessage[];
}

/**
 * Splits an OpenAI message list into Vercel AI SDK format. System messages are extracted into
 * `instructions` since the SDK v7 no longer accepts `{ role: 'system' }` in the messages array.
 * Builds a toolCallId → toolName lookup first, since tool result messages only carry the id.
 */
export function convertMessages({
  messages,
  provider,
}: {
  messages: ChatCompletionMessageParam[];
  provider: VercelAIProviderName;
}): ConvertedMessages {
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
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
      result.push(toAssistantModelMessage({ msg, provider }));
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
    toolSet[t.function.name] = {
      inputSchema: jsonSchema(t.function.parameters ?? { type: 'object', properties: {} }),
      ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    };
  }
  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}

/**
 * Normalized structured-response mode, derived from an OpenAI-format `response_format`. Kept as
 * plain data rather than a Vercel AI SDK `Output` instance, since `Output` isn't a nameable
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

/**
 * Builds the Vercel AI SDK `Output` spec for `streamText`. Not exported: `Output`'s type isn't
 * nameable outside `ai`, so an exported function can't declare it as a return type.
 */
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

/**
 * Pure-data subset of `streamText(...)`'s call args. Composes `LanguageModelCallOptions` for the
 * model settings so new SDK settings are picked up automatically. Uses `?` (omitted keys) rather
 * than this file's usual explicit `| undefined`, since these fields cross directly into
 * `streamText`'s own optional-property call signature under `exactOptionalPropertyTypes`.
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
 * Builds the pure-data subset of `streamText(...)`'s call args from already-computed
 * translations. Exported so the final wiring itself — not just the sub-functions that feed it
 * (`convertMessages`, `convertTools`, `buildProviderOptions`, `toReasoningLevel`,
 * `resolveMaxOutputTokens`) — is directly unit-testable: a value computed correctly but never
 * spread into this object wouldn't be caught by testing those sub-functions alone.
 *
 * `output` (from `buildOutput`) is deliberately excluded and spread separately by the caller:
 * its type isn't nameable outside `ai` (see `buildOutput`), so including it here would make this
 * exported function's return type unnameable too.
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

interface ToolCallState {
  index: number;
  id: string;
  name: string;
  arguments: string;
  /** Gemini `thoughtSignature` from `providerMetadata.google` on the `tool-input-start` part. */
  thoughtSignature: string | undefined;
}

/** Synthetic chunk fields shared by every chunk emitted for a single stream. */
interface ChunkMeta {
  id: string;
  created: number;
  model: string;
}

/**
 * Converts a Vercel AI SDK stream of `TextStreamPart`s into harness-format
 * `ExtendedChatCompletionChunk`s, returning the final aggregated assistant message on completion.
 * Takes a plain `AsyncIterable` so hand-built fixtures work in tests too.
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
  let currentThinkingBlock: ThinkingBlock | null = null;
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
        currentThinkingBlock = { type: 'thinking', thinking: '' };
        accumulatedThinking.push(currentThinkingBlock);
        break;
      }

      case 'reasoning-delta': {
        if (currentThinkingBlock !== null) {
          currentThinkingBlock.thinking += part.text;
        }
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
        if (currentThinkingBlock !== null && part.providerMetadata !== undefined) {
          // Scan all provider namespace values — only the active provider's key will
          // be populated, so this is provider-agnostic without coupling to replayKey.
          // OpenAI Responses API → meta.reasoningEncryptedContent
          // Anthropic              → meta.signature
          for (const meta of Object.values(part.providerMetadata)) {
            if ('reasoningEncryptedContent' in meta && typeof meta['reasoningEncryptedContent'] === 'string') {
              currentThinkingBlock.signature = meta['reasoningEncryptedContent'];
              break;
            }
            if ('signature' in meta && typeof meta['signature'] === 'string') {
              currentThinkingBlock.signature = meta['signature'];
              break;
            }
          }
        }
        currentThinkingBlock = null;
        break;
      }

      case 'tool-input-start': {
        const idx = nextToolIndex++;
        // @ai-sdk/google sets providerMetadata.google.thoughtSignature on tool-input-start for
        // Gemini thinking models. Capture it here so the finalized tool_call can carry
        // provider_specific_fields.thought_signature — the field toAssistantModelMessage reads
        // when replaying tool calls in multi-turn conversations.
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
        if (state !== undefined) {
          state.arguments += part.delta;
        }
        const idx = state?.index ?? 0;
        yield {
          ...makeBase(),
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: idx, function: { arguments: part.delta } }],
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
        const err = raw instanceof Error ? raw : new Error(String(raw));
        throw new Error('LLM stream error', { cause: err });
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
      case 'abort':
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
    body: ChatCompletionCreateParamsStreaming,
  ): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
    const { providerConfig } = this.config;
    const model = buildLanguageModel(providerConfig);

    const { instructions, messages } = convertMessages({ messages: body.messages, provider: providerConfig.provider });
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
    const reasoning = toReasoningLevel({ provider: providerConfig.provider, reasoningEffort });

    // top_k is injected by AgentThread via Object.assign; not in the SDK type.
    const rawTopK: unknown = Reflect.get(body, 'top_k');
    const streamTextArgs = buildStreamTextArgs({
      model,
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
      seed: body.seed,
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
      throw error;
    }

    // Synthetic chunk fields; id is unique per stream instance.
    const chunkMeta: ChunkMeta = {
      id: `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      created: Math.floor(Date.now() / 1000),
      model: body.model,
    };

    try {
      return yield* mapStreamToChunks({ stream: streamResult.stream, chunkMeta });
    } catch (error) {
      if (this.signal?.aborted) {
        this.logger.debug('LLM stream aborted', extractErrorLogFields(error));
      } else {
        this.logger.error('Error reading LLM stream', extractErrorLogFields(error));
      }
      throw error;
    }
  }

  async createNonStream(body: ChatCompletionCreateParams): Promise<RawAssistantMessageWithUsage> {
    // Drain the streaming generator — reuses the same accumulation and error handling path.
    const llmStream = this.create({ ...body, stream: true });
    let result = await llmStream.next();
    while (!result.done) {
      result = await llmStream.next();
    }
    return result.value;
  }
}
