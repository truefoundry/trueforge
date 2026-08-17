/**
 * Conversion of OpenAI-format messages → Vercel AI SDK ModelMessage[]:
 * user content parts, assistant messages (text + tool_calls + reasoning replay),
 * message list assembly, and tool definitions.
 */
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat';
import {
  convertMessages,
  convertTools,
  parseMimeFromDataUri,
  shouldAttachReasoningSignature,
  toAssistantModelMessage,
  toFilePart,
  toUserContent,
} from '../../../src/core/llm/VercelAILLM';

// ─────────── parseMimeFromDataUri ───────────

describe('parseMimeFromDataUri', () => {
  it('returns the MIME type from a data URI', () => {
    expect(parseMimeFromDataUri('data:image/png;base64,abc')).toBe('image/png');
    expect(parseMimeFromDataUri('data:application/pdf;base64,xyz')).toBe('application/pdf');
  });

  it('returns undefined for a non-data URI', () => {
    expect(parseMimeFromDataUri('https://example.com/img.png')).toBeUndefined();
    expect(parseMimeFromDataUri('')).toBeUndefined();
  });

  it('returns undefined when there is no MIME segment', () => {
    expect(parseMimeFromDataUri('data:;base64,abc')).toBeUndefined();
  });
});

// ─────────── toFilePart ───────────

describe('toFilePart', () => {
  it('returns undefined when file_data is absent', () => {
    expect(toFilePart({})).toBeUndefined();
    expect(toFilePart({ filename: 'doc.pdf' })).toBeUndefined();
  });

  it('parses mediaType from a data URI', () => {
    const part = toFilePart({ file_data: 'data:application/pdf;base64,abc', filename: 'doc.pdf' });
    expect(part).toEqual({
      type: 'file',
      data: 'data:application/pdf;base64,abc',
      mediaType: 'application/pdf',
      filename: 'doc.pdf',
    });
  });

  it('falls back to application/octet-stream when no MIME in data URI', () => {
    const part = toFilePart({ file_data: 'data:;base64,abc' });
    expect(part?.mediaType).toBe('application/octet-stream');
  });

  it('omits filename when not provided', () => {
    const part = toFilePart({ file_data: 'data:image/jpeg;base64,abc' });
    expect(part).not.toHaveProperty('filename');
  });
});

// ─────────── toUserContent ───────────

describe('toUserContent', () => {
  it('passes a string through unchanged', () => {
    expect(toUserContent('hello')).toBe('hello');
  });

  it('converts text parts', () => {
    const result = toUserContent([{ type: 'text', text: 'hi' }]);
    expect(result).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('converts image_url with a data URI (parses mediaType)', () => {
    const result = toUserContent([{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }]);
    expect(result).toEqual([{ type: 'file', data: 'data:image/png;base64,abc', mediaType: 'image/png' }]);
  });

  it('falls back to image/* for non-data image URLs', () => {
    const result = toUserContent([{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }]);
    expect(result).toEqual([{ type: 'file', data: 'https://example.com/img.png', mediaType: 'image/*' }]);
  });

  it('converts file parts with file_data', () => {
    const result = toUserContent([
      { type: 'file', file: { file_data: 'data:application/pdf;base64,xyz', filename: 'a.pdf' } },
    ]);
    expect(result).toEqual([
      { type: 'file', data: 'data:application/pdf;base64,xyz', mediaType: 'application/pdf', filename: 'a.pdf' },
    ]);
  });

  it('skips file parts with only file_id (no file_data)', () => {
    const result = toUserContent([{ type: 'file', file: { file_id: 'file-123' } }]);
    expect(result).toEqual([]);
  });

  it('skips input_audio parts', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture for an unsupported content part type
    const result = toUserContent([{ type: 'input_audio', input_audio: { data: 'abc', format: 'mp3' } } as any]);
    expect(result).toEqual([]);
  });

  it('handles mixed content parts in order', () => {
    const result = toUserContent([
      { type: 'text', text: 'caption' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ]);
    expect(result).toHaveLength(2);
    expect((result as Array<{ type: string }>)[0]?.type).toBe('text');
    expect((result as Array<{ type: string }>)[1]?.type).toBe('file');
  });
});

// ─────────── toAssistantModelMessage ───────────

describe('toAssistantModelMessage', () => {
  it('produces a text part for string content', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: 'hello',
    };
    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('joins array text content parts into one text part', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    };
    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    expect(result.content).toEqual([{ type: 'text', text: 'ab' }]);
  });

  it('falls back to empty text part when content is null/empty', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    expect(result.content).toEqual([{ type: 'text', text: '' }]);
  });

  it('converts tool_calls with parsed JSON arguments', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'my_tool', arguments: '{"x":1}' } }],
    };
    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    const toolCallPart = (result.content as Array<{ type: string }>).find(p => p.type === 'tool-call');
    expect(toolCallPart).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'my_tool',
      input: { x: 1 },
    });
  });

  it('falls back to empty input object for malformed tool_call arguments', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'bad', arguments: 'not-json' } }],
    };
    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    const toolCallPart = (result.content as Array<{ type: string; input?: unknown }>).find(p => p.type === 'tool-call');
    expect(toolCallPart?.input).toEqual({});
  });

  it('places thinking_blocks as reasoning parts — openai provider → reasoningEncryptedContent', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step one', signature: 'sig-openai' }]);
    Reflect.set(msg, 'source', 'openai/openai/test');

    const result = toAssistantModelMessage({ msg: msg, provider: 'openai', providerName: 'openai' });
    const reasoningPart = (result.content as Array<{ type: string; text?: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    expect(reasoningPart?.text).toBe('step one');
    // Key name is the one @ai-sdk/openai reads; anything else and it silently drops the part.
    expect(reasoningPart?.providerOptions).toEqual({ openai: { reasoningEncryptedContent: 'sig-openai' } });
  });

  it('places thinking_blocks as reasoning parts — anthropic provider → signature', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step two', signature: 'sig-ant' }]);
    Reflect.set(msg, 'source', 'anthropic/anthropic/test');

    const result = toAssistantModelMessage({ msg: msg, provider: 'anthropic', providerName: 'anthropic' });
    const reasoningPart = (result.content as Array<{ type: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    expect(reasoningPart?.providerOptions).toEqual({ anthropic: { signature: 'sig-ant' } });
  });

  it('places thinking_blocks as reasoning parts — custom provider carries no replay token', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step', signature: 'sig-gen' }]);

    const result = toAssistantModelMessage({ msg: msg, provider: 'custom', providerName: 'custom' });
    const reasoningPart = (result.content as Array<{ type: string; text?: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    // OpenAI-compatible replays reasoning as `reasoning_content` text and ignores providerOptions.
    expect(reasoningPart?.text).toBe('step');
    expect(reasoningPart?.providerOptions).toBeUndefined();
  });

  it('omits providerOptions on reasoning part when provider is google-gemini', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step', signature: 'sig' }]);

    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    const reasoningPart = (result.content as Array<{ type: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart).not.toHaveProperty('providerOptions');
  });

  it('places provider_specific_fields.thought_signature → providerOptions.google.thoughtSignature on tool-call', () => {
    const toolCall = { id: 'call-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } };
    Reflect.set(toolCall, 'provider_specific_fields', { thought_signature: 'gemini-sig' });
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      tool_calls: [toolCall],
    };

    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    const toolCallPart = (result.content as Array<{ type: string; providerOptions?: unknown }>).find(
      p => p.type === 'tool-call',
    );
    expect(toolCallPart?.providerOptions).toEqual({ google: { thoughtSignature: 'gemini-sig' } });
  });

  it('omits providerOptions on tool-call when no thought_signature', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
    };

    const result = toAssistantModelMessage({ msg: msg, provider: 'google-gemini', providerName: 'google-gemini' });
    const toolCallPart = (result.content as Array<{ type: string }>).find(p => p.type === 'tool-call');
    expect(toolCallPart).not.toHaveProperty('providerOptions');
  });

  it('attaches signature when source type and provider name match, ignoring model_name', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step', signature: 'sig' }]);
    Reflect.set(msg, 'source', 'openai/openai/old-model');

    const result = toAssistantModelMessage({ msg: msg, provider: 'openai', providerName: 'openai' });
    const reasoningPart = (result.content as Array<{ type: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    expect(reasoningPart?.providerOptions).toEqual({ openai: { reasoningEncryptedContent: 'sig' } });
  });

  it('omits signature providerOptions when source provider type differs', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step', signature: 'ant-sig' }]);
    Reflect.set(msg, 'source', 'anthropic/anthropic/opus');

    const result = toAssistantModelMessage({ msg: msg, provider: 'openai', providerName: 'openai' });
    const reasoningPart = (result.content as Array<{ type: string; text?: string; providerOptions?: unknown }>).find(
      p => p.type === 'reasoning',
    );
    expect(reasoningPart?.text).toBe('step');
    expect(reasoningPart).not.toHaveProperty('providerOptions');
  });

  it('requires matching provider name for any provider type', () => {
    expect(
      shouldAttachReasoningSignature({
        source: 'custom/gateway-a/model',
        provider: 'custom',
        providerName: 'gateway-a',
      }),
    ).toBe(true);
    expect(
      shouldAttachReasoningSignature({
        source: 'custom/gateway-a/model',
        provider: 'custom',
        providerName: 'gateway-b',
      }),
    ).toBe(false);
    expect(
      shouldAttachReasoningSignature({
        source: 'openai/other-name/model',
        provider: 'openai',
        providerName: 'openai',
      }),
    ).toBe(false);
  });

  it('does not attach when provider type differs even if provider_name matches', () => {
    expect(
      shouldAttachReasoningSignature({
        source: 'openai/shared/model',
        provider: 'anthropic',
        providerName: 'shared',
      }),
    ).toBe(false);
  });

  it('omits signature providerOptions when source is missing', () => {
    const msg: Extract<ChatCompletionMessageParam, { role: 'assistant' }> = {
      role: 'assistant',
      content: null,
    };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'step', signature: 'sig' }]);

    const result = toAssistantModelMessage({ msg: msg, provider: 'openai', providerName: 'openai' });
    const reasoningPart = (result.content as Array<{ type: string; text?: string }>).find(p => p.type === 'reasoning');
    expect(reasoningPart?.text).toBe('step');
    expect(reasoningPart).not.toHaveProperty('providerOptions');
  });
});

// ─────────── convertMessages ───────────

describe('convertMessages', () => {
  it('extracts system messages as instructions (joined with double newlines)', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'Prompt A' },
      { role: 'system', content: 'Prompt B' },
      { role: 'user', content: 'hi' },
    ];
    const { instructions, messages: result } = convertMessages({
      messages: messages,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    expect(instructions).toBe('Prompt A\n\nPrompt B');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: 'user' });
  });

  it('returns undefined instructions when there are no system messages', () => {
    const { instructions } = convertMessages({
      messages: [{ role: 'user', content: 'hi' }],
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    expect(instructions).toBeUndefined();
  });

  it('preserves user/assistant/tool message ordering', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'q1' },
      {
        role: 'assistant',
        content: 'a1',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'result' },
    ];
    const { messages: result } = convertMessages({
      messages: messages,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    expect(result).toHaveLength(3);
    expect(result[0]?.role).toBe('user');
    expect(result[1]?.role).toBe('assistant');
    expect(result[2]?.role).toBe('tool');
  });

  it('looks up toolName for tool result messages from assistant tool_calls', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'found it' },
    ];
    const { messages: result } = convertMessages({
      messages: messages,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    const toolMsg = result.find(m => m.role === 'tool');
    expect(toolMsg?.content).toEqual([expect.objectContaining({ toolName: 'search' })]);
  });

  it('falls back to empty string toolName for unresolvable tool_call_id', () => {
    const messages: ChatCompletionMessageParam[] = [{ role: 'tool', tool_call_id: 'unknown-id', content: 'data' }];
    const { messages: result } = convertMessages({
      messages: messages,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    expect(result[0]?.content).toEqual([expect.objectContaining({ toolName: '' })]);
  });

  it('skips developer and function role messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'x' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating unrecognised roles at runtime
      { role: 'developer', content: 'internal' } as any,
    ];
    const { messages: result } = convertMessages({
      messages: messages,
      provider: 'google-gemini',
      providerName: 'google-gemini',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
  });

  it('threads the provider into assistant message reasoning parts', () => {
    const msg: ChatCompletionMessageParam = { role: 'assistant', content: null };
    Reflect.set(msg, 'thinking_blocks', [{ type: 'thinking', thinking: 'thought', signature: 'sig' }]);
    Reflect.set(msg, 'source', 'anthropic/anthropic/test');

    const { messages: result } = convertMessages({ messages: [msg], provider: 'anthropic', providerName: 'anthropic' });
    const assistantMsg = result.find(m => m.role === 'assistant');
    const reasoningPart = (
      assistantMsg?.content as Array<{ type: string; providerOptions?: unknown }> | undefined
    )?.find(p => p.type === 'reasoning');
    expect(reasoningPart?.providerOptions).toEqual({ anthropic: { signature: 'sig' } });
  });
});

// ─────────── convertTools ───────────

describe('convertTools', () => {
  it('returns undefined for undefined input', () => {
    expect(convertTools(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(convertTools([])).toBeUndefined();
  });

  it('converts a valid tool definition', () => {
    const tools: ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
    ];
    const toolSet = convertTools(tools);
    expect(toolSet).toBeDefined();
    expect(toolSet?.['search']).toBeDefined();
    expect(toolSet?.['search']?.description).toBe('Search the web');
    expect(toolSet?.['search']?.inputSchema).toBeDefined();
  });

  it('falls back to empty object schema when parameters is absent', () => {
    const tools: ChatCompletionTool[] = [{ type: 'function', function: { name: 'noop' } }];
    const toolSet = convertTools(tools);
    expect(toolSet?.['noop']?.inputSchema).toBeDefined();
  });

  it('omits description when not provided', () => {
    const tools: ChatCompletionTool[] = [{ type: 'function', function: { name: 'silent' } }];
    const toolSet = convertTools(tools);
    expect(toolSet?.['silent']).not.toHaveProperty('description');
  });
});
