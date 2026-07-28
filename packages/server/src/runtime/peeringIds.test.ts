import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executorFromTurnId, mintPeeredTurnId } from './peeringIds';

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

  it('returns undefined for a bare ulid', () => {
    assert.equal(executorFromTurnId('01hxyzabcdefghijklmnopqrst'), undefined);
  });

  it('returns undefined for 3-segment gateway-style ids', () => {
    assert.equal(executorFromTurnId('01hxyzabcdefghijklmnopqrst.g.srv1ab'), undefined);
  });

  it('returns undefined for an empty executor segment', () => {
    assert.equal(executorFromTurnId('01hxyzabcdefghijklmnopqrst.'), undefined);
  });
});
