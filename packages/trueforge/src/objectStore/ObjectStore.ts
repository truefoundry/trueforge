export type PresignInput =
  { method: 'PUT'; key: string; size_bytes: number; sha256_b64: string } | { method: 'GET'; key: string };

export interface PresignedRequest {
  url: string;
  /** Must be sent unchanged with the request; they are part of the signature. */
  headers: Record<string, string>;
}

/** Lets a sandbox or browser move bytes straight to the store instead of through the server. */
export interface DirectTransfer {
  presign(input: PresignInput): Promise<PresignedRequest>;
  /** Confirms a presigned PUT really landed with the signed size and checksum. */
  verify(input: { key: string; size_bytes: number; sha256_b64: string }): Promise<boolean>;
}

/** Server-side byte storage addressed by `/`-separated keys. */
export interface ObjectStore {
  put(input: { key: string; body: Uint8Array }): Promise<void>;
  /** Resolves `undefined` when the key does not exist. */
  get(key: string): Promise<ReadableStream<Uint8Array> | undefined>;
  direct?: DirectTransfer;
}

/** Rejects absolute, empty-segment, and `.` / `..` keys so no key can escape its prefix. */
export function assertObjectKey(key: string): void {
  if (key.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid object key: ${JSON.stringify(key)}`);
  }
}
