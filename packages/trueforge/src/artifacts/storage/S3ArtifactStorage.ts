import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { assertBundlePath, type ArtifactBlobStorage } from './ArtifactBlobStorage';

export interface S3ArtifactStorageOptions {
  bucket: string;
  /** Key prefix inside the bucket, with a trailing slash when non-empty. */
  keyPrefix: string;
  region: string | undefined;
  endpoint: string | undefined;
  forcePathStyle: boolean;
}

/**
 * `storage_location` is `s3://bucket/key-prefix`, including the bucket, so a later
 * config change does not point old versions at a different bucket.
 */
export class S3ArtifactStorage implements ArtifactBlobStorage {
  readonly backend = 's3' as const;
  readonly #bucket: string;
  readonly #keyPrefix: string;
  readonly #client: S3Client;

  constructor(options: S3ArtifactStorageOptions) {
    this.#bucket = options.bucket;
    this.#keyPrefix = options.keyPrefix;
    this.#client = new S3Client({
      ...(options.region === undefined ? {} : { region: options.region }),
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint, forcePathStyle: options.forcePathStyle }),
    });
  }

  resolvePrefix(input: { key: string }): string {
    assertBundlePath(input.key);
    return `s3://${this.#bucket}/${this.#keyPrefix}${input.key}`;
  }

  async put(input: { prefix: string; path: string; body: Buffer; mediaType: string }): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#objectKey(input.prefix, input.path),
        Body: input.body,
        ContentType: input.mediaType,
      }),
    );
  }

  async get(input: { prefix: string; path: string }): Promise<Readable> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: this.#objectKey(input.prefix, input.path) }),
    );
    const body = response.Body;
    if (!(body instanceof Readable)) {
      throw new Error('S3 object body is not a Node stream');
    }
    return body;
  }

  async deletePrefix(input: { prefix: string }): Promise<void> {
    const prefix = this.#objectKey(input.prefix, undefined);
    let continuationToken: string | undefined;
    do {
      const listed = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      const keys = (listed.Contents ?? []).flatMap(object => (object.Key === undefined ? [] : [{ Key: object.Key }]));
      if (keys.length > 0) {
        await this.#client.send(new DeleteObjectsCommand({ Bucket: this.#bucket, Delete: { Objects: keys } }));
      }
      continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
  }

  #objectKey(prefix: string, filePath: string | undefined): string {
    const expectedStart = `s3://${this.#bucket}/${this.#keyPrefix}`;
    if (!prefix.startsWith(expectedStart)) {
      throw new Error('Artifact storage location does not belong to this S3 bucket');
    }
    const relative = prefix.slice(expectedStart.length);
    assertBundlePath(relative);
    if (filePath === undefined) {
      return `${this.#keyPrefix}${relative}/`;
    }
    assertBundlePath(filePath);
    return `${this.#keyPrefix}${relative}/${filePath}`;
  }
}
