import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSandboxSessionSegment, removeLocalSandboxSessionRoot } from '../../../../src/sandbox/localLifecycle';

async function createSessionRoot(rootParent: string, segment: string): Promise<string> {
  const root = join(rootParent, segment);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'agent.json'), '{}');
  return root;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('localSandboxSessionSegment', () => {
  it('keeps a single-segment session id and rejects missing or unsafe values', () => {
    expect(localSandboxSessionSegment('sess_1')).toBe('sess_1');
    expect(localSandboxSessionSegment(undefined)).toBe('_');
    expect(localSandboxSessionSegment('')).toBe('_');
    expect(localSandboxSessionSegment('a/b')).toBe('_');
    expect(localSandboxSessionSegment('..')).toBe('_');
    expect(localSandboxSessionSegment('foo..bar')).toBe('_');
  });
});

describe('removeLocalSandboxSessionRoot', () => {
  let rootParent: string;

  beforeEach(async () => {
    rootParent = await mkdtemp(join(tmpdir(), 'tfy-local-lifecycle-'));
  });

  afterEach(async () => {
    await rm(rootParent, { recursive: true, force: true });
  });

  it('removes only the target session root, leaving the parent and sibling roots in place', async () => {
    const target = await createSessionRoot(rootParent, 'sess_target');
    const sibling = await createSessionRoot(rootParent, 'sess_sibling');

    await removeLocalSandboxSessionRoot({ sandboxRootPathParent: rootParent, sessionId: 'sess_target' });

    expect(existsSync(target)).toBe(false);
    expect(await pathExists(rootParent)).toBe(true);
    expect(existsSync(sibling)).toBe(true);
    expect(await readFile(join(sibling, 'agent.json'), 'utf8')).toBe('{}');
  });

  it('is a no-op when the target session root does not exist', async () => {
    const sibling = await createSessionRoot(rootParent, 'sess_sibling');

    await expect(
      removeLocalSandboxSessionRoot({ sandboxRootPathParent: rootParent, sessionId: 'sess_missing' }),
    ).resolves.toBeUndefined();
    // Even a missing parent is a no-op.
    await expect(
      removeLocalSandboxSessionRoot({ sandboxRootPathParent: join(rootParent, 'gone'), sessionId: 'sess_missing' }),
    ).resolves.toBeUndefined();

    expect(await pathExists(rootParent)).toBe(true);
    expect(existsSync(sibling)).toBe(true);
  });

  it('never removes the shared fallback `_` segment', async () => {
    const fallback = await createSessionRoot(rootParent, '_');

    await removeLocalSandboxSessionRoot({ sandboxRootPathParent: rootParent, sessionId: '' });

    expect(existsSync(fallback)).toBe(true);
    expect(await readFile(join(fallback, 'agent.json'), 'utf8')).toBe('{}');
    expect(await pathExists(rootParent)).toBe(true);
  });
});
