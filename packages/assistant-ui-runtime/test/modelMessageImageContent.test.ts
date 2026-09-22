import { describe, expect, it } from 'vitest';
import type { ModelMessageEvent } from '../src/server/index.js';

import { PeerThreadFoldState, ingestStreamEvent } from '../src/foldPeerThreads.js';
import { buildAssistantContent } from '../src/modelMessageContent.js';
import { mergeStreamEventDelta } from '../src/modelMessageImageContent.js';

const imageDataUri = 'data:image/jpeg;base64,/9j/4AAQ';

function modelMessage(event: Omit<ModelMessageEvent, 'type' | 'createdAt'>): ModelMessageEvent {
  return {
    type: 'model.message',
    createdAt: new Date().toISOString(),
    ...event,
  };
}

describe('modelMessageImageContent', () => {
  it('merges content_blocks image_url deltas into the base model message', () => {
    const base = modelMessage({
      id: 'm1',
      threadId: 'main',
    });

    mergeStreamEventDelta(base, {
      type: 'model.message.delta',
      id: 'm1',
      threadId: 'main',
      content_blocks: [
        {
          index: 0,
          delta: {
            type: 'image_url',
            image_url: { url: imageDataUri },
          },
        },
      ],
    } as never);

    expect(base.content).toEqual([
      {
        type: 'image_url',
        image_url: { url: imageDataUri },
      },
    ]);
  });

  it('buildAssistantContent emits image parts for image_url content', () => {
    const parts = buildAssistantContent(
      modelMessage({
        id: 'm1',
        threadId: 'main',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataUri },
          },
        ] as never,
      }),
    );

    expect(parts).toEqual([
      {
        type: 'image',
        image: imageDataUri,
        filename: 'image-1.jpeg',
      },
    ]);
  });

  it('ingests content_blocks deltas through the fold state', () => {
    const fold = new PeerThreadFoldState();
    ingestStreamEvent(
      fold,
      modelMessage({
        id: 'm1',
        threadId: 'main',
      }),
    );
    ingestStreamEvent(fold, {
      type: 'model.message.delta',
      id: 'm1',
      threadId: 'main',
      content_blocks: [
        {
          index: 0,
          delta: {
            type: 'image_url',
            image_url: { url: imageDataUri },
          },
        },
      ],
    } as never);

    const event = fold.threads.get('main')?.events.get('m1');
    expect(event?.type).toBe('model.message');
    if (event?.type !== 'model.message') {
      return;
    }
    expect(event.content).toEqual([
      {
        type: 'image_url',
        image_url: { url: imageDataUri },
      },
    ]);
  });
});
