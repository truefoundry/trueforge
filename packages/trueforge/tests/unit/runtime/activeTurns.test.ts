import { CancellationReason, TurnOffloadReason, type TurnHandle } from '@truefoundry/trueforge-core/agent-session';
import { E_TIMEOUT } from 'async-mutex';
import { createLogger } from 'winston';
import { ActiveTurnRegistry, TurnLockAcquireTimeoutError } from '../../../src/runtime/activeTurns';

const logger = createLogger({ silent: true });

function turn(sessionId: string, turnId: string, status: 'running' | 'paused' = 'running'): TurnHandle {
  return { session_id: sessionId, id: turnId, state: { status } } as TurnHandle;
}

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

function requireTurnLockAcquireTimeout(caught: unknown): TurnLockAcquireTimeoutError {
  if (!(caught instanceof TurnLockAcquireTimeoutError)) {
    throw new Error('expected TurnLockAcquireTimeoutError', { cause: caught });
  }
  return caught;
}

describe('ActiveTurnRegistry', () => {
  it('track passes events through and removes the run when the stream completes', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 't1'),
      abortController,
      stream: values([1, 2, 3]),
    });

    const seen: number[] = [];
    for await (const value of tracked) {
      seen.push(value);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(false);
  });

  it('track cleans up when the consumer breaks early', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 't1'),
      abortController,
      stream: values([1, 2, 3]),
    });

    for await (const value of tracked) {
      expect(value).toBe(1);
      break;
    }
    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(false);
  });

  it('track cleans up when the stream throws', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 't1'),
      abortController,
      stream: throwingStream(),
    });

    await expect(async () => {
      for await (const value of tracked) {
        void value;
      }
    }).rejects.toThrow(/stream boom/);
    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(false);
  });

  it('cancelIfRunning aborts with the given reason and returns true', () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    void registry.track({
      turn: turn('s1', 't1'),
      abortController,
      stream: values([1]),
    });

    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
    expect(registry.isCancelled({ sessionId: 's1', turnId: 't1' })).toBe(true);
  });

  it('isCancelled ignores an offloaded run', () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    void registry.track({
      turn: turn('s1', 't1', 'paused'),
      abortController,
      stream: values([1]),
    });
    abortController.abort(TurnOffloadReason);

    expect(registry.isCancelled({ sessionId: 's1', turnId: 't1' })).toBe(false);
  });

  it('cancelIfRunning returns false for unknown ids', () => {
    const registry = new ActiveTurnRegistry({ logger });
    expect(
      registry.cancelIfRunning({
        sessionId: 'missing',
        turnId: 'missing',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(false);
  });

  it('cancelIfRunning does not re-abort an already-aborted controller', () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    void registry.track({
      turn: turn('s1', 't1'),
      abortController,
      stream: values([1]),
    });
    abortController.abort(CancellationReason.ClientCancelled);

    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.Abandoned,
      }),
    ).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
  });

  it('shutdownAndWait aborts runs and waits until tracked streams finish', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 't1'),
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
    expect(
      registry.cancelIfRunning({
        sessionId: 's1',
        turnId: 't1',
        abortReason: CancellationReason.ClientCancelled,
      }),
    ).toBe(false);
  });

  it('late track after shutdownAndWait aborts immediately with the shutdown reason', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    await registry.shutdownAndWait(CancellationReason.Abandoned);

    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 'late'),
      abortController,
      stream: values(['x']),
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.Abandoned);

    for await (const value of tracked) {
      void value;
    }
  });

  it('late track after shutdownAndWait offloads a paused turn', async () => {
    const registry = new ActiveTurnRegistry({ logger });
    await registry.shutdownAndWait(CancellationReason.Abandoned);

    const abortController = new AbortController();
    const tracked = registry.track({
      turn: turn('s1', 'late-paused', 'paused'),
      abortController,
      stream: values(['x']),
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(TurnOffloadReason);

    for await (const value of tracked) {
      void value;
    }
  });

  it('throws TurnLockAcquireTimeoutError when the lock is not acquired in time', async () => {
    const timeoutMs = 40;
    const registry = new ActiveTurnRegistry({ logger, lockAcquireTimeoutMs: timeoutMs });
    const gate = Promise.withResolvers<undefined>();
    const holder = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, () => gate.promise);
    const waiter = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, async () => 'acquired');

    let caught: unknown;
    try {
      await waiter;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TurnLockAcquireTimeoutError);
    const error = requireTurnLockAcquireTimeout(caught);
    expect(error.timeoutMs).toBe(timeoutMs);
    expect(error.cause).toBe(E_TIMEOUT);

    gate.resolve(undefined);
    await holder;
  });

  it('does not throw when the holder releases the lock before the acquire timeout', async () => {
    const registry = new ActiveTurnRegistry({ logger, lockAcquireTimeoutMs: 300 });
    const gate = Promise.withResolvers<undefined>();
    const holder = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, () => gate.promise);
    let entered = false;
    const waiter = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, async () => {
      entered = true;
      return 'acquired';
    });

    await new Promise<void>(resolve => {
      setTimeout(resolve, 30);
    });
    expect(entered).toBe(false);
    gate.resolve(undefined);
    await holder;
    await expect(waiter).resolves.toBe('acquired');
  });

  it('waits without a timeout when lockAcquireTimeoutMs is 0', async () => {
    const registry = new ActiveTurnRegistry({ logger, lockAcquireTimeoutMs: 0 });
    const gate = Promise.withResolvers<undefined>();
    const holder = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, () => gate.promise);
    let entered = false;
    const waiter = registry.withTurnLock({ sessionId: 's1', turnId: 't1' }, async () => {
      entered = true;
      return 'acquired';
    });

    await new Promise<void>(resolve => {
      setTimeout(resolve, 80);
    });
    expect(entered).toBe(false);
    gate.resolve(undefined);
    await holder;
    await expect(waiter).resolves.toBe('acquired');
  });
});
