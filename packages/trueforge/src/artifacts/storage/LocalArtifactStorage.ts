import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { assertBundlePath, type ArtifactBlobStorage } from './ArtifactBlobStorage';

/**
 * Files live under `{root}/{prefix}/{path}`. `prefix` stored on the version is
 * relative to `root`, so moving the data directory does not invalidate rows.
 * Writes land in a temp file in the same directory and are then renamed.
 */
export class LocalArtifactStorage implements ArtifactBlobStorage {
  readonly backend = 'local' as const;
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  resolvePrefix(input: { key: string }): string {
    assertBundlePath(input.key);
    return input.key;
  }

  async put(input: { prefix: string; path: string; body: Buffer; mediaType: string }): Promise<void> {
    const destination = this.#resolve(input.prefix, input.path);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${String(process.pid)}.tmp`;
    await writeFile(temporary, input.body);
    await rename(temporary, destination);
  }

  get(input: { prefix: string; path: string }): Promise<Readable> {
    return Promise.resolve().then(() => createReadStream(this.#resolve(input.prefix, input.path)));
  }

  async deletePrefix(input: { prefix: string }): Promise<void> {
    const directory = this.#resolve(input.prefix, undefined);
    await rm(directory, { recursive: true, force: true });
  }

  #resolve(prefix: string, filePath: string | undefined): string {
    assertBundlePath(prefix);
    if (filePath !== undefined) {
      assertBundlePath(filePath);
    }
    const relative = filePath === undefined ? prefix : path.posix.join(prefix, filePath);
    const resolved = path.resolve(this.#root, relative);
    const rootWithSep = this.#root.endsWith(path.sep) ? this.#root : `${this.#root}${path.sep}`;
    if (resolved !== this.#root && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Artifact path escapes storage root: ${relative}`);
    }
    return resolved;
  }
}
