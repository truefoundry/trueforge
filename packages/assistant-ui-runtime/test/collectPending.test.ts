import type { ThreadMessage } from '@assistant-ui/core';
import { describe, expect, it } from 'vitest';

import { deriveSandboxId } from '../src/collectPending.js';

function assistantMessage(id: string, custom: Record<string, unknown> = {}): ThreadMessage {
  return {
    id,
    role: 'assistant' as const,
    content: [],
    status: { type: 'complete' as const, reason: 'stop' as const },
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom,
    },
  };
}

function userMessage(id: string): ThreadMessage {
  return {
    id,
    role: 'user' as const,
    content: [{ type: 'text', text: 'hi' }],
    attachments: [],
    createdAt: new Date(),
    metadata: { custom: {} },
  };
}

describe('deriveSandboxId', () => {
  it('returns undefined when no message ever carried a sandboxId', () => {
    const messages = [userMessage('u1'), assistantMessage('a1')];
    expect(deriveSandboxId(messages)).toBeUndefined();
  });

  it('returns the sandboxId from the most recent message that has one', () => {
    const messages = [
      userMessage('u1'),
      assistantMessage('a1', { sandboxId: 'sbx-1' }),
      userMessage('u2'),
      assistantMessage('a2'),
    ];
    expect(deriveSandboxId(messages)).toBe('sbx-1');
  });

  it('prefers a later sandboxId over an earlier one', () => {
    const messages = [assistantMessage('a1', { sandboxId: 'sbx-1' }), assistantMessage('a2', { sandboxId: 'sbx-2' })];
    expect(deriveSandboxId(messages)).toBe('sbx-2');
  });

  it('keeps returning the sandboxId from earlier turns even when later assistant messages lack it', () => {
    const messages = [assistantMessage('a1', { sandboxId: 'sbx-1' }), assistantMessage('a2'), assistantMessage('a3')];
    expect(deriveSandboxId(messages)).toBe('sbx-1');
  });
});
