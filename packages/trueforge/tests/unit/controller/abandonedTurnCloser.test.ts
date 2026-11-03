import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import configuration from '../../../src/config';
import { abandonedTurnCloserLoop, dispatchAbandonedTurns } from '../../../src/controller/abandonedTurnCloser';
import { internalTrueForgeClient } from '../../../src/controller/internalTrueForgeClient';

function fakeLogger() {
  return { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

function abandoned(n: number): { tenantId: string; sessionId: string; turnId: string } {
  return { tenantId: 't1', sessionId: `s-${String(n)}`, turnId: `turn-${String(n)}` };
}

describe('abandonedTurnCloserLoop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes each abandoned turn from the internal API up to the batch limit', async () => {
    const batch = configuration.ABANDONED_TURN_CLOSE_BATCH;
    const all = Array.from({ length: batch + 5 }, (_, i) => abandoned(i));
    jest.spyOn(internalTrueForgeClient, 'listAbandonedTurns').mockResolvedValue(all);
    const close = jest.spyOn(internalTrueForgeClient, 'closeAbandonedTurn').mockResolvedValue(undefined);

    const logger = fakeLogger();
    const loop = abandonedTurnCloserLoop({ logger: logger as never });
    await loop.tick(new AbortController().signal);

    expect(close).toHaveBeenCalledTimes(batch);
    expect(close).toHaveBeenNthCalledWith(1, abandoned(0));
    expect(close).toHaveBeenNthCalledWith(batch, abandoned(batch - 1));
  });

  it('skips NotFoundError and continues the tick', async () => {
    jest.spyOn(internalTrueForgeClient, 'listAbandonedTurns').mockResolvedValue([abandoned(1), abandoned(2)]);
    const close = jest.spyOn(internalTrueForgeClient, 'closeAbandonedTurn').mockImplementation(async input => {
      if (input.turnId === 'turn-1') {
        throw new TrueForgeApi.NotFoundError({ error: { message: 'not found' } });
      }
    });
    const logger = fakeLogger();

    await dispatchAbandonedTurns({ logger: logger as never });

    expect(close).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not tick when aborted', async () => {
    const list = jest.spyOn(internalTrueForgeClient, 'listAbandonedTurns');
    const controller = new AbortController();
    controller.abort();
    const loop = abandonedTurnCloserLoop({ logger: fakeLogger() as never });
    await loop.tick(controller.signal);
    expect(list).not.toHaveBeenCalled();
  });
});
