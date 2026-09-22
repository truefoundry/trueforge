import type { ThreadMessage } from '@assistant-ui/core';

export function lastUserMessageText(messages: readonly ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user') {
      continue;
    }
    const text = message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }
  throw new Error('No user message with text content found.');
}
