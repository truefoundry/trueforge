import { HTTPException } from 'hono/http-exception';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCAL_EXECUTOR_ID } from '../../../src/config';
import { executorFromTurnId, mintPeeredTurnId } from '../../../src/runtime/peeringIds';

describe('turn ids', () => {
  it('decodes back to the owning executor', () => {
    assert.equal(executorFromTurnId(mintPeeredTurnId('abc123')), 'abc123');
  });

  it('carries the local owner in single-binary mode', () => {
    // `local` is just this process's executor id, so routing needs no special grammar.
    assert.equal(executorFromTurnId(mintPeeredTurnId(LOCAL_EXECUTOR_ID)), LOCAL_EXECUTOR_ID);
  });

  it('mints a distinct id each time', () => {
    assert.notEqual(mintPeeredTurnId(LOCAL_EXECUTOR_ID), mintPeeredTurnId(LOCAL_EXECUTOR_ID));
  });

  it('rejects ids outside the grammar', () => {
    for (const invalid of ['', '.', 'a.', '.b', 'a.b.c', 'noseparator']) {
      assert.throws(
        () => executorFromTurnId(invalid),
        (error: unknown) => error instanceof HTTPException && error.status === 400,
        `expected ${JSON.stringify(invalid)} to be rejected`,
      );
    }
  });
});
