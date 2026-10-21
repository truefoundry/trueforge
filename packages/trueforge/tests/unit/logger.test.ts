import { currentLogContext, runWithLogContext } from '../../src/logger';

describe('log context AsyncLocalStorage', () => {
  it('is empty when an AbortSignal listener runs after the request store exits', async () => {
    let signal: AbortSignal | undefined;
    const snapshot = await runWithLogContext(
      { request_id: 'req-1', session_id: 'sess-1', turn_id: 'turn-1', tenant_id: 'ten-1' },
      () => {
        const controller = new AbortController();
        signal = controller.signal;
        return { controller, fields: { ...currentLogContext() } };
      },
    );

    expect(currentLogContext()).toBeUndefined();
    expect(snapshot.fields).toEqual({
      request_id: 'req-1',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      tenant_id: 'ten-1',
    });

    await new Promise<void>(resolve => {
      signal?.addEventListener(
        'abort',
        () => {
          // Hono stream.onAbort is driven by the request AbortSignal the same way.
          expect(currentLogContext()).toBeUndefined();
          resolve();
        },
        { once: true },
      );
      snapshot.controller.abort();
    });
  });
});
