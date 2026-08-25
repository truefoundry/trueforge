/**
 * Code Mode UDS payload: one UTF-8 JSON value per connection.
 * Peer write-close (EOF) delimits the message; no length prefix.
 */
import { JsonMessageValueSchema } from '../schemas/jsonMessage.js';

export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeJsonMessage(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

/** Accumulates inbound socket bytes until EOF, then parses JSON. */
export class JsonMessageReader {
  #buffer = Buffer.alloc(0);
  readonly #maxBytes: number;

  constructor(options: { maxBytes?: number } = {}) {
    this.#maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
  }

  push(chunk: Buffer): void {
    if (this.#buffer.length + chunk.length > this.#maxBytes) {
      throw new Error(`message exceeds max ${String(this.#maxBytes)} bytes`);
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
  }

  finish(): unknown {
    try {
      return JsonMessageValueSchema.parse(JSON.parse(this.#buffer.toString('utf8')));
    } catch (error) {
      throw new Error('invalid JSON message', { cause: error });
    }
  }
}
