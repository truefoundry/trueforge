import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { providerOf } from '../src/harnessBuilderServer';

describe('harnessBuilderServer', () => {
  it('providerOf takes the segment before the first slash', () => {
    assert.equal(providerOf('openai/gpt-4o'), 'openai');
    assert.equal(providerOf('anthropic/claude-sonnet-4'), 'anthropic');
  });

  it('providerOf falls back to the full name when there is no slash', () => {
    assert.equal(providerOf('gpt-4o'), 'gpt-4o');
  });
});
