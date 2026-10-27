import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { SessionEventItem } from '@/server/types.js';
import { aggregateSessionTurnBand, buildSessionTurnViews } from '@/utils/sessionTurnViews.js';

const at = (second: number) => `2026-10-21T01:00:0${second}.000Z`;

function modelMessage({
  id,
  threadId,
  model,
  second,
}: {
  id: string;
  threadId: string;
  model?: string;
  second: number;
}): SessionEventItem {
  return {
    turnId: 't1',
    event: {
      type: 'model.message',
      id,
      threadId,
      createdAt: at(second),
      ...(model === undefined ? {} : { model: { name: model } }),
    },
  };
}

describe('turn model name', () => {
  const created: SessionEventItem = {
    turnId: 't1',
    event: {
      type: 'turn.created',
      id: 'c',
      turnId: 't1',
      createdAt: at(0),
      input: [{ type: 'user.message', content: 'hi' }],
    },
  };

  it('uses the last root-thread model and ignores sub-agent threads', () => {
    const turns = buildSessionTurnViews([
      created,
      modelMessage({ id: 'a', threadId: 'main', model: 'p/first', second: 1 }),
      modelMessage({ id: 'b', threadId: 'main', model: 'p/second', second: 2 }),
      modelMessage({ id: 'c', threadId: 'sub', model: 'p/sub', second: 3 }),
    ]);
    assert.equal(turns[0]?.modelName, 'p/second');
    assert.equal(aggregateSessionTurnBand(turns, 1)?.modelName, 'p/second');
  });

  it('leaves modelName unset when events carry no model', () => {
    const [turn] = buildSessionTurnViews([created, modelMessage({ id: 'a', threadId: 'main', second: 1 })]);
    assert.equal(turn?.modelName, undefined);
  });
});
