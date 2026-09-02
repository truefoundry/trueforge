import type { Sandbox } from '@daytona/sdk';
import { Daytona, DaytonaError } from '@daytona/sdk';
import { Readable } from 'node:stream';
import { DaytonaSandboxProvider } from '../../../src/core/sandbox/provider/DaytonaProvider';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxPathIsDirectoryError,
} from '../../../src/core/sandbox/SandboxErrors';
import { makeSilentLogger } from '../harnessMocks';

const NOT_FOUND_STATUS = 404;
const API_URL = 'https://daytona.test/api';
const SANDBOX_ID = 'test-tenant.dl-sandbox';

interface FsMockOverrides {
  details?: { size: number; isDir: boolean };
  fileNotFoundError?: boolean;
  stream?: Readable;
}

/** Provider wired to a fake SDK client whose `get` resolves a stub sandbox with mocked fs. */
function makeProviderWithFs(overrides: FsMockOverrides): DaytonaSandboxProvider {
  const client = new Daytona({ apiKey: 'dtn-test', useDeprecatedPolling: true });
  const sandbox = {
    state: 'started',
    refreshData: jest.fn(),
    start: jest.fn(),
    fs: {
      getFileDetails: jest.fn(() => {
        if (overrides.fileNotFoundError === true) {
          throw new DaytonaError('no such file', NOT_FOUND_STATUS);
        }
        return Promise.resolve(overrides.details ?? { size: 0, isDir: false });
      }),
      downloadFileStream: jest.fn(() => Promise.resolve(overrides.stream ?? Readable.from([]))),
    },
  };
  jest.spyOn(client, 'get').mockResolvedValue(sandbox as unknown as Sandbox);

  return new DaytonaSandboxProvider({
    client,
    apiKey: 'dtn-test',
    apiUrl: API_URL,
    tenantName: 'test-tenant',
    sandboxImage: 'registry.example.com/sandbox:029ea5ff',
    timeoutMs: 1000,
    autoStopIntervalInMinutes: 5,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 7200,
    fileMaxBytesForDownload: 1024,
    logger: makeSilentLogger(),
  });
}

async function drain(download: Awaited<ReturnType<DaytonaSandboxProvider['downloadFile']>>): Promise<Buffer> {
  const reader = download.stream.getReader();
  const parts: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value);
  }
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

describe('DaytonaSandboxProvider downloadFile streaming', () => {
  it('streams the file incrementally and reports the stat size', async () => {
    const provider = makeProviderWithFs({
      details: { size: 11, isDir: false },
      stream: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
    });

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'report.txt' });

    expect(download.size).toBe(11);
    expect((await drain(download)).toString()).toBe('hello world');
  });

  it('rejects directories and oversized files before opening the stream', async () => {
    const directoryProvider = makeProviderWithFs({ details: { size: 10, isDir: true } });
    await expect(directoryProvider.downloadFile({ sandboxId: SANDBOX_ID, path: 'dir' })).rejects.toBeInstanceOf(
      SandboxPathIsDirectoryError,
    );

    const oversizedProvider = makeProviderWithFs({ details: { size: 2048, isDir: false } });
    await expect(oversizedProvider.downloadFile({ sandboxId: SANDBOX_ID, path: 'big.bin' })).rejects.toBeInstanceOf(
      SandboxFileTooLargeError,
    );
  });

  it('maps a missing file to SandboxFileNotFoundError', async () => {
    const provider = makeProviderWithFs({ fileNotFoundError: true });

    await expect(provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'gone.txt' })).rejects.toBeInstanceOf(
      SandboxFileNotFoundError,
    );
  });

  it('enforces the cap again while streaming in case the file grew after stat', async () => {
    // Stat lies small; the actual stream exceeds fileMaxBytesForDownload (1024).
    const provider = makeProviderWithFs({
      details: { size: 8, isDir: false },
      stream: Readable.from([Buffer.alloc(700, 1), Buffer.alloc(700, 2)]),
    });

    const download = await provider.downloadFile({ sandboxId: SANDBOX_ID, path: 'grew.bin' });
    await expect(drain(download)).rejects.toBeInstanceOf(SandboxFileTooLargeError);
  });
});
