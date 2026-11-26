import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { ArtifactValidateResult } from '@truefoundry/trueforge-core/core';
import type { ArtifactTransferRun } from '@truefoundry/trueforge-core/core/sandbox/Sandbox';
import type {
  ArtifactUploadRequest,
  ArtifactUploadResult,
} from '@truefoundry/trueforge-core/core/sandbox/artifactTransfer';
import { NOOP_AGENT_TRACING } from '@truefoundry/trueforge-core/core/tracing/NoopAgentTracing';
import { createLogger } from 'winston';
import {
  PUSH_ARTIFACT_TOOL_NAME,
  pushArtifactCapability,
  type PushArtifactDeps,
} from '../../../src/artifacts/pushArtifact';
import type { ArtifactRecord, ArtifactVersionRecord, CreateArtifactVersionInput } from '../../../src/db/artifactStore';

const SUBJECT: Subject = { subject_id: 'u1', subject_type: 'user', subject_display_name: 'User' };
const SANDBOX_INFO = { sandbox_id: 'v1:test:raw-1' };
const FILES = [
  { relative_path: 'index.html', size_bytes: 5, sha256_b64: 'aaa=' },
  { relative_path: 'img/chart.png', size_bytes: 3, sha256_b64: 'bbb=' },
];

function artifactRecord(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'art-1',
    tenant_id: 't1',
    name: 'Report',
    latest_version: 1,
    latest_entry_point: 'index.html',
    created_by_subject: SUBJECT,
    created_by_session_id: 's1',
    created_by_agent_id: null,
    created_at: '2026-11-26T00:00:00.000Z',
    updated_at: '2026-11-26T00:00:00.000Z',
    ...overrides,
  };
}

function run<T>(result: T): Promise<ArtifactTransferRun<T>> {
  return Promise.resolve({ result, sandboxInfo: SANDBOX_INFO, sandboxCreated: false });
}

function setup(
  options: {
    validated?: ArtifactValidateResult;
    uploaded?: ArtifactUploadResult;
    verified?: boolean;
    existing?: ArtifactRecord;
  } = {},
) {
  const uploadRequests: ArtifactUploadRequest[] = [];
  const createdVersions: CreateArtifactVersionInput[] = [];
  const createArtifact = jest.fn(() => Promise.resolve(artifactRecord({ id: 'art-new', latest_version: 0 })));
  const deps: PushArtifactDeps = {
    artifactStore: {
      getArtifact: ({ id }) => Promise.resolve(options.existing?.id === id ? options.existing : undefined),
      createArtifact,
      createVersion: input => {
        createdVersions.push(input);
        const version: ArtifactVersionRecord = {
          artifact_id: input.artifact_id,
          version: 2,
          files_metadata: input.files_metadata,
          created_by_subject: input.created_by_subject,
          created_by_session_id: input.created_by_session_id,
          created_by_agent_id: input.created_by_agent_id,
          created_at: '2026-11-26T00:00:00.000Z',
        };
        return Promise.resolve(version);
      },
    },
    transfer: {
      presignPut: input => Promise.resolve({ url: `https://s3.test/${input.key}`, headers: { 'content-length': '1' } }),
      verify: () => Promise.resolve(options.verified ?? true),
    },
    limits: { max_files: 25, max_total_bytes: 1000 },
    sandbox: {
      validateArtifactDir: () =>
        run(options.validated ?? { mode: 'validate', success: true, exit_code: 0, error: null, files: FILES }),
      uploadArtifactFiles: ({ request }) => {
        uploadRequests.push(request);
        return run(options.uploaded ?? { mode: 'upload', success: true, exit_code: 0, files: [] });
      },
    },
    tenant_id: 't1',
    session_id: 's1',
    agent_id: 'agent-1',
    subject: SUBJECT,
    tracing: NOOP_AGENT_TRACING,
    logger: createLogger({ silent: true }),
  };
  const [toolSet] = pushArtifactCapability(deps).systemToolSets ?? [];
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
  return { call, uploadRequests, createdVersions, createArtifact };
}

describe('push_artifact', () => {
  it('creates an artifact, uploads every file and records the version', async () => {
    const { call, uploadRequests, createdVersions, createArtifact } = setup();
    const { isError, body } = await call({
      name: 'Q3 report',
      dir: '/home/trueforge/report',
      entry_point: 'index.html',
    });

    expect(isError).toBe(false);
    expect(body).toEqual({ artifact_id: 'art-new', version: 2, url: '/artifacts/art-new/v2' });
    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', name: 'Q3 report', created_by_agent_id: 'agent-1' }),
    );
    const rootPath = createdVersions[0]?.files_metadata.root_path ?? '';
    expect(rootPath).toMatch(/^artifacts\/t1\/art-new\/[0-9a-f-]+$/);
    expect(createdVersions[0]?.files_metadata).toEqual({
      entry_point: 'index.html',
      total_bytes: 8,
      root_path: rootPath,
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

  it('adds a version to an artifact the caller created', async () => {
    const { call, createArtifact, createdVersions } = setup({ existing: artifactRecord() });
    const { isError } = await call({ artifact_id: 'art-1', dir: '/home/trueforge/report', entry_point: 'index.html' });
    expect(isError).toBe(false);
    expect(createArtifact).not.toHaveBeenCalled();
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
    ['unknown artifact', {}, { artifact_id: 'nope' }, 'Artifact not found'],
    [
      'artifact created by someone else',
      { existing: artifactRecord({ created_by_subject: { ...SUBJECT, subject_id: 'u2' } }) },
      { artifact_id: 'art-1' },
      'does not have access to push to this artifact',
    ],
    [
      'sandbox validation error',
      {
        validated: { mode: 'validate', success: false, exit_code: 1, error: 'symlinks are not allowed: a', files: [] },
      },
      { name: 'R' },
      'Validation failed: symlinks are not allowed',
    ],
    [
      'failed upload',
      {
        uploaded: {
          mode: 'upload',
          success: false,
          exit_code: 1,
          files: [{ path: 'index.html', status: 403, error: 'SignatureDoesNotMatch' }],
        },
      },
      { name: 'R' },
      'Upload failed: index.html: SignatureDoesNotMatch',
    ],
    ['verify mismatch', { verified: false }, { name: 'R' }, 'Upload verification failed'],
  ])('fails on %s', async (_name, options, args, expected) => {
    const { call, createdVersions } = setup(options);
    const { isError, body } = await call({ dir: '/home/trueforge/report', entry_point: 'index.html', ...args });
    expect(isError).toBe(true);
    expect(String(body['error_message'])).toContain(expected);
    expect(createdVersions).toHaveLength(0);
  });
});
