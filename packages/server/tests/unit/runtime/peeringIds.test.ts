import { HTTPException } from 'hono/http-exception';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executorFromTurnId, mintPeeredTurnId } from '../../../src/runtime/peeringIds';

describe('turn ids', () => {
  it('decodes back to the owning executor', () => {
    assert.equal(executorFromTurnId(mintPeeredTurnId('abc123')), 'abc123');
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
