import { GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, S3Client } from '@aws-sdk/client-s3';

import { S3ObjectStore } from '../../../src/objectStore/S3ObjectStore';

const SHA256_B64 = 'jNu2+qtXI4r4KfDiYJuqkhR0bqxH82xwinR2S54qVEM=';

function createStore() {
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake' },
  });
  const store = new S3ObjectStore({ client, bucket: 'bucket', prefix: 'trueforge', presignTtlSeconds: 300 });
  return { client, store };
}

describe('S3ObjectStore', () => {
  it('presigns a PUT bound to size and checksum headers', async () => {
    const { store } = createStore();

    const request = await store.direct.presign({
      method: 'PUT',
      key: 'a/b.html',
      size_bytes: 307,
      sha256_b64: SHA256_B64,
    });

    const url = new URL(request.url);
    expect(url.pathname).toBe('/trueforge/a/b.html');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host;x-amz-checksum-sha256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(request.headers).toEqual({ 'content-length': '307', 'x-amz-checksum-sha256': SHA256_B64 });
  });

  it('presigns a GET without extra headers', async () => {
    const { store } = createStore();

    const request = await store.direct.presign({ method: 'GET', key: 'a/b.html' });

    expect(new URL(request.url).pathname).toBe('/trueforge/a/b.html');
    expect(request.headers).toEqual({});
  });

  it('returns undefined from get when the key is missing', async () => {
    const { client, store } = createStore();
    const send = jest.spyOn(client, 'send').mockImplementation(() => {
      throw new NoSuchKey({ message: 'missing', $metadata: {} });
    });

    await expect(store.get('a/missing.html')).resolves.toBeUndefined();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command?.input).toEqual({ Bucket: 'bucket', Key: 'trueforge/a/missing.html' });
  });

  it.each([
    { name: 'matches', head: { ContentLength: 307, ChecksumSHA256: SHA256_B64 }, expected: true },
    { name: 'size differs', head: { ContentLength: 306, ChecksumSHA256: SHA256_B64 }, expected: false },
    { name: 'checksum missing', head: { ContentLength: 307 }, expected: false },
  ])('verify: $name', async ({ head, expected }) => {
    const { client, store } = createStore();
    const send = jest.spyOn(client, 'send').mockImplementation(() => Promise.resolve({ $metadata: {}, ...head }));

    await expect(store.direct.verify({ key: 'a/b.html', size_bytes: 307, sha256_b64: SHA256_B64 })).resolves.toBe(
      expected,
    );
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command?.input).toEqual({ Bucket: 'bucket', Key: 'trueforge/a/b.html', ChecksumMode: 'ENABLED' });
  });

  it('verify returns false when the object was never uploaded', async () => {
    const { client, store } = createStore();
    jest.spyOn(client, 'send').mockImplementation(() => {
      throw new NotFound({ message: 'not found', $metadata: {} });
    });

    await expect(store.direct.verify({ key: 'a/b.html', size_bytes: 307, sha256_b64: SHA256_B64 })).resolves.toBe(
      false,
    );
  });
});
