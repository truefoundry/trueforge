import { describe, expect, it } from 'vitest';
import type { ModelMessageEvent } from '../src/server/index.js';

import { INCOMPLETE_RESPONSE_DATA_NAME } from '../src/incompleteResponse.js';
import { buildAssistantContent } from '../src/modelMessageContent.js';

function modelMessage(event: Omit<ModelMessageEvent, 'type' | 'createdAt'>): ModelMessageEvent {
  return {
    type: 'model.message',
    createdAt: new Date().toISOString(),
    ...event,
  };
}

describe('buildAssistantContent tool results', () => {
  it('coerces empty tool.response content to a truthy result', () => {
    const parts = buildAssistantContent(
      modelMessage({
        id: 'm1',
        threadId: 'main',
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
          },
        ],
      }),
      { toolResults: new Map([['spawn-1', '']]) },
    );

    const spawn = parts.find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') {
      return;
    }
    // assistant-ui uses `!part.result` to decide if a tool-call is still open.
    expect(spawn.result).toBeTruthy();
  });

  it('keeps non-empty tool.response content unchanged', () => {
    const parts = buildAssistantContent(
      modelMessage({
        id: 'm1',
        threadId: 'main',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'web_search', arguments: '{}' },
          },
        ],
      }),
      { toolResults: new Map([['call-1', 'found it']]) },
    );

    const tool = parts.find(part => part.type === 'tool-call');
    expect(tool?.type).toBe('tool-call');
    if (tool?.type !== 'tool-call') {
      return;
    }
    expect(tool.result).toBe('found it');
  });
});

describe('buildAssistantContent incomplete responses', () => {
  it('trails the content with a notice when the provider cut the response short', () => {
    const parts = buildAssistantContent(
      modelMessage({ id: 'm1', threadId: 'main', content: 'partial answer', finishReason: 'incomplete' }),
    );

    expect(parts).toEqual([
      { type: 'text', text: 'partial answer' },
      { type: 'data', name: INCOMPLETE_RESPONSE_DATA_NAME, data: {} },
    ]);
  });

  it('adds no notice when the provider reported a finish reason', () => {
    const parts = buildAssistantContent(
      modelMessage({ id: 'm1', threadId: 'main', content: 'full answer', finishReason: 'stop' }),
    );

    expect(parts).toEqual([{ type: 'text', text: 'full answer' }]);
  });
});
