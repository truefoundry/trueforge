import type { z } from 'zod';
import { InvalidPageTokenError } from './SessionStoreErrors';

export function encodePageToken<Output>(schema: z.ZodType<Output>, value: Output): string {
  const parsed = schema.parse(value);
  return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
}

export function decodePageToken<Output>(schema: z.ZodType<Output>, token: string): Output {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    return schema.parse(value);
  } catch {
    throw new InvalidPageTokenError(token);
  }
}
