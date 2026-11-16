import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalArtifactStorage } from '../../../src/artifacts/storage/LocalArtifactStorage';

describe('LocalArtifactStorage', () => {
  it('writes atomically and refuses a path that escapes the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-storage-'));
    const storage = new LocalArtifactStorage(root);
    const prefix = storage.resolvePrefix({ key: 'tenant/art/ver' });
    await storage.put({
      prefix,
      path: 'assets/app.css',
      body: Buffer.from('body{}'),
      mediaType: 'text/css',
    });
    const written = await readFile(path.join(root, 'tenant/art/ver/assets/app.css'), 'utf8');
    expect(written).toBe('body{}');
    const stream = await storage.get({ prefix, path: 'assets/app.css' });
    expect(Buffer.concat(await readAll(stream)).toString('utf8')).toBe('body{}');
    expect(() => storage.resolvePrefix({ key: '../outside' })).toThrow(/Invalid artifact path/);
    await expect(storage.get({ prefix, path: '../secret' })).rejects.toThrow(/Invalid artifact path/);
    await storage.deletePrefix({ prefix });
    await expect(readFile(path.join(root, 'tenant/art/ver/assets/app.css'))).rejects.toThrow();
  });
});

async function readAll(stream: Readable): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks;
}
