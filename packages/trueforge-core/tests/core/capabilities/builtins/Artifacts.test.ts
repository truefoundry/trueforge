import type { IArtifactsProvider, ScopedArtifactStore } from '../../../../src/core/artifacts/ArtifactsProvider';
import { artifacts, PUSH_ARTIFACT_TOOL_NAME } from '../../../../src/core/capabilities/builtins/Artifacts';
import type {
  ArtifactDirMetadata,
  ArtifactUploadRequest,
  ArtifactUploadResult,
} from '../../../../src/core/sandbox/artifacts/artifactTransfer';
import type { ArtifactTransferRun } from '../../../../src/core/sandbox/Sandbox';
import { NOOP_AGENT_TRACING } from '../../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../../harnessMocks';

const SANDBOX_INFO = { sandbox_id: 'v1:test:raw-1' };
const FILES = [
  { relative_path: 'index.html', size_bytes: 5, sha256_b64: 'aaa=' },
  { relative_path: 'img/chart.png', size_bytes: 3, sha256_b64: 'bbb=' },
];

type CreateVersionInput = Parameters<ScopedArtifactStore['createVersion']>[0];
type CreateArtifactWithVersionInput = Parameters<ScopedArtifactStore['createArtifactWithVersion']>[0];
type StoredObjects = Awaited<ReturnType<IArtifactsProvider['objectStore']['listObjects']>>;

const storedFiles = (prefix: string): StoredObjects =>
  FILES.map(f => ({ key: `${prefix}${f.relative_path}`, size_bytes: f.size_bytes }));

function run<T>(result: T): Promise<ArtifactTransferRun<T>> {
  return Promise.resolve({ result, sandboxInfo: SANDBOX_INFO, sandboxCreated: false });
}

function setup(
  options: {
    metadata?: ArtifactDirMetadata;
    uploaded?: ArtifactUploadResult;
    stored?: (prefix: string) => StoredObjects;
    accessDenied?: string;
  } = {},
) {
  const uploadRequests: ArtifactUploadRequest[] = [];
  const createdVersions: CreateVersionInput[] = [];
  const listedPrefixes: string[] = [];
  const newArtifactId = jest.fn(() => 'art-new');
  const createArtifactWithVersion = jest.fn((input: CreateArtifactWithVersionInput) => {
    createdVersions.push({ artifact_id: input.id, files_metadata: input.files_metadata });
    return Promise.resolve({ version: 1 });
  });
  const provider: IArtifactsProvider = {
    tenantId: 't1',
    store: {
      checkPushAccess: () => Promise.resolve(options.accessDenied),
      newArtifactId,
      createArtifactWithVersion,
      createVersion: input => {
        createdVersions.push(input);
        return Promise.resolve({ version: 2 });
      },
    },
    objectStore: {
      presignPut: input => Promise.resolve({ url: `https://s3.test/${input.key}`, headers: { 'content-length': '1' } }),
      listObjects: ({ prefix }) => {
        listedPrefixes.push(prefix);
        return Promise.resolve((options.stored ?? storedFiles)(prefix));
      },
    },
    limits: { max_files: 25, max_total_bytes: 1000 },
  };
  const [toolSet] =
    artifacts({
      provider,
      sandbox: {
        gatherArtifactDirMetadata: () =>
          run(options.metadata ?? { success: true, exit_code: 0, error: null, files: FILES }),
        uploadArtifactFiles: ({ request }) => {
          uploadRequests.push(request);
          return run(options.uploaded ?? { success: true, exit_code: 0, files: [] });
        },
      },
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    }).systemToolSets ?? [];
  const call = async (args: Record<string, unknown>) => {
    if (toolSet === undefined) {
      throw new Error('push_artifact tool set missing');
    }
    const response = await toolSet.callTool({ name: PUSH_ARTIFACT_TOOL_NAME, arguments: args });
    if (!('result' in response)) {
      throw new Error('expected a tool result');
    }
    const [content] = response.result.content;
    return {
      isError: response.result.isError === true,
      body: JSON.parse(content?.type === 'text' ? content.text : '{}') as Record<string, unknown>,
    };
  };
  return { call, toolSet, uploadRequests, createdVersions, listedPrefixes, newArtifactId, createArtifactWithVersion };
}

describe('push_artifact', () => {
  it('describes its limits and restrictions', async () => {
    const { toolSet } = setup();
    const listed = await toolSet?.listTools();
    if (!listed || 'authRequired' in listed) {
      throw new Error('expected listTools result');
    }
    expect(listed.result.tools[0]?.description).toContain('At most 25 files and 1000 bytes in total');
  });

  it('uploads every file, then creates the artifact with its first version', async () => {
    const { call, uploadRequests, listedPrefixes, newArtifactId, createArtifactWithVersion } = setup();
    const { isError, body } = await call({
      name: 'Q3 report',
      dir: '/home/trueforge/report',
      entry_point: 'index.html',
    });

    expect(isError).toBe(false);
    expect(body).toEqual({ artifact_id: 'art-new', version: 1, url: '/artifacts/art-new/v1' });
    expect(newArtifactId).toHaveBeenCalledWith({ name: 'Q3 report' });
    const rootPath = createArtifactWithVersion.mock.calls[0]?.[0].files_metadata.root_path ?? '';
    expect(rootPath).toMatch(/^artifacts\/t1\/art-new\/[0-9a-f-]+$/);
    expect(listedPrefixes).toEqual([`${rootPath}/`]);
    expect(createArtifactWithVersion).toHaveBeenCalledWith({
      id: 'art-new',
      name: 'Q3 report',
      files_metadata: { entry_point: 'index.html', total_bytes: 8, root_path: rootPath },
    });
    expect(uploadRequests[0]).toEqual({
      concurrency: 4,
      base_path: '/home/trueforge/report',
      files: FILES.map(f => ({
        relative_path: f.relative_path,
        url: `https://s3.test/${rootPath}/${f.relative_path}`,
        headers: { 'content-length': '1' },
      })),
    });
  });

  it('adds a version to an existing artifact', async () => {
    const { call, newArtifactId, createArtifactWithVersion, createdVersions } = setup();
    const { isError, body } = await call({
      artifact_id: 'art-1',
      dir: '/home/trueforge/report',
      entry_point: 'index.html',
    });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ artifact_id: 'art-1', version: 2 });
    expect(newArtifactId).not.toHaveBeenCalled();
    expect(createArtifactWithVersion).not.toHaveBeenCalled();
    expect(createdVersions[0]?.artifact_id).toBe('art-1');
  });

  it('normalizes entry_point', async () => {
    const { call, createdVersions } = setup();
    const { isError } = await call({ name: 'R', dir: '/home/trueforge/report', entry_point: './index.html' });
    expect(isError).toBe(false);
    expect(createdVersions[0]?.files_metadata.entry_point).toBe('index.html');
  });

  it.each<[string, Parameters<typeof setup>[0], Record<string, unknown>, string]>([
    ['missing name', {}, {}, 'name is required'],
    ['denied artifact', { accessDenied: 'Artifact not found: nope' }, { artifact_id: 'nope' }, 'Artifact not found'],
    [
      'sandbox metadata error',
      { metadata: { success: false, exit_code: 1, error: 'cannot read a: Permission denied', files: [] } },
      { name: 'R' },
      'Validation failed: cannot read a',
    ],
    [
      'failed upload',
      {
        uploaded: {
          success: false,
          exit_code: 1,
          files: [{ path: 'index.html', status: 403, error: 'SignatureDoesNotMatch' }],
        },
      },
      { name: 'R' },
      'Upload failed: index.html: SignatureDoesNotMatch',
    ],
    [
      'missing object',
      { stored: prefix => storedFiles(prefix).slice(1) },
      { name: 'R' },
      'Upload verification failed: index.html',
    ],
    [
      'size mismatch',
      { stored: prefix => storedFiles(prefix).map(o => ({ ...o, size_bytes: o.size_bytes + 1 })) },
      { name: 'R' },
      'Upload verification failed: index.html, img/chart.png',
    ],
    [
      'unexpected object',
      { stored: prefix => [...storedFiles(prefix), { key: `${prefix}extra.js`, size_bytes: 1 }] },
      { name: 'R' },
      'Upload verification failed: unexpected objects',
    ],
  ])('fails on %s', async (_name, options, args, expected) => {
    const { call, createdVersions } = setup(options);
    const { isError, body } = await call({ dir: '/home/trueforge/report', entry_point: 'index.html', ...args });
    expect(isError).toBe(true);
    expect(String(body['error_message'])).toContain(expected);
    expect(createdVersions).toHaveLength(0);
  });
});
