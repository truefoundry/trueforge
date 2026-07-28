import { CancellationReason } from '@truefoundry/utils/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActiveTurnRegistry } from '../runtime/activeTurns';
import { cancelSessionTurnPeerHandler, SESSIONS_CANCEL_PATH } from './sessions';

async function* values<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

function makeRoute() {
  const activeTurns = new ActiveTurnRegistry();
  const router = new RequestReplyRouter();
  router.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(activeTurns));
  return { activeTurns, router };
}

describe('sessions/cancel request-reply route', () => {
  it('cancels a turn running in this process and replies 200 after teardown', async () => {
    const { activeTurns, router } = makeRoute();
    const abortController = new AbortController();
    const tracked = activeTurns.track({
      sessionId: 's1',
      turnId: '01abc.exec1',
      abortController,
      stream: values([1]),
    });
    // The cancel reply waits for teardown, so the run must actually drain.
    const drain = (async () => {
      for await (const value of tracked) {
        void value;
      }
    })();

    const reply = await router.dispatchRoute(SESSIONS_CANCEL_PATH, {
      body: { session_id: 's1', turn_id: '01abc.exec1', reason: CancellationReason.ClientCancelled },
    });

    assert.equal(reply.status, 200);
    assert.equal(abortController.signal.aborted, true);
    assert.equal(abortController.signal.reason, CancellationReason.ClientCancelled);
    await drain;
  });

  it('replies 412 when the turn is not running here', async () => {
    const { router } = makeRoute();
    const reply = await router.dispatchRoute(SESSIONS_CANCEL_PATH, {
      body: { session_id: 's1', turn_id: '01abc.exec1', reason: CancellationReason.ClientCancelled },
    });
    assert.equal(reply.status, 412);
  });

  it('replies 400 for an invalid payload', async () => {
    const { router } = makeRoute();
    const reply = await router.dispatchRoute(SESSIONS_CANCEL_PATH, { body: { nope: true } });
    assert.equal(reply.status, 400);
  });
});
