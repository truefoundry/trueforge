import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ArtifactObject, IObjectStore } from '@truefoundry/trueforge-core/core';
import type { S3Config } from '../config';

export class S3ObjectStore implements IObjectStore {
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

  async listObjects({ prefix }: { prefix: string }) {
    const objects: Pick<ArtifactObject, 'key' | 'size_bytes'>[] = [];
    const rootLength = this.#key('').length;
    let continuationToken: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: this.#key(prefix),
          ...(continuationToken !== undefined ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined && object.Size !== undefined) {
          objects.push({ key: object.Key.slice(rootLength), size_bytes: object.Size });
        }
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return objects;
  }

  #key(key: string): string {
    return this.#prefix === '' ? key : `${this.#prefix}/${key}`;
  }
}

export function createS3ObjectStore(config: S3Config): S3ObjectStore {
  return new S3ObjectStore({
    client: new S3Client({
      ...(config.region !== undefined ? { region: config.region } : {}),
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    }),
    bucket: config.bucket,
    prefix: config.prefix,
    presignTtlSeconds: config.presign_ttl_seconds,
  });
}
