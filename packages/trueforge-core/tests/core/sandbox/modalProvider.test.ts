import { App, Image, ModalClient } from 'modal';
import { createLogger } from 'winston';
import { ModalSandboxProvider } from '../../../src/core/sandbox/provider/ModalProvider';

const logger = createLogger({ silent: true });

function makeProvider(client: ModalClient, buildRef?: string): ModalSandboxProvider {
  return new ModalSandboxProvider({
    client,
    tokenId: 'ak-test',
    tokenSecret: 'as-test',
    tenantName: 'tenant',
    sandboxImage: 'registry.example.com/trueforge:sha',
    buildRef,
    environment: 'main',
    appName: 'trueforge',
    timeoutMs: 60_000,
    sandboxTimeoutMs: 3_600_000,
    idleTimeoutMs: 300_000,
    fileMaxBytesForDownload: 1024,
    logger,
  });
}

describe('ModalSandboxProvider image lifecycle', () => {
  it('eagerly builds the release image and persists its Modal image ID', async () => {
    const client = new ModalClient({ tokenId: 'ak-test', tokenSecret: 'as-test' });
    const app = new App('ap-test', 'trueforge', 'main');
    const source = new Image(client, '', 'registry.example.com/trueforge:sha');
    const built = new Image(client, 'im-built', 'registry.example.com/trueforge:sha');
    jest.spyOn(client.apps, 'fromName').mockResolvedValue(app);
    jest.spyOn(client.images, 'fromRegistry').mockReturnValue(source);
    jest.spyOn(source, 'build').mockResolvedValue(built);

    await expect(makeProvider(client).buildImage()).resolves.toEqual({
      status: 'ready',
      reason: null,
      metadata: { build_ref: 'im-built', image_uri: 'registry.example.com/trueforge:sha' },
    });
  });

  it('checks a persisted image without rebuilding it', async () => {
    const client = new ModalClient({ tokenId: 'ak-test', tokenSecret: 'as-test' });
    jest.spyOn(client.images, 'fromId').mockResolvedValue(new Image(client, 'im-built', ''));
    await expect(makeProvider(client, 'im-built').getImageBuildStatus()).resolves.toEqual({
      status: 'ready',
      reason: null,
      metadata: { build_ref: 'im-built', image_uri: 'registry.example.com/trueforge:sha' },
    });
  });
});
