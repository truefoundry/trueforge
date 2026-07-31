import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  AssistantContent,
  LanguageModel,
  ModelMessage,
  ProviderMetadata,
  TextPart,
  ToolCallPart,
  ToolContent,
  ToolSet,
  UserContent,
} from 'ai';
import { jsonSchema, streamText } from 'ai';
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
  name: string;
  /** Optional base URL override. Explicitly includes `undefined` for Zod-derived type compat. */
  base_url?: string | undefined;
  apiKey: string;
  headers: Record<string, string>;
  /**
   * Which OpenAI API surface to use. Only applies when `provider === 'openai'`.
   * Defaults to 'responses' (supports reasoning models and stateless multi-turn
   * via encrypted content). Use 'chat' for deployments or models that don't
   * support the Responses API.
   */
  openai_api?: 'responses' | 'chat' | undefined;
}

export interface VercelAILLMConfig {
  providerConfig: VercelAIProviderConfig;
  logger: Logger;
  signal?: AbortSignal;
}

/** Well-known base URLs for gateway providers that have a canonical endpoint. */
const GATEWAY_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  portkey: 'https://api.portkey.ai/v1',
  kimi: 'https://api.moonshot.cn/v1',
};

/**
 * Returns whether the effective OpenAI API surface is the Responses API.
 *
 * - `openai` provider defaults to `responses`; opt out with `openai_api: chat`.
 * - All other providers default to `chat`; opt in with `openai_api: responses`.
 */
function isResponsesApi(config: VercelAIProviderConfig): boolean {
  if (config.provider === 'openai') {
    return config.openai_api !== 'chat';
  }
  return config.openai_api === 'responses';
}

function buildLanguageModel(config: VercelAIProviderConfig): LanguageModel {
  const { provider, name: modelId, base_url, apiKey, headers } = config;
  const extraHeaders = Object.keys(headers).length > 0 ? headers : undefined;

  switch (provider) {
    case 'openai': {
      const client = createOpenAI({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      // Default to Responses API (required for o-series reasoning models).
      // Opt in to Chat Completions API explicitly for models or deployments
      // that don't support the Responses API.
      return isResponsesApi(config) ? client.responses(modelId) : client.chat(modelId);
    }
    case 'anthropic': {
      const client = createAnthropic({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    case 'google': {
      const client = createGoogle({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    case 'mistral': {
      const client = createMistral({
        apiKey,
        ...(base_url !== undefined ? { baseURL: base_url } : {}),
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
    default: {
      // openai-compatible, litellm, truefoundry; plus named gateways with known URLs
      const resolvedBaseUrl = base_url ?? GATEWAY_BASE_URLS[provider];
      if (resolvedBaseUrl === undefined) {
        throw new Error(
          `Provider "${provider}" requires a base_url in models.yaml (no well-known endpoint registered for this provider)`,
        );
      }
      if (isResponsesApi(config)) {
        // Compat provider explicitly opted in to the Responses API: use
        // @ai-sdk/openai with a custom base URL so we get responses() support.
        const client = createOpenAI({
          apiKey,
          baseURL: resolvedBaseUrl,
          ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
        });
        return client.responses(modelId);
      }
      const client = createOpenAICompatible({
        name: provider,
        baseURL: resolvedBaseUrl,
        apiKey,
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      });
      return client(modelId);
    }
  }
}

/** Maps Vercel AI SDK LanguageModelUsage → harness CompletionUsage. */
function normalizeUsage(usage: {
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

function mapFinishReason(reason: string): RawAssistantMessageWithUsage['finish_reason'] {
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
function buildProviderOptions(config: VercelAIProviderConfig, reasoningEffort: string | undefined): ProviderOptions {
  const options: ProviderOptions = {};
  if (isResponsesApi(config)) {
    // Always disable server-side storage and request the encrypted reasoning
    // token so multi-turn conversations can replay reasoning statelessly.
    // `include` is a harmless no-op for non-reasoning models.
    //
    // For compat providers (openai-compatible, litellm, …) with openai_api: responses,
    // buildLanguageModel routes through @ai-sdk/openai with a custom baseURL. That SDK
    // internally calls getOpenAILanguageModelCapabilities(modelId) and matches the model
    // ID against ^gpt-(\d+) and ^o(\d+). Gateway-prefixed IDs like "openai-main/gpt-5.5"
    // fail both patterns, so the SDK would silently drop reasoningEffort and ignore
    // reasoning.encrypted_content. forceReasoning: true bypasses the model-ID check.
    options['openai'] = {
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(config.provider !== 'openai' ? { forceReasoning: true } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
  } else if (config.provider === 'anthropic' && reasoningEffort !== undefined) {
    const budgetByEffort: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
    const budgetTokens = budgetByEffort[reasoningEffort] ?? 8192;
    options['anthropic'] = { thinking: { type: 'enabled', budgetTokens } };
  }
  return options;
}

/** Converts a user content array from OpenAI format to Vercel AI SDK UserContent. */
function toUserContent(content: string | ChatCompletionContentPart[]): UserContent {
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
      parts.push({ type: 'image', image: part.image_url.url });
      continue;
    }
    // input_audio, file — not universally supported across providers; omit.
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
 * `replayKey` controls where the opaque provider token is placed:
 * - `'openai'`     → `providerOptions.openai.encryptedContent` (Responses API)
 * - `'anthropic'`  → `providerOptions.anthropic.signature`
 * - `undefined`    → no provider token (provider doesn't support reasoning replay)
 */
function toAssistantModelMessage(
  msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }>,
  replayKey: 'openai' | 'anthropic' | undefined,
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
          if (replayKey === 'openai') {
            reasoningProviderOptions = { openai: { encryptedContent: signature } };
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
        const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // malformed arguments — leave empty record
      }
      const toolCallPart: ToolCallPart = {
        type: 'tool-call',
        toolCallId: tc.id,
        toolName: tc.function.name,
        input,
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
function convertMessages(
  messages: ChatCompletionMessageParam[],
  replayKey: 'openai' | 'anthropic' | undefined,
): ModelMessage[] {
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolNameById.set(tc.id, tc.function.name);
      }
    }
  }

  const result: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.text).join('');
      result.push({ role: 'system', content });
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
  return result;
}

/** Converts OpenAI tool definitions to the Vercel AI SDK ToolSet. */
function convertTools(tools: ChatCompletionTool[] | undefined): ToolSet | undefined {
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

interface ToolCallState {
  index: number;
  id: string;
  name: string;
  arguments: string;
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
    const replayKey: 'openai' | 'anthropic' | undefined = isResponsesApi(providerConfig)
      ? 'openai'
      : providerConfig.provider === 'anthropic'
        ? 'anthropic'
        : undefined;

    const messages = convertMessages(body.messages, replayKey);
    const tools = convertTools(body.tools ?? undefined);

    // reasoning_effort is injected by AgentThread via Object.assign; not in the SDK type.
    const rawReasoningEffort: unknown = Reflect.get(body, 'reasoning_effort');
    const reasoningEffort = typeof rawReasoningEffort === 'string' ? rawReasoningEffort : undefined;
    const providerOptions = buildProviderOptions(providerConfig, reasoningEffort);

    let streamResult;
    try {
      streamResult = streamText({
        model,
        messages,
        ...(tools !== undefined ? { tools } : {}),
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
    const chunkId = `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const chunkCreated = Math.floor(Date.now() / 1000);
    const chunkModel = body.model;

    const makeBase = (): Omit<ExtendedChatCompletionChunk, 'choices' | 'usage'> => ({
      id: chunkId,
      object: 'chat.completion.chunk' as const,
      created: chunkCreated,
      model: chunkModel,
    });

    // Per-stream accumulation
    const toolCallStates = new Map<string, ToolCallState>();
    let nextToolIndex = 0;
    let accumulatedText = '';
    const accumulatedThinking: ThinkingBlock[] = [];
    let currentThinkingBlock: ThinkingBlock | null = null;
    let finalUsage: CompletionUsage = getEmptyUsage();
    let finalFinishReason: RawAssistantMessageWithUsage['finish_reason'] = 'stop';

    try {
      for await (const part of streamResult.stream) {
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
            if (currentThinkingBlock !== null) {
              const oaiMeta: unknown = part.providerMetadata?.['openai'];
              if (
                typeof oaiMeta === 'object' &&
                oaiMeta !== null &&
                'reasoningEncryptedContent' in oaiMeta &&
                typeof (oaiMeta as Record<string, unknown>)['reasoningEncryptedContent'] === 'string'
              ) {
                currentThinkingBlock.signature = (oaiMeta as Record<string, string>)['reasoningEncryptedContent'];
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
    } catch (error) {
      if (this.signal?.aborted) {
        this.logger.debug('LLM stream aborted', extractErrorLogFields(error));
      } else {
        this.logger.error('Error reading LLM stream', extractErrorLogFields(error));
      }
      throw error;
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
