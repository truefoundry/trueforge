import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../../../src/objectStore/S3ObjectStore';

const SHA256_B64 = 'jNu2+qtXI4r4KfDiYJuqkhR0bqxH82xwinR2S54qVEM=';
const OBJECT = { key: 'artifacts/t1/a1/p1/index.html', size_bytes: 307, sha256_b64: SHA256_B64 };

function createStore(prefix = 'trueforge') {
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake' },
  });
  const store = new S3ObjectStore({ client, bucket: 'bucket', prefix, presignTtlSeconds: 300 });
  return { client, store };
}

describe('S3ObjectStore', () => {
  it('presigns a PUT bound to size and checksum headers', async () => {
    const { store } = createStore();

    const request = await store.presignPut(OBJECT);

    const url = new URL(request.url);
    expect(url.pathname).toBe('/trueforge/artifacts/t1/a1/p1/index.html');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host;x-amz-checksum-sha256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(request.headers).toEqual({ 'content-length': '307', 'x-amz-checksum-sha256': SHA256_B64 });
  });

  it('uses the key as-is when the prefix is empty', async () => {
    const { client, store } = createStore('');
    const send = jest
      .spyOn(client, 'send')
      .mockImplementation(() =>
        Promise.resolve({ $metadata: {}, Contents: [{ Key: 'artifacts/t1/a1/p1/index.html', Size: 307 }] }),
      );

    const url = new URL((await store.presignPut(OBJECT)).url);
    await expect(store.listObjects({ prefix: 'artifacts/t1/a1/p1/' })).resolves.toEqual([
      { key: 'artifacts/t1/a1/p1/index.html', size_bytes: 307 },
    ]);

    expect(url.pathname).toBe('/artifacts/t1/a1/p1/index.html');
    expect(send.mock.calls[0]?.[0]?.input).toMatchObject({ Prefix: 'artifacts/t1/a1/p1/' });
  });

  it('lists objects under the prefix across pages, relative to the store prefix', async () => {
    const { client, store } = createStore();
    const send = jest
      .spyOn(client, 'send')
      .mockImplementationOnce(() =>
        Promise.resolve({
          $metadata: {},
          IsTruncated: true,
          NextContinuationToken: 'next',
          Contents: [{ Key: 'trueforge/artifacts/t1/a1/p1/index.html', Size: 307 }],
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          $metadata: {},
          IsTruncated: false,
          Contents: [{ Key: 'trueforge/artifacts/t1/a1/p1/img/chart.png', Size: 3 }],
        }),
      );

    await expect(store.listObjects({ prefix: 'artifacts/t1/a1/p1/' })).resolves.toEqual([
      { key: 'artifacts/t1/a1/p1/index.html', size_bytes: 307 },
      { key: 'artifacts/t1/a1/p1/img/chart.png', size_bytes: 3 },
    ]);
    const [first, second] = send.mock.calls.map(([command]) => command);
    expect(first).toBeInstanceOf(ListObjectsV2Command);
    expect(first?.input).toEqual({ Bucket: 'bucket', Prefix: 'trueforge/artifacts/t1/a1/p1/' });
    expect(second?.input).toEqual({
      Bucket: 'bucket',
      Prefix: 'trueforge/artifacts/t1/a1/p1/',
      ContinuationToken: 'next',
    });
  });

  it('lists nothing when no object was uploaded', async () => {
    const { client, store } = createStore();
    jest.spyOn(client, 'send').mockImplementation(() => Promise.resolve({ $metadata: {}, KeyCount: 0 }));

    await expect(store.listObjects({ prefix: 'artifacts/t1/a1/p1/' })).resolves.toEqual([]);
  });
});
