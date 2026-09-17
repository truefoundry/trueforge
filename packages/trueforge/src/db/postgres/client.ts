import { Kysely, PostgresDialect } from 'kysely';
import pg, { Pool } from 'pg';

import type { PostgresSslConfig } from '../../config';
import type { Database } from './types';

const INT8_OID = 20;
/**
 * Postgres OID for `bigint[]` / `_int8`. Scalar int8 parser (OID 20) does NOT cover arrays.
 * Widened setter: node-pg's TypeId enum omits array OIDs.
 */
const setTypeParserByOid: (oid: number, parser: (value: string) => unknown) => void = pg.types.setTypeParser.bind(
  pg.types,
);

/**
 * Parse a Postgres array literal of int8 into number[].
 * Safe below Number.MAX_SAFE_INTEGER (2^53) — same contract as the scalar int8 parser.
 * Identity append_ids stay far below that bound.
 */
function parseInt8Array(value: string): number[] {
  if (value === '{}' || value === '') {
    return [];
  }
  // Plain unquoted numeric elements (bigint[] never needs quotes).
  return value
    .slice(1, -1)
    .split(',')
    .map(element => Number(element));
}

function configurePgTypeParsers(): void {
  pg.types.setTypeParser(INT8_OID, Number);
  setTypeParserByOid(1016, parseInt8Array);
}

export function createDb(options: {
  connectionString: string;
  poolMax: number;
  /** Postgres `statement_timeout` in ms. Applied to every pooled connection. */
  statementTimeoutMs: number;
  /** Postgres `idle_in_transaction_session_timeout` in ms. Applied to every pooled connection. */
  idleInTransactionSessionTimeoutMs: number;
  schema: string;
  /** Client TLS for the pg Pool (`false` | `true` | `{ cert, key, ca, rejectUnauthorized }`). */
  ssl?: boolean | PostgresSslConfig | undefined;
}): Kysely<Database> {
  const { connectionString, poolMax, statementTimeoutMs, idleInTransactionSessionTimeoutMs, schema, ssl } = options;
  configurePgTypeParsers();
  const pool = new Pool({
    connectionString,
    max: poolMax,
    // pg default 0 waits forever; 10s covers in-cluster TCP+auth and fails fast if Postgres is down.
    connectionTimeoutMillis: 10_000,
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: idleInTransactionSessionTimeoutMs,
    options: `-c search_path=${schema}`,
    ...(ssl !== undefined ? { ssl } : {}),
  });
  // Idle clients emit 'error' when the backend closes; without a listener Node exits.
  pool.on('error', (error: Error) => {
    console.error('Unexpected Postgres pool error on idle client', error);
  });
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
  });
}

/**
 * Match Postgres errors by SQLSTATE without `instanceof DatabaseError`.
 * instanceof breaks silently when two copies of pg-protocol load (version skew / dual CJS+ESM);
 * checking `code` is the conventional node-postgres pattern.
 */
export function isPgErrorCode(err: unknown, code: string): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false;
  }
  return err.code === code;
}

export function isUniqueViolation(err: unknown): boolean {
  return isPgErrorCode(err, '23505');
}

/** Match a Postgres unique/PK violation to a named constraint or index. */
export function isPgConstraint(err: unknown, name: string): boolean {
  if (typeof err !== 'object' || err === null || !('constraint' in err)) {
    return false;
  }
  return err.constraint === name;
}
