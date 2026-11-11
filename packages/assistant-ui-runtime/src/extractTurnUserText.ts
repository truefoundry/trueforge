import type { Turn } from './server/index.js';
import { EVENT_TYPE } from './server/index.js';

export function extractTurnUserText(input: Turn['input']): string | undefined {
  const parts: string[] = [];
  let hasUserMessage = false;
  for (const item of input ?? []) {
    if (item.type !== EVENT_TYPE.USER_MESSAGE) {
      continue;
    }
    hasUserMessage = true;
    const { content } = item;
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    for (const part of content) {
      if (part.type === 'text') {
        parts.push(part.text);
      }
    }
  }
  return hasUserMessage ? parts.join('\n').trim() : undefined;
}
