import { boundedFileStream } from '../../../../src/core/sandbox/provider/boundedFileStream';
import { SandboxFileTooLargeError } from '../../../../src/core/sandbox/SandboxErrors';

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ parts: Uint8Array[]; error?: unknown }> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return { parts };
      }
      parts.push(next.value);
    }
  } catch (error) {
    return { parts, error };
  } finally {
    reader.releaseLock();
  }
}

function sourceOf(chunks: Buffer[], hooks?: { onFinally?: () => void }): () => AsyncGenerator<Uint8Array> {
  return async function* () {
    try {
      for (const chunk of chunks) {
        yield chunk;
      }
    } finally {
      hooks?.onFinally?.();
    }
  };
}

describe('boundedFileStream', () => {
  it('forwards chunks in order without copying', async () => {
    const chunks = [Buffer.from('he'), Buffer.from('ll'), Buffer.from('o')];
    const stream = boundedFileStream({ path: 'f.bin', maxBytes: 100, chunks: sourceOf(chunks) });

    const { parts, error } = await drain(stream);

    expect(error).toBeUndefined();
    expect(parts.map(part => Buffer.from(part).toString())).toEqual(['he', 'll', 'o']);
  });

  it('errors with SandboxFileTooLargeError when streamed bytes exceed the cap', async () => {
    const chunks = [Buffer.alloc(60, 1), Buffer.alloc(60, 2)];
    const stream = boundedFileStream({ path: 'big.bin', maxBytes: 100, chunks: sourceOf(chunks) });

    const { parts, error } = await drain(stream);

    // The offending chunk is withheld: the client never sees past-the-cap bytes.
    expect(parts).toHaveLength(1);
    expect(error).toBeInstanceOf(SandboxFileTooLargeError);
    expect((error as SandboxFileTooLargeError).fileSize).toBe(120);
  });

  it('propagates source failures as stream errors', async () => {
    const stream = boundedFileStream({
      path: 'f.bin',
      maxBytes: 100,
      chunks: async function* () {
        yield Buffer.from('ok');
        throw new Error('backend exploded');
      },
    });

    const { parts, error } = await drain(stream);

    expect(parts.map(part => Buffer.from(part).toString())).toEqual(['ok']);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('backend exploded');
  });

  it('runs source cleanup when the consumer cancels mid-stream', async () => {
    let cleanedUp = false;
    const chunks = [Buffer.from('first'), Buffer.from('second'), Buffer.from('third')];
    const stream = boundedFileStream({
      path: 'f.bin',
      maxBytes: 100,
      chunks: sourceOf(chunks, { onFinally: () => (cleanedUp = true) }),
    });

    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();

    expect(cleanedUp).toBe(true);
  });
});
