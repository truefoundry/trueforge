import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCAL_EXECUTOR_ID, parseBoolean, resolveExecutorId, resolveRedisUrl } from '../../src/config';

/** Restores REDIS_URL so these cases cannot leak into each other. */
const withRedisUrl = (value: string | undefined, run: () => void): void => {
  const previous = process.env['REDIS_URL'];
  if (value === undefined) {
    delete process.env['REDIS_URL'];
  } else {
    process.env['REDIS_URL'] = value;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env['REDIS_URL'];
    } else {
      process.env['REDIS_URL'] = previous;
    }
  }
};

describe('parseBoolean', () => {
  it('falls back to the default when unset or blank', () => {
    assert.equal(parseBoolean({ envKey: 'FLAG', raw: undefined, defaultValue: true }), true);
    assert.equal(parseBoolean({ envKey: 'FLAG', raw: '  ', defaultValue: false }), false);
  });

  it('accepts true/false in any casing, with surrounding space', () => {
    assert.equal(parseBoolean({ envKey: 'FLAG', raw: 'true', defaultValue: false }), true);
    assert.equal(parseBoolean({ envKey: 'FLAG', raw: ' TRUE ', defaultValue: false }), true);
    assert.equal(parseBoolean({ envKey: 'FLAG', raw: 'False', defaultValue: true }), false);
  });

  it('rejects anything else rather than guessing', () => {
    // Reading an unrecognised value as false would silently disable peering.
    for (const raw of ['1', '0', 'yes', 'no', 'on', 'off', 'TRUEISH']) {
      assert.throws(
        () => parseBoolean({ envKey: 'FLAG', raw, defaultValue: true }),
        /must be "true" or "false"/,
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });
});

describe('resolveRedisUrl', () => {
  it('ignores a configured URL in single-binary mode', () => {
    withRedisUrl('redis://localhost:6379', () => {
      assert.equal(resolveRedisUrl(true), undefined);
    });
  });

  it('returns the URL when peering is on', () => {
    withRedisUrl('redis://localhost:6379', () => {
      assert.equal(resolveRedisUrl(false), 'redis://localhost:6379');
    });
  });

  it('refuses to boot a peered server without a URL', () => {
    for (const raw of [undefined, '', '   ']) {
      withRedisUrl(raw, () => {
        assert.throws(() => resolveRedisUrl(false), /REDIS_URL is required/);
      });
    }
  });
});

describe('resolveExecutorId', () => {
  it('is the fixed local id in single-binary mode', () => {
    assert.equal(resolveExecutorId(true), LOCAL_EXECUTOR_ID);
  });

  it('is distinct per process when peering', () => {
    assert.notEqual(resolveExecutorId(false), resolveExecutorId(false));
  });

  it('can never collide with the local id', () => {
    // Routing depends on this: a peer named `local` would swallow orphaned turns.
    for (let i = 0; i < 500; i += 1) {
      assert.notEqual(resolveExecutorId(false), LOCAL_EXECUTOR_ID);
    }
  });
});
