import { describe, expect, it } from 'vitest';

import { buildSandboxDownloadRequest } from '../src/sandboxDownload.js';

describe('buildSandboxDownloadRequest', () => {
  it('succeeds with turnId and path when sandboxId is missing (resume without sandbox.created in window)', () => {
    expect(
      buildSandboxDownloadRequest({
        sessionId: 'session-1',
        turnId: 'turn-tip',
        path: '/tmp/out.txt',
      }),
    ).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-tip',
      path: '/tmp/out.txt',
    });
  });

  it('includes sandboxId when the live/history path recovered it', () => {
    expect(
      buildSandboxDownloadRequest({
        sessionId: 'session-1',
        turnId: 'turn-1',
        path: '/tmp/out.txt',
        sandboxId: 'sbx-123',
      }),
    ).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: '/tmp/out.txt',
      sandboxId: 'sbx-123',
    });
  });

  it('errors only when sessionId is missing', () => {
    expect(() =>
      buildSandboxDownloadRequest({
        sessionId: undefined,
        turnId: 'turn-1',
        path: '/tmp/out.txt',
        sandboxId: 'sbx-123',
      }),
    ).toThrow(/session has not been saved/);
  });
});
