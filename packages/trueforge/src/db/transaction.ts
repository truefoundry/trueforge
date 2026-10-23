import { Transaction, type Kysely } from 'kysely';

/** Route-owned transaction boundary: opens a tx and passes the handle into the callback. */
export type WithTransaction<TTransaction> = <T>(callback: (transaction: TTransaction) => Promise<T>) => Promise<T>;

/** Narrows a root `Kysely` or an open transaction so callers can reuse the open one. */
export function isTransaction<DB>(db: Kysely<DB> | Transaction<DB>): db is Transaction<DB> {
  return db instanceof Transaction;
}
