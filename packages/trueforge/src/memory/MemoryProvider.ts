import type { MemoryFact } from '@truefoundry/trueforge-core/core';
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
  /**
   * The previous attempt at this exchange failed, possibly after the provider stored it (e.g. a
   * timeout). The provider checks before sending, so a retry doesn't store it twice.
   */
  mayAlreadyBeStored: boolean;
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
 * Long-term memory backend shared by ingestion (controller) and retrieval and writes (agent turns).
 * Every call names its scope; callers derive it with `resolveMemoryScope`, never from model input.
 */
export interface MemoryProvider {
  readonly name: MemoryProviderName;
  /** Resolves once the provider has accepted the exchange; extraction may finish later. */
  ingestExchange(input: IngestExchangeInput): Promise<{ externalThreadId: string }>;
  /**
   * The scope's user summary; null when the user or summary doesn't exist yet. Single attempt, for
   * the latency-bound session start; `signal` aborts it.
   */
  getUserSummary(input: { scope: MemoryScope; signal: AbortSignal | undefined }): Promise<string | null>;
  /** Facts in the scope's memory relevant to `query`, best first; empty when the user doesn't exist yet. */
  search(input: { scope: MemoryScope; query: string; limit: number }): Promise<MemoryFact[]>;
  /** Store a note the user asked to be remembered; the provider extracts facts from it later. */
  addMemory(input: { scope: MemoryScope; content: string; sessionId: string; createdAt: string }): Promise<void>;
}
