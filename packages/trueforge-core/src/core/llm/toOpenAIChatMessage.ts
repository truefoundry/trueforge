import type { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/chat';
import type { LLMContextMessage } from '../runtime/AgentThread.types';
import type { LLMUserMessage } from './LLMTypes';

/**
 * Maps harness context messages to the OpenAI chat message param shape.
 * For assistants: spreads the message (preserving thinking_blocks, reasoning_content,
 * and tool-call provider_specific_fields), strips only `tool_info`, and omits empty
 * `tool_calls` (OpenAI rejects `tool_calls: []`).
 * User content is rebuilt field-by-field for exactOptionalPropertyTypes.
 */
export function toOpenAIChatMessage(msg: LLMContextMessage): ChatCompletionMessageParam {
  if (msg.role === 'user') {
    return { role: 'user', content: toOpenAIUserContent(msg.content) };
  }

  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.tool_call_id,
      content: msg.content,
    };
  }

  // assistant — match gateway AgentThread inline mapping: spread msg, strip tool_info only.
  if (!msg.tool_calls?.length) {
    const { tool_calls: _omit, ...rest } = msg;
    void _omit;
    // Assert: OpenAI SDK message type omits gateway thinking-block / provider extensions
    // (thinking_blocks, reasoning_content, …); we intentionally forward them for replay.
    return rest as ChatCompletionMessageParam;
  }

  // Assert: same as above, plus tool-call provider_specific_fields (e.g. Gemini thought_signature).
  return {
    ...msg,
    tool_calls: msg.tool_calls.map(({ tool_info: _toolInfo, ...rest }) => {
      void _toolInfo;
      return rest;
    }),
  } as ChatCompletionMessageParam;
}

function toOpenAIUserContent(content: LLMUserMessage['content']): string | ChatCompletionContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  const parts: ChatCompletionContentPart[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image_url') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          ...(part.image_url.detail !== undefined ? { detail: part.image_url.detail } : {}),
        },
      });
      continue;
    }
    if (part.type === 'input_audio') {
      parts.push({
        type: 'input_audio',
        input_audio: {
          data: part.input_audio.data,
          format: part.input_audio.format,
        },
      });
      continue;
    }
    parts.push({
      type: 'file',
      file: {
        ...(part.file.file_data !== undefined ? { file_data: part.file.file_data } : {}),
        ...(part.file.file_id !== undefined ? { file_id: part.file.file_id } : {}),
        ...(part.file.filename !== undefined ? { filename: part.file.filename } : {}),
      },
    });
  }
  return parts;
}
