import { SnapshotState } from '@daytona/sdk';
import {
  activateInactiveTrueForgeSnapshots,
  daytonaSnapshotActivationLoop,
  type DaytonaSnapshotActivationClient,
} from '../../../src/controller/daytonaSnapshotActivation';

jest.mock('../../../src/sentry', () => ({
  captureCriticalException: jest.fn(),
}));

function fakeLogger() {
  return { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

describe('daytonaSnapshotActivationLoop', () => {
  it('paginates snapshots and activates only inactive trueforge snapshots', async () => {
    const list = jest.fn<
      ReturnType<DaytonaSnapshotActivationClient['list']>,
      Parameters<DaytonaSnapshotActivationClient['list']>
    >();
    list
      .mockResolvedValueOnce({
        items: [
          { id: 'snap-1', name: 'trueforge-one', state: SnapshotState.INACTIVE },
          { id: 'snap-2', name: 'trueforge-two', state: SnapshotState.ACTIVE },
          { id: 'snap-3', name: 'other', state: SnapshotState.INACTIVE },
        ],
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'snap-4', name: 'trueforge-four', state: SnapshotState.INACTIVE }],
        totalPages: 2,
      });
    const activate = jest.fn().mockRejectedValueOnce(new Error('activation failed')).mockResolvedValue(undefined);
    const logger = fakeLogger();

    await activateInactiveTrueForgeSnapshots({
      client: { list, activate },
      logger: logger as never,
      signal: new AbortController().signal,
    });

    expect(list).toHaveBeenNthCalledWith(1, { page: 1, limit: 100 });
    expect(list).toHaveBeenNthCalledWith(2, { page: 2, limit: 100 });
    expect(activate.mock.calls).toEqual([['snap-1'], ['snap-4']]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not list snapshots when stopped', async () => {
    const getSandboxProvider = jest.fn();
    const controller = new AbortController();
    controller.abort();

    const loop = daytonaSnapshotActivationLoop({
      sandboxProviderStore: {
        getSandboxProvider,
      } as never,
      logger: fakeLogger() as never,
    });
    await loop.tick(controller.signal);

    expect(getSandboxProvider).not.toHaveBeenCalled();
  });
});
