import { HTTPException } from 'hono/http-exception';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executorFromTurnId, mintPeeredTurnId } from './peeringIds';

function isBadRequest(error: unknown): boolean {
  return error instanceof HTTPException && error.status === 400;
}

describe('mintPeeredTurnId', () => {
  it('mints <ulid>.<executorId> and round-trips through executorFromTurnId', () => {
    const turnId = mintPeeredTurnId('srv1ab');
    const parts = turnId.split('.');
    assert.equal(parts.length, 2);
    assert.match(parts[0] ?? '', /^[0-9a-z]{26}$/);
    assert.equal(executorFromTurnId(turnId), 'srv1ab');
  });

  it('rejects an empty executorId', () => {
    assert.throws(() => mintPeeredTurnId(''), /non-empty/);
  });

  it("rejects an executorId containing '.'", () => {
    assert.throws(() => mintPeeredTurnId('a.b'), /without '\./);
  });
});

describe('executorFromTurnId', () => {
  it('extracts the executor from a 2-segment id', () => {
    assert.equal(executorFromTurnId('01hxyzabcdefghijklmnopqrst.srv1ab'), 'srv1ab');
  });

  it('throws 400 for a bare ulid', () => {
    assert.throws(() => executorFromTurnId('01hxyzabcdefghijklmnopqrst'), isBadRequest);
  });

  it('throws 400 for ids with more than two segments', () => {
    assert.throws(() => executorFromTurnId('01hxyzabcdefghijklmnopqrst.g.srv1ab'), isBadRequest);
  });

  it('throws 400 for an empty executor segment', () => {
    assert.throws(() => executorFromTurnId('01hxyzabcdefghijklmnopqrst.'), isBadRequest);
  });
});
