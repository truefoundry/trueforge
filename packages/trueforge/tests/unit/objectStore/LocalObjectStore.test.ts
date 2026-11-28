import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LocalObjectStore } from '../../../src/objectStore/LocalObjectStore';

describe('LocalObjectStore', () => {
  let root: string;
  let store: LocalObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'object-store-'));
    store = new LocalObjectStore({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads back what it wrote under nested keys', async () => {
    await store.put({ key: 'artifacts/t1/a1/p1/report/index.html', body: new TextEncoder().encode('<h1>hi</h1>') });

    const body = await store.get('artifacts/t1/a1/p1/report/index.html');

    expect(body).toBeDefined();
    expect(await new Response(body).text()).toBe('<h1>hi</h1>');
  });

  it('returns undefined for a missing key', async () => {
    await expect(store.get('artifacts/missing.txt')).resolves.toBeUndefined();
  });

  it.each(['/abs/key', 'a/../b', 'a//b', 'a/./b', 'a/', '', '..\\x', 'a\\b'])('rejects key %j', async key => {
    await expect(store.put({ key, body: new Uint8Array() })).rejects.toThrow('Invalid object key');
    await expect(store.get(key)).rejects.toThrow('Invalid object key');
  });
});
