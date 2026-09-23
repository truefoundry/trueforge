import { CancellationReason } from '@truefoundry/trueforge-core/agent-session';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

async function* values<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

async function* throwingStream(): AsyncGenerator<number> {
  yield 1;
  throw new Error('stream boom');
}

/**
 * Yields once, then waits until `signal` aborts before completing — used to
 * prove shutdownAndWait waits for tracked streams to finish after abort.
 */
async function* gateOnAbort(signal: AbortSignal): AsyncGenerator<string> {
  yield 'started';
  if (signal.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('ActiveTurnRegistry', () => {
  it('track passes events through and removes the run when the stream completes', async () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: values([1, 2, 3]),
    });

    const seen: number[] = [];
    for await (const value of tracked) {
      seen.push(value);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('track cleans up when the consumer breaks early', async () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: values([1, 2, 3]),
    });

    for await (const value of tracked) {
      expect(value).toBe(1);
      break;
    }
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('track cleans up when the stream throws', async () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: throwingStream(),
    });

    await expect(async () => {
      for await (const value of tracked) {
        void value;
      }
    }).rejects.toThrow(/stream boom/);
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('has is true only while the run is tracked', async () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: values([1]),
    });
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(true);
    for await (const value of tracked) {
      void value;
    }
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('cancel aborts with the given reason', () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    void registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: values([1]),
    });

    registry.cancel({
      sessionId: 's1',
      turnId: 't1',
      abortReason: CancellationReason.ClientCancelled,
    });
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
  });

  it('cancel is a no-op for unknown ids', () => {
    const registry = new ActiveTurnRegistry();
    expect(() =>
      registry.cancel({
        sessionId: 'missing',
        turnId: 'missing',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).not.toThrow();
  });

  it('cancel does not re-abort an already-aborted controller', () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    void registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: values([1]),
    });
    abortController.abort(CancellationReason.ClientCancelled);

    registry.cancel({
      sessionId: 's1',
      turnId: 't1',
      abortReason: CancellationReason.Abandoned,
    });
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
  });

  it('shutdownAndWait aborts runs and waits until tracked streams finish', async () => {
    const registry = new ActiveTurnRegistry();
    const abortController = new AbortController();
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 't1',
      abortController,
      stream: gateOnAbort(abortController.signal),
    });

    const drain = (async () => {
      for await (const value of tracked) {
        void value;
      }
    })();

    await registry.shutdownAndWait(CancellationReason.Abandoned);
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.Abandoned);
    await drain;
    expect(registry.has({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('late track after shutdownAndWait aborts immediately with the shutdown reason', async () => {
    const registry = new ActiveTurnRegistry();
    await registry.shutdownAndWait(CancellationReason.Abandoned);

    const abortController = new AbortController();
    const tracked = registry.track({
      sessionId: 's1',
      turnId: 'late',
      abortController,
      stream: values(['x']),
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.Abandoned);

    for await (const value of tracked) {
      void value;
    }
  });
});
