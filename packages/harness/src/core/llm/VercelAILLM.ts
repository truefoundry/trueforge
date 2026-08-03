import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  AssistantContent,
  FilePart,
  LanguageModel,
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

/**
 * Provider-specific options map. Structurally identical to ProviderOptions from
 * @ai-sdk/provider-utils, which is not re-exported by the `ai` package.
 */
type ProviderOptions = ProviderMetadata;

/**
 * Local mirrors of the OpenAI SDK's cross-module namespace types. ESLint's
 * TypeScript resolver cannot follow `Namespace.Member` references across module
 * boundaries, so these locally-declared interfaces with `in`-based type guards
 * give ESLint resolvable types without any assertion escapes.
 */
interface ToolCallFn {
  name: string;
  arguments: string;
}
interface ToolDefinitionFn {
  name: string;
  description?: string | undefined;
  parameters?: Record<string, unknown> | undefined;
}

/** Returns true for any non-null, non-array object — narrows to an indexable record. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isToolCallFn(v: unknown): v is ToolCallFn {
  return (
    typeof v === 'object' &&
    v !== null &&
    'name' in v &&
    'arguments' in v &&
    typeof v.name === 'string' &&
    typeof v.arguments === 'string'
  );
}

function isToolDefinitionFn(v: unknown): v is ToolDefinitionFn {
  return (
    typeof v === 'object' &&
    v !== null &&
    'name' in v &&
    typeof v.name === 'string' &&
    (!('description' in v) || typeof v.description === 'string') &&
    (!('parameters' in v) || isPlainObject(v.parameters))
  );
}

/**
 * Reasoning content part for multi-turn assistant message history.
 * Structurally matches ReasoningPart from @ai-sdk/provider-utils.
 */
interface ReasoningPart {
  type: 'reasoning';
  text: string;
  providerOptions?: ProviderOptions;
}

/** Structural config accepted by VercelAILLM; compatible with server's ProviderConfig. */
export interface VercelAIProviderConfig {
  provider: string;
  /** Display name / alias. Also used as the provider model identifier when `model_id` is absent. */
  name: string;
  /**
   * Provider-facing model identifier (e.g. `anthropic/claude-sonnet-4-6` for a
   * gateway). When present, this is sent to the provider instead of `name`.
   */
  model_id?: string | undefined;
  /** Optional base URL override. Explicitly includes `undefined` for Zod-derived type compat. */
  base_url?: string | undefined;
  apiKey: string;
  headers: Record<string, string>;
  /**
   * API format for the `generic` provider. Only `openai-chat-completions` is
   * supported today. Defaults to `openai-chat-completions` when absent.
   */
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
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    default: {
      throw new Error(
        `Unknown provider "${provider}" — supported providers are: openai, anthropic, google-gemini, generic`,
      );
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

export function mapFinishReason(reason: string): RawAssistantMessageWithUsage['finish_reason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/** Builds provider-specific options for reasoning/thinking budget. */
export function buildProviderOptions(
  config: VercelAIProviderConfig,
  reasoningEffort: string | undefined,
): ProviderOptions {
  const options: ProviderOptions = {};
  if (config.provider === 'openai') {
    // Always disable server-side storage and request the encrypted reasoning
    // token so multi-turn conversations can replay reasoning statelessly.
    // `include` is a harmless no-op for non-reasoning models.
    options['openai'] = {
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
  } else if (config.provider === 'anthropic' && reasoningEffort !== undefined) {
    const budgetByEffort: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
    const budgetTokens = budgetByEffort[reasoningEffort] ?? 8192;
    options['anthropic'] = { thinking: { type: 'enabled', budgetTokens } };
  } else if (config.provider === 'generic' && reasoningEffort !== undefined) {
    // @ai-sdk/openai-compatible registers under the name 'generic'; reasoningEffort
    // maps to reasoning_effort in the request body for OpenAI-compatible endpoints.
    options['generic'] = { reasoningEffort };
  }
  return options;
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
 * `replayKey` controls where the opaque provider token for standalone reasoning blocks is placed:
 * - `'openai'`     → `providerOptions.openai.encryptedContent` (Responses API)
 * - `'anthropic'`  → `providerOptions.anthropic.signature`
 * - `undefined`    → no provider token (provider doesn't support reasoning replay)
 *
 * Independently of `replayKey`, a tool call's own `provider_specific_fields.thought_signature`
 * (Gemini attaches its thinking signature to the function-call part itself, not a separate
 * reasoning block) is placed at `providerOptions.google.thoughtSignature` on the `ToolCallPart` —
 * the convention `@ai-sdk/google` reads back out when replaying a tool call. Harmless no-op for
 * other providers, since this field is never populated for them.
 */
export function toAssistantModelMessage(
  msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }>,
  replayKey: 'openai' | 'anthropic' | 'generic' | undefined,
): ModelMessage {
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
        if (signature !== undefined && replayKey !== undefined) {
          if (replayKey === 'openai' || replayKey === 'generic') {
            reasoningProviderOptions = { [replayKey]: { encryptedContent: signature } };
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
      const rawFn: unknown = tc.function;
      if (!isToolCallFn(rawFn)) continue;
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(rawFn.arguments);
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
        toolName: rawFn.name,
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
 * `replayKey` is threaded into assistant message conversion so that reasoning
 * replay tokens are placed under the correct providerOptions key.
 */
export interface ConvertedMessages {
  instructions: string | undefined;
  messages: ModelMessage[];
}

/**
 * Splits an OpenAI message list into Vercel AI SDK format.
 * System messages are extracted into `instructions` because the Vercel AI SDK v7
 * no longer accepts `{ role: 'system' }` entries in the messages array.
 * Multiple system messages are joined with a blank line.
 */
export function convertMessages(
  messages: ChatCompletionMessageParam[],
  replayKey: 'openai' | 'anthropic' | 'generic' | undefined,
): ConvertedMessages {
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const rawFn: unknown = tc.function;
        if (isToolCallFn(rawFn)) {
          toolNameById.set(tc.id, rawFn.name);
        }
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
      result.push(toAssistantModelMessage(msg, replayKey));
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
    const rawFn: unknown = t.function;
    if (!isToolDefinitionFn(rawFn)) continue;
    toolSet[rawFn.name] = {
      inputSchema: jsonSchema(rawFn.parameters ?? { type: 'object', properties: {} }),
      ...(rawFn.description !== undefined ? { description: rawFn.description } : {}),
    };
  }
  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}

/**
 * Normalized description of the requested structured-response mode, derived from an
 * OpenAI-format `response_format`. Kept as plain data (rather than a Vercel AI SDK `Output`
 * instance) because `Output` is not a nameable exported type from `ai` — see `buildOutput`.
 */
export type StructuredOutputSpec =
  | { mode: 'text' }
  | { mode: 'json' }
  | { mode: 'json_schema'; schema: Record<string, unknown>; name: string; description: string | undefined };

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
  };
}

/**
 * Builds the Vercel AI SDK `Output` spec for `streamText` from a `StructuredOutputSpec`.
 * Not exported: `Output`'s interface type isn't nameable outside `ai` (only its `.object`/`.json`/
 * `.text` factory functions are exported), so an exported function can't declare it as a return
 * type. The pure mapping logic lives in `toStructuredOutputSpec` above, which is directly testable.
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
  }
}

interface ToolCallState {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** Synthetic chunk fields shared by every chunk emitted for a single stream. */
interface ChunkMeta {
  id: string;
  created: number;
  model: string;
}

/**
 * Converts a Vercel AI SDK stream of `TextStreamPart`s into harness-format
 * `ExtendedChatCompletionChunk`s, returning the final aggregated assistant
 * message once the stream completes.
 *
 * Pure data transformation — takes a plain `AsyncIterable`, so it accepts
 * either a real `streamText().stream` or hand-built fixtures in tests.
 */
export async function* mapStreamToChunks(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
  chunkMeta: ChunkMeta,
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
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
          for (const meta of Object.values(part.providerMetadata)) {
            if ('reasoningEncryptedContent' in meta && typeof meta['reasoningEncryptedContent'] === 'string') {
              currentThinkingBlock.signature = meta['reasoningEncryptedContent'];
              break;
            }
          }
        }
        currentThinkingBlock = null;
        break;
      }

      case 'tool-input-start': {
        const idx = nextToolIndex++;
        toolCallStates.set(part.id, {
          index: idx,
          id: part.id,
          name: part.toolName,
          arguments: '',
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

      // 'start', 'text-start', 'text-end', 'reasoning-file', 'tool-input-end',
      // 'tool-call', 'tool-result', 'finish', 'source', 'custom', 'raw', etc.
      // are structural bookkeeping events — no harness chunk is emitted for these.
    }
  }

  const toolCalls = [...toolCallStates.values()]
    .sort((a, b) => a.index - b.index)
    .map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
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

    // Which providerOptions key to use when replaying reasoning tokens in multi-turn history.
    // 'generic' uses the same encryptedContent convention as 'openai' because
    // @ai-sdk/openai-compatible is registered under the name 'generic'.
    const replayKey: 'openai' | 'anthropic' | 'generic' | undefined =
      providerConfig.provider === 'openai'
        ? 'openai'
        : providerConfig.provider === 'anthropic'
          ? 'anthropic'
          : providerConfig.provider === 'generic'
            ? 'generic'
            : undefined;

    const { instructions, messages } = convertMessages(body.messages, replayKey);
    const tools = convertTools(body.tools ?? undefined);
    const output = buildOutput(toStructuredOutputSpec(body.response_format));

    // reasoning_effort is injected by AgentThread via Object.assign; not in the SDK type.
    const rawReasoningEffort: unknown = Reflect.get(body, 'reasoning_effort');
    const reasoningEffort = typeof rawReasoningEffort === 'string' ? rawReasoningEffort : undefined;
    const providerOptions = buildProviderOptions(providerConfig, reasoningEffort);

    let streamResult;
    try {
      streamResult = streamText({
        model,
        ...(instructions !== undefined ? { instructions } : {}),
        messages,
        ...(tools !== undefined ? { tools } : {}),
        ...(output !== undefined ? { output } : {}),
        // Prefer max_completion_tokens; fall back to max_tokens (deprecated on the OpenAI type,
        // read via Reflect.get so the lint rule doesn't fire on the call site).
        ...((): { maxOutputTokens: number } | Record<never, never> => {
          const limit: unknown = body.max_completion_tokens ?? Reflect.get(body, 'max_tokens');
          return typeof limit === 'number' ? { maxOutputTokens: limit } : {};
        })(),
        ...(body.temperature != null ? { temperature: body.temperature } : {}),
        ...(body.top_p != null ? { topP: body.top_p } : {}),
        ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
        ...(this.signal !== undefined ? { abortSignal: this.signal } : {}),
        maxRetries: 0,
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
      return yield* mapStreamToChunks(streamResult.stream, chunkMeta);
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
