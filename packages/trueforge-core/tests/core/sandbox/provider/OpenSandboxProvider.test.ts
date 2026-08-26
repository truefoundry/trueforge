import winston from 'winston';

// Mock only Sandbox and SandboxManager (the pieces we call), while keeping the *real*
// exception classes so `instanceof SandboxApiException` checks in the provider still work.
// jest.requireActual is synchronous (unlike vitest's vi.importActual), so this factory
// doesn't need to be async.
jest.mock('@alibaba-group/opensandbox', () => {
  const actual = jest.requireActual<typeof import('@alibaba-group/opensandbox')>('@alibaba-group/opensandbox');
  return {
    ...actual,
    Sandbox: { create: jest.fn(), connect: jest.fn(), resume: jest.fn() },
    SandboxManager: { create: jest.fn() },
  };
});

import { Sandbox, SandboxApiException, SandboxError, SandboxManager } from '@alibaba-group/opensandbox';
import { OpenSandboxProvider } from '../../../../src/core/sandbox/provider/OpenSandboxProvider';
import {
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
} from '../../../../src/core/sandbox/SandboxErrors';

const logger = winston.createLogger({ transports: [] });

function fakeSandbox(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides['id'] ?? 'sbx-1',
    getInfo: jest
      .fn()
      .mockResolvedValue({ status: { state: 'Running' }, metadata: { 'trueforge.tenant': 'tenant-a' } }),
    resume: jest.fn(),
    kill: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    commands: { run: jest.fn() },
    files: { getFileInfo: jest.fn(), readBytes: jest.fn(), writeFiles: jest.fn() },
    getEndpoint: jest.fn().mockResolvedValue({ endpoint: 'localhost:4444' }),
    ...overrides,
  };
}

function fakeManager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listSnapshots: jest.fn().mockResolvedValue({ items: [] }),
    getSandboxInfo: jest.fn(),
    createSnapshot: jest.fn(),
    deleteSnapshot: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function apiError(statusCode: number, message = 'boom') {
  return new SandboxApiException({
    message,
    statusCode,
    error: new SandboxError(SandboxError.UNEXPECTED_RESPONSE, message),
  });
}

function makeProvider() {
  return new OpenSandboxProvider({
    domain: 'localhost:8080',
    apiKey: 'test-key',
    tenantName: 'tenant-a',
    sandboxImage: 'tfy.jfrog.io/tfy-images/trueforge-sandbox:0dab475d3d20a8333cff41f25f88e7134c424cf9',
    timeoutMs: 60_000,
    fileMaxBytesForDownload: 1024,
    logger,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (SandboxManager.create as jest.Mock).mockReturnValue(fakeManager());
});

describe('buildImage', () => {
  it("creates a throwaway sandbox and snapshots it, WITHOUT killing it immediately (that races the server's async commit job)", async () => {
    const manager = fakeManager({
      createSnapshot: jest.fn().mockResolvedValue({ id: 'snap-1', status: { state: 'Creating' } }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);
    const throwaway = fakeSandbox({ id: 'throwaway-1' });
    (Sandbox.create as jest.Mock).mockResolvedValue(throwaway);

    const provider = makeProvider();
    const build = await provider.buildImage();

    expect(manager.createSnapshot).toHaveBeenCalledWith('throwaway-1', {
      name: expect.stringContaining('trueforge-build-'),
    });
    expect(throwaway.kill).not.toHaveBeenCalled();
    expect(build.status).toBe('pending');

    (manager.listSnapshots as jest.Mock).mockResolvedValue({
      items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }],
    });
    await provider.getImageBuildStatus();
  });

  it('kills the throwaway sandbox once getImageBuildStatus sees the snapshot leave Creating', async () => {
    const listSnapshots = jest
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] });
    const manager = fakeManager({
      createSnapshot: jest.fn().mockResolvedValue({ id: 'snap-1', status: { state: 'Creating' } }),
      listSnapshots,
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);
    const throwaway = fakeSandbox({ id: 'throwaway-1' });
    (Sandbox.create as jest.Mock).mockResolvedValue(throwaway);

    const provider = makeProvider();
    await provider.buildImage();
    expect(throwaway.kill).not.toHaveBeenCalled();

    const build = await new OpenSandboxProvider({
      domain: 'localhost:8080',
      apiKey: 'test-key',
      tenantName: 'tenant-a',
      sandboxImage: 'tfy.jfrog.io/tfy-images/trueforge-sandbox:0dab475d3d20a8333cff41f25f88e7134c424cf9',
      timeoutMs: 60_000,
      fileMaxBytesForDownload: 1024,
      logger,
    }).getImageBuildStatus();
    expect(throwaway.kill).toHaveBeenCalled();
    expect(build.status).toBe('ready');
  });

  it('returns ready without creating a throwaway sandbox when a Ready snapshot already exists', async () => {
    const manager = fakeManager({
      listSnapshots: jest.fn().mockResolvedValue({
        items: [{ id: 'snap-existing', status: { state: 'Ready' }, createdAt: new Date() }],
      }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    const build = await provider.buildImage();

    expect(Sandbox.create).not.toHaveBeenCalled();
    expect(build.status).toBe('ready');
  });

  it('deletes a Failed snapshot and rebuilds rather than reporting failed forever', async () => {
    const manager = fakeManager({
      listSnapshots: jest.fn().mockResolvedValue({
        items: [{ id: 'snap-dead', status: { state: 'Failed', message: 'oom' }, createdAt: new Date() }],
      }),
      createSnapshot: jest.fn().mockResolvedValue({ id: 'snap-new', status: { state: 'Creating' } }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);
    (Sandbox.create as jest.Mock).mockResolvedValue(fakeSandbox({ id: 'throwaway-2' }));

    const provider = makeProvider();
    const build = await provider.buildImage();

    expect(manager.deleteSnapshot).toHaveBeenCalledWith('snap-dead');
    expect(build.status).toBe('pending');
  });
});

describe('exec', () => {
  it('maps stdout/stderr/exitCode and applies the provider exec timeout by default', async () => {
    const sandbox = fakeSandbox();
    (sandbox.commands.run as jest.Mock).mockResolvedValue({
      logs: { stdout: [{ text: '1\n' }], stderr: [] },
      exitCode: 0,
    });
    (Sandbox.create as jest.Mock).mockResolvedValue(sandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    const result = await provider.exec({ sandboxId: sandbox.id as string, command: 'echo 1' });

    expect(result).toEqual({ success: true, response: { exitCode: 0, result: '1\n' } });
    const optsArg = (sandbox.commands.run as jest.Mock).mock.calls[0][1];
    expect(optsArg).toEqual({ timeoutSeconds: 60 });
  });

  it('allows an individual command to override the provider exec timeout', async () => {
    const sandbox = fakeSandbox();
    (sandbox.commands.run as jest.Mock).mockResolvedValue({
      logs: { stdout: [], stderr: [] },
      exitCode: 0,
    });
    (Sandbox.create as jest.Mock).mockResolvedValue(sandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    await provider.exec({ sandboxId: sandbox.id as string, command: 'sleep 1', timeoutSeconds: 7 });

    expect(sandbox.commands.run).toHaveBeenCalledWith('sleep 1', { timeoutSeconds: 7 });
  });

  it('resumes a paused sandbox and retries once on a SandboxException', async () => {
    const staleSandbox = fakeSandbox({
      commands: { run: jest.fn().mockRejectedValue(apiError(409, 'sandbox is paused')) },
      getInfo: jest
        .fn()
        .mockResolvedValue({ status: { state: 'Paused' }, metadata: { 'trueforge.tenant': 'tenant-a' } }),
    });
    const freshSandbox = fakeSandbox({
      id: 'sbx-1',
      commands: { run: jest.fn().mockResolvedValue({ logs: { stdout: [{ text: 'ok' }], stderr: [] }, exitCode: 0 }) },
    });
    (staleSandbox.resume as jest.Mock).mockResolvedValue(freshSandbox);
    (Sandbox.create as jest.Mock).mockResolvedValue(staleSandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    const result = await provider.exec({ sandboxId: 'sbx-1', command: 'echo ok' });

    expect(staleSandbox.resume).toHaveBeenCalled();
    expect(freshSandbox.commands.run).toHaveBeenCalled();
    expect(result).toEqual({ success: true, response: { exitCode: 0, result: 'ok' } });
  });

  it('rethrows the original error when recovery finds the sandbox already Running (not a pause issue)', async () => {
    const sandbox = fakeSandbox({
      commands: { run: jest.fn().mockRejectedValue(apiError(500, 'transient infra error')) },
      getInfo: jest
        .fn()
        .mockResolvedValue({ status: { state: 'Running' }, metadata: { 'trueforge.tenant': 'tenant-a' } }),
    });
    (Sandbox.create as jest.Mock).mockResolvedValue(sandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    const result = await provider.exec({ sandboxId: sandbox.id as string, command: 'echo ok' });

    expect(sandbox.resume).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('refuses to operate on a sandbox owned by a different tenant', async () => {
    const manager = fakeManager({
      getSandboxInfo: jest
        .fn()
        .mockResolvedValue({ status: { state: 'Running' }, metadata: { 'trueforge.tenant': 'someone-else' } }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await expect(provider.exec({ sandboxId: 'not-mine', command: 'echo 1' })).rejects.toBeInstanceOf(
      SandboxNotAvailableError,
    );
  });

  it('surfaces a missing sandbox as SandboxNotAvailableError, not a raw SDK exception', async () => {
    const manager = fakeManager({ getSandboxInfo: jest.fn().mockRejectedValue(apiError(404)) });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await expect(provider.downloadFile({ sandboxId: 'gone', path: '/tmp/f' })).rejects.not.toBeInstanceOf(
      SandboxApiException,
    );
  });
});

describe('downloadFile guard rails', () => {
  it('throws SandboxFileTooLargeError before reading bytes', async () => {
    const sandbox = fakeSandbox({
      files: {
        getFileInfo: jest.fn().mockResolvedValue({ '/big': { size: 999_999, type: 'file' } }),
        readBytes: jest.fn(),
        writeFiles: jest.fn(),
      },
    });
    (Sandbox.create as jest.Mock).mockResolvedValue(sandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    await expect(provider.downloadFile({ sandboxId: sandbox.id as string, path: '/big' })).rejects.toBeInstanceOf(
      SandboxFileTooLargeError,
    );
    expect(sandbox.files.readBytes).not.toHaveBeenCalled();
  });

  it('throws SandboxPathIsDirectoryError for directories', async () => {
    const sandbox = fakeSandbox({
      files: {
        getFileInfo: jest.fn().mockResolvedValue({ '/dir': { size: 0, type: 'directory' } }),
        readBytes: jest.fn(),
        writeFiles: jest.fn(),
      },
    });
    (Sandbox.create as jest.Mock).mockResolvedValue(sandbox);
    const manager = fakeManager({
      listSnapshots: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'snap-1', status: { state: 'Ready' }, createdAt: new Date() }] }),
    });
    (SandboxManager.create as jest.Mock).mockReturnValue(manager);

    const provider = makeProvider();
    await provider.createSandbox();
    await expect(provider.downloadFile({ sandboxId: sandbox.id as string, path: '/dir' })).rejects.toBeInstanceOf(
      SandboxPathIsDirectoryError,
    );
  });
});
