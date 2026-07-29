import type { z } from 'zod';

/**
 * Global declaration-merging registry for private/feature passthrough events.
 *
 * Tradeoffs:
 * - Merging is ambient: there is no runtime registration table.
 * - Every TypeScript program that typechecks harness consumers must include the
 *   augmentation file(s) (see `src/agent/agentPassthroughEvents.d.ts`, and
 *   `tsconfig.json` / `tsconfig.test.json` includes). Without augmentation,
 *   `RegisteredPassthroughEvent` collapses to `never`.
 * - Compile fixtures: `tests/unit-tests/agent/harness/passthroughRegistration.compile.test.ts`.
 * - A future typed registry or `AgentThread<TPassthroughEvent>` generic is deferred.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging registry
export interface AgentPassthroughEventSchemaMap {}

export type RegisteredPassthroughEvent = {
  [K in keyof AgentPassthroughEventSchemaMap]: AgentPassthroughEventSchemaMap[K] extends z.ZodType<infer Event>
    ? Event & {
        type: K;
        /** Durable event identity and primary ordering key. */
        id: string;
        /** ISO-8601 event creation time; required for every persisted event. */
        created_at: string;
      }
    : never;
}[keyof AgentPassthroughEventSchemaMap];

/**
 * Include {@link RegisteredPassthroughEvent} in a union only when the registry
 * is non-empty. Avoids `T | never` when no augmentations are present.
 */
export type WithRegisteredPassthrough<T> = [RegisteredPassthroughEvent] extends [never]
  ? T
  : T | RegisteredPassthroughEvent;
