import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  assertObjectKey,
  type DirectTransfer,
  type ObjectStore,
  type PresignInput,
  type PresignedRequest,
} from './ObjectStore';

export interface S3ObjectStoreOptions {
  client: S3Client;
  bucket: string;
  /** Joined in front of every key; empty for none. */
  prefix: string;
  presignTtlSeconds: number;
}

export class S3ObjectStore implements ObjectStore {
  readonly direct: DirectTransfer = {
    presign: input => this.presign(input),
    verify: input => this.verify(input),
  };

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly presignTtlSeconds: number;

  constructor({ client, bucket, prefix, presignTtlSeconds }: S3ObjectStoreOptions) {
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix;
    this.presignTtlSeconds = presignTtlSeconds;
  }

  async put({ key, body }: { key: string; body: Uint8Array }): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: body }));
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      if (response.Body === undefined) {
        throw new Error(`S3 returned no body for ${JSON.stringify(key)}`);
      }
      return response.Body.transformToWebStream();
    } catch (error) {
      if (error instanceof NoSuchKey) {
        return undefined;
      }
      throw error;
    }
  }

  private async presign(input: PresignInput): Promise<PresignedRequest> {
    const Key = this.objectKey(input.key);
    if (input.method === 'GET') {
      const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key }), {
        expiresIn: this.presignTtlSeconds,
      });
      return { url, headers: {} };
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key,
      ContentLength: input.size_bytes,
      ChecksumSHA256: input.sha256_b64,
    });
    // Keeps the checksum a signed header so S3 rejects a body that does not match it.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.presignTtlSeconds,
      signableHeaders: new Set(['content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      url,
      headers: { 'content-length': String(input.size_bytes), 'x-amz-checksum-sha256': input.sha256_b64 },
    };
  }

  private async verify({
    key,
    size_bytes,
    sha256_b64,
  }: {
    key: string;
    size_bytes: number;
    sha256_b64: string;
  }): Promise<boolean> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ChecksumMode: 'ENABLED' }),
      );
      return head.ContentLength === size_bytes && head.ChecksumSHA256 === sha256_b64;
    } catch (error) {
      if (error instanceof NotFound) {
        return false;
      }
      throw error;
    }
  }

  private objectKey(key: string): string {
    assertObjectKey(key);
    return this.prefix === '' ? key : `${this.prefix}/${key}`;
  }
}
