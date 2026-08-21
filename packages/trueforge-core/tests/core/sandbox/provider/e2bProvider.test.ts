import { CommandExitError, E2B, Sandbox as E2BSdkSandbox, FileNotFoundError } from 'e2b';
import { E2BSandboxProvider, resolveE2BCodeModeHost } from '../../../../src/core/sandbox/provider/E2BProvider';
import { SandboxFileNotFoundError } from '../../../../src/core/sandbox/SandboxErrors';
import { makeSilentLogger } from '../../harnessMocks';

const IMAGE_URI = 'registry.example.com/trueforge-sandbox:029ea5ff';
const templateMethodRestores: Array<() => void> = [];

function replaceBoundTemplateMethod(client: E2B, name: string, replacement: unknown): void {
  const owner = Object.getPrototypeOf(client.Template);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (descriptor === undefined) {
    throw new Error(`Missing E2B Template method: ${name}`);
  }
  Object.defineProperty(owner, name, { ...descriptor, value: replacement });
  templateMethodRestores.push(() => {
    Object.defineProperty(owner, name, descriptor);
  });
}

class TestSandbox extends E2BSdkSandbox {
  constructor(params: { sandboxId: string; trafficAccessToken: string | undefined }) {
    super({
      apiKey: 'e2b-test',
      sandboxId: params.sandboxId,
      sandboxDomain: 'e2b.test',
      envdVersion: '0.5.7',
      ...(params.trafficAccessToken === undefined ? {} : { trafficAccessToken: params.trafficAccessToken }),
    });
  }
}

function makeProvider(params?: {
  client?: E2B | undefined;
  buildId?: string | undefined;
  templateId?: string | undefined;
}): { client: E2B; provider: E2BSandboxProvider } {
  const client = params?.client ?? new E2B({ apiKey: 'e2b-test' });
  return {
    client,
    provider: new E2BSandboxProvider({
      client,
      tenantName: 'tenant-a',
      sandboxImage: IMAGE_URI,
      buildId: params?.buildId,
      templateId: params?.templateId,
      execTimeoutMs: 60_000,
      sandboxTimeoutMs: 300_000,
      fileMaxBytesForDownload: 1024,
      logger: makeSilentLogger(),
    }),
  };
}

afterEach(() => {
  for (const restore of templateMethodRestores.splice(0)) {
    restore();
  }
  jest.restoreAllMocks();
});

describe('E2BSandboxProvider image build', () => {
  it('builds the pinned release image with the TrueForge workdir and NATS start command', async () => {
    const { client, provider } = makeProvider();
    const existsMock = jest.fn().mockResolvedValue(false);
    const buildMock = jest.fn().mockResolvedValue({
      alias: 'trueforge-build-029ea5ff',
      name: 'trueforge-build-029ea5ff',
      tags: [],
      buildId: 'build-1',
      templateId: 'template-1',
    });
    replaceBoundTemplateMethod(client, 'exists', existsMock);
    replaceBoundTemplateMethod(client, 'buildInBackground', buildMock);

    const build = await provider.buildImage();
    const template = buildMock.mock.calls[0]?.[0];
    if (template === undefined) {
      throw new Error('Expected an E2B template build');
    }
    const serialized = await client.Template.toJSON(template, false);

    expect(serialized).toContain(IMAGE_URI);
    expect(serialized).toContain('/home/trueforge');
    expect(serialized).toContain('/usr/bin/supervisord -n');
    expect(serialized).toContain('4444');
    expect(build).toEqual({
      status: 'pending',
      reason: 'Sandbox image build started.',
      metadata: {
        build_ref: 'trueforge-build-029ea5ff',
        image_uri: IMAGE_URI,
        build_id: 'build-1',
        template_id: 'template-1',
      },
    });
  });

  it('polls a persisted E2B build without starting another build', async () => {
    const { client, provider } = makeProvider({ buildId: 'build-1', templateId: 'template-1' });
    const getBuildStatusMock = jest.fn().mockResolvedValue({
      buildID: 'build-1',
      templateID: 'template-1',
      status: 'ready',
      logEntries: [],
      logs: [],
    });
    const buildMock = jest.fn();
    replaceBoundTemplateMethod(client, 'getBuildStatus', getBuildStatusMock);
    replaceBoundTemplateMethod(client, 'buildInBackground', buildMock);

    const build = await provider.getImageBuildStatus();

    expect(build.status).toBe('ready');
    expect(build.reason).toBeNull();
    expect(buildMock).not.toHaveBeenCalled();
  });
});

describe('E2BSandboxProvider sandbox operations', () => {
  it('creates secure, pausing sandboxes with tenant ownership metadata', async () => {
    const { client, provider } = makeProvider({ templateId: 'template-1' });
    const sandbox = new TestSandbox({ sandboxId: 'sandbox-1', trafficAccessToken: 'traffic-1' });
    const createMock = jest.spyOn(client.Sandbox, 'create').mockResolvedValue(sandbox);

    await expect(provider.createSandbox()).resolves.toEqual({ sandboxId: 'sandbox-1' });
    expect(createMock).toHaveBeenCalledWith('template-1', {
      timeoutMs: 300_000,
      metadata: { trueforge_tenant_id: 'tenant-a' },
      secure: true,
      lifecycle: { onTimeout: 'pause', autoResume: true },
    });
  });

  it('binds the secure traffic token to the same sandbox host', () => {
    const sandbox = new TestSandbox({ sandboxId: 'sandbox-1', trafficAccessToken: 'traffic-1' });

    const connection = resolveE2BCodeModeHost({ sandbox, port: 4444 });

    expect(connection.url).toContain('4444-sandbox-1');
    expect(connection.webSocketHeaders).toEqual({ 'E2B-Traffic-Access-Token': 'traffic-1' });
  });

  it('does not connect to an opaque sandbox id owned by another tenant', async () => {
    const { client, provider } = makeProvider();
    jest.spyOn(client.Sandbox, 'getInfo').mockResolvedValue({
      sandboxId: 'opaque-id',
      templateId: 'template-1',
      metadata: { trueforge_tenant_id: 'tenant-b' },
      startedAt: new Date(),
      endAt: new Date(),
      state: 'running',
      cpuCount: 1,
      memoryMB: 512,
      envdVersion: '0.5.7',
    });
    const connectMock = jest.spyOn(client.Sandbox, 'connect');

    await expect(provider.downloadFile({ sandboxId: 'opaque-id', path: '/tmp/file' })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('returns nonzero command exits as successful infrastructure calls', async () => {
    const { client, provider } = makeProvider();
    const sandbox = new TestSandbox({ sandboxId: 'sandbox-1', trafficAccessToken: 'traffic-1' });
    jest.spyOn(client.Sandbox, 'create').mockResolvedValue(sandbox);
    await provider.createSandbox();
    jest
      .spyOn(sandbox.commands, 'run')
      .mockRejectedValue(new CommandExitError({ exitCode: 7, stdout: 'stdout\n', stderr: 'stderr\n' }));

    const result = await provider.exec({ sandboxId: 'sandbox-1', command: 'exit 7', timeoutSeconds: 2 });

    expect(result).toEqual({
      success: true,
      response: { exitCode: 7, result: 'stdout\nstderr\n' },
    });
  });

  it('maps missing files to the sandbox domain error', async () => {
    const { client, provider } = makeProvider();
    const sandbox = new TestSandbox({ sandboxId: 'sandbox-1', trafficAccessToken: 'traffic-1' });
    jest.spyOn(client.Sandbox, 'create').mockResolvedValue(sandbox);
    await provider.createSandbox();
    jest.spyOn(sandbox.files, 'getInfo').mockRejectedValueOnce(new FileNotFoundError('missing'));
    await expect(provider.downloadFile({ sandboxId: 'sandbox-1', path: '/tmp/missing' })).rejects.toBeInstanceOf(
      SandboxFileNotFoundError,
    );
  });
});
