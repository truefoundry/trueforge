import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { createLogger } from 'winston';
import { internalTrueForgeClient } from '../../../src/controller/internalTrueForgeClient';
import { dispatchSandboxEnvBuilds, sandboxEnvBuildLoop } from '../../../src/controller/sandboxEnvBuild';

function fakeLogger() {
  return { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

describe('sandboxEnvBuildLoop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('progresses each pending version id from the internal API', async () => {
    jest.spyOn(internalTrueForgeClient, 'listPendingSandboxEnvironmentVersions').mockResolvedValue(['ver-1', 'ver-2']);
    const progress = jest
      .spyOn(internalTrueForgeClient, 'progressSandboxEnvironmentVersion')
      .mockResolvedValue(undefined);

    const logger = fakeLogger();
    const loop = sandboxEnvBuildLoop({ logger: logger as never });
    await loop.tick(new AbortController().signal);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, 'ver-1');
    expect(progress).toHaveBeenNthCalledWith(2, 'ver-2');
  });

  it('skips NotFoundError and continues the tick', async () => {
    jest.spyOn(internalTrueForgeClient, 'listPendingSandboxEnvironmentVersions').mockResolvedValue(['gone', 'ok']);
    const progress = jest
      .spyOn(internalTrueForgeClient, 'progressSandboxEnvironmentVersion')
      .mockImplementation(async id => {
        if (id === 'gone') {
          throw new TrueForgeApi.NotFoundError({ error: { message: 'not found' } });
        }
      });
    const logger = fakeLogger();

    await dispatchSandboxEnvBuilds({ logger: logger as never });

    expect(progress).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Sandbox environment version not found; skipping',
      expect.objectContaining({
        environment_version_id: 'gone',
        reportable_error: expect.objectContaining({ operation: 'progressNotFound' }),
      }),
    );
  });

  it('reports a progress failure once', async () => {
    jest.spyOn(internalTrueForgeClient, 'listPendingSandboxEnvironmentVersions').mockResolvedValue(['ver-1']);
    jest.spyOn(internalTrueForgeClient, 'progressSandboxEnvironmentVersion').mockRejectedValue(new Error('down'));
    const logger = createLogger({ silent: true });
    const error = jest.spyOn(logger, 'error');

    await dispatchSandboxEnvBuilds({ logger });

    expect(error).toHaveBeenCalledWith(
      'Sandbox environment version progress failed',
      expect.objectContaining({
        reportable_error: expect.objectContaining({ operation: 'progress' }),
      }),
    );
  });

  it('does not tick when aborted', async () => {
    const list = jest.spyOn(internalTrueForgeClient, 'listPendingSandboxEnvironmentVersions');
    const controller = new AbortController();
    controller.abort();
    const loop = sandboxEnvBuildLoop({ logger: fakeLogger() as never });
    await loop.tick(controller.signal);
    expect(list).not.toHaveBeenCalled();
  });
});
