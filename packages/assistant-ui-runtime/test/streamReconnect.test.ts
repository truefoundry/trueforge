import { describe, expect, it } from 'vitest';

import { delayReconnect } from '../src/streamReconnect.js';

describe('delayReconnect', () => {
  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delayReconnect(controller.signal, 50)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with AbortError when aborted during the wait', async () => {
    const controller = new AbortController();
    const pending = delayReconnect(controller.signal, 50_000);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
