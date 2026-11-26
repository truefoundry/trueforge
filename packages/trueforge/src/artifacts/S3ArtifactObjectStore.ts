import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config';
import type { ArtifactObject, ArtifactUploadTransfer } from './pushArtifact';

/** S3 store for artifacts. */
export class S3ArtifactObjectStore implements ArtifactUploadTransfer {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #presignTtlSeconds: number;

  constructor(input: { client: S3Client; bucket: string; prefix: string; presignTtlSeconds: number }) {
    this.#client = input.client;
    this.#bucket = input.bucket;
    this.#prefix = input.prefix;
    this.#presignTtlSeconds = input.presignTtlSeconds;
  }

  async presignPut({ key, size_bytes, sha256_b64 }: ArtifactObject) {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: this.#key(key),
      ContentLength: size_bytes,
      ChecksumSHA256: sha256_b64,
    });
    // Keeps the checksum a signed header, so S3 rejects a body that does not match it.
    const url = await getSignedUrl(this.#client, command, {
      expiresIn: this.#presignTtlSeconds,
      signableHeaders: new Set(['content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return { url, headers: { 'content-length': String(size_bytes), 'x-amz-checksum-sha256': sha256_b64 } };
  }

  async verify({ key, size_bytes, sha256_b64 }: ArtifactObject): Promise<boolean> {
    try {
      const head = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: this.#key(key), ChecksumMode: 'ENABLED' }),
      );
      return head.ContentLength === size_bytes && head.ChecksumSHA256 === sha256_b64;
    } catch (error) {
      if (error instanceof NotFound) {
        return false;
      }
      throw error;
    }
  }

  #key(key: string): string {
    return this.#prefix === '' ? key : `${this.#prefix}/${key}`;
  }
}

export function createS3ArtifactObjectStore(config: S3Config): S3ArtifactObjectStore {
  return new S3ArtifactObjectStore({
    client: new S3Client({
      ...(config.region !== undefined ? { region: config.region } : {}),
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    }),
    bucket: config.bucket,
    prefix: config.prefix,
    presignTtlSeconds: config.presign_ttl_seconds,
  });
}
