/**
 * Serializes agent updates that also call ServiceFoundry.
 * Implementations: Postgres advisory xact lock, or a no-op for SQLite.
 */
export type WithAgentUpdateLock<TTransaction> = <T>(
  input: { tenant_id: string; id: string },
  fn: (transaction: TTransaction | undefined) => Promise<T>,
) => Promise<T>;

export function withoutAgentUpdateLock<TTransaction>(): WithAgentUpdateLock<TTransaction> {
  return async (_input, fn) => fn(undefined);
}
