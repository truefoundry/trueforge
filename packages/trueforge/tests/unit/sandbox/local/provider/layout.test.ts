import { localSandboxSessionSegment } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('localSandboxSessionSegment', () => {
  it('keeps a single-segment session id and rejects missing or unsafe values', () => {
    expect(localSandboxSessionSegment('sess_1')).toBe('sess_1');
    expect(localSandboxSessionSegment(undefined)).toBe('_');
    expect(localSandboxSessionSegment('')).toBe('_');
    expect(localSandboxSessionSegment('a/b')).toBe('_');
    expect(localSandboxSessionSegment('..')).toBe('_');
    expect(localSandboxSessionSegment('foo..bar')).toBe('_');
  });
});
