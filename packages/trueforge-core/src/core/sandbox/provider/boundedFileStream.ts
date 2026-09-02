import { SandboxFileTooLargeError } from '../SandboxErrors';

export interface BoundedFileStreamParams {
  /** User-visible sandbox path used in cap-violation errors. */
  path: string;
  /** Hard byte ceiling; also enforced here because the pre-download stat can go stale. */
  maxBytes: number;
  /**
   * Provider-specific incremental source, created fresh per call so the generator's own
   * `finally` cleanup runs on completion, source errors, and consumer cancellation alike.
   */
  chunks: () => AsyncGenerator<Uint8Array>;
}

/**
 * Wraps incremental file chunks into a single-consumption web stream that enforces the
 * download cap while streaming. Consumer cancellation (`stream.cancel()`) returns the
 * underlying generator early, which runs its cleanup — providers stop their reads there.
 */
export function boundedFileStream(params: BoundedFileStreamParams): ReadableStream<Uint8Array> {
  const iterator = params.chunks();
  let streamed = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: IteratorResult<Uint8Array>;
      try {
        next = await iterator.next();
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (next.done) {
        controller.close();
        return;
      }
      streamed += next.value.byteLength;
      if (streamed > params.maxBytes) {
        // Held back rather than enqueued: the client never sees past-the-cap bytes.
        await iterator.return(undefined);
        controller.error(new SandboxFileTooLargeError(params.path, streamed, params.maxBytes));
        return;
      }
      controller.enqueue(next.value);
    },
    cancel() {
      void iterator.return(undefined);
    },
  });
}
