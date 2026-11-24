import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { assertObjectKey, type ObjectStore } from './ObjectStore';

/** Stores each key as a file under `root`. */
export class LocalObjectStore implements ObjectStore {
  private readonly root: string;

  constructor({ root }: { root: string }) {
    this.root = root;
  }

  async put({ key, body }: { key: string; body: Uint8Array }): Promise<void> {
    const filePath = this.filePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const filePath = this.filePath(key);
    try {
      const handle = await open(filePath, 'r');
      return Readable.toWeb(handle.createReadStream());
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private filePath(key: string): string {
    assertObjectKey(key);
    return path.join(this.root, ...key.split('/'));
  }
}
