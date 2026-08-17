import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalSandboxProvider,
  localSandboxSessionSegment,
} from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('LocalSandboxProvider layout', () => {
  let sandboxRootPathParent: string;
  let codeModeSocketParentPath: string;

  beforeEach(async () => {
    sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-layout-'));
    // Code Mode parent must stay ≤60 bytes after realpath; keep it short and shared.
    codeModeSocketParentPath = '/tmp/tfl';
    await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
  });

  afterEach(async () => {
    await rm(sandboxRootPathParent, { recursive: true, force: true });
  });

  it('uses cwd-relative uploads, skills, and git-downloader paths', () => {
    const provider = new LocalSandboxProvider({
      sandboxRootPathParent,
      codeModeSocketParentPath,
      support: { supported: true, platform: 'darwin', shell: '/bin/bash', python: '/usr/bin/python3' },
    });
    expect(provider.getFileUploadsDir('ignored')).toBe('uploads');
    expect(provider.getSkillsDir('ignored')).toBe('skills');
    expect(provider.getGitDownloaderPath('ignored')).toBe('git_downloader.py');
  });

  it('nests the sandbox root under a safe session id segment', () => {
    expect(localSandboxSessionSegment('sess_1')).toBe('sess_1');
    expect(join('/data/sandboxes', localSandboxSessionSegment('sess_1'), '01ulid')).toBe(
      '/data/sandboxes/sess_1/01ulid',
    );
  });

  it('falls back to _ when session id is missing or not a single path segment', () => {
    expect(localSandboxSessionSegment(undefined)).toBe('_');
    expect(localSandboxSessionSegment('')).toBe('_');
    expect(localSandboxSessionSegment('a/b')).toBe('_');
    expect(localSandboxSessionSegment('..')).toBe('_');
    expect(localSandboxSessionSegment('foo..bar')).toBe('_');
  });
});
