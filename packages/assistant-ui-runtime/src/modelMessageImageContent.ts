import type { CompleteAttachment } from '@assistant-ui/core';
import {
  EVENT_TYPE,
  isEventDelta,
  mergeEventDelta,
  type ModelMessageContentPart,
  type ModelMessageDeltaEvent,
  type ModelMessageEvent,
  type TurnEvent,
  type TurnStreamingEvent,
} from './server/index.js';

import type { AssistantContentPart } from './modelMessageContent.js';

export type ImageUrlContentPart = Extract<ModelMessageContentPart, { type: 'image_url' }>;

type ContentBlockDelta = NonNullable<ModelMessageDeltaEvent['contentBlocks']>[number];

function parseDataUriMime(data: string): string {
  if (!data.startsWith('data:')) {
    return 'image/png';
  }
  const match = /^data:([^;,]+)/.exec(data);
  return match?.[1] ?? 'image/png';
}

function imageFilenameFromUrl(url: string, index: number): string {
  const mimeType = parseDataUriMime(url);
  const ext = mimeType.split('/')[1] ?? 'png';
  return `image-${String(index + 1)}.${ext}`;
}

export function isImageUrlContentPart(part: unknown): part is ImageUrlContentPart {
  if (!isUnknownRecord(part) || part['type'] !== 'image_url' || !isUnknownRecord(part['image_url'])) {
    return false;
  }
  return typeof part['image_url']['url'] === 'string';
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeModelMessageContent(message: ModelMessageEvent): ModelMessageContentPart[] {
  const { content } = message;
  if (content == null) {
    return [];
  }
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  return content;
}

function mergeContentBlockDeltas(message: ModelMessageEvent, blocks: readonly ContentBlockDelta[]): void {
  const content = normalizeModelMessageContent(message);
  message.content = content;

  for (const block of blocks) {
    const index = block.index;
    while (content.length <= index) {
      content.push({ type: 'text', text: '' });
    }

    const delta = block.delta;
    if (delta.type === 'text') {
      const existing = content[index];
      if (existing?.type === 'text') {
        existing.text += delta.text ?? '';
      } else {
        content[index] = { type: 'text', text: delta.text ?? '' };
      }
      continue;
    }

    const chunk = delta.image_url?.url ?? '';
    const existing = content[index];
    if (isImageUrlContentPart(existing)) {
      existing.image_url.url += chunk;
    } else {
      content[index] = { type: 'image_url', image_url: { url: chunk } };
    }
  }
}

export function mergeStreamEventDelta(base: TurnEvent, delta: TurnStreamingEvent): void {
  if (!isEventDelta(delta)) {
    return;
  }

  mergeEventDelta(base, delta);

  if (base.type !== EVENT_TYPE.MODEL_MESSAGE) {
    return;
  }

  const blocks = delta.contentBlocks ?? delta.content_blocks;
  if (blocks == null || blocks.length === 0) {
    return;
  }

  mergeContentBlockDeltas(base, blocks);
}

export function imageUrlToAttachment(url: string, attachmentId: string): CompleteAttachment {
  const mimeType = parseDataUriMime(url);
  return {
    id: attachmentId,
    type: 'image',
    name: imageFilenameFromUrl(url, 0),
    contentType: mimeType,
    status: { type: 'complete' },
    content: [{ type: 'image', image: url, filename: imageFilenameFromUrl(url, 0) }],
  };
}

export function imagePartToAssistantImage(url: string, index: number): AssistantContentPart {
  return {
    type: 'image',
    image: url,
    filename: imageFilenameFromUrl(url, index),
  };
}

export function extractImagePartsFromModelMessage(message: ModelMessageEvent): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  let imageIndex = 0;

  for (const part of normalizeModelMessageContent(message)) {
    if (!isImageUrlContentPart(part)) {
      continue;
    }
    const url = part.image_url.url.trim();
    if (url.length === 0) {
      continue;
    }
    parts.push(imagePartToAssistantImage(url, imageIndex));
    imageIndex += 1;
  }

  return parts;
}

export function extractImageUrlFromUserContentItem(part: unknown): string | undefined {
  if (isImageUrlContentPart(part)) {
    const url = part.image_url.url.trim();
    return url.length > 0 ? url : undefined;
  }
  return undefined;
}
