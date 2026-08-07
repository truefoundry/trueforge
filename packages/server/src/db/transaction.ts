/** Route-owned transaction boundary: opens a tx and passes the handle into the callback. */
export type WithTransaction<TTransaction> = <T>(callback: (transaction: TTransaction) => Promise<T>) => Promise<T>;
