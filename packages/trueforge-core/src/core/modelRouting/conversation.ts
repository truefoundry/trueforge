import type { DecisionModelCreateParams } from '../decision/IDecisionModel';
import type { UserMessage } from '../events/schema';
import type { InternalEnrichedAssistantMessage, LLMUserMessage } from '../llm/LLMTypes';
import { parseMimeFromDataUri } from '../llm/VercelAILLM';
import type { ContextMessage } from '../runtime/AgentThread.types';
import { isInternalSystemMessage, SYSTEM_TAG_START } from '../runtime/contextUtils';
import { uploadedFilesInAnnouncement } from '../runtime/UserInputMessage';

type MessageContent = LLMUserMessage['content'] | InternalEnrichedAssistantMessage['content'] | UserMessage['content'];

function attachedFileNote(name: string | undefined, mime: string | undefined): string {
  if (name !== undefined && name.length > 0 && mime !== undefined && mime.length > 0) {
    return `[attached file: ${name}, ${mime}]`;
  }
  if (name !== undefined && name.length > 0) {
    return `[attached file: ${name}]`;
  }
  if (mime !== undefined && mime.length > 0) {
    return `[attached file: ${mime}]`;
  }
  return '[attached file]';
}

function textFromInternal(text: string): string {
  return uploadedFilesInAnnouncement(text)
    .map(file => attachedFileNote(file.filename, file.mime))
    .join('\n');
}

function textOf(content: MessageContent): string {
  if (typeof content === 'string') {
    return content.startsWith(SYSTEM_TAG_START) ? textFromInternal(content) : content;
  }
  if (content == null) {
    return '';
  }
  const texts: string[] = [];
  for (const part of content) {
    let piece = '';
    if (part.type === 'text') {
      piece = part.text.startsWith(SYSTEM_TAG_START) ? textFromInternal(part.text) : part.text;
    } else if (part.type === 'file' && 'name' in part) {
      piece = attachedFileNote(part.name, parseMimeFromDataUri(part.data));
    } else if (part.type === 'file') {
      const fileData = part.file.file_data;
      piece = attachedFileNote(part.file.filename, fileData !== undefined ? parseMimeFromDataUri(fileData) : undefined);
    } else if (part.type === 'image_url') {
      const mime = parseMimeFromDataUri(part.image_url.url);
      piece = mime !== undefined ? `[attached image: ${mime}]` : '[attached image]';
    }
    if (piece.length > 0) {
      texts.push(piece);
    }
  }
  return texts.join('\n');
}

/**
 * A thread's conversation as the classifier sees it: user and assistant text in order, then the latest user input.
 * Tool calls, tool results, approvals and internal system messages are left out. Attachments are named, not inlined.
 */
export function routingConversation(context: readonly ContextMessage[], latest: readonly UserMessage[]) {
  const messages: Exclude<DecisionModelCreateParams['input'], string> = [];
  const add = (role: 'user' | 'assistant', text: string) => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      messages.push({ role, content: trimmed });
    }
  };
  for (const message of context) {
    if (isInternalSystemMessage(message)) {
      continue;
    }
    if ('role' in message && (message.role === 'user' || message.role === 'assistant')) {
      add(message.role, textOf(message.content));
    }
  }
  for (const message of latest) {
    add('user', textOf(message.content));
  }
  return messages;
}
