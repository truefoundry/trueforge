import { mintActiveExecutorId, parseActiveExecutorId } from '../../src/agent-session/activeExecutorId';

describe('parseActiveExecutorId', () => {
  it('splits executorId.generation', () => {
    expect(parseActiveExecutorId('abc123.a1f0')).toEqual({ executorId: 'abc123', generation: 'a1f0' });
  });

  it('treats a bare id as executor-only', () => {
    expect(parseActiveExecutorId('abc123')).toEqual({ executorId: 'abc123', generation: undefined });
  });

  it('does not treat a short suffix as generation', () => {
    expect(parseActiveExecutorId('abc123.12')).toEqual({ executorId: 'abc123.12', generation: undefined });
  });
});

describe('mintActiveExecutorId', () => {
  it('appends 4 hex chars and strips an existing suffix', () => {
    const minted = mintActiveExecutorId('abc123.a1f0', 'abc123.a1f0');
    expect(minted).toMatch(/^abc123\.[0-9a-f]{4}$/);
    expect(minted).not.toBe('abc123.a1f0');
  });
});
