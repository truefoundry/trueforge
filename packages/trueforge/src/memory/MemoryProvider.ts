import type { MemoryScope } from './scope';

export const MEMORY_PROVIDER_NAMES = ['zep'] as const;
export type MemoryProviderName = (typeof MEMORY_PROVIDER_NAMES)[number];

export interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO-8601 UTC instant the message was produced. */
  createdAt: string;
  /** Speaker name shown to the provider (user display name or agent name). */
  name: string;
  /** False keeps the message as context only; the provider must not extract facts from it. */
  extract: boolean;
}

/** One user request and the turns that answered it, rendered for a provider. */
export interface MemoryExchange {
  sessionId: string;
  firstTurnId: string;
  lastTurnId: string;
  messages: MemoryMessage[];
}

export interface IngestExchangeInput {
  scope: MemoryScope;
  exchange: MemoryExchange;
  /** Provider-side thread for the session; null on the first exchange of a session. */
  externalThreadId: string | null;
}

/**
 * Ingestion failed. `externalThreadId` is the thread the session should keep using, which may have
 * been created during the failed attempt.
 */
export class MemoryIngestError extends Error {
  readonly externalThreadId: string | null;

  constructor({
    message,
    externalThreadId,
    cause,
  }: {
    message: string;
    externalThreadId: string | null;
    cause: unknown;
  }) {
    super(message, { cause });
    this.name = 'MemoryIngestError';
    this.externalThreadId = externalThreadId;
  }
}

/**
 * Long-term memory backend. Ingestion only for now; retrieval (user context, search), agent writes
 * and deletes will be added here so every caller shares one provider contract.
 */
export interface MemoryProvider {
  readonly name: MemoryProviderName;
  /** Resolves once the provider has accepted the exchange; extraction may finish later. */
  ingestExchange(input: IngestExchangeInput): Promise<{ externalThreadId: string }>;
}
