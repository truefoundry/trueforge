import { S3Client } from '@aws-sdk/client-s3';

import type { ObjectStoreConfig } from '../config';
import { LocalObjectStore } from './LocalObjectStore';
import type { ObjectStore } from './ObjectStore';
import { S3ObjectStore } from './S3ObjectStore';

export function createObjectStore(config: ObjectStoreConfig): ObjectStore {
  switch (config.type) {
    case 'local':
      return new LocalObjectStore({ root: config.root });
    case 's3':
      return new S3ObjectStore({
        client: new S3Client({
          ...(config.region !== undefined ? { region: config.region } : {}),
          ...(config.endpoint !== undefined ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
        }),
        bucket: config.bucket,
        prefix: config.prefix,
        presignTtlSeconds: config.presignTtlSeconds,
      });
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unsupported object store: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
